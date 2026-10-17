import { Injectable, UnauthorizedException, ForbiddenException, BadRequestException, ConflictException, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  LoginDto,

  RegisterEmployeeDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyMobileOtpDto,
  SendEmailOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import { EmployeeType,  } from '@prisma/client';
import { QBIdGenerator } from './qb-id.generator';
import { Msg91Service } from '../msg91/msg91.service';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notification/notification.service';
import { PlanScheduleGateway } from '../work/plan-schedule.gateway';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private qbIdGenerator: QBIdGenerator,
    private msg91Service: Msg91Service,
    @Optional() private emailService?: EmailService,
    @Optional() private notificationService?: NotificationService,
    @Optional()
    @Inject(forwardRef(() => PlanScheduleGateway))
    private planScheduleGateway?: PlanScheduleGateway,
  ) {}

  async registerEmployee(dto: RegisterEmployeeDto) {
    const normalizedEmail = (dto.email || '').trim().toLowerCase();
    const normalizedPhone = (dto.mobile || dto.phone || '').trim();
    const normalizedCity = (dto.city || '').trim();

    if (!normalizedEmail) {
      throw new BadRequestException('Email address is required');
    }
    if (!normalizedCity) {
      throw new BadRequestException('City is required');
    }
    if (!dto.employeeType || !['COMPANY', 'FREELANCER'].includes(dto.employeeType)) {
      throw new BadRequestException('Please select employee type.');
    }
    const effectivePassword = (dto.password && dto.password.trim()) || '123456';
    if (effectivePassword.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    if (dto.password && dto.confirmPassword && dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const fullName = (dto.fullName || '').trim();
    if (!fullName) {
      throw new BadRequestException('Full name is required');
    }

    let firstName = dto.firstName?.trim() || '';
    let lastName = dto.lastName?.trim() || '';
    if (!firstName || !lastName) {
      const parts = fullName.split(/\s+/);
      firstName = parts[0] || 'Employee';
      lastName = parts.slice(1).join(' ') || 'User';
    }

    this.logger.log(
      `[EMPLOYEE_REGISTRATION_REQUEST] Registering employee email=${normalizedEmail} type=${dto.employeeType} city=${normalizedCity}`,
    );

    // Check duplicate email or phone in users and employees
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
          { employee: { email: normalizedEmail } },
          ...(normalizedPhone ? [{ employee: { phone: normalizedPhone } }] : []),
        ],
      },
    });
    const existingEmp = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ],
      },
    });
    if (existingUser || existingEmp) {
      if (existingUser?.email === normalizedEmail || existingEmp?.email === normalizedEmail) {
        throw new ConflictException('Email is already registered. Please login instead.');
      }
      if (normalizedPhone && (existingUser?.phone === normalizedPhone || existingEmp?.phone === normalizedPhone)) {
        throw new ConflictException('Phone number is already registered. Please login instead.');
      }
      throw new ConflictException('An account with these details already exists.');
    }

    const hashedPassword = await bcrypt.hash(effectivePassword, 10);

    let createdResult: any;
    try {
      createdResult = await this.prisma.$transaction(async (tx) => {
        // 2. Create User account (isVerified: true, isActive: true)
        const user = await tx.user.create({
          data: {

            email: normalizedEmail,
            phone: normalizedPhone || null,
            passwordHash: hashedPassword,
            firstName,
            lastName,
            isActive: true,
            isVerified: true,
          },
        });

        // 3. Auto-generate sequential employeeCode (e.g. QB-EMP-001)
        const count = await tx.employee.count({ where: {  } });
        const paddedNum = String(count + 1).padStart(3, '0');
        const employeeCode = `QB-EMP-${paddedNum}`;

        // 4. Create Employee record
        const employee = await tx.employee.create({
          data: {

            userId: user.id,
            employeeCode,
            firstName,
            lastName,
            email: normalizedEmail,
            phone: normalizedPhone || null,
            city: normalizedCity,
            employeeType: dto.employeeType as EmployeeType,
            employmentType: dto.employeeType === 'FREELANCER' ? 'CONTRACT' : 'FULL_TIME',
            status: 'ACTIVE',
            mobileLoginEnabled: true,
          },
        });

        return { user, employee };
      });
    } catch (err: any) {
      this.logger.error(`[EMPLOYEE_REGISTRATION_FAILED] Error registering employee: ${err?.message}`, err?.stack);
      if (err instanceof PrismaService && (err as any).code === 'P2002') {
        throw new ConflictException('Email or phone number is already registered.');
      }
      throw err;
    }

    const tokens = await this.generateTokens(createdResult.user.id, createdResult.user.email);

    return {
      success: true,
      message: 'Employee registered successfully',
      user: {
        id: createdResult.user.id,
        email: createdResult.user.email,
        firstName: createdResult.user.firstName,
        lastName: createdResult.user.lastName,
        role: 'EMPLOYEE',
        employeeId: createdResult.employee.id,
        employeeCode: createdResult.employee.employeeCode,
        employeeType: createdResult.employee.employeeType,
        city: createdResult.employee.city,

      },
      tokens,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async login(
    emailOrDto: string | LoginDto,
    passwordOrApp?: string,
    targetApp?: string,
  ) {
const dto = typeof emailOrDto === 'object' ? emailOrDto : { email: emailOrDto, password: passwordOrApp, appType: targetApp };
    const identifier = String(dto.email || '').trim();
    const phone = identifier.replace(/\D/g, '').slice(-10);
    const phoneValues = phone.length === 10 ? [phone, '91' + phone, '+91' + phone, identifier] : [identifier];
    const user = await this.prisma.user.findFirst({ where: { deletedAt: null, OR: [
      { email: { equals: identifier, mode: 'insensitive' } }, { phone: { in: phoneValues } },
      { employee: { employeeCode: { equals: identifier, mode: 'insensitive' } } },
      { employee: { phone: { in: phoneValues } } },
    ] }, include: { employee: { include: { designation: true, department: true } } } });
    if (!user || !await bcrypt.compare(String(dto.password || ''), user.passwordHash)) throw new UnauthorizedException('Invalid credentials');
    const app = String((typeof emailOrDto === 'object' ? passwordOrApp || dto.appType : targetApp) || '').toUpperCase();
    if (['ADMIN', 'SUPER_ADMIN', 'COMPANY_ADMIN'].includes(app) && !['SUPER_ADMIN', 'ADMIN'].includes(user.accountType)) throw new ForbiddenException('Administrator account required');
    return this.createSessionResponse(user);
  }

  /**
   * Auto-provisions an Employee record with autoincremented employeeCode (EMP-001, EMP-002, ...)
   * if a user does not have one attached.
   */
  private async ensureEmployee(user: any): Promise<any> {
    if (user.accountType === 'CUSTOMER') {
      const customer = await this.prisma.customer.findUnique({ where: { userId: user.id } });
      if (!customer) throw new ForbiddenException('Linked customer account required');
      return null;
    }
const employee = user.employee || await this.prisma.employee.findUnique({ where: { userId: user.id }, include: { designation: true, department: true } });
    if (!employee || employee.status !== 'ACTIVE' || employee.mobileLoginEnabled === false) throw new ForbiddenException('Active employee profile required');
    return employee;
  }

  async refreshToken(dto: RefreshTokenDto) {
const token = String(dto.refreshToken || '').trim();
    if (!token) throw new UnauthorizedException('Refresh token is required');
    const secret = String(this.configService.get('JWT_REFRESH_SECRET') || process.env.JWT_REFRESH_SECRET || 'quikboom_super_secret_jwt_refresh_key_2026').replace(/^["']|["']$/g, '').trim();
    let payload: any;
    try { payload = this.jwtService.verify(token, { secret }); } catch { throw new UnauthorizedException('Invalid or expired refresh token'); }
    const stored = await this.prisma.refreshToken.findUnique({ where: { token }, include: { user: { include: { employee: { include: { designation: true, department: true } } } } } });
    if (!stored || stored.isRevoked || stored.expiresAt <= new Date() || stored.userId !== Number(payload.sub)) throw new UnauthorizedException('Invalid or expired refresh token');
    // Consume atomically so simultaneous refresh requests cannot both rotate one session.
    const consumed = await this.prisma.refreshToken.updateMany({ where: { id: stored.id, isRevoked: false }, data: { isRevoked: true } });
    if (consumed.count !== 1) throw new UnauthorizedException('Refresh token already used');
    return this.createSessionResponse(stored.user);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    return this.sendEmailOtp({ email: dto.email });
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
    if (dto.email && !dto.mobile && !dto.employeeId) {
      return this.sendEmailOtp({ email: dto.email });
    }

    if (dto.employeeId && !dto.mobile && !dto.email) {
      const rawId = dto.employeeId.trim();
      const user = await this.prisma.user.findFirst({
        where: {
          employee: {
            OR: [
              { employeeCode: { equals: rawId, mode: 'insensitive' } },
              ...(isNaN(Number(rawId)) ? [] : [{ id: Number(rawId) }]),
            ],
          },
          deletedAt: null,
        },
        include: { employee: true },
      });
      if (!user) {
        throw new BadRequestException('No employee account found matching this Employee ID.');
      }
      const targetPhone = user.phone || user.employee?.phone;
      const targetEmail = user.email || user.employee?.email;
      if (targetPhone) {
        const res = await this.sendOtp({ mobile: targetPhone });
        return {
          ...res,
          destination: this.msg91Service.maskMobile(targetPhone),
          destinationType: 'mobile',
        };
      } else if (targetEmail) {
        const res = await this.sendEmailOtp({ email: targetEmail });
        return {
          ...res,
          destination: this.maskEmail(targetEmail),
          destinationType: 'email',
        };
      } else {
        throw new BadRequestException('No registered mobile or email found for this employee.');
      }
    }

    const rawMobile = dto.mobile?.trim();
    if (!rawMobile) {
      throw new BadRequestException('Mobile number, email address, or Employee ID is required');
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
      destination: maskedMobile,
      destinationType: 'mobile',
    };
  }

  /**
   * Verifies OTP code and logs the user in, issuing JWT tokens and roles.
   */
  async verifyOtp(dto: VerifyMobileOtpDto | VerifyOtpDto) {
    if ((dto as any).email && !(dto as any).mobile && !(dto as any).employeeId) {
      return this.verifyEmailOtp(dto as any);
    }

    if ((dto as any).employeeId && !(dto as any).mobile && !(dto as any).email) {
      const rawId = (dto as any).employeeId.trim();
      const user = await this.prisma.user.findFirst({
        where: {
          employee: {
            OR: [
              { employeeCode: { equals: rawId, mode: 'insensitive' } },
              ...(isNaN(Number(rawId)) ? [] : [{ id: Number(rawId) }]),
            ],
          },
          deletedAt: null,
        },
        include: { employee: true },
      });
      if (!user) {
        throw new BadRequestException('No employee account found matching this Employee ID.');
      }
      const targetPhone = user.phone || user.employee?.phone;
      const targetEmail = user.email || user.employee?.email;
      if (targetPhone) {
        return this.verifyOtp({ mobile: targetPhone, otp: dto.otp });
      } else if (targetEmail) {
        return this.verifyEmailOtp({ email: targetEmail, otp: dto.otp });
      } else {
        throw new BadRequestException('No registered mobile or email found for this employee.');
      }
    }

    const rawMobile = (dto as any).mobile?.trim();
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

        employee: {
          include: {
            department: true,
            designation: true,
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

    return this.createSessionResponse(user);
  }

  /**
   * Generates and dispatches a 6-digit Email OTP via the existing SMTP integration
   * using the Admin Panel configured EMAIL_OTP template.
   */
  async sendEmailOtp(dto: SendEmailOtpDto) {
    const rawEmail = dto.email?.trim().toLowerCase();
    if (!rawEmail) {
      throw new BadRequestException('Email address is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) {
      throw new BadRequestException('Invalid email address format');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: rawEmail, deletedAt: null },

    });

    // To prevent user enumeration, return generic success if email does not exist
    if (!user) {
      this.logger.warn(`[EMAIL_OTP] Request for non-existent email "${rawEmail}". Returning generic response.`);
      return {
        statusCode: 200,
        success: true,
        message: 'If an account exists with this email address, a verification OTP has been sent.',
      };
    }

    if (!user.isActive) {
      throw new ForbiddenException('User account is deactivated. Please contact support.');
    }

    // Enforce 60 seconds cooldown
    if (user.otpLastSentAt) {
      const secondsSinceLastSent = (Date.now() - new Date(user.otpLastSentAt).getTime()) / 1000;
      if (secondsSinceLastSent < 60) {
        const remainingSeconds = Math.ceil(60 - secondsSinceLastSent);
        throw new BadRequestException(
          `Please wait ${remainingSeconds} seconds before requesting a new OTP.`,
        );
      }
    }

    // Generate cryptographically secure random 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiryMinutes = 5; // Exactly 5 minutes expiry
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Invalidate prior OTP and persist new OTP details
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: otp,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
        otpLastSentAt: new Date(),
      },
    });

    const companyName = 'QuickBoom CRM';
    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';

    // Dispatch OTP strictly through existing SMTP email service using EMAIL_OTP template
    if (this.emailService) {
      try {
        await this.emailService.sendTemplateEmail(
          'EMAIL_OTP',
          user.email,
          {
            userName,
            companyName,
            otp,
          },
          {
            recordType: 'USER_OTP',
            recordId: String(user.id),
          },
          { id: user.id },
        );
      } catch (err: any) {
        this.logger.error(`[EMAIL_OTP_FAILED] To: "${user.email}", Error: ${err?.message}`);
        throw new BadRequestException(
          `Failed to deliver OTP verification email: ${err?.message || 'SMTP service error'}. Please check your SMTP configuration in Admin Panel → Settings → SMTP Email Integration.`,
        );
      }
    } else {
      this.logger.warn(`[EMAIL_OTP] EmailService not available. OTP code generated for userId: ${user.id}`);
    }

    this.logger.log(`[EMAIL_OTP_SENT] Verification OTP dispatched via SMTP to userId: ${user.id} (${user.email})`);

    const maskedEmail = this.maskEmail(user.email);
    return {
      statusCode: 200,
      success: true,
      message: 'OTP sent successfully to registered email address',
      destination: maskedEmail,
      destinationType: 'email',
    };
  }

  private maskEmail(email: string): string {
    const parts = (email || '').split('@');
    if (parts.length !== 2) return email;
    const name = parts[0];
    const domain = parts[1];
    if (name.length <= 1) return `*@${domain}`;
    return `${name[0]}***@${domain}`;
  }

  /**
   * Verifies 6-digit Email OTP and authenticates the user, issuing tokens and roles.
   */
  async verifyEmailOtp(dto: VerifyOtpDto) {
    const rawEmail = dto.email?.trim().toLowerCase();
    const otpCode = dto.otp?.trim();

    if (!rawEmail || !otpCode) {
      throw new BadRequestException('Email address and OTP code are required');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: rawEmail, deletedAt: null },
      include: {

        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
        
      },
    });

    if (!user) {
      throw new BadRequestException('No account found matching this email address.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('User account is deactivated. Please contact support.');
    }

    // Check if OTP was generated
    if (!user.otpCode || !user.otpExpiresAt) {
      throw new BadRequestException('No active OTP request found. Please request a new OTP.');
    }

    // Check expiry (5 minutes)
    if (new Date(user.otpExpiresAt) < new Date()) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpCode: null, otpExpiresAt: null },
      });
      throw new BadRequestException('OTP has expired. Please request a new OTP.');
    }

    // Check maximum attempts (5 max)
    if (user.otpAttempts >= 5) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpCode: null, otpExpiresAt: null },
      });
      throw new BadRequestException('Maximum OTP verification attempts exceeded. Please request a new OTP.');
    }

    // Validate OTP match
    if (user.otpCode !== otpCode) {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { otpAttempts: { increment: 1 } },
      });
      const remainingAttempts = 5 - updated.otpAttempts;
      throw new BadRequestException(
        `Invalid OTP code. ${remainingAttempts > 0 ? `${remainingAttempts} attempt(s) remaining.` : 'Please request a new OTP.'}`,
      );
    }

    // Success: Clear OTP & mark email verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        isVerified: true,
      },
    });

    this.logger.log(`[AUTH_EMAIL_OTP_VERIFIED] User ${user.id} (${user.email}) successfully logged in via email OTP`);

    return this.createSessionResponse(user);
  }

  async getProfile(userId: number | string, currentUser?: any) {
const user = await this.prisma.user.findUnique({ where: { id: Number(userId) }, include: { employee: { include: { designation: true, department: true } } } });
    if (!user || !user.isActive || user.deletedAt) throw new UnauthorizedException('Account is inactive or no longer exists');
    return this.sessionUser(user);
  }

  public isBpoEmployee(emp: any): boolean {
    if (!emp) return false;

    // 1. Team membership where team name or description contains 'BPO'
    if (
      emp.teamMembers?.some(
        (tm: any) =>
          (tm.team?.name || '').toUpperCase().includes('BPO') ||
          (tm.team?.description || '').toUpperCase().includes('BPO'),
      )
    ) {
      return true;
    }

    // 2. Leader of a team containing 'BPO'
    if (
      emp.ledTeams?.some(
        (t: any) =>
          (t.name || '').toUpperCase().includes('BPO') ||
          (t.description || '').toUpperCase().includes('BPO'),
      )
    ) {
      return true;
    }

    // 3. Department name or code contains 'BPO'
    const deptName = (emp.department?.name || '').toUpperCase();
    const deptCode = (emp.department?.code || '').toUpperCase();
    if (deptName.includes('BPO') || deptCode.includes('BPO')) {
      return true;
    }

    // 4. Designation name or code contains 'BPO' or 'TELE' (Telecaller / Telesales)
    const desigName = (emp.designation?.name || '').toUpperCase();
    const desigCode = (emp.designation?.code || '').toUpperCase();
    if (
      desigName.includes('BPO') ||
      desigCode.includes('BPO') ||
      desigName.includes('TELE') ||
      desigCode.includes('TELE')
    ) {
      return true;
    }

    return false;
  }

  public async checkIsBpoEmployee(emp: any): Promise<boolean> {
    if (!emp) return false;
    if (this.isBpoEmployee(emp)) return true;

    if (emp.id && (!emp.teamMembers || !emp.ledTeams || !emp.department)) {
      try {
        const fullEmp = await this.prisma.employee.findUnique({
          where: { id: emp.id },
          include: {
            department: true,
            designation: true,
            teamMembers: { include: { team: true } },
            ledTeams: true,
          },
        });
        if (fullEmp) {
          return this.isBpoEmployee(fullEmp);
        }
      } catch (err) {
        this.logger.warn(`Failed to query employee teams/department for BPO check: ${err.message}`);
      }
    }
    return false;
  }

  private determineCrmEligibility(emp: any): boolean {
    if (!emp) return false;
    if (emp.designation?.crmMobileAccess !== undefined && emp.designation?.crmMobileAccess !== null) {
      return Boolean(emp.designation.crmMobileAccess);
    }
    const desigName = (emp.designation?.name || '').toUpperCase();
    return desigName.includes('TELE') || desigName.includes('BPO');
  }

  private async generateTokens(userId: number, email: string) {
    const account = await this.prisma.user.findUnique({ where: { id: userId }, include: { employee: true } });
    if (!account || !account.isActive || account.deletedAt) throw new UnauthorizedException('Inactive account');
    if (!['ADMIN', 'SUPER_ADMIN'].includes(account.accountType)) await this.ensureEmployee(account);
    const resolvedRole = account.accountType;
    const resolvedRoleType = account.accountType;

    const payload: any = {
      sub: userId,
      userId,

      email,
      role: resolvedRole,
      roleType: resolvedRoleType,
      isBpo: this.isBpoEmployee(account.employee),
    };

    const accessExpiresIn =
      this.configService.get('JWT_ACCESS_EXPIRES_IN') ||
      this.configService.get('JWT_EXPIRATION') ||
      '7d';

    const accessSecret = (
      this.configService.get<string>('JWT_SECRET') ||
      process.env.JWT_SECRET ||
      'quikboom_super_secret_jwt_access_key_2026'
    )
      .replace(/^["']|["']$/g, '')
      .trim();

    const accessToken = this.jwtService.sign(payload, {
      secret: accessSecret,
      expiresIn: accessExpiresIn,
    });

    const refreshPayload = {
      sub: userId,

      email,
      role: resolvedRole,
      roleType: resolvedRoleType,
      jti: `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    };

    const refreshExpiresIn =
      this.configService.get('JWT_REFRESH_EXPIRES_IN') ||
      this.configService.get('JWT_REFRESH_EXPIRATION') ||
      '30d';

    const refreshSecret = (
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      process.env.JWT_REFRESH_SECRET ||
      'quikboom_super_secret_jwt_refresh_key_2026'
    )
      .replace(/^["']|["']$/g, '')
      .trim();

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: refreshSecret,
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

  private sessionUser(user: any) {
    const role = user.accountType || 'EMPLOYEE';
    const employee = user.employee;
    return { id: user.id, email: user.email, phone: user.phone, firstName: user.firstName, lastName: user.lastName,
      avatar: user.avatar, accountType: role, role, roleType: role, roles: [role],
      employeeId: employee?.id ?? null, employeeCode: employee?.employeeCode ?? null,
      employee: employee ? { ...employee, user: undefined } : null,
      qbUserId: this.qbIdGenerator.generateQBUserId(role, user.id),
      isBpo: this.isBpoEmployee(employee), crmMobileAccess: this.determineCrmEligibility(employee),
    };
  }

  private async createSessionResponse(user: any) {
    if (!user || !user.isActive || user.deletedAt) throw new UnauthorizedException('Account is inactive or no longer exists');
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.accountType)) await this.ensureEmployee(user);
    const profile = this.sessionUser(user);
    const tokens = await this.generateTokens(user.id, user.email);
    return { success: true, message: 'Login successful', user: profile, tokens, ...tokens, data: { user: profile, tokens, ...tokens } };
  }
}
