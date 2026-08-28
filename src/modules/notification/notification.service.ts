import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmService } from './fcm.service';
import { RegisterDeviceTokenDto } from './dto/device-token.dto';

export interface SendPushOptions {
  userId?: number;
  customerId?: number;
  title: string;
  body: string;
  type?: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcmService: FcmService,
  ) {}

  async findAll(
    customerId: number | string,
    userId?: number | string,
    unreadOnly = false,
    page = 1,
    limit = 20,
    search?: string,
  ) {
    const numCustomerId = Number(customerId);
    const numPage = Math.max(Number(page) || 1, 1);
    const numLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (numPage - 1) * numLimit;

    const where: any = {};
    if (!isNaN(numCustomerId)) {
      where.customerId = numCustomerId;
    }
    if (userId && !isNaN(Number(userId))) {
      where.userId = Number(userId);
    }
    if (unreadOnly) {
      where.isRead = false;
    }

    if (search && search.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: 'insensitive' } },
        { message: { contains: search.trim(), mode: 'insensitive' } },
        { type: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: numLimit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const totalPages = Math.ceil(total / numLimit) || 1;

    return {
      data: items,
      items,
      pagination: {
        page: numPage,
        pageSize: numLimit,
        total,
        totalPages,
      },
      meta: {
        page: numPage,
        limit: numLimit,
        total,
        totalPages,
      },
    };
  }

  async markAsRead(id: number | string) {
    const numId = Number(id);
    return this.prisma.notification.updateMany({
      where: { id: numId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(customerId: number | string) {
    const numCustomerId = Number(customerId);
    return this.prisma.notification.updateMany({
      where: { customerId: numCustomerId, isRead: false },
      data: { isRead: true },
    });
  }

  /**
   * Register or update an active FCM device token for a user
   */
  async registerDeviceToken(userId: number, dto: RegisterDeviceTokenDto) {
    const cleanToken = dto.token.trim();
    const platform = dto.platform ? dto.platform.toUpperCase() : 'ANDROID';

    const deviceToken = await this.prisma.userDeviceToken.upsert({
      where: { token: cleanToken },
      update: {
        userId,
        platform,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId,
        token: cleanToken,
        platform,
        isActive: true,
      },
    });

    this.logger.log(`Registered device token for userId ${userId} (platform: ${platform})`);

    return {
      success: true,
      message: 'Device token registered successfully',
      data: deviceToken,
    };
  }

  /**
   * Deactivate a device token when user logs out
   */
  async unregisterDeviceToken(userId: number, token: string) {
    const cleanToken = (token || '').trim();
    if (!cleanToken) return { success: false, message: 'Token required' };

    await this.prisma.userDeviceToken.updateMany({
      where: {
        token: cleanToken,
        userId,
      },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Deactivated device token for userId ${userId}`);

    return {
      success: true,
      message: 'Device token unregistered successfully',
    };
  }

  /**
   * Send push notification & store in-app notification record
   */
  async sendPushNotification(options: SendPushOptions) {
    const { userId, customerId, title, body, type = 'GENERAL', data = {} } = options;

    let targetUserId = userId;
    let targetCustomerId = customerId;

    if (!targetUserId && !targetCustomerId) {
      throw new Error('Either userId or customerId must be provided to send a notification');
    }

    // Resolve customerId if userId is given but customerId isn't
    if (targetUserId && !targetCustomerId) {
      const user = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { customerId: true },
      });
      targetCustomerId = user?.customerId || 1;
    }

    // If customerId is given without userId, find customer owner/first user
    if (!targetUserId && targetCustomerId) {
      const firstUser = await this.prisma.user.findFirst({
        where: { customerId: targetCustomerId, deletedAt: null },
        select: { id: true },
      });
      if (firstUser) {
        targetUserId = firstUser.id;
      }
    }

    // 1. Create in-app Notification database record
    let dbNotification: any = null;
    if (targetUserId && targetCustomerId) {
      dbNotification = await this.prisma.notification.create({
        data: {
          customerId: targetCustomerId,
          userId: targetUserId,
          title,
          message: body,
          type,
          data: data as any,
          isRead: false,
        },
      });
    }

    // 2. Fetch all active device tokens for the recipient(s)
    const tokenQuery: any = { isActive: true };
    if (targetUserId) {
      tokenQuery.userId = targetUserId;
    } else if (targetCustomerId) {
      tokenQuery.user = { customerId: targetCustomerId, deletedAt: null };
    }

    const deviceRecords = await this.prisma.userDeviceToken.findMany({
      where: tokenQuery,
      select: { token: true },
    });

    const tokens = deviceRecords.map((d) => d.token);

    // Ensure data payload includes type & notification metadata
    const payloadData: Record<string, string> = {
      type,
      title,
      body,
      notificationId: dbNotification ? String(dbNotification.id) : '',
      ...data,
    };

    // 3. Dispatch multicast push via FCM Service
    const fcmResult = await this.fcmService.sendMulticast(tokens, title, body, payloadData);

    // 4. Automatically deactivate invalid / stale tokens in database
    if (fcmResult.invalidTokens.length > 0) {
      await this.prisma.userDeviceToken.updateMany({
        where: {
          token: { in: fcmResult.invalidTokens },
        },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });
      this.logger.log(`Cleaned up ${fcmResult.invalidTokens.length} invalid FCM token(s).`);
    }

    return {
      notification: dbNotification,
      fcm: fcmResult,
    };
  }

  // Business Event Notification Helpers

  async sendNewOrderNotification(userId: number, orderId: string | number, amount?: number) {
    const formattedAmount = amount ? ` for ₹${amount.toLocaleString('en-IN')}` : '';
    return this.sendPushNotification({
      userId,
      title: 'New Order Received',
      body: `You have received a new order #${orderId}${formattedAmount}.`,
      type: 'NEW_ORDER',
      data: {
        type: 'ORDER',
        orderId: String(orderId),
      },
    });
  }

  async sendOrderConfirmedNotification(userId: number, orderId: string | number) {
    return this.sendPushNotification({
      userId,
      title: 'Order Confirmed',
      body: `Your order #${orderId} has been successfully confirmed.`,
      type: 'ORDER_CONFIRMED',
      data: {
        type: 'ORDER',
        orderId: String(orderId),
      },
    });
  }

  async sendOrderCancelledNotification(userId: number, orderId: string | number, reason?: string) {
    const reasonText = reason ? ` Reason: ${reason}` : '';
    return this.sendPushNotification({
      userId,
      title: 'Order Cancelled',
      body: `Order #${orderId} was cancelled.${reasonText}`,
      type: 'ORDER_CANCELLED',
      data: {
        type: 'ORDER',
        orderId: String(orderId),
      },
    });
  }

  async sendPaymentSuccessfulNotification(userId: number, orderId: string | number, amount: number) {
    return this.sendPushNotification({
      userId,
      title: 'Payment Successful',
      body: `Payment of ₹${amount.toLocaleString('en-IN')} for order #${orderId} was successful.`,
      type: 'PAYMENT_SUCCESSFUL',
      data: {
        type: 'PAYMENT',
        orderId: String(orderId),
        amount: String(amount),
      },
    });
  }

  async sendGeneralNotification(userId: number, title: string, body: string, data?: Record<string, string>) {
    return this.sendPushNotification({
      userId,
      title,
      body,
      type: 'GENERAL',
      data,
    });
  }
}
