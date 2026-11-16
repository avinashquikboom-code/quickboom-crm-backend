import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

describe('self attendance punch permissions', () => {
  const guard = new PermissionsGuard(new Reflector());
  function check(handler: keyof AttendanceController, permissions: any[]) {
    const context = {
      getHandler: () => AttendanceController.prototype[handler],
      getClass: () => AttendanceController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'EMPLOYEE', permissions } }) }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context);
  }
  it.each([['checkIn', 'PUNCH_IN'], ['punchIn', 'PUNCH_IN'], ['checkOut', 'PUNCH_OUT'], ['punchOut', 'PUNCH_OUT']] as const)('%s requires %s and accepts the legacy CREATE grant', (handler, action) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AttendanceController.prototype[handler])).toEqual([{ module: 'ATTENDANCE', action }]);
    expect(check(handler, [{ module: 'ATTENDANCE', action }])).toBe(true);
    expect(check(handler, [{ module: 'ATTENDANCE', action: 'CREATE' }])).toBe(true);
    expect(() => check(handler, [{ module: 'ATTENDANCE', action: 'VIEW' }])).toThrow(ForbiddenException);
    expect(() => check(handler, [{ module: 'VISITS', action }])).toThrow(ForbiddenException);
  });
  it('does not allow punch-in permission to authorize punch-out', () => {
    expect(() => check('checkOut', [{ module: 'ATTENDANCE', action: 'PUNCH_IN' }])).toThrow(ForbiddenException);
  });
});
