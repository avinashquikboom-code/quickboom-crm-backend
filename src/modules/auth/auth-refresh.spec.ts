import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { QBIdGenerator } from './qb-id.generator';
import { Msg91Service } from '../msg91/msg91.service';
import { RoleType } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService - Token Refresh Flow', () => {
  let authService: AuthService;
  let prisma: any;
  let jwtService: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      role: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      userRole: {
        create: jest.fn(),
      },
      customer: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
      employee: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      },
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 1, token: 'mock-new-refresh-token' }),
        update: jest.fn().mockResolvedValue({ id: 1, isRevoked: true }),
      },
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_SECRET') return 'test-secret';
              if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
              if (key === 'JWT_ACCESS_EXPIRES_IN') return '7d';
              if (key === 'JWT_REFRESH_EXPIRES_IN') return '30d';
              return null;
            }),
          },
        },
        { provide: QBIdGenerator, useValue: { generateUserId: jest.fn() } },
        { provide: Msg91Service, useValue: { sendOtp: jest.fn() } },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('1. Allows SUPER_ADMIN without employee record to refresh token successfully', async () => {
    jwtService.verify.mockReturnValue({ sub: 1, email: 'admin@quickboom.com', role: 'SUPER_ADMIN' });

    prisma.refreshToken.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'admin@quickboom.com',
      isActive: true,
      deletedAt: null,
      customerId: null,
      employee: null, // No employee record!
      userRoles: [
        {
          role: {
            id: 2,
            name: 'SUPER_ADMIN',
            type: RoleType.SUPER_ADMIN,
          },
        },
      ],
    });

    const res = await authService.refreshToken({ refreshToken: 'valid-super-admin-refresh-token' });
    expect(res).toBeDefined();
    expect(res.accessToken).toBe('mock-jwt-token');
    expect(res.refreshToken).toBe('mock-jwt-token');
  });

  it('2. Allows CUSTOMER_ADMIN without employee record to refresh token successfully', async () => {
    jwtService.verify.mockReturnValue({ sub: 10, email: 'customer@test.com', role: 'CUSTOMER_ADMIN' });

    prisma.refreshToken.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 10,
      email: 'customer@test.com',
      isActive: true,
      deletedAt: null,
      customerId: 5,
      employee: null,
      userRoles: [
        {
          role: {
            id: 3,
            name: 'Customer Admin',
            type: RoleType.CUSTOMER_ADMIN,
          },
        },
      ],
    });

    const res = await authService.refreshToken({ refreshToken: 'valid-customer-admin-refresh-token' });
    expect(res).toBeDefined();
    expect(res.accessToken).toBe('mock-jwt-token');
  });

  it('3. Rejects token refresh if user account is deactivated', async () => {
    jwtService.verify.mockReturnValue({ sub: 1, email: 'admin@quickboom.com' });

    prisma.refreshToken.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'admin@quickboom.com',
      isActive: false, // Inactive user
      deletedAt: null,
      userRoles: [],
    });

    await expect(
      authService.refreshToken({ refreshToken: 'some-token' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('4. Rejects token refresh if employee has inactive status', async () => {
    jwtService.verify.mockReturnValue({ sub: 20, email: 'emp@test.com', role: 'EMPLOYEE' });

    prisma.refreshToken.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      email: 'emp@test.com',
      isActive: true,
      deletedAt: null,
      customerId: 3,
      employee: {
        id: 15,
        status: 'INACTIVE', // Inactive employee!
        mobileLoginEnabled: true,
      },
      userRoles: [
        {
          role: {
            id: 6,
            name: 'Employee',
            type: RoleType.CUSTOM,
          },
        },
      ],
    });

    await expect(
      authService.refreshToken({ refreshToken: 'emp-refresh-token' }),
    ).rejects.toThrow('Employee account is inactive or no longer exists.');
  });
});
