import {
  Injectable,
  UnauthorizedException,
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

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        customer: true,
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

    if (user.customer && !user.customer.isActive) {
      throw new UnauthorizedException('Your company account is suspended');
    }

    const userRoleTypes = user.userRoles.map((ur) => ur.role.type);
    const isSuperAdmin =
      userRoleTypes.includes(RoleType.SUPER_ADMIN) ||
      user.email === 'admin@quikboom.com';

    if (!isSuperAdmin) {
      throw new UnauthorizedException(
        'Access Restricted: The Admin Panel is exclusively accessible by Super Admin. Employees and staff must use the QuikBoom Mobile App.',
      );
    }

    const tokens = await this.generateTokens(user.id, user.customerId, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        customerId: user.customerId,
        customerName: user.customer?.name || 'Super Admin',
        roles: user.userRoles.map((ur) => ur.role.type),
      },
      tokens,
    };
  }

  async refreshToken(dto: RefreshTokenDto) {
    const existingToken = await this.prisma.refreshToken.findUnique({
      where: { token: dto.refreshToken },
      include: { user: true },
    });

    if (!existingToken || existingToken.isRevoked || existingToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: existingToken.id },
      data: { isRevoked: true },
    });

    return this.generateTokens(
      existingToken.user.id,
      existingToken.user.customerId,
      existingToken.user.email,
    );
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

  private async generateTokens(userId: string, customerId: string | null, email: string) {
    const payload = { sub: userId, customerId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET') || 'quikboom_super_secret_jwt_access_key_2026',
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret:
        this.configService.get('JWT_REFRESH_SECRET') ||
        'quikboom_super_secret_jwt_refresh_key_2026',
      expiresIn: '7d',
    });

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
    };
  }
}
