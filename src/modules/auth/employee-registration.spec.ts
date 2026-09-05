import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { QBIdGenerator } from './qb-id.generator';
import { ConflictException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { RoleType } from '@prisma/client';
import { Msg91Service } from '../msg91/msg91.service';

describe('Auth Service - Employee Registration & Mobile Login Tests', () => {
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
      employee: {
        findFirst: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
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
        findFirst: jest.fn(),
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
      sign: jest.fn().mockReturnValue('mock_employee_jwt_token_2026'),
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
        {
          provide: Msg91Service,
          useValue: { sendOtp: jest.fn().mockResolvedValue({ type: 'success' }) },
        },
        QBIdGenerator,
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  describe('Employee Registration', () => {
    it('successfully registers a COMPANY employee with employeeType = COMPANY', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({ id: 1, name: 'Default Workspace', isActive: true });
      prisma.customer.findUnique.mockResolvedValue({ id: 1, name: 'Default Workspace', isActive: true });
      prisma.user.create.mockResolvedValue({
        id: 101,
        customerId: 1,
        email: 'rahul.company@example.com',
        firstName: 'Rahul',
        lastName: 'Sharma',
        isActive: true,
      });
      prisma.employee.create.mockResolvedValue({
        id: 10,
        customerId: 1,
        userId: 101,
        employeeCode: 'QB-EMP-003',
        firstName: 'Rahul',
        lastName: 'Sharma',
        email: 'rahul.company@example.com',
        city: 'Mumbai',
        employeeType: 'COMPANY',
        employmentType: 'FULL_TIME',
        status: 'ACTIVE',
      });
      prisma.role.findFirst.mockResolvedValue({ id: 5, name: 'Employee' });

      const result = await authService.registerEmployee({
        fullName: 'Rahul Sharma',
        city: 'Mumbai',
        mobile: '+919876543210',
        email: 'rahul.company@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        employeeType: 'COMPANY',
      });

      expect(result.success).toBe(true);
      expect(result.user.employeeType).toBe('COMPANY');
      expect(result.user.city).toBe('Mumbai');
      expect(result.tokens.accessToken).toBeDefined();
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employeeType: 'COMPANY',
            city: 'Mumbai',
          }),
        }),
      );
    });

    it('successfully registers a FREELANCER with employeeType = FREELANCER and isolated customer', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.customer.create.mockResolvedValue({
        id: 99,
        name: 'Sneha Patel (Freelancer)',
        customerType: 'INDIVIDUAL',
        isActive: true,
      });
      prisma.user.create.mockResolvedValue({
        id: 102,
        customerId: 99,
        email: 'sneha.freelancer@example.com',
        firstName: 'Sneha',
        lastName: 'Patel',
        isActive: true,
      });
      prisma.employee.create.mockResolvedValue({
        id: 11,
        customerId: 99,
        userId: 102,
        employeeCode: 'QB-EMP-001',
        firstName: 'Sneha',
        lastName: 'Patel',
        email: 'sneha.freelancer@example.com',
        city: 'Bengaluru',
        employeeType: 'FREELANCER',
        employmentType: 'CONTRACT',
        status: 'ACTIVE',
      });
      prisma.role.findFirst.mockResolvedValue({ id: 5, name: 'Employee' });

      const result = await authService.registerEmployee({
        fullName: 'Sneha Patel',
        city: 'Bengaluru',
        mobile: '+919876543211',
        email: 'sneha.freelancer@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        employeeType: 'FREELANCER',
      });

      expect(result.success).toBe(true);
      expect(result.user.employeeType).toBe('FREELANCER');
      expect(result.user.customerId).toBe(99);
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employeeType: 'FREELANCER',
            city: 'Bengaluru',
          }),
        }),
      );
    });

    it('rejects registration when employeeType is missing or invalid', async () => {
      await expect(
        authService.registerEmployee({
          fullName: 'Test User',
          city: 'Pune',
          mobile: '+919876543212',
          email: 'test@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          employeeType: 'INVALID_TYPE' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects registration when email is already registered', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 50,
        email: 'duplicate@example.com',
      });

      await expect(
        authService.registerEmployee({
          fullName: 'Duplicate User',
          city: 'Delhi',
          mobile: '+919876543213',
          email: 'duplicate@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          employeeType: 'COMPANY',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Employee Mobile Login Status Validation', () => {
    it('blocks employee login with "Payment verification pending." when employee status is PAYMENT_PENDING', async () => {
      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

      prisma.user.findFirst.mockResolvedValue({
        id: 105,
        email: 'pending@quikboom.com',
        passwordHash: 'hashed_password',
        isActive: true,
        userRoles: [{ role: { name: 'Employee', type: RoleType.CUSTOM } }],
        customer: { id: 1, isActive: true },
        employee: {
          id: 15,
          status: 'PAYMENT_PENDING',
          mobileLoginEnabled: true,
        },
      });

      await expect(
        authService.login('pending@quikboom.com', 'Password123!', 'EMPLOYEE'),
      ).rejects.toThrow(new UnauthorizedException('Payment verification pending.'));
    });

    it('blocks employee login with "Payment verification rejected. Please contact administrator." when status is PAYMENT_REJECTED', async () => {
      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

      prisma.user.findFirst.mockResolvedValue({
        id: 106,
        email: 'rejected@quikboom.com',
        passwordHash: 'hashed_password',
        isActive: true,
        userRoles: [{ role: { name: 'Employee', type: RoleType.CUSTOM } }],
        customer: { id: 1, isActive: true },
        employee: {
          id: 16,
          status: 'PAYMENT_REJECTED',
          mobileLoginEnabled: true,
        },
      });

      await expect(
        authService.login('rejected@quikboom.com', 'Password123!', 'EMPLOYEE'),
      ).rejects.toThrow(
        new UnauthorizedException('Payment verification rejected. Please contact administrator.'),
      );
    });
  });
});
