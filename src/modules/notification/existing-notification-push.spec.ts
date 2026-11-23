import { NotificationService } from './notification.service';

describe('push for an existing work notification', () => {
  it('delivers the saved notification without inserting a duplicate', async () => {
    const prisma: any = {
      notification: {
        findFirst: jest.fn().mockResolvedValue({ id: 41, userId: 7, customerId: 3 }),
        create: jest.fn(),
      },
      userDeviceToken: { findMany: jest.fn().mockResolvedValue([{ token: 'test-device' }]), updateMany: jest.fn() },
    };
    const fcm: any = { sendMulticast: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0, invalidTokens: [], messageIds: ['test-message'] }) };
    const service = new NotificationService(prisma, fcm);
    const result = await service.sendPushNotification({ existingNotificationId: 41, userId: 7, customerId: 3, title: 'Ready', body: 'Review', type: 'WORK_SUBMITTED', data: { workId: '12' } });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.notification.findFirst).toHaveBeenCalledWith({ where: { id: 41, userId: 7, customerId: 3 } });
    expect(fcm.sendMulticast).toHaveBeenCalledWith(['test-device'], 'Ready', 'Review', expect.objectContaining({ notificationId: '41', workId: '12' }), expect.any(Object));
    expect(result.delivered).toBe(true);
  });
});
