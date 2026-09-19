import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { FcmService } from './fcm.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('Plan Purchase & Welcome Notification End-to-End Suite', () => {
  let notificationService: NotificationService;
  let prisma: PrismaService;
  let fcmService: FcmService;

  const mockPrisma = {
    notification: {
      create: jest.fn(),
      findFirst: jest.fn(),
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
      create: jest.fn(),
    },
    customer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    customerSubscription: {
      findFirst: jest.fn(),
    },
  };

  const mockFcmService = {
    isReady: jest.fn().mockReturnValue(true),
    sendMulticast: jest.fn(),
    sendToSingleToken: jest.fn(),
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

    notificationService = module.get<NotificationService>(NotificationService);
    prisma = module.get<PrismaService>(PrismaService);
    fcmService = module.get<FcmService>(FcmService);
  });

  describe('Customer Registration -> Welcome Notification Flow', () => {
    it('CASE 1: New customer registration SUCCESS -> Customer created -> Welcome notification created -> FCM sent', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null); // No existing notification
      mockPrisma.notification.create.mockResolvedValue({
        id: 101,
        customerId: 42,
        userId: 10,
        title: 'Welcome to QuikBoom! 🎉',
        message: 'Your account has been created successfully. Welcome to QuikBoom!',
        type: 'WELCOME',
        isRead: false,
        data: {
          type: 'WELCOME',
          customerId: '42',
          event: 'CUSTOMER_REGISTERED',
        },
      });

      mockPrisma.userDeviceToken.findMany.mockResolvedValue([
        { token: 'valid_device_token_xyz' },
      ]);

      mockFcmService.sendMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        invalidTokens: [],
        messageIds: ['fcm-msg-1'],
      });

      const result = await notificationService.sendCustomerWelcomeNotification({
        customerId: 42,
        userId: 10,
        customerName: 'Test Company',
      });

      // 1. Notification created in DB with correct content and payload
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          customerId: 42,
          userId: 10,
          title: 'Welcome to QuikBoom! 🎉',
          message: 'Your account has been created successfully. Welcome to QuikBoom!',
          type: 'WELCOME',
          isRead: false,
          data: {
            type: 'WELCOME',
            customerId: '42',
            event: 'CUSTOMER_REGISTERED',
          },
        },
      });

      // 2. FCM sent
      expect(mockFcmService.sendMulticast).toHaveBeenCalledWith(
        ['valid_device_token_xyz'],
        'Welcome to QuikBoom! 🎉',
        'Your account has been created successfully. Welcome to QuikBoom!',
        expect.objectContaining({
          type: 'WELCOME',
          customerId: '42',
          event: 'CUSTOMER_REGISTERED',
          notificationId: '101',
        }),
        expect.objectContaining({
          customerId: 42,
          notificationType: 'WELCOME',
        }),
      );

      expect(result?.fcmSent).toBe(true);
      expect(result?.notification?.id).toBe(101);
    });

    it('CASE 2: Registration FAILED -> Customer not created -> sendCustomerWelcomeNotification not called / handled safely', async () => {
      // If customer has no active user or customer lookup fails, notification is not created
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await notificationService.sendCustomerWelcomeNotification({
        customerId: 999, // Non-existent
      });

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockFcmService.sendMulticast).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('CASE 3: Customer created but FCM token unavailable -> Registration succeeds -> Notification stored in DB -> No crash', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockPrisma.notification.create.mockResolvedValue({
        id: 102,
        customerId: 43,
        userId: 11,
        title: 'Welcome to QuikBoom! 🎉',
        message: 'Your account has been created successfully. Welcome to QuikBoom!',
        type: 'WELCOME',
        isRead: false,
      });

      // No active tokens found in DB
      mockPrisma.userDeviceToken.findMany.mockResolvedValue([]);

      const result = await notificationService.sendCustomerWelcomeNotification({
        customerId: 43,
        userId: 11,
      });

      // DB record is still created as unread
      expect(mockPrisma.notification.create).toHaveBeenCalled();
      // FCM sendMulticast is not invoked when no tokens exist
      expect(mockFcmService.sendMulticast).not.toHaveBeenCalled();
      expect(result?.fcmSent).toBe(false);
      expect(result?.reason).toBe('NO_DEVICE_TOKEN');
      expect(result?.notification?.id).toBe(102);
    });

    it('CASE 4: Invalid FCM token -> Registration succeeds -> Invalid token removed/deactivated -> Notification remains in DB', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockPrisma.notification.create.mockResolvedValue({
        id: 103,
        customerId: 44,
        userId: 12,
        title: 'Welcome to QuikBoom! 🎉',
        message: 'Your account has been created successfully. Welcome to QuikBoom!',
        type: 'WELCOME',
        isRead: false,
      });

      mockPrisma.userDeviceToken.findMany.mockResolvedValue([
        { token: 'invalid_expired_token' },
      ]);

      mockFcmService.sendMulticast.mockResolvedValue({
        successCount: 0,
        failureCount: 1,
        invalidTokens: ['invalid_expired_token'],
        messageIds: [],
      });

      const result = await notificationService.sendCustomerWelcomeNotification({
        customerId: 44,
        userId: 12,
      });

      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(mockFcmService.sendMulticast).toHaveBeenCalled();
      // Invalid token must be deactivated in userDeviceToken
      expect(mockPrisma.userDeviceToken.updateMany).toHaveBeenCalledWith({
        where: { token: { in: ['invalid_expired_token'] } },
        data: { isActive: false, updatedAt: expect.any(Date) },
      });
      expect(result?.notification?.id).toBe(103);
    });

    it('CASE 5: Customer has multiple devices -> Welcome notification sent to all valid devices', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockPrisma.notification.create.mockResolvedValue({
        id: 104,
        customerId: 45,
        userId: 13,
        title: 'Welcome to QuikBoom! 🎉',
        message: 'Your account has been created successfully. Welcome to QuikBoom!',
        type: 'WELCOME',
        isRead: false,
      });

      // 3 active devices belonging to the customer
      mockPrisma.userDeviceToken.findMany.mockResolvedValue([
        { token: 'phone_token' },
        { token: 'tablet_token' },
        { token: 'web_token' },
      ]);

      mockFcmService.sendMulticast.mockResolvedValue({
        successCount: 3,
        failureCount: 0,
        invalidTokens: [],
        messageIds: ['msg-1', 'msg-2', 'msg-3'],
      });

      const result = await notificationService.sendCustomerWelcomeNotification({
        customerId: 45,
        userId: 13,
      });

      expect(mockFcmService.sendMulticast).toHaveBeenCalledWith(
        ['phone_token', 'tablet_token', 'web_token'],
        'Welcome to QuikBoom! 🎉',
        'Your account has been created successfully. Welcome to QuikBoom!',
        expect.any(Object),
        expect.objectContaining({
          customerId: 45,
          notificationType: 'WELCOME',
        }),
      );
      expect(result?.fcmSent).toBe(true);
    });

    it('CASE 6: Duplicate registration request -> Idempotency prevents duplicate welcome notification', async () => {
      // Welcome notification already exists for customerId 46
      const existingNotification = {
        id: 99,
        customerId: 46,
        userId: 14,
        title: 'Welcome to QuikBoom! 🎉',
        message: 'Your account has been created successfully. Welcome to QuikBoom!',
        type: 'WELCOME',
        isRead: false,
      };

      mockPrisma.notification.findFirst.mockResolvedValue(existingNotification);
      mockPrisma.userDeviceToken.findMany.mockResolvedValue([]);

      const result = await notificationService.sendCustomerWelcomeNotification({
        customerId: 46,
        userId: 14,
      });

      // Do NOT create a duplicate notification in DB
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(result?.notification?.id).toBe(99);
    });

    it('CASE 7: Customer opens notification screen -> Initially unread -> Existing markAsRead marks it read', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([
        {
          id: 105,
          customerId: 47,
          userId: 15,
          title: 'Welcome to QuikBoom! 🎉',
          message: 'Your account has been created successfully. Welcome to QuikBoom!',
          type: 'WELCOME',
          isRead: false,
          createdAt: new Date(),
        },
      ]);
      mockPrisma.notification.count.mockResolvedValue(1);
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });

      const inbox = await notificationService.findAll(47, 15);
      expect(inbox.items.length).toBe(1);
      expect(inbox.items[0].isRead).toBe(false);

      await notificationService.markAsRead(105, 47, 15);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 105, customerId: 47, userId: 15 },
        data: { isRead: true },
      });
    });

    it('CASE 8: Customer registers FCM token later -> Pending welcome notification delivered to new device', async () => {
      mockPrisma.userDeviceToken.upsert.mockResolvedValue({
        id: 1,
        userId: 20,
        token: 'newly_obtained_token_abc',
        platform: 'ANDROID',
        isActive: true,
      });

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 200,
        customerId: 50,
        userId: 20,
        title: 'Welcome to QuikBoom! 🎉',
        message: 'Your account has been created successfully. Welcome to QuikBoom!',
        type: 'WELCOME',
        isRead: false,
      });

      await notificationService.registerDeviceToken(20, {
        token: 'newly_obtained_token_abc',
        platform: 'ANDROID',
      });

      expect(mockFcmService.sendToSingleToken).toHaveBeenCalledWith(
        'newly_obtained_token_abc',
        'Welcome to QuikBoom! 🎉',
        'Your account has been created successfully. Welcome to QuikBoom!',
        expect.objectContaining({
          type: 'WELCOME',
          customerId: '50',
          event: 'CUSTOMER_REGISTERED',
        }),
      );
    });
  });

  describe('Plan Purchase Success Flow', () => {
    it('CASE 9: Plan purchase success -> Subscription ACTIVE -> Plan purchase notification created in DB -> FCM sent', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]); // No recent duplicate
      mockPrisma.notification.create.mockResolvedValue({
        id: 301,
        customerId: 60,
        userId: 30,
        title: 'Plan Activated Successfully',
        message: 'Your Basic Package has been activated successfully.',
        type: 'PLAN_PURCHASE_SUCCESS',
        isRead: false,
      });

      mockPrisma.userDeviceToken.findMany.mockResolvedValue([
        { token: 'token_customer_60' },
      ]);

      mockFcmService.sendMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        invalidTokens: [],
        messageIds: ['fcm-plan-1'],
      });

      const result = await notificationService.sendPlanPurchaseSuccessNotification({
        customerId: 60,
        userId: 30,
        subscriptionId: 100,
        planId: 1,
        planName: 'Basic Package',
        paymentId: 'pay_ABC123',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          customerId: 60,
          userId: 30,
          title: 'Plan Activated Successfully',
          message: 'Your Basic Package has been activated successfully.',
          type: 'PLAN_PURCHASE_SUCCESS',
          isRead: false,
          data: {
            type: 'PLAN_PURCHASE_SUCCESS',
            subscriptionId: '100',
            planId: '1',
            planName: 'Basic Package',
            customerId: '60',
            status: 'ACTIVE',
            paymentId: 'pay_ABC123',
          },
        },
      });

      expect(mockFcmService.sendMulticast).toHaveBeenCalledWith(
        ['token_customer_60'],
        'Plan Activated Successfully',
        'Your Basic Package has been activated successfully.',
        expect.objectContaining({
          type: 'PLAN_PURCHASE_SUCCESS',
          subscriptionId: '100',
          planId: '1',
          planName: 'Basic Package',
          status: 'ACTIVE',
          paymentId: 'pay_ABC123',
        }),
        expect.objectContaining({
          customerId: 60,
          notificationType: 'PLAN_PURCHASE_SUCCESS',
        }),
      );

      expect(result?.fcmSent).toBe(true);
      expect(result?.notification?.id).toBe(301);
    });

    it('CASE 10: Webhook + client verify called (Idempotency) -> Exactly 1 notification sent, duplicate skipped', async () => {
      // Notification already recorded for this paymentId within 15 minutes
      mockPrisma.notification.findMany.mockResolvedValue([
        {
          id: 302,
          customerId: 60,
          type: 'PLAN_PURCHASE_SUCCESS',
          data: { paymentId: 'pay_ABC123', subscriptionId: '100', planId: '1' },
          createdAt: new Date(),
        },
      ]);

      const result = await notificationService.sendPlanPurchaseSuccessNotification({
        customerId: 60,
        userId: 30,
        subscriptionId: 100,
        planId: 1,
        planName: 'Basic Package',
        paymentId: 'pay_ABC123',
      });

      // DB create not called again
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockFcmService.sendMulticast).not.toHaveBeenCalled();
      expect(result?.skippedDuplicate).toBe(true);
    });

    it('CASE 11: Plan purchase multi-device -> FCM sent to all customer devices', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.create.mockResolvedValue({
        id: 303,
        customerId: 61,
        userId: 31,
        title: 'Plan Activated Successfully',
        message: 'Your Enterprise Plan has been activated successfully.',
        type: 'PLAN_PURCHASE_SUCCESS',
      });

      mockPrisma.userDeviceToken.findMany.mockResolvedValue([
        { token: 'device_1' },
        { token: 'device_2' },
      ]);

      mockFcmService.sendMulticast.mockResolvedValue({
        successCount: 2,
        failureCount: 0,
        invalidTokens: [],
        messageIds: ['msg-1', 'msg-2'],
      });

      const result = await notificationService.sendPlanPurchaseSuccessNotification({
        customerId: 61,
        userId: 31,
        subscriptionId: 101,
        planId: 2,
        planName: 'Enterprise Plan',
      });

      expect(mockFcmService.sendMulticast).toHaveBeenCalledWith(
        ['device_1', 'device_2'],
        'Plan Activated Successfully',
        'Your Enterprise Plan has been activated successfully.',
        expect.any(Object),
        expect.objectContaining({
          customerId: 61,
          notificationType: 'PLAN_PURCHASE_SUCCESS',
        }),
      );
      expect(result?.fcmSent).toBe(true);
    });
  });
});

