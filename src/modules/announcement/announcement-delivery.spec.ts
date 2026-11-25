import { AnnouncementService } from './announcement.service';

describe('announcement delivery', () => {
  const row = { id: 4, customerId: 8, status: 'DRAFT', title: 'News', description: 'Hello', audience: 'DEPARTMENT', departmentId: 3, publishAt: null, expiresAt: null, imageUrl: null };
  const prisma = { announcement: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() }, employee: { findMany: jest.fn() } };
  const notifications = { sendPushNotification: jest.fn() };
  const service = new AnnouncementService(prisma as any, {} as any, notifications as any);
  beforeEach(() => { jest.clearAllMocks(); prisma.announcement.findFirst.mockResolvedValue(row); prisma.announcement.findUniqueOrThrow.mockResolvedValue({ ...row, status: 'PUBLISHED' }); prisma.announcement.updateMany.mockResolvedValue({ count: 1 }); prisma.employee.findMany.mockResolvedValue([{ userId: 12 }]); notifications.sendPushNotification.mockResolvedValue({}); });
  it('notifies only the selected department when published', async () => {
    await service.publish(8, 4);
    expect(prisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: 8, departmentId: 3 }) }));
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 12, customerId: 8, type: 'ANNOUNCEMENT' }));
  });
  it('does not resend if another request already published it', async () => {
    prisma.announcement.updateMany.mockResolvedValue({ count: 0 });
    await service.publish(8, 4);
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });
  it('publishes due scheduled announcements once', async () => {
    prisma.announcement.findMany.mockResolvedValue([{ ...row, status: 'SCHEDULED' }]);
    await service.processScheduled();
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
  });
});
