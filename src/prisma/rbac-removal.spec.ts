import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../modules/auth/jwt.strategy';
import { AuthService } from '../modules/auth/auth.service';
import { ScheduleService } from '../modules/schedule/schedule.service';
import { WorkRecordGuard } from '../modules/work/work-record.guard';

const config = { get: () => 'test-secret-only' };

describe('authentication and assignment access after RBAC removal', () => {
  it('ignores forged administrator labels in a signed employee session', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 7, isActive: true, accountType: 'EMPLOYEE', employee: { id: 9, status: 'ACTIVE' } }) } };
    const result = await new JwtStrategy(config as any, prisma as any).validate({ sub: 7, role: 'SUPER_ADMIN', roles: ['SUPER_ADMIN'] });
    expect(result.accountType).toBe('EMPLOYEE');
    expect(result.roles).toEqual(['EMPLOYEE']);
  });

  it('rejects inactive employees even when an old token claims administrator access', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 7, isActive: true, accountType: 'EMPLOYEE', employee: { id: 9, status: 'INACTIVE' } }) } };
    await expect(new JwtStrategy(config as any, prisma as any).validate({ sub: 7, role: 'SUPER_ADMIN' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects refresh tokens absent from persisted sessions', async () => {
    const prisma = { refreshToken: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new AuthService(prisma as any, { verify: () => ({ sub: 7 }) } as any, config as any, {} as any, {} as any);
    await expect(service.refreshToken({ refreshToken: 'unregistered-token' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects access to work that has no employee or team assignment', async () => {
    const prisma = { work: { findFirst: jest.fn().mockResolvedValue(null) } };
    const req = { user: { id: 7, accountType: 'EMPLOYEE', employee: { id: 9, status: 'ACTIVE' } }, params: { id: '21' } };
    const context = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({ name: 'findOne' }) };
    await expect(new WorkRecordGuard(prisma as any).canActivate(context as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.work.findFirst.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([{ assignedToId: 9 }, { editorId: 9 }]));
  });

  it('generates plan schedules idempotently without subscriptions', async () => {
    let schedule: any = null;
    const tx = {
      $queryRaw: jest.fn(),
      plan: { findUnique: jest.fn().mockResolvedValue({ id: 3, name: 'Creative Plan', isActive: true }) },
      monthlySchedule: {
        findFirst: jest.fn(async () => schedule),
        create: jest.fn(async ({ data }) => (schedule = { id: 21, ...data })),
      },
    };
    const service = new ScheduleService({ $transaction: (fn) => fn(tx) } as any);
    const options = { duration: 1, startDate: '2026-10-20T00:00:00.000Z' };
    const first = await service.generateSchedulesForPlan(3, options);
    const second = await service.generateSchedulesForPlan(3, options);
    expect(second).toEqual(first);
    expect(tx.monthlySchedule.create).toHaveBeenCalledTimes(1);
    expect(first[0].planId).toBe(3);
  });
});
