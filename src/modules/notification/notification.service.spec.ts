import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { FcmService } from './fcm.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('NotificationService & FCM Integration', () => {
  let service: NotificationService;
  let prisma: PrismaService;
  let fcmService: FcmService;

  const mockPrisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    userDeviceToken: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockFcmService = {
    isReady: jest.fn().mockReturnValue(true),
    sendMulticast: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FcmService, useValue: mockFcmService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    prisma = module.get<PrismaService>(PrismaService);
    fcmService = module.get<FcmService>(FcmService);
  });

  describe('registerDeviceToken', () => {
    it('should upsert an active device token for a user', async () => {
      mockPrisma.userDeviceToken.upsert.mockResolvedValue({
        id: 1,
        userId: 10,
        token: 'fcm_token_123',
        platform: 'ANDROID',
        isActive: true,
      });

      const result = await service.registerDeviceToken(10, {
        token: 'fcm_token_123',
        platform: 'ANDROID',
      });

      expect(mockPrisma.userDeviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'fcm_token_123' },
        update: {
          userId: 10,
          platform: 'ANDROID',
          isActive: true,
          updatedAt: expect.any(Date),
        },
        create: {
          userId: 10,
          token: 'fcm_token_123',
          platform: 'ANDROID',
          isActive: true,
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('unregisterDeviceToken', () => {
    it('should mark the device token as inactive on logout', async () => {
      mockPrisma.userDeviceToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.unregisterDeviceToken(10, 'fcm_token_123');

      expect(mockPrisma.userDeviceToken.updateMany).toHaveBeenCalledWith({
        where: { token: 'fcm_token_123', userId: 10 },
        data: { isActive: false, updatedAt: expect.any(Date) },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('sendPushNotification', () => {
    it('should create notification in DB, fetch active tokens, send via FCM, and clean invalid tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ customerId: 1 });
      mockPrisma.notification.create.mockResolvedValue({
        id: 99,
        customerId: 1,
        userId: 10,
        title: 'Order Confirmed',
        message: 'Your order has been confirmed.',
        type: 'ORDER_CONFIRMED',
      });

      mockPrisma.userDeviceToken.findMany.mockResolvedValue([
        { token: 'valid_token_1' },
        { token: 'stale_token_2' },
      ]);

      mockFcmService.sendMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        invalidTokens: ['stale_token_2'],
        messageIds: ['msg-1'],
      });

      const result = await service.sendPushNotification({
        userId: 10,
        title: 'Order Confirmed',
        body: 'Your order has been confirmed.',
        type: 'ORDER_CONFIRMED',
        data: { type: 'ORDER', orderId: '123' },
      });

      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(mockFcmService.sendMulticast).toHaveBeenCalledWith(
        ['valid_token_1', 'stale_token_2'],
        'Order Confirmed',
        'Your order has been confirmed.',
        expect.objectContaining({
          type: 'ORDER',
          orderId: '123',
          title: 'Order Confirmed',
        }),
        expect.objectContaining({
          customerId: 1,
          notificationType: 'ORDER_CONFIRMED',
        }),
      );

      // Verify invalid token was automatically deactivated
      expect(mockPrisma.userDeviceToken.updateMany).toHaveBeenCalledWith({
        where: { token: { in: ['stale_token_2'] } },
        data: { isActive: false, updatedAt: expect.any(Date) },
      });

      expect(result.notification.id).toBe(99);
      expect(result.fcm.successCount).toBe(1);
    });
  });

  describe('Business Event Notification Helpers', () => {
    it('sendNewOrderNotification dispatches with NEW_ORDER type', async () => {
      jest.spyOn(service, 'sendPushNotification').mockResolvedValue({} as any);

      await service.sendNewOrderNotification(10, 'ORD-500', 1200);

      expect(service.sendPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 10,
          type: 'NEW_ORDER',
          title: 'New Order Received',
        }),
      );
    });

    it('sendPaymentSuccessfulNotification dispatches with PAYMENT_SUCCESSFUL type', async () => {
      jest.spyOn(service, 'sendPushNotification').mockResolvedValue({} as any);

      await service.sendPaymentSuccessfulNotification(10, 'ORD-500', 1200);

      expect(service.sendPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 10,
          type: 'PAYMENT_SUCCESSFUL',
          title: 'Payment Successful',
        }),
      );
    });
  });
});
