import { NotificationService } from './notification.service';

describe('notification image URLs', () => {
  const raw = 'https://bucket.s3.amazonaws.com/announcements/image.jpg';
  const signed = 'https://signed.example/image.jpg';
  const prisma = { notification: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() }, userDeviceToken: { findMany: jest.fn() } };
  const fcm = { sendMulticast: jest.fn() };
  const s3 = { getPresignedUrl: jest.fn().mockResolvedValue(signed) };
  const service = new NotificationService(prisma as any, fcm as any, undefined, undefined, undefined, s3 as any);
  beforeEach(() => jest.clearAllMocks());
  it('stores the durable URL and sends a signed URL to mobile devices', async () => {
    prisma.notification.create.mockResolvedValue({ id: 4 });
    prisma.userDeviceToken.findMany.mockResolvedValue([{ token: 'token' }]);
    fcm.sendMulticast.mockResolvedValue({ invalidTokens: [] });
    await service.sendPushNotification({ userId: 3, customerId: 2, title: 'News', body: 'Hello', type: 'ANNOUNCEMENT', data: { imageUrl: raw } });
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ data: { imageUrl: raw } }) }));
    expect(fcm.sendMulticast).toHaveBeenCalledWith(expect.anything(), 'News', 'Hello', expect.objectContaining({ imageUrl: signed }), expect.anything());
  });
  it('returns fresh signed images in notification lists', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 4, data: { imageUrl: raw } }]);
    prisma.notification.count.mockResolvedValue(1);
    const result = await service.findAll(2, 3);
    expect((result.items[0].data as any).imageUrl).toBe(signed);
  });
});
