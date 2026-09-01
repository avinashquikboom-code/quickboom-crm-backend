import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ForbiddenException, NotFoundException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AuthService } from '../auth/auth.service';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerGuard } from '../../common/guards/customer.guard';

describe('API Authentication & Authorization Spec (GET /api/v1/employees/:id)', () => {
  let jwtService: JwtService;
  let jwtStrategy: JwtStrategy;
  let authService: AuthService;
  let jwtAuthGuard: JwtAuthGuard;
  let customerGuard: CustomerGuard;
  let employeeController: EmployeeController;
  let employeeService: EmployeeService;
  let prisma: any;

  const JWT_SECRET = 'quikboom_super_secret_jwt_access_key_2026';
  const JWT_REFRESH_SECRET = 'quikboom_super_secret_jwt_refresh_key_2026';

  beforeEach(async () => {
    jwtService = new JwtService({});

    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      employee: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return JWT_SECRET;
        if (key === 'JWT_REFRESH_SECRET') return JWT_REFRESH_SECRET;
        if (key === 'JWT_ACCESS_EXPIRES_IN') return '1h';
        if (key === 'JWT_REFRESH_EXPIRES_IN') return '30d';
        return null;
      }),
    };

    jwtStrategy = new JwtStrategy(configService as any, prisma as any);
    authService = new AuthService(
      prisma as any,
      jwtService,
      configService as any,
      { generateQBUserId: () => 'QB-EMP-003' } as any,
      {} as any,
    );
    jwtAuthGuard = new JwtAuthGuard(new Reflector());
    customerGuard = new CustomerGuard(prisma as any);

    employeeService = {
      findOne: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    } as any;

    employeeController = new EmployeeController(employeeService);
  });

  describe('1. Token Verification & Authorization Header Handling', () => {
    it('ALLOWS authentication when valid Bearer access token is provided', async () => {
      const payload = { sub: 3, userId: 3, customerId: 1, email: 'emp3@example.com' };
      const validToken = jwtService.sign(payload, { secret: JWT_SECRET, expiresIn: '1h' });

      // Mock database user lookup in JwtStrategy
      prisma.user.findUnique.mockResolvedValue({
        id: 3,
        email: 'emp3@example.com',
        isActive: true,
        customerId: 1,
        userRoles: [{ role: { name: 'EMPLOYEE', type: 'CUSTOM' } }],
        employee: { id: 3, customerId: 1, employeeCode: 'EMP-003' },
        customer: { id: 1, name: 'QuikBoom Org', isActive: true },
      });

      // Verify token payload through JwtStrategy
      const decodedPayload = jwtService.verify(validToken, { secret: JWT_SECRET });
      const user = await jwtStrategy.validate(decodedPayload);

      expect(user).toBeDefined();
      expect(user.id).toBe(3);
      expect(user.customerId).toBe(1);
      expect(user.role).toBe('EMPLOYEE');

      // Test JwtAuthGuard handleRequest
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            url: '/api/v1/employees/3',
            headers: { authorization: `Bearer ${validToken}` },
          }),
        }),
      } as any;

      const guardResult = jwtAuthGuard.handleRequest(null, user, null, mockContext);
      expect(guardResult).toBe(user);
    });

    it('REJECTS with 401 Unauthorized when Authorization header is missing', () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            url: '/api/v1/employees/3',
            headers: {},
          }),
        }),
      } as any;

      expect(() => {
        jwtAuthGuard.handleRequest(null, null, { message: 'No auth token' }, mockContext);
      }).toThrow(UnauthorizedException);
    });

    it('REJECTS with 401 Unauthorized when Authorization header is malformed (Bearer null / Bearer undefined)', () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            url: '/api/v1/employees/3',
            headers: { authorization: 'Bearer null' },
          }),
        }),
      } as any;

      expect(() => {
        jwtAuthGuard.handleRequest(null, null, { message: 'jwt malformed' }, mockContext);
      }).toThrow(UnauthorizedException);
    });

    it('REJECTS with 401 Unauthorized when access token is expired', () => {
      const payload = { sub: 3, userId: 3, customerId: 1, email: 'emp3@example.com' };
      // Expired 10 seconds ago
      const expiredToken = jwtService.sign(payload, { secret: JWT_SECRET, expiresIn: '-10s' });

      expect(() => {
        jwtService.verify(expiredToken, { secret: JWT_SECRET });
      }).toThrow();

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            url: '/api/v1/employees/3',
            headers: { authorization: `Bearer ${expiredToken}` },
          }),
        }),
      } as any;

      expect(() => {
        jwtAuthGuard.handleRequest(null, null, { message: 'jwt expired' }, mockContext);
      }).toThrow(UnauthorizedException);
    });

    it('REJECTS with 401 Unauthorized when user in DB is inactive or deleted', async () => {
      const payload = { sub: 3, userId: 3, customerId: 1 };
      prisma.user.findUnique.mockResolvedValue({
        id: 3,
        isActive: false, // Inactive user
        deletedAt: null,
      });

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('2. Refresh Token Flow', () => {
    it('SUCCESSFULLY issues new accessToken when valid refreshToken is provided', async () => {
      const refreshPayload = { sub: 3, customerId: 1, email: 'emp3@example.com' };
      const validRefreshToken = jwtService.sign(refreshPayload, {
        secret: JWT_REFRESH_SECRET,
        expiresIn: '30d',
      });

      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 1,
        userId: 3,
        token: validRefreshToken,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        user: {
          id: 3,
          email: 'emp3@example.com',
          isActive: true,
          customerId: 1,
          userRoles: [{ role: { name: 'EMPLOYEE', type: 'CUSTOM' } }],
          employee: { id: 3, customerId: 1 },
          customer: { id: 1, isActive: true },
        },
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 2, token: 'new_refresh' });
      prisma.refreshToken.update.mockResolvedValue({ id: 1, isRevoked: true });

      const refreshResult = await authService.refreshToken({ refreshToken: validRefreshToken });

      expect(refreshResult.accessToken).toBeDefined();
      expect(refreshResult.refreshToken).toBeDefined();

      // Verify the newly generated access token is valid and verifiable
      const verified = jwtService.verify(refreshResult.accessToken, { secret: JWT_SECRET });
      expect(verified.sub).toBe(3);
      expect(verified.role).toBe('EMPLOYEE');
    });

    it('REJECTS with 401 Unauthorized when refresh token is expired or revoked', async () => {
      const expiredRefreshToken = jwtService.sign(
        { sub: 3 },
        { secret: JWT_REFRESH_SECRET, expiresIn: '-1s' },
      );

      await expect(
        authService.refreshToken({ refreshToken: expiredRefreshToken }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('3. GET /api/v1/employees & GET /api/v1/employees/:id Controller & RBAC Behavior', () => {
    it('RETURNS 200 OK when authenticated user calls GET /employees within own tenant', async () => {
      const mockResult = {
        items: [
          { id: 1, employeeCode: 'EMP-001', firstName: 'Alice', customerId: 1 },
          { id: 2, employeeCode: 'EMP-002', firstName: 'Bob', customerId: 1 },
        ],
        data: [],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
      };

      (employeeService.findAll as jest.Mock).mockResolvedValue(mockResult);

      const user = { id: 1, customerId: 1, role: 'COMPANY_ADMIN', roles: ['COMPANY_ADMIN'] };
      const result = await employeeController.findAll(user, 1);

      expect(result).toEqual(mockResult);
      expect(employeeService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 1,
          isSuperAdmin: false,
        }),
      );
    });

    it('RETURNS 200 OK when authenticated user requests single employee details within own tenant', async () => {
      const mockEmployee = {
        id: 3,
        employeeCode: 'EMP-003',
        firstName: 'John',
        lastName: 'Doe',
        customerId: 1,
        attendance: { status: 'Present', workingHours: '8h 0m' },
      };

      (employeeService.findOne as jest.Mock).mockResolvedValue(mockEmployee);

      const user = { id: 3, customerId: 1, role: 'EMPLOYEE', roles: ['EMPLOYEE'] };
      const result = await employeeController.findOne('3', user, 1);

      expect(result).toEqual(mockEmployee);
      expect(employeeService.findOne).toHaveBeenCalledWith({
        id: '3',
        customerId: 1,
        isSuperAdmin: false,
      });
    });

    it('REJECTS with 403 Forbidden when user has no customerId and is not SuperAdmin', async () => {
      const user = { id: 99, customerId: null, role: 'EMPLOYEE', roles: ['EMPLOYEE'] };

      await expect(employeeController.findOne('3', user, undefined)).rejects.toThrow(
        ForbiddenException,
      );

      await expect(employeeController.findAll(user, undefined)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('REJECTS with 404 Not Found when employee ID does not exist', async () => {
      (employeeService.findOne as jest.Mock).mockRejectedValue(
        new NotFoundException("Employee with identifier '9999' not found"),
      );

      const user = { id: 3, customerId: 1, role: 'EMPLOYEE', roles: ['EMPLOYEE'] };
      await expect(employeeController.findOne('9999', user, 1)).rejects.toThrow(NotFoundException);
    });
  });
});
