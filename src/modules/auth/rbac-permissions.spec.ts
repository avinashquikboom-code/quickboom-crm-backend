import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS_KEY, RequiredPermission } from '../../common/decorators/permissions.decorator';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { QBIdGenerator } from './qb-id.generator';
import { Msg91Service } from '../msg91/msg91.service';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notification/notification.service';
import { ALL_STANDARD_MODULES, ROLE_PERMISSION_DEFAULTS } from '../../common/constants/rbac.constants';

describe('RBAC & Module Permission System', () => {
  let permissionsGuard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    permissionsGuard = new PermissionsGuard(reflector);
  });

  const createMockContext = (user: any, handlerPerms: RequiredPermission[] = []): ExecutionContext => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(handlerPerms);
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  describe('1. Backend PermissionsGuard Enforcement', () => {
    it('allows access when no permissions are required', () => {
      const context = createMockContext({ role: 'TELECALLER', permissions: [] }, []);
      expect(permissionsGuard.canActivate(context)).toBe(true);
    });

    it('bypasses checks for SUPER_ADMIN role', () => {
      const context = createMockContext(
        { role: 'SUPER_ADMIN', roles: ['SUPER_ADMIN'], permissions: [] },
        [{ module: 'ATTENDANCE', action: 'VIEW' }],
      );
      expect(permissionsGuard.canActivate(context)).toBe(true);
    });

    it('bypasses checks for COMPANY_ADMIN role', () => {
      const context = createMockContext(
        { role: 'COMPANY_ADMIN', roles: ['COMPANY_ADMIN'], permissions: [] },
        [{ module: 'SALARY', action: 'VIEW' }],
      );
      expect(permissionsGuard.canActivate(context)).toBe(true);
    });

    it('allows access for TELECALLER with LEADS:VIEW permission', () => {
      const telecallerUser = {
        role: 'TELECALLER',
        roles: ['TELECALLER'],
        permissions: [
          { module: 'LEADS', action: 'VIEW' },
          { module: 'LEADS', action: 'CREATE' },
          { module: 'LEADS', action: 'EDIT' },
        ],
      };
      const context = createMockContext(telecallerUser, [{ module: 'LEADS', action: 'VIEW' }]);
      expect(permissionsGuard.canActivate(context)).toBe(true);
    });

    it('rejects access with 403 Forbidden for TELECALLER when calling ATTENDANCE:VIEW', () => {
      const telecallerUser = {
        role: 'TELECALLER',
        roles: ['TELECALLER'],
        permissions: [
          { module: 'LEADS', action: 'VIEW' },
          { module: 'LEADS', action: 'CREATE' },
          { module: 'LEADS', action: 'EDIT' },
        ],
      };
      const context = createMockContext(telecallerUser, [{ module: 'ATTENDANCE', action: 'VIEW' }]);
      expect(() => permissionsGuard.canActivate(context)).toThrow(ForbiddenException);
      try {
        permissionsGuard.canActivate(context);
      } catch (err: any) {
        expect(err.message).toContain('ATTENDANCE:VIEW');
      }
    });

    it('rejects access with 403 Forbidden for TELECALLER when calling LEADS:DELETE', () => {
      const telecallerUser = {
        role: 'TELECALLER',
        roles: ['TELECALLER'],
        permissions: [
          { module: 'LEADS', action: 'VIEW' },
          { module: 'LEADS', action: 'CREATE' },
          { module: 'LEADS', action: 'EDIT' },
        ],
      };
      const context = createMockContext(telecallerUser, [{ module: 'LEADS', action: 'DELETE' }]);
      expect(() => permissionsGuard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('case-insensitively matches module and action names', () => {
      const user = {
        role: 'CUSTOM_AGENT',
        roles: ['CUSTOM_AGENT'],
        permissions: [{ module: 'leads', action: 'view' }],
      };
      const context = createMockContext(user, [{ module: 'LEADS', action: 'VIEW' }]);
      expect(permissionsGuard.canActivate(context)).toBe(true);
    });
  });

  describe('2. AuthService resolveUserEffectivePermissions', () => {
    let authService: AuthService;
    let mockPrisma: any;

    beforeEach(async () => {
      mockPrisma = {
        user: { findUnique: jest.fn() },
        role: { findMany: jest.fn(), findUnique: jest.fn() },
        permission: { findMany: jest.fn(), findUnique: jest.fn() },
        rolePermission: { deleteMany: jest.fn(), create: jest.fn() },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: JwtService, useValue: {} },
          { provide: ConfigService, useValue: {} },
          { provide: QBIdGenerator, useValue: { generateQBUserId: jest.fn() } },
          { provide: Msg91Service, useValue: {} },
          { provide: EmailService, useValue: {} },
          { provide: NotificationService, useValue: {} },
        ],
      }).compile();

      authService = module.get<AuthService>(AuthService);
    });

    it('resolves effective permissions for TELECALLER role correctly', async () => {
      const mockUser = {
        id: 10,
        email: 'telecaller@company.com',
        userRoles: [
          {
            role: {
              name: 'TELECALLER',
              type: 'CUSTOM',
              rolePermissions: [
                { permission: { module: 'LEADS', action: 'VIEW' } },
                { permission: { module: 'LEADS', action: 'CREATE' } },
                { permission: { module: 'LEADS', action: 'EDIT' } },
                { permission: { module: 'FOLLOW_UP', action: 'VIEW' } },
                { permission: { module: 'FOLLOW_UP', action: 'CREATE' } },
              ],
            },
          },
        ],
      };

      const result = await authService.resolveUserEffectivePermissions(10, mockUser);
      expect(result.role).toBe('TELECALLER');
      expect(result.effectivePermissions.LEADS.view).toBe(true);
      expect(result.effectivePermissions.LEADS.create).toBe(true);
      expect(result.effectivePermissions.LEADS.edit).toBe(true);
      expect(result.effectivePermissions.LEADS.delete).toBe(false);

      expect(result.effectivePermissions.FOLLOW_UP.view).toBe(true);
      expect(result.effectivePermissions.FOLLOW_UP.create).toBe(true);
      expect(result.effectivePermissions.FOLLOW_UP.edit).toBe(false);

      // Attendance, Salary, Loan, Reports must be FALSE
      expect(result.effectivePermissions.ATTENDANCE.view).toBe(false);
      expect(result.effectivePermissions.ATTENDANCE.create).toBe(false);
      expect(result.effectivePermissions.SALARY.view).toBe(false);
      expect(result.effectivePermissions.LOAN.view).toBe(false);
      expect(result.effectivePermissions.REPORTS.view).toBe(false);
    });

    it('grants full access across all modules for SUPER_ADMIN', async () => {
      const mockSuperAdmin = {
        id: 1,
        email: 'admin@quikboom.com',
        userRoles: [{ role: { name: 'SUPER_ADMIN', type: 'SUPER_ADMIN', rolePermissions: [] } }],
      };

      const result = await authService.resolveUserEffectivePermissions(1, mockSuperAdmin);
      expect(result.role).toBe('SUPER_ADMIN');
      ALL_STANDARD_MODULES.forEach((mod) => {
        expect(result.effectivePermissions[mod].view).toBe(true);
      });
    });

    it('falls back to standard role defaults if rolePermissions table has no records', async () => {
      const mockUserWithDefaultRole = {
        id: 15,
        email: 'agent@company.com',
        userRoles: [{ role: { name: 'TELECALLER', type: 'CUSTOM', rolePermissions: [] } }],
      };

      const result = await authService.resolveUserEffectivePermissions(15, mockUserWithDefaultRole);
      expect(result.effectivePermissions.LEADS.view).toBe(true);
      expect(result.effectivePermissions.CALENDAR.view).toBe(false);
      expect(result.effectivePermissions.MY_WORK.view).toBe(false);
    });
  });
});
