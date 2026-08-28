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
import * as crypto from 'crypto';
import {
  LoginDto,
  RegisterCustomerDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyMobileOtpDto,
} from './dto/auth.dto';
import { RoleType } from '@prisma/client';
import { QBIdGenerator } from './qb-id.generator';
import { Msg91Service } from '../msg91/msg91.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private qbIdGenerator: QBIdGenerator,
    private msg91Service: Msg91Service,
  ) {}

  async registerCustomer(dto: RegisterCustomerDto) {
    const normalizedEmail = (dto.email || '').trim().toLowerCase();
    const normalizedPhone = dto.phone?.trim() ? dto.phone.trim() : null;
    const normalizedCity = dto.city?.trim() ? dto.city.trim() : null;

    if (!normalizedEmail) {
      throw new BadRequestException('Email address is required');
    }

    const companyOrCustomerName = (dto.companyName || dto.fullName || 'Customer').trim();
    if (!companyOrCustomerName) {
      throw new BadRequestException('Business name or full name is required');
    }

    this.logger.log(
      `[REGISTRATION_REQUEST] Registering customer email=${normalizedEmail} company=${companyOrCustomerName} city=${normalizedCity || 'N/A'}`,
    );

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ],
      },
    });
    if (existingUser) {
      if (existingUser.email === normalizedEmail) {
        throw new ConflictException('Email is already registered');
      }
      if (normalizedPhone && existingUser.phone === normalizedPhone) {
        throw new ConflictException('Phone number is already registered');
      }
    }

    // Determine first and last name from fullName or explicit fields
    let firstName = dto.firstName?.trim() || '';
    let lastName = dto.lastName?.trim() || '';
    if (dto.fullName && (!firstName || !lastName)) {
      const parts = dto.fullName.trim().split(/\s+/);
      firstName = parts[0] || 'Customer';
      lastName = parts.slice(1).join(' ') || (dto.companyName ? dto.companyName.trim() : 'Admin');
    }
    if (!firstName) firstName = companyOrCustomerName.split(/\s+/)[0] || 'Customer';
    if (!lastName) lastName = 'Admin';

    const rawPassword = dto.password || '123456';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    let createdResult: any;
    try {
      createdResult = await this.prisma.$transaction(async (tx) => {
        // Create Customer
        const customer = await tx.customer.create({
          data: {
            name: companyOrCustomerName,
            companyName: companyOrCustomerName,
            email: normalizedEmail,
            phone: normalizedPhone,
            city: normalizedCity,
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
            email: normalizedEmail,
            phone: normalizedPhone,
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

        return {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            customerId: customer.id,
            customerName: customer.name,
            role: 'CUSTOMER',
          },
          customer: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            city: customer.city,
          },
        };
      });
    } catch (err: any) {
      this.logger.error(`[REGISTRATION_FAILED] Error registering customer: ${err?.message}`, err?.stack);
      if (err?.code === 'P2002') {
        const target = err?.meta?.target;
        if (Array.isArray(target) && target.includes('email')) {
          throw new ConflictException('Email is already registered');
        }
        if (Array.isArray(target) && target.includes('phone')) {
          throw new ConflictException('Phone number is already registered');
        }
        throw new ConflictException('An account with these details already exists');
      }
      throw err;
    }

    // Generate tokens AFTER transaction has committed so user.id exists in database for RefreshToken table
    const tokens = await this.generateTokens(
      createdResult.user.id,
      createdResult.user.customerId,
      createdResult.user.email,
      'CUSTOMER',
    );

    this.logger.log(
      `[REGISTRATION_SUCCESS] Customer created → customerId=${createdResult.customer.id} (${createdResult.customer.name}), email=${createdResult.user.email}, userId=${createdResult.user.id}`,
    );

    return {
      success: true,
      message: 'Account created successfully',
      user: createdResult.user,
      tokens,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      customerId: createdResult.user.customerId,
      userId: createdResult.user.id,
    };
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

    // 1. Role identification based dynamically on database Role/UserRole attributes (role.type & role.name)
    const isSuperAdminRole = user.userRoles.some((ur) => {
      const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
      const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
      return type === RoleType.SUPER_ADMIN || name === 'SUPERADMIN' || name === 'SUPERADMINISTRATOR';
    });

    const isCompanyAdminRole =
      !isSuperAdminRole &&
      user.userRoles.some((ur) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.CUSTOMER_ADMIN ||
          type === RoleType.TENANT_ADMIN ||
          name.includes('COMPANYADMIN') ||
          name.includes('CUSTOMERADMIN') ||
          name.includes('TENANTADMIN')
        );
      });

    const isEmployeeRole =
      !isSuperAdminRole &&
      !isCompanyAdminRole &&
      Boolean(
        user.employee ||
        user.userRoles.some((ur) => {
          const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
          const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
          return (
            type === RoleType.SALES_EXECUTIVE ||
            type === RoleType.SALES_MANAGER ||
            name.includes('EMPLOYEE') ||
            name.includes('STAFF')
          );
        }),
      );

    const isCustomerRole =
      !isSuperAdminRole &&
      !isCompanyAdminRole &&
      !isEmployeeRole &&
      Boolean(
        user.customerId ||
        user.userRoles.some((ur) => {
          const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
          return name.includes('CUSTOMER') || name.includes('CLIENT');
        }),
      );

    let userRole: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'EMPLOYEE' | 'CUSTOMER';
    let userRoleType: string;
    if (isSuperAdminRole) {
      userRole = 'SUPER_ADMIN';
      userRoleType = RoleType.SUPER_ADMIN;
    } else if (isCompanyAdminRole) {
      userRole = 'COMPANY_ADMIN';
      userRoleType = RoleType.CUSTOMER_ADMIN;
    } else if (isEmployeeRole) {
      userRole = 'EMPLOYEE';
      userRoleType = RoleType.CUSTOM;
    } else if (isCustomerRole) {
      userRole = 'CUSTOMER';
      userRoleType = RoleType.CUSTOM;
    } else {
      const firstRoleName = user.userRoles[0]?.role?.name?.toUpperCase() || '';
      if (firstRoleName.includes('SUPER')) {
        userRole = 'SUPER_ADMIN';
        userRoleType = RoleType.SUPER_ADMIN;
      } else if (firstRoleName.includes('ADMIN')) {
        userRole = 'COMPANY_ADMIN';
        userRoleType = RoleType.CUSTOMER_ADMIN;
      } else if (firstRoleName.includes('EMPLOYEE') || firstRoleName.includes('STAFF')) {
        userRole = 'EMPLOYEE';
        userRoleType = RoleType.CUSTOM;
      } else {
        userRole = 'CUSTOMER';
        userRoleType = RoleType.CUSTOM;
      }
    }

    // 2. Company suspension and account status verification
    if (userRole === 'SUPER_ADMIN') {
      // Platform Super Admin is never blocked by tenant/customer suspension status
    } else if (userRole === 'COMPANY_ADMIN') {
      if (!user.isActive) {
        throw new UnauthorizedException('Company admin account is inactive.');
      }
      if (user.customer && !user.customer.isActive) {
        throw new UnauthorizedException('Your company account is suspended.');
      }
    } else if (userRole === 'EMPLOYEE') {
      if (user.employee && user.employee.status !== 'ACTIVE') {
        throw new UnauthorizedException('Employee account is inactive.');
      }
      if (user.employee && user.employee.mobileLoginEnabled === false) {
        throw new UnauthorizedException('Mobile login is disabled for this employee.');
      }
      if (user.customer && !user.customer.isActive) {
        throw new UnauthorizedException('Your company account is suspended.');
      }
    } else if (userRole === 'CUSTOMER') {
      if (user.customer && !user.customer.isActive) {
        throw new UnauthorizedException('Your company account is suspended.');
      }
    }

    const rawApp = (appType || '').trim().toLowerCase();

    // 3. Strict Target App / Expected Role Login Validation
    const upperExpectedRole = (appType || '').trim().toUpperCase();
    if (upperExpectedRole === 'SUPER_ADMIN') {
      if (userRole !== 'SUPER_ADMIN') {
        throw new ForbiddenException('These credentials are not registered as a Super Admin account.');
      }
    } else if (upperExpectedRole === 'COMPANY_ADMIN') {
      if (userRole !== 'COMPANY_ADMIN') {
        throw new ForbiddenException('These credentials are not registered as a Company Admin account.');
      }
    } else if (upperExpectedRole === 'ADMIN') {
      if (userRole !== 'SUPER_ADMIN' && userRole !== 'COMPANY_ADMIN') {
        throw new ForbiddenException('These credentials are not registered as an Admin account.');
      }
    } else if (['CUSTOMER', 'CUSTOMER_MOBILE'].includes(upperExpectedRole)) {
      if (userRole !== 'CUSTOMER') {
        throw new ForbiddenException('These credentials are not registered as a Customer account.');
      }
      if (!user.customerId) {
        throw new UnauthorizedException('Customer workspace is missing for this account.');
      }
      if (user.customer && !user.customer.isActive) {
        throw new UnauthorizedException('Customer account is inactive or suspended.');
      }
    } else if (['EMPLOYEE', 'EMPLOYEE_MOBILE'].includes(upperExpectedRole)) {
      if (userRole !== 'EMPLOYEE') {
        throw new ForbiddenException('These credentials are not registered as an Employee account.');
      }
    } else if (rawApp === 'mobile') {
      const allowedRoles = ['CUSTOMER', 'EMPLOYEE', 'COMPANY_ADMIN', 'SUPER_ADMIN'];
      if (!allowedRoles.includes(userRole)) {
        throw new ForbiddenException('This account cannot access the mobile application.');
      }
    }

    const rawRoles = isEmployeeRole
      ? ['EMPLOYEE', RoleType.CUSTOM]
      : user.userRoles.map((ur) => ur.role?.type || ur.role?.name).filter(Boolean);

    const roles = Array.from(new Set([userRole, ...rawRoles]));

    const tokens = await this.generateTokens(user.id, user.customerId, user.email, userRole, userRoleType);

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
      ...(userRole !== 'SUPER_ADMIN' && user.customerId && { customerId: user.customerId, customerName: user.customer?.name ?? null }),
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
        throw new Error(`User ${user.id} has no customerId assigned. Cannot auto-provision employee without a real customer.`);
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
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: true,
              },
            },
            employee: true,
            customer: true,
          },
        },
      },
    });

    if (existingToken && (existingToken.isRevoked || existingToken.expiresAt < new Date())) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user =
      existingToken?.user ||
      (await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          userRoles: {
            include: {
              role: true,
            },
          },
          employee: true,
          customer: true,
        },
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

    const isSuperAdminRole = (user as any).userRoles?.some((ur: any) => {
      const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
      const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
      return type === RoleType.SUPER_ADMIN || name === 'SUPERADMIN' || name === 'SUPERADMINISTRATOR';
    });

    const isCompanyAdminRole =
      !isSuperAdminRole &&
      (user as any).userRoles?.some((ur: any) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.CUSTOMER_ADMIN ||
          type === RoleType.TENANT_ADMIN ||
          name.includes('COMPANYADMIN') ||
          name.includes('CUSTOMERADMIN') ||
          name.includes('TENANTADMIN')
        );
      });

    const isEmployeeRole =
      !isSuperAdminRole &&
      !isCompanyAdminRole &&
      (Boolean((user as any).employee) ||
        (user as any).userRoles?.some((ur: any) => {
          const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
          const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
          return (
            type === RoleType.SALES_EXECUTIVE ||
            type === RoleType.SALES_MANAGER ||
            name.includes('EMPLOYEE') ||
            name.includes('STAFF')
          );
        }));

    let resolvedRole: string;
    let resolvedRoleType: string;
    if (isSuperAdminRole) {
      resolvedRole = 'SUPER_ADMIN';
      resolvedRoleType = RoleType.SUPER_ADMIN;
    } else if (isCompanyAdminRole) {
      resolvedRole = 'COMPANY_ADMIN';
      resolvedRoleType = RoleType.CUSTOMER_ADMIN;
    } else if (isEmployeeRole) {
      resolvedRole = 'EMPLOYEE';
      resolvedRoleType = RoleType.CUSTOM;
    } else {
      resolvedRole = 'CUSTOMER';
      resolvedRoleType = RoleType.CUSTOM;
    }

    const tokens = await this.generateTokens(
      user.id,
      user.customerId,
      user.email,
      resolvedRole,
      resolvedRoleType,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokens,
      user: {
        id: user.id,
        email: user.email,
        customerId: user.customerId,
        role: resolvedRole,
        roleType: resolvedRoleType,
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

    return { message: 'Password reset OTP sent successfully' };
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

  /**
   * Dispatches a 6-digit OTP to an Indian mobile number via MSG91.
   */
  async sendOtp(dto: SendOtpDto) {
    const rawMobile = dto.mobile?.trim();
    if (!rawMobile) {
      throw new BadRequestException('Mobile number is required');
    }

    const normalizedFullMobile = this.msg91Service.normalizeMobile(rawMobile);
    const tenDigit = this.msg91Service.extract10DigitMobile(rawMobile);
    const maskedMobile = this.msg91Service.maskMobile(rawMobile);

    // Look for existing user with 10-digit, 91+10-digit, or +91+10-digit phone
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: tenDigit },
          { phone: `91${tenDigit}` },
          { phone: `+91${tenDigit}` },
        ],
        deletedAt: null,
      },
    });

    if (!user) {
      throw new BadRequestException('No account found matching this mobile number. Please check the number or register first.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('User account is deactivated. Please contact support.');
    }

    // Resend cooldown check (60 seconds)
    if (user.otpLastSentAt) {
      const secondsSinceLastSent = (Date.now() - new Date(user.otpLastSentAt).getTime()) / 1000;
      if (secondsSinceLastSent < 60) {
        const remainingSeconds = Math.ceil(60 - secondsSinceLastSent);
        throw new BadRequestException(
          `Please wait ${remainingSeconds} seconds before requesting a new OTP.`,
        );
      }
    }

    // Generate cryptographically secure 6-digit OTP (crypto.randomInt is CSPRNG-backed)
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiryMinutes = parseInt(process.env.MSG91_OTP_EXPIRY || '10', 10) || 10;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Update user record with OTP and reset attempt counter
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: otp,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
        otpLastSentAt: new Date(),
      },
    });

    // Send through MSG91 service
    await this.msg91Service.sendOtp(normalizedFullMobile, otp);

    this.logger.log(`[AUTH_OTP_SENT] OTP dispatched to ${maskedMobile} for userId: ${user.id}`);

    return {
      statusCode: 200,
      success: true,
      message: 'OTP sent successfully to registered mobile number',
    };
  }

  /**
   * Verifies OTP code and logs the user in, issuing JWT tokens and roles.
   */
  async verifyOtp(dto: VerifyMobileOtpDto) {
    const rawMobile = dto.mobile?.trim();
    const otpCode = dto.otp?.trim();

    if (!rawMobile || !otpCode) {
      throw new BadRequestException('Mobile number and OTP code are required');
    }

    const tenDigit = this.msg91Service.extract10DigitMobile(rawMobile);
    const maskedMobile = this.msg91Service.maskMobile(rawMobile);

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: tenDigit },
          { phone: `91${tenDigit}` },
          { phone: `+91${tenDigit}` },
        ],
        deletedAt: null,
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
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('No account found matching this mobile number.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('User account is deactivated. Please contact support.');
    }

    // Check if OTP was generated
    if (!user.otpCode || !user.otpExpiresAt) {
      throw new BadRequestException('No active OTP request found. Please request a new OTP.');
    }

    // Check expiry
    if (new Date(user.otpExpiresAt) < new Date()) {
      throw new BadRequestException('OTP has expired. Please request a new OTP.');
    }

    // Check maximum attempts (5 max)
    if (user.otpAttempts >= 5) {
      // Invalidate OTP
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpCode: null, otpExpiresAt: null },
      });
      throw new BadRequestException('Maximum OTP verification attempts exceeded. Please request a new OTP.');
    }

    // Validate OTP match
    if (user.otpCode !== otpCode) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpAttempts: { increment: 1 } },
      });
      const remainingAttempts = 5 - (user.otpAttempts + 1);
      throw new BadRequestException(
        `Invalid OTP code. ${remainingAttempts > 0 ? `${remainingAttempts} attempt(s) remaining.` : 'Please request a new OTP.'}`,
      );
    }

    // Success: Clear OTP & mark phone verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        isPhoneVerified: true,
        isVerified: true,
      },
    });

    this.logger.log(`[AUTH_OTP_VERIFIED_SUCCESS] User ${user.id} logged in via mobile ${maskedMobile}`);

    // Resolve primary role
    const isEmployee = user.employee !== null;
    const isCustomerAdmin = user.userRoles.some(
      (ur) => ur.role.type === RoleType.CUSTOMER_ADMIN || (ur.role.type as string) === 'COMPANY_ADMIN',
    );
    const hasSuperAdminRole = user.userRoles.some(
      (ur) => ur.role.type === RoleType.SUPER_ADMIN,
    );

    let userRole = 'CUSTOMER';
    if (hasSuperAdminRole) {
      userRole = 'SUPER_ADMIN';
    } else if (isCustomerAdmin) {
      userRole = 'COMPANY_ADMIN';
    } else if (isEmployee) {
      userRole = 'EMPLOYEE';
    }

    const roles = isEmployee && !hasSuperAdminRole
      ? ['EMPLOYEE', RoleType.CUSTOM]
      : user.userRoles.map((ur) => ur.role.type);

    const tokens = await this.generateTokens(user.id, user.customerId, user.email);

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
      ...(userRole !== 'SUPER_ADMIN' && { customerId: user.customerId }),
      ...(userRole !== 'SUPER_ADMIN' && { customerName: user.customer?.name ?? null }),
    };

    if (userRole === 'EMPLOYEE' && employeeData) {
      userData.employeeId = qbCode;
      userData.employeeCode = qbCode;
      userData.employee = employeeData;
    }

    return {
      statusCode: 200,
      success: true,
      message: 'Logged in successfully via mobile OTP verification',
      data: {
        user: userData,
        tokens,
      },
      user: userData,
      tokens,
    };
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
      ...(!hasSuperAdminRole && { customerName: user.customer?.name ?? null }),
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

  private async generateTokens(
    userId: number,
    customerId: number | null,
    email: string,
    role?: string,
    roleType?: string,
  ) {
    const resolvedRole = role || (customerId ? 'COMPANY_ADMIN' : 'SUPER_ADMIN');
    const resolvedRoleType = roleType || role || (customerId ? RoleType.CUSTOMER_ADMIN : RoleType.SUPER_ADMIN);

    const payload: any = {
      sub: userId,
      customerId,
      email,
      role: resolvedRole,
      roleType: resolvedRoleType,
    };

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
