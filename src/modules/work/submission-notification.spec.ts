import { WorkStatus } from '@prisma/client';
import { WorkService } from './work.service';

describe('work submission notification', () => {
  it('saves the customer notification before attempting push and keeps the submission when push fails', async () => {
    const current: any = { id: 12, customerId: 3, title: 'Video', status: WorkStatus.IN_PROGRESS, revisionCount: 0, scheduledDate: new Date(), subscriptionId: null };
    const tx: any = {
      $queryRaw: jest.fn(),
      work: { findUniqueOrThrow: jest.fn().mockResolvedValue(current), update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...current, ...data })) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 77 }) },
      employee: { findUnique: jest.fn().mockResolvedValue({ firstName: 'Test', lastName: 'Employee' }) },
      notification: { create: jest.fn().mockResolvedValue({ id: 45, title: 'Ready', message: 'Review' }) },
    };
    const prisma: any = { work: { findFirst: jest.fn().mockResolvedValue(current) }, $transaction: jest.fn(async (fn) => fn(tx)) };
    const push: any = { sendPushNotification: jest.fn().mockRejectedValue(new Error('unavailable')) };
    const service = new WorkService(prisma, {} as any, undefined, push);
    const result = await service.update(undefined, 12, { status: WorkStatus.COMPLETED }, 5);
    expect(result.status).toBe(WorkStatus.CUSTOMER_REVIEW);
    expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: 3, employee: null }) }));
    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerId: 3, userId: 77, type: 'WORK_SUBMITTED' }) }));
    expect(push.sendPushNotification).toHaveBeenCalledWith(expect.objectContaining({ existingNotificationId: 45, userId: 77, customerId: 3 }));
  });
});
