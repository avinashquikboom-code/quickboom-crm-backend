import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AttendanceController } from './attendance.controller';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { applyAttendancePermissions } from '../../common/utils/attendance-permissions.util';
import { ROLE_PERMISSION_DEFAULTS } from '../../common/constants/rbac.constants';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

describe('Attendance check-in authorization', () => {
  const guard = new PermissionsGuard(new Reflector());

  function context(
    handler: Function,
    permissions: { module: string; action: string }[],
    classRef: any = AttendanceController,
  ) {
    return {
      getHandler: () => handler,
      getClass: () => classRef,
      switchToHttp: () => ({
        getRequest: () => ({ user: { roles: ['EMPLOYEE'], permissions } }),
      }),
    } as ExecutionContext;
  }

  for (const method of ['checkIn', 'punchIn'] as const) {
    const handler = AttendanceController.prototype[method];

    it(`${method} accepts the configured punch-in permission`, () => {
      expect(
        guard.canActivate(
          context(handler, [
            { module: 'ATTENDANCE', action: 'VIEW' },
            { module: 'ATTENDANCE', action: 'PUNCH_IN' },
          ]),
        ),
      ).toBe(true);
    });

    it(`${method} accepts legacy ATTENDANCE:CREATE permission`, () => {
      expect(
        guard.canActivate(
          context(handler, [
            { module: 'ATTENDANCE', action: 'VIEW' },
            { module: 'ATTENDANCE', action: 'CREATE' },
          ]),
        ),
      ).toBe(true);
    });

    it(`${method} blocks employees whose effective permissions omit or deny punch-in`, () => {
      for (const permissions of [
        [],
        [{ module: 'ATTENDANCE', action: 'VIEW' }],
        [{ module: 'ATTENDANCE', action: 'PUNCH_OUT' }],
        [{ module: 'LEADS', action: 'CREATE' }],
      ]) {
        expect(() => guard.canActivate(context(handler, permissions))).toThrow(ForbiddenException);
      }
    });
  }

  for (const method of ['checkOut', 'punchOut'] as const) {
    const handler = AttendanceController.prototype[method];

    it(`${method} accepts the configured punch-out permission`, () => {
      expect(
        guard.canActivate(
          context(handler, [
            { module: 'ATTENDANCE', action: 'VIEW' },
            { module: 'ATTENDANCE', action: 'PUNCH_OUT' },
          ]),
        ),
      ).toBe(true);
    });

    it(`${method} accepts legacy ATTENDANCE:CREATE permission`, () => {
      expect(
        guard.canActivate(
          context(handler, [
            { module: 'ATTENDANCE', action: 'VIEW' },
            { module: 'ATTENDANCE', action: 'CREATE' },
          ]),
        ),
      ).toBe(true);
    });

    it(`${method} blocks employees whose effective permissions omit or deny punch-out`, () => {
      for (const permissions of [
        [],
        [{ module: 'ATTENDANCE', action: 'VIEW' }],
        [{ module: 'ATTENDANCE', action: 'PUNCH_IN' }],
        [{ module: 'LEADS', action: 'CREATE' }],
      ]) {
        expect(() => guard.canActivate(context(handler, permissions))).toThrow(ForbiddenException);
      }
    });
  }

  describe('effective attendance permissions', () => {
    function resolved(actions: string[], overrides: { moduleKey: string; override: string }[] = []) {
      const permissions = new Map(actions.map(action => [
        `ATTENDANCE:${action}`, { module: 'ATTENDANCE', action },
      ]));
      applyAttendancePermissions(permissions, overrides);
      return [...permissions.values()];
    }

    it('does not turn punch-out into punch-in or legacy CREATE', () => {
      const permissions = resolved(['PUNCH_OUT']);
      expect(permissions).toEqual([{ module: 'ATTENDANCE', action: 'PUNCH_OUT' }]);
      expect(() => guard.canActivate(context(AttendanceController.prototype.checkIn, permissions))).toThrow(ForbiddenException);
    });

    it.each(['PUNCH_IN', 'PUNCH_OUT'])('preserves explicit %s DENY against legacy CREATE', action => {
      const permissions = resolved(['CREATE'], [{ moduleKey: `employee.attendance.${action.toLowerCase()}`, override: 'DENY' }]);
      const deniedHandler = action === 'PUNCH_IN' ? 'checkIn' : 'checkOut';
      const allowedHandler = action === 'PUNCH_IN' ? 'checkOut' : 'checkIn';
      expect(() => guard.canActivate(context(AttendanceController.prototype[deniedHandler], permissions))).toThrow(ForbiddenException);
      expect(guard.canActivate(context(AttendanceController.prototype[allowedHandler], permissions))).toBe(true);
    });

    it('keeps module DENY ahead of a later granular ALLOW', () => {
      expect(resolved(['MANAGE'], [
        { moduleKey: 'ATTENDANCE', override: 'DENY' },
        { moduleKey: 'ATTENDANCE:PUNCH_IN', override: 'ALLOW' },
      ])).toEqual([]);
    });

    it('supports INHERIT and explicit ALLOW without granting other punch actions', () => {
      const permissions = resolved(['VIEW'], [
        { moduleKey: 'ATTENDANCE', override: 'INHERIT' },
        { moduleKey: 'ATTENDANCE:PUNCH_IN', override: 'ALLOW' },
      ]);
      expect(guard.canActivate(context(AttendanceController.prototype.checkIn, permissions))).toBe(true);
      expect(() => guard.canActivate(context(AttendanceController.prototype.checkOut, permissions))).toThrow(ForbiddenException);
    });

    it('authorizes the existing eligible role templates and blocks templates without attendance grants', () => {
      for (const grants of Object.values(ROLE_PERMISSION_DEFAULTS)) {
        const attendance = grants.filter(p => p.module === 'ATTENDANCE').map(p => p.action);
        const permissions = resolved(attendance);
        if (attendance.some(action => ['CREATE', 'PUNCH_IN', 'ALL', 'MANAGE'].includes(action))) {
          expect(guard.canActivate(context(AttendanceController.prototype.checkIn, permissions))).toBe(true);
        } else {
          expect(() => guard.canActivate(context(AttendanceController.prototype.checkIn, permissions))).toThrow(ForbiddenException);
        }
      }
    });
  });

  describe('Legacy ATTENDANCE:CREATE endpoint check-in compatibility', () => {
    class LegacyAttendanceController {
      checkIn() {}
    }
    Reflect.defineMetadata(
      PERMISSIONS_KEY,
      [{ module: 'ATTENDANCE', action: 'CREATE' }],
      LegacyAttendanceController.prototype.checkIn,
    );

    const legacyHandler = LegacyAttendanceController.prototype.checkIn;

    it('allows employee with ATTENDANCE:PUNCH_IN to pass when route requires ATTENDANCE:CREATE', () => {
      expect(
        guard.canActivate(
          context(
            legacyHandler,
            [
              { module: 'ATTENDANCE', action: 'VIEW' },
              { module: 'ATTENDANCE', action: 'PUNCH_IN' },
            ],
            LegacyAttendanceController,
          ),
        ),
      ).toBe(true);
    });

    it('allows employee with ATTENDANCE:CREATE to pass when route requires ATTENDANCE:CREATE', () => {
      expect(
        guard.canActivate(
          context(
            legacyHandler,
            [
              { module: 'ATTENDANCE', action: 'VIEW' },
              { module: 'ATTENDANCE', action: 'CREATE' },
            ],
            LegacyAttendanceController,
          ),
        ),
      ).toBe(true);
    });

    it('rejects employee with 403 Forbidden when ATTENDANCE:CREATE is required and user lacks punch permissions', () => {
      for (const permissions of [
        [],
        [{ module: 'ATTENDANCE', action: 'PUNCH_OUT' }],
        [{ module: 'ATTENDANCE', action: 'VIEW' }],
        [{ module: 'LEADS', action: 'CREATE' }],
      ]) {
        expect(() =>
          guard.canActivate(
            context(legacyHandler, permissions, LegacyAttendanceController),
          ),
        ).toThrow(ForbiddenException);
      }
    });
  });

  describe('Active workforce employee baseline attendance resolution', () => {
    function resolveEmployeePermissions(
      user: { employee?: { status?: string; employeeModuleOverrides?: any[] } | null },
      initialRolePermissions: { module: string; action: string }[],
    ) {
      const permissionsMap = new Map<string, { module: string; action: string }>();
      for (const p of initialRolePermissions) {
        permissionsMap.set(`${p.module.toUpperCase()}:${p.action.toUpperCase()}`, {
          module: p.module.toUpperCase(),
          action: p.action.toUpperCase(),
        });
      }

      if (user.employee && (!user.employee.status || user.employee.status === 'ACTIVE')) {
        if (!permissionsMap.has('ATTENDANCE:VIEW')) {
          permissionsMap.set('ATTENDANCE:VIEW', { module: 'ATTENDANCE', action: 'VIEW' });
        }
        if (!permissionsMap.has('ATTENDANCE:CREATE')) {
          permissionsMap.set('ATTENDANCE:CREATE', { module: 'ATTENDANCE', action: 'CREATE' });
        }
        if (!permissionsMap.has('ATTENDANCE:PUNCH_IN')) {
          permissionsMap.set('ATTENDANCE:PUNCH_IN', { module: 'ATTENDANCE', action: 'PUNCH_IN' });
        }
        if (!permissionsMap.has('ATTENDANCE:PUNCH_OUT')) {
          permissionsMap.set('ATTENDANCE:PUNCH_OUT', { module: 'ATTENDANCE', action: 'PUNCH_OUT' });
        }
      }

      applyAttendancePermissions(permissionsMap, user.employee?.employeeModuleOverrides || []);
      return [...permissionsMap.values()];
    }

    it('grants punch-in authorization to active employee whose designation role only had DATA_CAPTURE and LEADS', () => {
      const user = { employee: { status: 'ACTIVE' } };
      const rolePermissions = [
        { module: 'DATA_CAPTURE', action: 'VIEW' },
        { module: 'DATA_CAPTURE', action: 'CREATE' },
        { module: 'LEADS', action: 'VIEW' },
      ];
      const permissions = resolveEmployeePermissions(user, rolePermissions);

      expect(guard.canActivate(context(AttendanceController.prototype.checkIn, permissions))).toBe(true);
      expect(guard.canActivate(context(AttendanceController.prototype.checkOut, permissions))).toBe(true);
    });

    it('strictly blocks punch-in if an active employee has an explicit DENY override on attendance', () => {
      const user = {
        employee: {
          status: 'ACTIVE',
          employeeModuleOverrides: [
            { moduleKey: 'ATTENDANCE', override: 'DENY' },
          ],
        },
      };
      const rolePermissions = [
        { module: 'DATA_CAPTURE', action: 'VIEW' },
        { module: 'LEADS', action: 'VIEW' },
      ];
      const permissions = resolveEmployeePermissions(user, rolePermissions);

      expect(() =>
        guard.canActivate(context(AttendanceController.prototype.checkIn, permissions)),
      ).toThrow(ForbiddenException);
    });
  });
});

