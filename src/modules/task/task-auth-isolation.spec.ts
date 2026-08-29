import { Test, TestingModule } from '@nestjs/testing';
import { TaskService } from './task.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { Msg91Service } from '../msg91/msg91.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { UnauthorizedException, ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleType } from '@prisma/client';

describe('Tasks API End-to-End Authentication & Multi-Role Isolation (20A - 20H)', () => {
  let taskService: TaskService;
  let authService: AuthService;
  let jwtStrategy: JwtStrategy;
  let jwtAuthGuard: JwtAuthGuard;
  let customerGuard: CustomerGuard;
  let prisma: any;
  let jwtService: any;
  let configService: any;

  beforeEach(async () => {
    prisma = {
      task: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      employee: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      customer: {
        findUnique: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock_access_token_jwt_2026'),
      verify: jest.fn(),
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
        TaskService,
        AuthService,
        JwtStrategy,
        JwtAuthGuard,
        CustomerGuard,
        Reflector,
        QBIdGenerator,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
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

    taskService = module.get<TaskService>(TaskService);
    authService = module.get<AuthService>(AuthService);
    jwtStrategy = module.get<JwtStrategy>(JwtStrategy);
    jwtAuthGuard = module.get<JwtAuthGuard>(JwtAuthGuard);
    customerGuard = module.get<CustomerGuard>(CustomerGuard);
  });

  describe('Case A: Valid Access Token', () => {
    it('successfully validates user from database and returns authenticated context', async () => {
      const mockDbUser = {
        id: 50,
        email: 'cadmin@company.com',
        customerId: 101,
        firstName: 'Company',
        lastName: 'Admin',
        isActive: true,
        userRoles: [
          { role: { type: RoleType.TENANT_ADMIN, name: 'Company Admin', rolePermissions: [] } },
        ],
      };

      prisma.user.findUnique.mockResolvedValue(mockDbUser);

      const userContext = await jwtStrategy.validate({ sub: 50 });
      expect(userContext.id).toBe(50);
      expect(userContext.customerId).toBe(101);
      expect(userContext.role).toBe('COMPANY_ADMIN');
    });
  });

  describe('Case B: Expired Access Token -> Refresh -> Retry Flow', () => {
    it('refreshes token successfully when refresh token is valid and unrevoked', async () => {
      jwtService.verify.mockReturnValue({ sub: 50, customerId: 101 });

      const mockDbUser = {
        id: 50,
        email: 'cadmin@company.com',
        customerId: 101,
        isActive: true,
        deletedAt: null,
      };

      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 1,
        userId: 50,
        token: 'valid_refresh_token_123',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        user: mockDbUser,
      });

      prisma.refreshToken.update.mockResolvedValue({ id: 1, isRevoked: true });
      prisma.refreshToken.create.mockResolvedValue({ id: 2 });

      const res = await authService.refreshToken({
        refreshToken: 'valid_refresh_token_123',
      });

      expect(res.accessToken).toBe('mock_access_token_jwt_2026');
      expect(res.user.id).toBe(50);
    });
  });

  describe('Case C & D: Invalid Access Token or Missing Auth Header', () => {
    it('throws 401 Unauthorized on missing user/invalid token in JwtAuthGuard', () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'GET', url: '/api/v1/tasks', headers: {} }),
        }),
      } as unknown as ExecutionContext;

      expect(() => {
        jwtAuthGuard.handleRequest(null, null, { message: 'jwt must be provided' }, mockContext);
      }).toThrow(UnauthorizedException);
    });

    it('rejects deactivated or deleted user token (401)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 50,
        isActive: false,
        deletedAt: new Date(),
      });

      await expect(jwtStrategy.validate({ sub: 50 })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Case E: Valid CUSTOMER Token', () => {
    it('scopes tasks query strictly to customerId (101)', async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: 1, title: 'Customer Task 1', customerId: 101, proofs: [] },
      ]);
      prisma.task.count.mockResolvedValue(1);

      const res = await taskService.findAll(101, { page: 1, limit: 20 });
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 101, deletedAt: null }),
        }),
      );
      expect(res.data).toHaveLength(1);
    });
  });

  describe('Case F: Valid EMPLOYEE Token', () => {
    it('scopes tasks query strictly to employee company workspace', async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: 2, title: 'Employee Assigned Task', customerId: 101, proofs: [] },
      ]);
      prisma.task.count.mockResolvedValue(1);

      const res = await taskService.findAll(101, { employeeId: '10' });
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 101, employeeId: 10, deletedAt: null }),
        }),
      );
      expect(res.data).toHaveLength(1);
    });
  });

  describe('Case G: Valid COMPANY_ADMIN Token', () => {
    it('scopes tasks to full company workspace', async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: 3, title: 'Company Wide Task', customerId: 101, proofs: [] },
      ]);
      prisma.task.count.mockResolvedValue(1);

      const res = await taskService.findAll(101, {});
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 101, deletedAt: null }),
        }),
      );
      expect(res.data).toHaveLength(1);
    });
  });

  describe('Case H: Valid SUPER_ADMIN Token', () => {
    it('allows Super Admin to query tasks across platform without customerId filter', async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: 1, title: 'Company A Task', customerId: 101, proofs: [] },
        { id: 2, title: 'Company B Task', customerId: 102, proofs: [] },
      ]);
      prisma.task.count.mockResolvedValue(2);

      const res = await taskService.findAll(undefined, {});
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
        }),
      );
      expect(res.data).toHaveLength(2);
    });
  });
});
