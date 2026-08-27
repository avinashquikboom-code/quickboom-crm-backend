import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { QBIdGenerator } from './qb-id.generator';
import { ConflictException, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RoleType } from '@prisma/client';

describe('Auth Service - Customer Registration & Role Isolation Tests', () => {
  let authService: AuthService;
  let prisma: any;
  let jwtService: any;
  let configService: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      plan: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      customerSubscription: {
        create: jest.fn(),
      },
      role: {
        create: jest.fn(),
      },
      userRole: {
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prisma);
        }
        return Promise.all(cb);
      }),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock_signed_jwt_token_2026'),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test_jwt_secret_key_12345';
        if (key === 'JWT_REFRESH_SECRET') return 'test_jwt_refresh_secret_key_12345';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        QBIdGenerator,
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  describe('1. Valid Customer Registration Flow', () => {
    it('successfully registers a new customer (boomquik@gmail.com, Vadodara, Quik@2026) and returns tokens', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      prisma.customer.create.mockResolvedValue({
        id: 101,
        name: 'BoomQuik Tech',
        companyName: 'BoomQuik Tech',
        email: 'boomquik@gmail.com',
        phone: '+919876543210',
        city: 'Vadodara',
        isActive: true,
      });

      prisma.plan.findUnique.mockResolvedValue({
        id: 1,
        name: 'Starter Plan',
        code: 'STARTER',
      });

      prisma.customerSubscription.create.mockResolvedValue({
        id: 501,
        customerId: 101,
        planId: 1,
        status: 'TRIAL',
      });

      prisma.role.create.mockResolvedValue({
        id: 10,
        customerId: 101,
        name: 'Customer Administrator',
        type: RoleType.CUSTOMER_ADMIN,
      });

      prisma.user.create.mockResolvedValue({
        id: 1001,
        customerId: 101,
        email: 'boomquik@gmail.com',
        phone: '+919876543210',
        firstName: 'BoomQuik',
        lastName: 'Tech',
        isVerified: true,
      });

      prisma.userRole.create.mockResolvedValue({
        userId: 1001,
        roleId: 10,
      });

      prisma.refreshToken.create.mockResolvedValue({
        id: 1,
        userId: 1001,
        token: 'mock_signed_jwt_token_2026',
      });

      const res = await authService.registerCustomer({
        companyName: 'BoomQuik Tech',
        fullName: 'BoomQuik Tech',
        email: 'boomquik@gmail.com',
        city: 'Vadodara',
        phone: '+919876543210',
        password: 'Quik@2026',
      });

      expect(res.success).toBe(true);
      expect(res.user.email).toBe('boomquik@gmail.com');
      expect(res.user.customerId).toBe(101);
      expect(res.tokens.accessToken).toBeDefined();
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });
  });

  describe('2. Duplicate Email & Phone Conflict Handling', () => {
    it('throws ConflictException (409) when email already exists', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 200,
        email: 'boomquik@gmail.com',
        phone: null,
      });

      await expect(
        authService.registerCustomer({
          companyName: 'BoomQuik Duplicate',
          email: 'boomquik@gmail.com',
          city: 'Vadodara',
          password: 'Quik@2026',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException (409) when phone already exists', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 201,
        email: 'other@gmail.com',
        phone: '+919876543210',
      });

      await expect(
        authService.registerCustomer({
          companyName: 'BoomQuik Phone Duplicate',
          email: 'newemail@gmail.com',
          phone: '+919876543210',
          password: 'Quik@2026',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('3. Role Isolation Enforcement', () => {
    it('rejects Customer account trying to login as Employee (403 Forbidden)', async () => {
      const mockCustomerUser = {
        id: 1001,
        customerId: 101,
        email: 'boomquik@gmail.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        customer: { id: 101, isActive: true },
        employee: null,
        userRoles: [{ role: { type: RoleType.CUSTOMER_ADMIN, name: 'Customer Administrator' } }],
      };

      prisma.user.findFirst.mockResolvedValue(mockCustomerUser);

      // Mock bcrypt.compare
      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

      await expect(
        authService.login({
          email: 'boomquik@gmail.com',
          password: 'Quik@2026',
          appType: 'EMPLOYEE_MOBILE',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects Customer account trying to login as Company Admin (403 Forbidden)', async () => {
      const mockCustomerUser = {
        id: 1001,
        customerId: 101,
        email: 'boomquik@gmail.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        customer: { id: 101, isActive: true },
        employee: null,
        userRoles: [{ role: { type: RoleType.CUSTOMER_ADMIN, name: 'Customer Administrator' } }],
      };

      prisma.user.findFirst.mockResolvedValue(mockCustomerUser);

      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

      await expect(
        authService.login({
          email: 'boomquik@gmail.com',
          password: 'Quik@2026',
          appType: 'COMPANY_ADMIN',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Customer account login with CUSTOMER app type', async () => {
      const mockCustomerUser = {
        id: 1001,
        customerId: 101,
        email: 'boomquik@gmail.com',
        firstName: 'BoomQuik',
        lastName: 'Tech',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        customer: { id: 101, isActive: true, name: 'BoomQuik Tech' },
        employee: null,
        userRoles: [{ role: { type: RoleType.CUSTOMER_ADMIN, name: 'Customer Administrator' } }],
      };

      prisma.user.findFirst.mockResolvedValue(mockCustomerUser);
      prisma.refreshToken.create.mockResolvedValue({ id: 1 });

      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

      const loginRes = await authService.login({
        email: 'boomquik@gmail.com',
        password: 'Quik@2026',
        appType: 'CUSTOMER',
      });

      expect(loginRes.user.role).toBe('CUSTOMER');
      expect(loginRes.user.customerId).toBe(101);
      expect(loginRes.tokens.accessToken).toBeDefined();
    });
  });
});
