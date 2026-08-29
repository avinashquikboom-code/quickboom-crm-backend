import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { MobileAuthController } from './mobile-auth.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { QBIdGenerator } from './qb-id.generator';
import { Msg91Service } from '../msg91/msg91.service';
import { RoleType } from '@prisma/client';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('Customer Mobile Login Role Validation', () => {
  let authService: AuthService;
  let mobileAuthController: MobileAuthController;
  let prisma: any;
  let jwtService: any;

  const mockHashedPassword = bcrypt.hashSync('validPassword123', 10);

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
        create: jest.fn().mockResolvedValue({ id: 1, token: 'mock-refresh-token' }),
      },
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MobileAuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_SECRET') return 'test_jwt_secret';
              if (key === 'JWT_ACCESS_EXPIRES_IN') return '7d';
              if (key === 'JWT_REFRESH_SECRET') return 'test_refresh_secret';
              if (key === 'JWT_REFRESH_EXPIRES_IN') return '30d';
              return null;
            }),
          },
        },
        QBIdGenerator,
        {
          provide: Msg91Service,
          useValue: {
            sendOtp: jest.fn(),
            verifyOtp: jest.fn(),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    mobileAuthController = module.get<MobileAuthController>(MobileAuthController);
  });

  it('1. Allows CUSTOMER_ADMIN (test@gmail.com, User 10, Customer 11, Role 7) to login via customer mobile endpoint', async () => {
    const mockUser = {
      id: 10,
      customerId: 11,
      email: 'test@gmail.com',
      phone: null,
      firstName: 'Customer',
      lastName: 'Administrator',
      passwordHash: mockHashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null,
      customer: {
        id: 11,
        name: 'Test Customer Workspace',
        isActive: true,
        deletedAt: null,
      },
      userRoles: [
        {
          roleId: 7,
          role: {
            id: 7,
            customerId: 11,
            name: 'Customer Administrator',
            type: RoleType.CUSTOMER_ADMIN,
            description: 'Full administrative access to customer workspace',
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(mockUser);

    const response = await mobileAuthController.loginCustomer({
      email: 'test@gmail.com',
      password: 'validPassword123',
    });

    expect(response.success).toBe(true);
    expect(response.user.id).toBe(10);
    expect(response.user.customerId).toBe(11);
    expect(response.user.roleId).toBe(7);
    expect(response.user.role).toBe('CUSTOMER_ADMIN');
    expect(response.user.roleType).toBe(RoleType.CUSTOMER_ADMIN);
    expect(response.tokens).toBeDefined();

    // Verify JWT payload generated with userId, customerId, roleId
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 10,
        userId: 10,
        customerId: 11,
        roleId: 7,
        role: 'CUSTOMER_ADMIN',
        roleType: RoleType.CUSTOMER_ADMIN,
      }),
      expect.any(Object),
    );
  });

  it('2. Allows normal CUSTOMER role user to login via customer mobile endpoint', async () => {
    const mockUser = {
      id: 20,
      customerId: 11,
      email: 'member@test.com',
      firstName: 'Member',
      lastName: 'User',
      passwordHash: mockHashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null,
      customer: {
        id: 11,
        name: 'Test Customer Workspace',
        isActive: true,
      },
      userRoles: [
        {
          roleId: 15,
          role: {
            id: 15,
            customerId: 11,
            name: 'Customer User',
            type: RoleType.CUSTOM,
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(mockUser);

    const response = await mobileAuthController.loginCustomer({
      email: 'member@test.com',
      password: 'validPassword123',
    });

    expect(response.success).toBe(true);
    expect(response.user.id).toBe(20);
    expect(response.user.customerId).toBe(11);
    expect(response.user.role).toBe('CUSTOMER');
  });

  it('3. Rejects EMPLOYEE role from customer mobile endpoint with HTTP 403 Forbidden', async () => {
    const mockEmployee = {
      id: 30,
      customerId: 11,
      email: 'sales@test.com',
      firstName: 'Sales',
      lastName: 'Executive',
      passwordHash: mockHashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null,
      employee: {
        id: 5,
        employeeCode: 'EMP-005',
        status: 'ACTIVE',
        mobileLoginEnabled: true,
      },
      customer: {
        id: 11,
        isActive: true,
      },
      userRoles: [
        {
          roleId: 3,
          role: {
            id: 3,
            name: 'Sales Executive',
            type: RoleType.SALES_EXECUTIVE,
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(mockEmployee);

    await expect(
      mobileAuthController.loginCustomer({
        email: 'sales@test.com',
        password: 'validPassword123',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('4. Rejects SUPER_ADMIN from customer mobile endpoint with HTTP 403 Forbidden', async () => {
    const mockSuperAdmin = {
      id: 1,
      customerId: null,
      email: 'superadmin@quikboom.com',
      firstName: 'Super',
      lastName: 'Admin',
      passwordHash: mockHashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null,
      userRoles: [
        {
          roleId: 1,
          role: {
            id: 1,
            name: 'Super Administrator',
            type: RoleType.SUPER_ADMIN,
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(mockSuperAdmin);

    await expect(
      mobileAuthController.loginCustomer({
        email: 'superadmin@quikboom.com',
        password: 'validPassword123',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('5. Throws clear suspension UnauthorizedException if customer workspace is inactive', async () => {
    const mockSuspendedUser = {
      id: 10,
      customerId: 11,
      email: 'test@gmail.com',
      firstName: 'Customer',
      lastName: 'Admin',
      passwordHash: mockHashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null,
      customer: {
        id: 11,
        name: 'Suspended Workspace',
        isActive: false, // Suspended!
      },
      userRoles: [
        {
          roleId: 7,
          role: {
            id: 7,
            name: 'Customer Administrator',
            type: RoleType.CUSTOMER_ADMIN,
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(mockSuspendedUser);

    await expect(
      mobileAuthController.loginCustomer({
        email: 'test@gmail.com',
        password: 'validPassword123',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('6. Rejects CUSTOMER_ADMIN (test@gmail.com) from Employee mobile endpoint with HTTP 403 Forbidden', async () => {
    const mockCustomerAdmin = {
      id: 10,
      customerId: 11,
      email: 'test@gmail.com',
      firstName: 'Customer',
      lastName: 'Administrator',
      passwordHash: mockHashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null,
      customer: {
        id: 11,
        name: 'Test Customer Workspace',
        isActive: true,
      },
      userRoles: [
        {
          roleId: 7,
          role: {
            id: 7,
            customerId: 11,
            name: 'Customer Administrator',
            type: RoleType.CUSTOMER_ADMIN,
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(mockCustomerAdmin);

    await expect(
      mobileAuthController.loginEmployee({
        email: 'test@gmail.com',
        password: 'validPassword123',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('7. Rejects normal CUSTOMER from Employee mobile endpoint with HTTP 403 Forbidden', async () => {
    const mockCustomer = {
      id: 20,
      customerId: 11,
      email: 'member@test.com',
      firstName: 'Member',
      lastName: 'User',
      passwordHash: mockHashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null,
      customer: {
        id: 11,
        name: 'Test Customer Workspace',
        isActive: true,
      },
      userRoles: [
        {
          roleId: 15,
          role: {
            id: 15,
            customerId: 11,
            name: 'Customer User',
            type: RoleType.CUSTOM,
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(mockCustomer);

    await expect(
      mobileAuthController.loginEmployee({
        email: 'member@test.com',
        password: 'validPassword123',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('8. Allows valid EMPLOYEE to login via Employee mobile endpoint with HTTP 200 OK', async () => {
    const mockEmployee = {
      id: 30,
      customerId: 11,
      email: 'employee@test.com',
      firstName: 'Emp',
      lastName: 'Loyee',
      passwordHash: mockHashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null,
      employee: {
        id: 5,
        employeeCode: 'EMP-005',
        status: 'ACTIVE',
        mobileLoginEnabled: true,
      },
      customer: {
        id: 11,
        name: 'Test Customer Workspace',
        isActive: true,
      },
      userRoles: [
        {
          roleId: 3,
          role: {
            id: 3,
            name: 'Sales Executive',
            type: RoleType.SALES_EXECUTIVE,
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(mockEmployee);

    const response = await mobileAuthController.loginEmployee({
      email: 'employee@test.com',
      password: 'validPassword123',
    });

    expect(response.success).toBe(true);
    expect(response.user.id).toBe(30);
    expect(response.user.role).toBe('EMPLOYEE');
    expect(response.user.employee).toBeDefined();
  });

  it('9. Rejects SUPER_ADMIN from Employee mobile endpoint with HTTP 403 Forbidden', async () => {
    const mockSuperAdmin = {
      id: 1,
      customerId: null,
      email: 'superadmin@quikboom.com',
      firstName: 'Super',
      lastName: 'Admin',
      passwordHash: mockHashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null,
      userRoles: [
        {
          roleId: 1,
          role: {
            id: 1,
            name: 'Super Administrator',
            type: RoleType.SUPER_ADMIN,
          },
        },
      ],
    };

    prisma.user.findFirst.mockResolvedValue(mockSuperAdmin);

    await expect(
      mobileAuthController.loginEmployee({
        email: 'superadmin@quikboom.com',
        password: 'validPassword123',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
