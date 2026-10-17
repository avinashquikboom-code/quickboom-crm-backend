import { ForbiddenException } from '@nestjs/common';
import { WorkType } from '@prisma/client';
import { WorkService } from '../modules/work/work.service';
import { WorkPermissionService } from '../modules/work/work-permission.service';

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

  it('keeps designation-based work assignments without removed RBAC tables', async () => {
    const employee = { id: 7, status: 'ACTIVE', designation: { name: 'Video Editor' }, user: null };
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue(employee), findFirst: jest.fn().mockResolvedValue(employee) },
      workAccessRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new WorkPermissionService(prisma as any);
    const result = await service.getAllowedActivityTypesForEmployee(7);
    expect(result.isFullAccess).toBe(false);
    expect(result.workPermissions).toContain('video_edit');
    expect(result.allowedTypes.has('REEL_EDIT')).toBe(true);
  });

  it('rejects a missing employee instead of granting organization permissions', async () => {
    const service = new WorkPermissionService({ employee: { findUnique: jest.fn().mockResolvedValue(null) } } as any);
    await expect(service.getAllowedActivityTypesForEmployee(7)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
