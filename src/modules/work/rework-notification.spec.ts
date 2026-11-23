import { WorkStatus } from '@prisma/client';
import { WorkService } from './work.service';

describe('customer rework notifications', () => {
  it('notifies assigned employee user accounts rather than employee IDs', async () => {
    const existing: any = { id: 4, customerId: 3, title: 'Task', status: WorkStatus.COMPLETED, revisionCount: 0, workType: 'REEL', assignedToId: 10, editorId: 11 };
    const tx: any = {
      work: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockResolvedValue({ id: 5, assignedTo: { userId: 70 }, editor: { userId: 71 }, scheduledDate: new Date() }) },
      workTask: { createMany: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ customerId: 9, isActive: true, deletedAt: null }) },
      notification: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: data.userId, ...data })) },
    };
    const prisma: any = { $transaction: jest.fn((fn) => fn(tx)) };
    const push: any = { sendPushNotification: jest.fn().mockResolvedValue({ delivered: true }) };
    const service = new WorkService(prisma, {} as any, undefined, push);
    jest.spyOn(service, 'findOne').mockResolvedValue(existing);
    await service.requestRework(3, 4, { reason: 'Please revise' });
    expect(tx.notification.create).toHaveBeenCalledTimes(2);
    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 70, customerId: 9, data: { workId: 5, originalWorkId: 4 } }) }));
    expect(push.sendPushNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 70, customerId: 9, existingNotificationId: 70 }));
  });
});
