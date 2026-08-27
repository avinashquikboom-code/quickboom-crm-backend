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
import { QBIdGenerator } from './qb-id.generator';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private qbIdGenerator: QBIdGenerator,
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
      const companyOrCustomerName = (dto.companyName || dto.fullName || 'Customer').trim();
      const customer = await tx.customer.create({
        data: {
          name: companyOrCustomerName,
          companyName: companyOrCustomerName,
          email: dto.email,
          phone: dto.phone,
          city: dto.city,
          isActive: true,
          source: 'APP_REGISTRATION',
          customerType: 'ENTERPRISE',
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

      this.logger.log(
        `[CUSTOMER_REGISTERED] Customer created → customerId=${customer.id} (${customer.name}), email=${customer.email}, user=${user.email}`,
      );

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

  async login(
    emailOrDto: string | LoginDto,
    passwordOrApp?: string,
    targetApp?: string,
  ) {
    let email: string;
    let password = '';
    let appType: string | undefined;

    if (typeof emailOrDto === 'object' && emailOrDto !== null) {
      email = emailOrDto.email;
      password = emailOrDto.password;
      appType = passwordOrApp || emailOrDto.appType;
    } else {
      email = String(emailOrDto || '');
      password = passwordOrApp || '';
      appType = targetApp;
    }

    const rawInput = (email || '').trim();
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

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Your account has been deactivated');
    }

    const hasSuperAdminRole = user.userRoles.some((ur) => ur.role?.type === RoleType.SUPER_ADMIN);
    const hasCustomerAdminRole = user.userRoles.some(
      (ur) =>
        ur.role?.type === RoleType.CUSTOMER_ADMIN ||
        ur.role?.name?.toUpperCase().includes('CUSTOMER'),
    );
    const isEmployee = Boolean(
      (user.employee || user.userRoles.some((ur) => ur.role?.name?.toUpperCase().includes('EMPLOYEE'))) &&
      !hasSuperAdminRole &&
      !hasCustomerAdminRole,
    );
    const isCustomer = Boolean(!hasSuperAdminRole && !isEmployee && (hasCustomerAdminRole || user.customerId));

    if (!hasSuperAdminRole && user.customer && !user.customer.isActive) {
      throw new UnauthorizedException('Your company account is suspended');
    }

    const rawApp = (appType || '').trim().toLowerCase();

    let userRole: string;
    if (hasSuperAdminRole) {
      userRole = 'SUPER_ADMIN';
    } else if (isCustomer) {
      userRole = 'CUSTOMER';
    } else if (isEmployee) {
      userRole = 'EMPLOYEE';
    } else {
      userRole = user.userRoles[0]?.role?.name?.toUpperCase().replace(/\s+/g, '_') || 'CUSTOMER';
    }

    // Dedicated Endpoint Exact Role Validation
    const upperExpectedRole = (appType || '').trim().toUpperCase();
    if (['CUSTOMER', 'EMPLOYEE', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(upperExpectedRole)) {
      if (upperExpectedRole === 'SUPER_ADMIN') {
        if (!hasSuperAdminRole) {
          throw new ForbiddenException('Only Super Admin can access admin panel');
        }
      } else if (upperExpectedRole === 'CUSTOMER') {
        if (hasSuperAdminRole) {
          throw new ForbiddenException('This user is SUPER_ADMIN, not CUSTOMER. Use /api/v1/admin/auth/login/super-admin');
        }
        if (userRole !== 'CUSTOMER' && userRole !== 'CUSTOMER_ADMIN') {
          throw new ForbiddenException(`This user is ${userRole}, not CUSTOMER. Use correct endpoint for ${userRole.toLowerCase()} login`);
        }
      } else if (upperExpectedRole === 'EMPLOYEE') {
        if (hasSuperAdminRole) {
          throw new ForbiddenException('This user is SUPER_ADMIN, not EMPLOYEE. Use /api/v1/admin/auth/login/super-admin');
        }
        if (userRole !== 'EMPLOYEE') {
          throw new ForbiddenException(`This user is ${userRole}, not EMPLOYEE. Use correct endpoint for ${userRole.toLowerCase()} login`);
        }
        if (user.employee?.status !== 'ACTIVE') {
          throw new UnauthorizedException('Employee account is inactive.');
        }
        if (!user.employee?.mobileLoginEnabled) {
          throw new UnauthorizedException('Mobile login is disabled for this employee.');
        }
      } else if (upperExpectedRole === 'COMPANY_ADMIN') {
        if (hasSuperAdminRole) {
          throw new ForbiddenException('This user is SUPER_ADMIN, not COMPANY_ADMIN. Use /api/v1/admin/auth/login/super-admin');
        }
        if (userRole !== 'COMPANY_ADMIN' && userRole !== 'CUSTOMER_ADMIN' && userRole !== 'CUSTOMER') {
          throw new ForbiddenException(`This user is ${userRole}, not COMPANY_ADMIN. Use correct endpoint for ${userRole.toLowerCase()} login`);
        }
      }
    } else if (rawApp === 'admin' || rawApp === 'super_admin') {
      if (!hasSuperAdminRole) {
        throw new ForbiddenException('Only Super Admin can access admin panel');
      }
    } else if (rawApp === 'mobile' || rawApp === 'employee_mobile' || rawApp === 'customer_mobile') {
      const allowedRoles = ['CUSTOMER', 'EMPLOYEE', 'COMPANY_ADMIN', 'CUSTOMER_ADMIN'];
      if (!allowedRoles.includes(userRole) || hasSuperAdminRole) {
        throw new ForbiddenException('This user cannot access mobile app');
      }
      if (isEmployee) {
        if (user.employee?.status !== 'ACTIVE') {
          throw new UnauthorizedException('Employee account is inactive.');
        }
        if (!user.employee?.mobileLoginEnabled) {
          throw new UnauthorizedException('Mobile login is disabled for this employee.');
        }
      }
    } else if (rawApp === 'customer') {
      if (hasSuperAdminRole) {
        throw new ForbiddenException('Access Denied: Admin accounts cannot access the Customer portal.');
      }
      if (isEmployee) {
        throw new ForbiddenException('Access Denied: Employee accounts cannot access the Customer portal.');
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

    const roles = isEmployee && !hasSuperAdminRole
      ? ['EMPLOYEE', RoleType.CUSTOM]
      : user.userRoles.map((ur) => ur.role.type);

    const tokens = await this.generateTokens(user.id, user.customerId, user.email);

    // Auto-generate employee record ONLY if the authenticated user is an Employee
    let emp: any = null;
    let employeeData: any = null;
    if (userRole === 'EMPLOYEE') {
      emp = await this.ensureEmployee(user);
      const targetNumericId = emp?.id || user.id;
      const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);
      employeeData = {
        id: emp.id,
        employeeId: qbCode,
        employeeCode: qbCode,
        firstName: emp.firstName || user.firstName,
        lastName: emp.lastName || user.lastName,
        email: emp.email || user.email,
        mobile: emp.phone || user.phone,
        phone: emp.phone || user.phone,
        branch: emp.branch || 'Head Office',
        office: emp.branch || 'Head Office',
        department: emp.department?.name || 'General',
        designation: emp.designation?.name || 'Staff',
        status: emp.status || 'ACTIVE',
        mobileLoginEnabled: emp.mobileLoginEnabled ?? true,
        joiningDate: emp.joiningDate || user.createdAt,
      };
    }

    const targetNumericId = userRole === 'EMPLOYEE'
      ? (emp?.id || user.id)
      : (userRole === 'COMPANY_ADMIN' || userRole === 'CUSTOMER' ? (user.customerId || user.id) : user.id);
    const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);

    const userData: any = {
      id: user.id,
      email: user.email,
      phone: user.phone || null,
      firstName: user.firstName,
      lastName: user.lastName,
      role: userRole,
      roles: roles.length > 0 ? roles : [userRole],
      userId: qbCode,
      // Conditional: Only include customerId and customerName for non-super-admin
      ...(userRole !== 'SUPER_ADMIN' && { customerId: user.customerId }),
      ...(userRole !== 'SUPER_ADMIN' && { customerName: user.customer?.name || 'Enterprise Workspace' }),
    };

    if (userRole === 'EMPLOYEE' && employeeData) {
      userData.employeeId = qbCode;
      userData.employeeCode = qbCode;
      userData.employee = employeeData;
    }

    return {
      success: true,
      data: {
        user: userData,
        tokens,
      },
      user: userData,
      tokens,
    };
  }

  /**
   * Auto-provisions an Employee record with autoincremented employeeCode (EMP-001, EMP-002, ...)
   * if a user does not have one attached.
   */
  private async ensureEmployee(user: any): Promise<any> {
    if (user.employee) {
      return user.employee;
    }

    try {
      let customerId = user.customerId;
      if (!customerId) {
        let defaultCustomer = await this.prisma.customer.findFirst({
          where: { isActive: true },
        });
        if (!defaultCustomer) {
          defaultCustomer = await this.prisma.customer.create({
            data: {
              name: 'Enterprise Workspace',
              email: user.email,
              isActive: true,
            },
          });
        }
        customerId = defaultCustomer.id;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { customerId },
        });
      }

      // Generate next sequential EMP code
      const totalEmployees = await this.prisma.employee.count();
      const codeSeq = String(totalEmployees + 1).padStart(3, '0');
      const employeeCode = `EMP-${codeSeq}`;

      const newEmployee = await this.prisma.employee.create({
        data: {
          customerId,
          userId: user.id,
          employeeCode,
          firstName: user.firstName || 'Employee',
          lastName: user.lastName || '',
          email: user.email,
          phone: user.phone || null,
          status: 'ACTIVE',
          mobileLoginEnabled: true,
          branch: 'Head Office',
        },
        include: {
          department: true,
          designation: true,
        },
      });

      return newEmployee;
    } catch (err) {
      const fallbackCode = `EMP-${String(user.id).padStart(3, '0')}`;
      return {
        id: user.id,
        employeeCode: fallbackCode,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        status: 'ACTIVE',
        mobileLoginEnabled: true,
        branch: 'Head Office',
      };
    }
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
    const hasSuperAdminRole = roles.includes(RoleType.SUPER_ADMIN);
    const hasCustomerAdminRole = user.userRoles.some(
      (ur) =>
        ur.role?.type === RoleType.CUSTOMER_ADMIN ||
        ur.role?.name?.toUpperCase().includes('CUSTOMER'),
    );
    const isEmployee = Boolean(
      (user.employee || user.userRoles.some((ur) => ur.role?.name?.toUpperCase().includes('EMPLOYEE'))) &&
      !hasSuperAdminRole &&
      !hasCustomerAdminRole,
    );
    const isCustomer = Boolean(!hasSuperAdminRole && !isEmployee && (hasCustomerAdminRole || user.customerId));

    let userRole: string;
    if (hasSuperAdminRole) {
      userRole = 'SUPER_ADMIN';
    } else if (isCustomer) {
      userRole = 'CUSTOMER';
    } else if (isEmployee) {
      userRole = 'EMPLOYEE';
    } else {
      userRole = user.userRoles[0]?.role?.name?.toUpperCase().replace(/\s+/g, '_') || 'CUSTOMER';
    }

    let emp: any = null;
    let employeeData: any = null;
    if (userRole === 'EMPLOYEE') {
      emp = await this.ensureEmployee(user);
      const targetNumericId = emp?.id || user.id;
      const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);
      employeeData = {
        id: emp.id,
        employeeId: qbCode,
        employeeCode: qbCode,
        firstName: emp.firstName || user.firstName,
        lastName: emp.lastName || user.lastName,
        email: emp.email || user.email,
        mobile: emp.phone || user.phone,
        phone: emp.phone || user.phone,
        branch: emp.branch || 'Head Office',
        office: emp.branch || 'Head Office',
        department: emp.department?.name || 'General',
        designation: emp.designation?.name || 'Staff',
        status: emp.status || 'ACTIVE',
        mobileLoginEnabled: emp.mobileLoginEnabled ?? true,
        joiningDate: emp.joiningDate || user.createdAt,
      };
    }

    const targetNumericId = userRole === 'EMPLOYEE'
      ? (emp?.id || user.id)
      : (userRole === 'COMPANY_ADMIN' || userRole === 'CUSTOMER_ADMIN' || userRole === 'CUSTOMER' ? (user.customerId || user.id) : user.id);
    const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);

    const profileData: any = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: userRole,
      roles,
      userId: qbCode,
      createdAt: user.createdAt,
      // Conditional: Only include customerId and customerName for non-super-admin
      ...(!hasSuperAdminRole && { customerId: user.customerId }),
      ...(!hasSuperAdminRole && { customerName: user.customer?.name || 'Enterprise Workspace' }),
    };

    if (userRole === 'EMPLOYEE' && employeeData) {
      profileData.employee = employeeData;
      profileData.employeeId = qbCode;
      profileData.employeeCode = qbCode;
    }

    return profileData;
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
