import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import {
  LoginDto,
  RegisterCustomerDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { RoleType } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async registerCustomer(dto: RegisterCustomerDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Determine first and last name from fullName or explicit fields
    let firstName = dto.firstName || '';
    let lastName = dto.lastName || '';
    if (dto.fullName && (!firstName || !lastName)) {
      const parts = dto.fullName.trim().split(/\s+/);
      firstName = parts[0] || 'Customer';
      lastName = parts.slice(1).join(' ') || (dto.companyName ? dto.companyName : 'Admin');
    }
    if (!firstName) firstName = 'Customer';
    if (!lastName) lastName = 'Admin';

    const rawPassword = dto.password || '123456';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    return this.prisma.$transaction(async (tx) => {
      // Create Customer
      const customer = await tx.customer.create({
        data: {
          name: dto.companyName,
          email: dto.email,
          phone: dto.phone,
          city: dto.city,
        },
      });

      // Find or Create Starter Plan
      let starterPlan = await tx.plan.findUnique({ where: { code: 'STARTER' } });
      if (!starterPlan) {
        starterPlan = await tx.plan.create({
          data: {
            name: 'Starter Plan',
            code: 'STARTER',
            monthlyPrice: 29.0,
            yearlyPrice: 290.0,
            userLimit: 5,
            leadLimit: 500,
            storageLimit: BigInt(5368709120), // 5GB
            features: ['LEADS', 'CONTACTS', 'DEALS', 'TASKS'],
          },
        });
      }

      // Create Subscription
      await tx.customerSubscription.create({
        data: {
          customerId: customer.id,
          planId: starterPlan.id,
          startDate: new Date(),
          endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          status: 'TRIAL',
        },
      });

      // Create Admin Role for Customer
      const adminRole = await tx.role.create({
        data: {
          customerId: customer.id,
          name: 'Customer Administrator',
          type: RoleType.CUSTOMER_ADMIN,
          description: 'Full administrative access to customer workspace',
        },
      });

      // Create Admin User
      const user = await tx.user.create({
        data: {
          customerId: customer.id,
          email: dto.email,
          phone: dto.phone,
          firstName: firstName,
          lastName: lastName,
          passwordHash: hashedPassword,
          isVerified: true,
        },
      });

      // Assign Admin Role
      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: adminRole.id,
        },
      });

      const tokens = await this.generateTokens(user.id, customer.id, user.email);

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          customerId: customer.id,
          customerName: customer.name,
        },
        tokens,
      };
    });
  }

  async login(dto: LoginDto, targetApp?: 'ADMIN' | 'EMPLOYEE_MOBILE' | 'CUSTOMER') {
    const rawInput = (dto.email || '').trim();
    const normalizedEmail = rawInput.toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { phone: rawInput },
          { employee: { employeeCode: rawInput } },
          { employee: { email: normalizedEmail } },
          { employee: { phone: rawInput } },
        ],
      },
      include: {
        customer: true,
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Your account has been deactivated');
    }

    const hasSuperAdminRole = user.userRoles.some((ur) => ur.role?.type === RoleType.SUPER_ADMIN);
    const isEmployee = Boolean(user.employee);
    const isCustomer = Boolean(user.customerId && !isEmployee && !hasSuperAdminRole);

    if (!hasSuperAdminRole && user.customer && !user.customer.isActive) {
      throw new UnauthorizedException('Your company account is suspended');
    }

    const app = targetApp || dto.appType;

    // Strict Access Rules Matrix Enforcement
    if (app === 'ADMIN') {
      if (!hasSuperAdminRole) {
        if (isEmployee) {
          throw new ForbiddenException(
            'Access Denied: The Admin Panel is strictly for SUPER_ADMIN only. Other roles must use the mobile application.',
          );
        }
        throw new ForbiddenException(
          'Access Denied: Customer accounts cannot access the Admin Panel.',
        );
      }
    } else if (app === 'EMPLOYEE_MOBILE') {
      if (hasSuperAdminRole) {
        throw new ForbiddenException(
          'Access Denied: Admin accounts cannot access the Employee Mobile App.',
        );
      }
      if (isCustomer || !isEmployee) {
        throw new ForbiddenException(
          'Access Denied: Customer accounts cannot access the Employee Mobile App.',
        );
      }
      if (user.employee?.status !== 'ACTIVE') {
        throw new UnauthorizedException('Employee account is inactive.');
      }
      if (!user.employee?.mobileLoginEnabled) {
        throw new UnauthorizedException('Mobile login is disabled for this employee.');
      }
    } else if (app === 'CUSTOMER') {
      if (hasSuperAdminRole) {
        throw new ForbiddenException(
          'Access Denied: Admin accounts cannot access the Customer portal.',
        );
      }
      if (isEmployee) {
        throw new ForbiddenException(
          'Access Denied: Employee accounts cannot access the Customer portal.',
        );
      }
    } else {
      // General login endpoint validation
      if (isEmployee) {
        if (user.employee?.status !== 'ACTIVE') {
          throw new UnauthorizedException('Employee account is inactive.');
        }
        if (!user.employee?.mobileLoginEnabled) {
          throw new UnauthorizedException('Mobile login is disabled for this employee.');
        }
      }
    }

    const primaryRole = hasSuperAdminRole
      ? RoleType.SUPER_ADMIN
      : isEmployee
      ? RoleType.CUSTOM
      : user.userRoles[0]?.role?.type || (user.customerId ? RoleType.CUSTOMER_ADMIN : RoleType.CUSTOM);
    const roles = isEmployee && !hasSuperAdminRole
      ? ['EMPLOYEE', RoleType.CUSTOM]
      : user.userRoles.map((ur) => ur.role.type);

    const tokens = await this.generateTokens(user.id, user.customerId, user.email);

    const emp = user.employee;
    const employeeData = emp
      ? {
          id: emp.id,
          employeeId: emp.employeeCode,
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          email: emp.email,
          mobile: emp.phone || user.phone,
          phone: emp.phone || user.phone,
          branch: emp.branch || 'Head Office',
          office: emp.branch || 'Head Office',
          department: emp.department?.name || 'General',
          designation: emp.designation?.name || 'Staff',
          status: emp.status,
          mobileLoginEnabled: emp.mobileLoginEnabled,
          joiningDate: emp.joiningDate,
        }
      : null;

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || null,
        firstName: user.firstName,
        lastName: user.lastName,
        customerId: user.customerId,
        customerName: user.customer?.name || (user.customerId ? 'Enterprise Workspace' : 'Super Admin'),
        role: primaryRole,
        roles: roles.length > 0 ? roles : [primaryRole],
        employeeId: user.employee?.id || null,
        employeeCode: user.employee?.employeeCode || null,
        employee: employeeData,
      },
      tokens,
    };
  }

  async refreshToken(dto: RefreshTokenDto) {
    const rawToken = (dto.refreshToken || '').trim();
    if (!rawToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const refreshSecret =
      this.configService.get('JWT_REFRESH_SECRET') ||
      'quikboom_super_secret_jwt_refresh_key_2026';

    let payload: any;
    try {
      payload = this.jwtService.verify(rawToken, {
        secret: refreshSecret,
      });
    } catch (err) {
      try {
        const accessSecret =
          this.configService.get('JWT_SECRET') ||
          'quikboom_super_secret_jwt_access_key_2026';
        payload = this.jwtService.verify(rawToken, {
          secret: accessSecret,
        });
      } catch (e) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
    }

    const userId = Number(payload.sub ?? payload.id ?? payload.userId);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('Invalid refresh token payload');
    }

    const existingToken = await this.prisma.refreshToken.findUnique({
      where: { token: rawToken },
      include: { user: true },
    });

    if (existingToken && (existingToken.isRevoked || existingToken.expiresAt < new Date())) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user =
      existingToken?.user ||
      (await this.prisma.user.findUnique({
        where: { id: userId },
      }));

    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('User account inactive or missing');
    }

    if (existingToken) {
      await this.prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: { isRevoked: true },
      });
    }

    const tokens = await this.generateTokens(user.id, user.customerId, user.email);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokens,
      user: {
        id: user.id,
        email: user.email,
        customerId: user.customerId,
      },
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      return { message: 'If the email exists, a reset code will be sent.' };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: otp,
        otpExpiresAt: expiresAt,
      },
    });

    return { message: 'Password reset OTP generated successfully', otpMock: otp };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        otpCode: dto.token,
        otpExpiresAt: { gte: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashedPassword,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    return { message: 'Password reset successfully' };
  }

  async getProfile(userId: number | string) {
    const numericUserId = Number(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: numericUserId },
      include: {
        customer: true,
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const roles = user.userRoles.map((ur) => ur.role.type);

    const emp = user.employee;
    const employeeData = emp
      ? {
          id: emp.id,
          employeeId: emp.employeeCode,
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          email: emp.email,
          mobile: emp.phone || user.phone,
          phone: emp.phone || user.phone,
          branch: emp.branch || 'Head Office',
          office: emp.branch || 'Head Office',
          department: emp.department?.name || 'General',
          designation: emp.designation?.name || 'Staff',
          status: emp.status,
          mobileLoginEnabled: emp.mobileLoginEnabled,
          joiningDate: emp.joiningDate,
        }
      : null;

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      customerId: user.customerId,
      customerName: user.customer?.name || 'Enterprise Workspace',
      roles,
      employee: employeeData,
      employeeId: emp?.employeeCode || null,
      createdAt: user.createdAt,
    };
  }

  async getRoles(customerId?: number) {
    const roles = await this.prisma.role.findMany({
      where: customerId ? { customerId, deletedAt: null } : { deletedAt: null },
      include: {
        _count: {
          select: {
            rolePermissions: true,
            userRoles: true,
          },
        },
      },
    });

    return roles.map((r) => ({
      id: String(r.id),
      name: r.name,
      type: r.type,
      description: r.description || 'System role for CRM/HRM access',
      permissionsCount: r._count.rolePermissions || 24,
      usersCount: r._count.userRoles || 0,
      isSystem: r.type === RoleType.SUPER_ADMIN || !r.customerId,
    }));
  }

  private async generateTokens(userId: number, customerId: number | null, email: string) {
    const payload = { sub: userId, customerId, email };

    const accessExpiresIn =
      this.configService.get('JWT_ACCESS_EXPIRES_IN') ||
      this.configService.get('JWT_EXPIRATION') ||
      '7d';
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET') || 'quikboom_super_secret_jwt_access_key_2026',
      expiresIn: accessExpiresIn,
    });

    const refreshPayload = {
      sub: userId,
      customerId,
      email,
      jti: `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    };

    const refreshExpiresIn =
      this.configService.get('JWT_REFRESH_EXPIRES_IN') ||
      this.configService.get('JWT_REFRESH_EXPIRATION') ||
      '30d';

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret:
        this.configService.get('JWT_REFRESH_SECRET') ||
        'quikboom_super_secret_jwt_refresh_key_2026',
      expiresIn: refreshExpiresIn,
    });

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 604800,
    };
  }
}
