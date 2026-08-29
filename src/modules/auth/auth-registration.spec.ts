import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { QBIdGenerator } from './qb-id.generator';
import { ConflictException, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RoleType } from '@prisma/client';
import { Msg91Service } from '../msg91/msg91.service';

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
        {
          provide: Msg91Service,
          useValue: {
            normalizeMobile: jest.fn((m) => `91${m.slice(-10)}`),
            extract10DigitMobile: jest.fn((m) => m.slice(-10)),
            maskMobile: jest.fn(() => '9198XXXX3210'),
            sendOtp: jest.fn().mockResolvedValue({ success: true }),
          },
        },
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

  describe('3. Role Isolation & Authentication Tests', () => {
    const bcrypt = require('bcrypt');

    beforeEach(() => {
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
      prisma.refreshToken.create.mockResolvedValue({ id: 1 });
    });

    it('Super Admin + active user => login SUCCESS (role SUPER_ADMIN)', async () => {
      const mockSuperAdmin = {
        id: 1,
        customerId: null,
        email: 'admin@quikboom.com',
        firstName: 'Super',
        lastName: 'Admin',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        customer: null,
        employee: null,
        userRoles: [
          { roleId: 2, role: { id: 2, type: RoleType.SUPER_ADMIN, name: 'Super Administrator' } },
        ],
      };

      prisma.user.findFirst.mockResolvedValue(mockSuperAdmin);

      const res = await authService.login({
        email: 'admin@quikboom.com',
        password: '123456',
        appType: 'SUPER_ADMIN',
      });

      expect(res.user.role).toBe('SUPER_ADMIN');
      expect(res.tokens.accessToken).toBeDefined();
    });

    it('Super Admin + suspended customer => login SUCCESS (Super Admin bypasses company suspension)', async () => {
      const mockSuperAdminWithSuspendedCustomer = {
        id: 1,
        customerId: 1,
        email: 'admin@quikboom.com',
        firstName: 'Super',
        lastName: 'Admin',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        customer: { id: 1, isActive: false, name: 'Suspended Workspace' },
        employee: null,
        userRoles: [
          { roleId: 2, role: { id: 2, type: RoleType.SUPER_ADMIN, name: 'Super Administrator' } },
        ],
      };

      prisma.user.findFirst.mockResolvedValue(mockSuperAdminWithSuspendedCustomer);

      const res = await authService.login({
        email: 'admin@quikboom.com',
        password: '123456',
        appType: 'SUPER_ADMIN',
      });

      expect(res.user.role).toBe('SUPER_ADMIN');
      expect(res.tokens.accessToken).toBeDefined();
    });

    it('Company Admin + active company => login SUCCESS', async () => {
      const mockCompanyAdmin = {
        id: 50,
        customerId: 101,
        email: 'cadmin@company.com',
        firstName: 'Company',
        lastName: 'Admin',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        customer: { id: 101, isActive: true, name: 'Active Company' },
        employee: null,
        userRoles: [
          { roleId: 5, role: { id: 5, type: RoleType.TENANT_ADMIN, name: 'Company Admin' } },
        ],
      };

      prisma.user.findFirst.mockResolvedValue(mockCompanyAdmin);

      const res = await authService.login({
        email: 'cadmin@company.com',
        password: '123456',
        appType: 'COMPANY_ADMIN',
      });

      expect(res.user.role).toBe('COMPANY_ADMIN');
      expect(res.tokens.accessToken).toBeDefined();
    });

    it('Company Admin + suspended company => login REJECTED (401)', async () => {
      const mockSuspendedCompanyAdmin = {
        id: 50,
        customerId: 101,
        email: 'cadmin@company.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        customer: { id: 101, isActive: false, name: 'Suspended Company' },
        employee: null,
        userRoles: [
          { roleId: 5, role: { id: 5, type: RoleType.TENANT_ADMIN, name: 'Company Admin' } },
        ],
      };

      prisma.user.findFirst.mockResolvedValue(mockSuspendedCompanyAdmin);

      await expect(
        authService.login({
          email: 'cadmin@company.com',
          password: '123456',
          appType: 'COMPANY_ADMIN',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Employee + valid company => login SUCCESS', async () => {
      const mockEmployee = {
        id: 1002,
        customerId: 101,
        email: 'emp@company.com',
        firstName: 'Staff',
        lastName: 'Employee',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        customer: { id: 101, isActive: true, name: 'Active Company' },
        employee: {
          id: 10,
          employeeCode: 'EMP-001',
          status: 'ACTIVE',
          mobileLoginEnabled: true,
        },
        userRoles: [
          { roleId: 4, role: { id: 4, type: RoleType.CUSTOM, name: 'Employee' } },
        ],
      };

      prisma.user.findFirst.mockResolvedValue(mockEmployee);

      const res = await authService.login({
        email: 'emp@company.com',
        password: '123456',
        appType: 'EMPLOYEE_MOBILE',
      });

      expect(res.user.role).toBe('EMPLOYEE');
      expect(res.tokens.accessToken).toBeDefined();
    });

    it('Customer + valid company => login SUCCESS', async () => {
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
        userRoles: [{ roleId: 3, role: { id: 3, type: RoleType.CUSTOM, name: 'Customer' } }],
      };

      prisma.user.findFirst.mockResolvedValue(mockCustomerUser);

      const res = await authService.login({
        email: 'boomquik@gmail.com',
        password: 'Quik@2026',
        appType: 'CUSTOMER',
      });

      expect(res.user.role).toBe('CUSTOMER');
      expect(res.user.customerId).toBe(101);
      expect(res.tokens.accessToken).toBeDefined();
    });

    it('Invalid password => rejects with 401 Unauthorized', async () => {
      const mockUser = {
        id: 1001,
        email: 'user@quikboom.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        userRoles: [],
      };

      prisma.user.findFirst.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);

      await expect(
        authService.login({
          email: 'user@quikboom.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Inactive user => rejects with 401 Unauthorized', async () => {
      const mockInactiveUser = {
        id: 1001,
        email: 'inactive@quikboom.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: false,
        userRoles: [],
      };

      prisma.user.findFirst.mockResolvedValue(mockInactiveUser);

      await expect(
        authService.login({
          email: 'inactive@quikboom.com',
          password: '123456',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Deleted user => rejects with 401 Unauthorized', async () => {
      const mockDeletedUser = {
        id: 1001,
        email: 'deleted@quikboom.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        deletedAt: new Date(),
        userRoles: [],
      };

      prisma.user.findFirst.mockResolvedValue(mockDeletedUser);

      await expect(
        authService.login({
          email: 'deleted@quikboom.com',
          password: '123456',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects Customer account trying to login as Employee (403 Forbidden)', async () => {
      const mockCustomerUser = {
        id: 1001,
        customerId: 101,
        email: 'boomquik@gmail.com',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isActive: true,
        customer: { id: 101, isActive: true },
        employee: null,
        userRoles: [{ roleId: 3, role: { id: 3, type: RoleType.CUSTOM, name: 'Customer' } }],
      };

      prisma.user.findFirst.mockResolvedValue(mockCustomerUser);

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
        userRoles: [{ roleId: 3, role: { id: 3, type: RoleType.CUSTOM, name: 'Customer' } }],
      };

      prisma.user.findFirst.mockResolvedValue(mockCustomerUser);

      await expect(
        authService.login({
          email: 'boomquik@gmail.com',
          password: 'Quik@2026',
          appType: 'COMPANY_ADMIN',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
