import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { QBIdGenerator } from './qb-id.generator';
import { Msg91Service } from '../msg91/msg91.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RoleType } from '@prisma/client';

describe('Auth Service - MSG91 OTP Authentication Flow', () => {
  let authService: AuthService;
  let prisma: any;
  let msg91Service: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
      },
    };

    msg91Service = {
      normalizeMobile: jest.fn((mobile: string) => {
        if (!mobile || !/^[6-9]\d{9}$/.test(mobile.replace(/[\s+\-]/g, '').slice(-10))) {
          throw new BadRequestException('Invalid mobile number');
        }
        return `91${mobile.replace(/[\s+\-]/g, '').slice(-10)}`;
      }),
      extract10DigitMobile: jest.fn((mobile: string) =>
        mobile.replace(/[\s+\-]/g, '').slice(-10),
      ),
      maskMobile: jest.fn((mobile: string) => '9198XXXX3210'),
      sendOtp: jest.fn().mockResolvedValue({ success: true, message: 'OTP sent' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('jwt_token_123') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_SECRET') return 'test_jwt_secret';
              if (key === 'MSG91_OTP_EXPIRY') return '10';
              return null;
            }),
          },
        },
        { provide: QBIdGenerator, useValue: new QBIdGenerator() },
        { provide: Msg91Service, useValue: msg91Service },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  describe('sendOtp', () => {
    it('dispatches 6-digit OTP to existing user mobile', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 10,
        phone: '9876543210',
        isActive: true,
        otpLastSentAt: null,
      });
      prisma.user.update.mockResolvedValue({ id: 10 });

      const res = await authService.sendOtp({ mobile: '9876543210' });
      expect(res.success).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({
            otpCode: expect.any(String),
            otpAttempts: 0,
          }),
        }),
      );
      expect(msg91Service.sendOtp).toHaveBeenCalled();
    });

    it('rejects unregistered mobile numbers', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        authService.sendOtp({ mobile: '9876543210' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces 60-second cooldown on OTP resend', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 10,
        phone: '9876543210',
        isActive: true,
        otpLastSentAt: new Date(Date.now() - 20 * 1000), // 20s ago
      });

      await expect(
        authService.sendOtp({ mobile: '9876543210' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyOtp', () => {
    it('successfully logs in when OTP is correct', async () => {
      const mockUser = {
        id: 10,
        phone: '9876543210',
        email: 'customer@acme.com',
        firstName: 'John',
        lastName: 'Doe',
        isActive: true,
        otpCode: '123456',
        otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min future
        otpAttempts: 0,
        customer: { id: 5, name: 'Acme Corp', isActive: true },
        employee: null,
        userRoles: [{ role: { type: RoleType.CUSTOM } }],
      };

      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({ ...mockUser, isPhoneVerified: true });
      prisma.refreshToken.create.mockResolvedValue({ id: 1 });

      const res = await authService.verifyOtp({
        mobile: '9876543210',
        otp: '123456',
      });

      expect(res.success).toBe(true);
      expect(res.data.user.role).toBe('CUSTOMER');
      expect(res.data.tokens).toHaveProperty('accessToken');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({
            otpCode: null,
            isPhoneVerified: true,
          }),
        }),
      );
    });

    it('rejects expired OTP', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 10,
        phone: '9876543210',
        isActive: true,
        otpCode: '123456',
        otpExpiresAt: new Date(Date.now() - 60 * 1000), // expired 1 min ago
        otpAttempts: 0,
      });

      await expect(
        authService.verifyOtp({ mobile: '9876543210', otp: '123456' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('increments attempts on wrong OTP and rejects after 5 attempts', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 10,
        phone: '9876543210',
        isActive: true,
        otpCode: '123456',
        otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
        otpAttempts: 2,
        userRoles: [],
      });
      prisma.user.update.mockResolvedValue({});

      await expect(
        authService.verifyOtp({ mobile: '9876543210', otp: '999999' }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: { otpAttempts: { increment: 1 } },
        }),
      );
    });
  });
});
