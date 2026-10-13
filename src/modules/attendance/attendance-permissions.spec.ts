import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AttendanceController } from './attendance.controller';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
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
});
