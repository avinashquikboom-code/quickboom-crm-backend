import { ForbiddenException } from '@nestjs/common';
import { WorkType } from '@prisma/client';
import { WorkService } from '../modules/work/work.service';
import { WorkPermissionService } from '../modules/work/work-permission.service';
import { EmployeeService } from '../modules/employee/employee.service';

describe('single organization after Customer and Lead removal', () => {
  it('creates independent work and its workflow without a tenant or subscription', async () => {
    const work = { id: 11, title: 'Campaign', scheduledDate: new Date('2026-10-19'), assignedToId: null, editorId: null, assignedTo: null };
    const tx = {
      planEntitlement: { findFirst: jest.fn().mockResolvedValue(null) },
      work: { create: jest.fn().mockResolvedValue(work) },
      workTask: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new WorkService(prisma as any);
    await expect(service.create(undefined, { title: 'Campaign', workType: WorkType.POST_DESIGN, scheduledDate: '2026-10-19' } as any)).resolves.toEqual(work);
    expect(tx.work.create.mock.calls[0][0].data).not.toHaveProperty('customerId');
    expect(tx.work.create.mock.calls[0][0].data).not.toHaveProperty('subscriptionId');
    expect(tx.workTask.createMany.mock.calls[0][0].data).toHaveLength(3);
  });

  it('keeps configured work quotas when subscriptions are absent', async () => {
    const tx = {
      planEntitlement: {
        findFirst: jest.fn().mockResolvedValue({ id: 3, totalQty: 2, scheduledQty: 2, usedQty: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      work: { create: jest.fn() },
    };
    const service = new WorkService({ $transaction: (callback) => callback(tx) } as any);
    await expect(service.create(undefined, { title: 'Campaign', workType: WorkType.POST_DESIGN, scheduledDate: '2026-10-19' } as any)).rejects.toThrow('quota');
    expect(tx.work.create).not.toHaveBeenCalled();
  });

  it('allocates employee codes across the organization without looking up Customer', async () => {
    const prisma = {
      employee: { findMany: jest.fn().mockResolvedValue([{ employeeCode: 'EMP-003' }, { employeeCode: 'EMP-008' }]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new EmployeeService(prisma as any);
    await expect(service.getNextEmployeeCode(undefined, 'EMP')).resolves.toEqual({ nextEmployeeId: 'EMP-009', prefix: 'EMP' });
    expect(prisma.employee.findMany.mock.calls[0][0].where).not.toHaveProperty('customerId');
  });

  it('keeps employee DENY overrides without tenant ownership', async () => {
    const employee = { id: 7, status: 'ACTIVE', designation: { name: 'Video Editor' }, user: null, employeeModuleOverrides: [{ moduleKey: 'video_edit', override: 'DENY' }] };
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue(employee), findFirst: jest.fn().mockResolvedValue(employee) },
      roleWorkPermission: { findMany: jest.fn().mockResolvedValue([]) },
      workAccessRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new WorkPermissionService(prisma as any);
    const result = await service.getAllowedActivityTypesForEmployee(7);
    expect(result.isFullAccess).toBe(false);
    expect(result.workPermissions).not.toContain('video_edit');
    expect(result.allowedTypes.size).toBe(0);
  });

  it('rejects a missing employee instead of granting organization permissions', async () => {
    const service = new WorkPermissionService({ employee: { findUnique: jest.fn().mockResolvedValue(null) } } as any);
    await expect(service.getAllowedActivityTypesForEmployee(7)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
