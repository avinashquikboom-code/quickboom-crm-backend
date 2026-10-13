import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AttendanceController } from './attendance.controller';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

describe('Attendance check-in authorization', () => {
  const guard = new PermissionsGuard(new Reflector());

  function context(handler: Function, permissions: { module: string; action: string }[]) {
    return {
      getHandler: () => handler,
      getClass: () => AttendanceController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { roles: ['EMPLOYEE'], permissions } }),
      }),
    } as ExecutionContext;
  }

  for (const method of ['checkIn', 'punchIn'] as const) {
    const handler = AttendanceController.prototype[method];

    it(`${method} accepts the configured punch-in permission without legacy CREATE`, () => {
      expect(guard.canActivate(context(handler, [
        { module: 'ATTENDANCE', action: 'VIEW' },
        { module: 'ATTENDANCE', action: 'PUNCH_IN' },
      ]))).toBe(true);
    });

    it(`${method} blocks employees whose effective permissions omit or deny punch-in`, () => {
      for (const permissions of [
        [],
        [{ module: 'ATTENDANCE', action: 'VIEW' }],
        [{ module: 'ATTENDANCE', action: 'CREATE' }],
        [{ module: 'ATTENDANCE', action: 'PUNCH_OUT' }],
      ]) {
        expect(() => guard.canActivate(context(handler, permissions))).toThrow(ForbiddenException);
      }
    });
  }

  for (const method of ['checkOut', 'punchOut'] as const) {
    const handler = AttendanceController.prototype[method];

    it(`${method} accepts the configured punch-out permission`, () => {
      expect(guard.canActivate(context(handler, [
        { module: 'ATTENDANCE', action: 'VIEW' },
        { module: 'ATTENDANCE', action: 'PUNCH_OUT' },
      ]))).toBe(true);
    });

    it(`${method} blocks employees whose effective permissions omit or deny punch-out`, () => {
      for (const permissions of [
        [],
        [{ module: 'ATTENDANCE', action: 'VIEW' }],
        [{ module: 'ATTENDANCE', action: 'CREATE' }],
        [{ module: 'ATTENDANCE', action: 'PUNCH_IN' }],
      ]) {
        expect(() => guard.canActivate(context(handler, permissions))).toThrow(ForbiddenException);
      }
    });
  }
});

