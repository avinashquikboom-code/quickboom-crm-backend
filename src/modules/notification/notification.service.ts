import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmService } from './fcm.service';
import { RegisterDeviceTokenDto, TestTokenDto, AdminOfferNotificationDto } from './dto/device-token.dto';

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

  async markAsRead(
    id: number | string,
    customerId: number | string,
    userId: number | string,
  ) {
    const numId = Number(id);
    const numCustomerId = Number(customerId);
    const numUserId = Number(userId);
    return this.prisma.notification.updateMany({
      where: { id: numId, customerId: numCustomerId, userId: numUserId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(customerId: number | string, userId: number | string) {
    const numCustomerId = Number(customerId);
    const numUserId = Number(userId);
    return this.prisma.notification.updateMany({
      where: { customerId: numCustomerId, userId: numUserId, isRead: false },
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

    this.logger.log(`Registered device token for userId ${userId} (platform: ${platform}, length: ${cleanToken.length})`);

    return {
      success: true,
      message: 'Device token registered successfully',
      data: {
        id: deviceToken.id,
        userId: deviceToken.userId,
        platform: deviceToken.platform,
        isActive: deviceToken.isActive,
      },
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

    this.logger.log(`Deactivated device token for userId ${userId} (token length: ${cleanToken.length})`);

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
      if (!user?.customerId) {
        throw new BadRequestException('The notification recipient is not associated with a customer.');
      }
      targetCustomerId = user.customerId;
    }

    // If customerId is given without userId, find customer owner/first user
    if (!targetUserId && targetCustomerId) {
      const firstUser = await this.prisma.user.findFirst({
        where: { customerId: targetCustomerId, deletedAt: null },
        select: { id: true },
      });
      if (firstUser) {
        targetUserId = firstUser.id;
      } else {
        throw new BadRequestException('The customer has no active user to receive this notification.');
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

    if (tokens.length === 0) {
      this.logger.warn(
        `[PUSH_DISPATCH] No active device tokens found for userId=${targetUserId || 'none'}, customerId=${targetCustomerId || 'none'}. In-app notification #${dbNotification?.id || 'none'} created.`,
      );
    } else {
      this.logger.log(
        `[PUSH_DISPATCH] Dispatching push notification to ${tokens.length} active device(s) for userId=${targetUserId || 'none'}, customerId=${targetCustomerId || 'none'} (Title: "${title}")`,
      );
    }

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
      delivered: fcmResult.successCount > 0,
      status:
        tokens.length === 0
          ? 'NO_ACTIVE_TOKENS'
          : fcmResult.successCount > 0
          ? 'DELIVERED'
          : 'FCM_DELIVERY_FAILED',
    };
  }

  /**
   * Directly test push delivery to a single FCM token (Requirement 10)
   */
  async sendDirectTestToToken(dto: TestTokenDto) {
    const title = dto.title || 'Test Push Notification';
    const body = dto.body || 'This is a test notification outside the app.';
    const data = dto.data || { type: 'TEST', timestamp: new Date().toISOString() };
    return this.fcmService.sendToSingleToken(dto.token, title, body, data);
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

  /**
   * Send Leave Approval Notification (Full-day or Half-day) to Employee
   */
  async sendLeaveApprovalNotification(employeeId: number, leave: any, isHalfDay = false) {
    try {
      const emp = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, customerId: true, firstName: true },
      });

      if (!emp || !emp.userId) {
        this.logger.warn(`Cannot send leave notification: employee #${employeeId} has no linked userId`);
        return null;
      }

      const leaveTypeName = leave.leaveType?.name || 'Leave';
      const fromStr = leave.fromDate ? new Date(leave.fromDate).toISOString().split('T')[0] : '';
      const toStr = leave.toDate ? new Date(leave.toDate).toISOString().split('T')[0] : '';
      const dateText = fromStr === toStr ? fromStr : `${fromStr} to ${toStr}`;

      const title = isHalfDay ? 'Half-Day Leave Approved' : 'Leave Request Approved';
      const body = `Your ${isHalfDay ? 'half-day ' : ''}${leaveTypeName} request for ${dateText} has been approved.`;

      return await this.sendPushNotification({
        userId: emp.userId,
        customerId: emp.customerId,
        title,
        body,
        type: 'LEAVE_APPROVED',
        data: {
          type: 'LEAVE',
          leaveId: String(leave.id),
          leaveType: leaveTypeName,
          status: 'APPROVED',
          isHalfDay: String(isHalfDay),
          dates: dateText,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending leave approval notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Send Work Assignment Notification to Employee
   */
  async sendWorkAssignmentNotification(employeeId: number, work: any, isReassignment = false) {
    try {
      const emp = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, customerId: true, firstName: true },
      });

      if (!emp || !emp.userId) {
        this.logger.warn(`Cannot send work assignment notification: employee #${employeeId} has no linked userId`);
        return null;
      }

      // Fetch customer / company info
      let companyName = 'Customer Workspace';
      if (work.customerId) {
        const cust = await this.prisma.customer.findUnique({
          where: { id: work.customerId },
          select: { companyName: true, name: true },
        });
        if (cust) {
          companyName = cust.companyName || cust.name || 'Customer Workspace';
        }
      }

      const workTitle = work.title || 'Scheduled Activity';
      const dateStr = work.scheduledDate ? new Date(work.scheduledDate).toISOString().split('T')[0] : '';
      const timeStr = work.scheduledTime ? ` at ${work.scheduledTime}` : '';

      const title = isReassignment ? `Work Reassigned: ${workTitle}` : `New Work Assigned: ${workTitle}`;
      const body = `You have been assigned to "${workTitle}" for ${companyName}${dateStr ? ` scheduled for ${dateStr}${timeStr}` : ''}.`;

      return await this.sendPushNotification({
        userId: emp.userId,
        customerId: emp.customerId,
        title,
        body,
        type: 'WORK_ASSIGNMENT',
        data: {
          type: 'WORK',
          workId: String(work.id),
          customerId: String(work.customerId),
          title: workTitle,
          company: companyName,
          scheduledDate: dateStr,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending work assignment notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Send Subscription Expiry Notification to Customer
   */
  async sendSubscriptionExpiringNotification(customerId: number, subscription: any, daysRemaining = 3) {
    try {
      const planName = subscription.plan?.name || 'Subscription Plan';
      const endDate = subscription.endDate ? new Date(subscription.endDate).toISOString().split('T')[0] : 'soon';

      const title = '⚠️ Your Plan Expires Soon';
      const body = `Your ${planName} plan will expire in 3 days. Renew your plan to continue using QB Suite.`;

      return await this.sendPushNotification({
        customerId,
        title,
        body,
        type: 'SUBSCRIPTION_EXPIRING_SOON',
        data: {
          type: 'SUBSCRIPTION',
          subscriptionId: String(subscription.id),
          customerId: String(customerId),
          planName,
          expiryDate: endDate,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending subscription expiry notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Send Tomorrow's Calendar Schedule Reminder
   */
  async sendCalendarReminderNotification(params: {
    recipientType: 'CUSTOMER' | 'EMPLOYEE';
    userId: number;
    customerId: number;
    work: any;
  }) {
    try {
      const { recipientType, userId, customerId, work } = params;
      const workTitle = work.title || 'Scheduled Activity';
      const timeStr = work.scheduledTime ? ` at ${work.scheduledTime}` : '';

      let companyName = 'Customer Workspace';
      if (work.customer) {
        companyName = work.customer.companyName || work.customer.name || 'Customer Workspace';
      }

      const title = `Tomorrow's Schedule: ${workTitle}`;
      const body =
        recipientType === 'CUSTOMER'
          ? `Reminder: You have "${workTitle}" scheduled for tomorrow${timeStr}.`
          : `Reminder: You are scheduled for "${workTitle}" for ${companyName} tomorrow${timeStr}.`;

      return await this.sendPushNotification({
        userId,
        customerId,
        title,
        body,
        type: 'CALENDAR_SCHEDULE_REMINDER',
        data: {
          type: 'CALENDAR',
          workId: String(work.id),
          customerId: String(customerId),
          title: workTitle,
          recipientType,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending calendar reminder notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Send Leave Rejection Notification to Employee
   */
  async sendLeaveRejectionNotification(employeeId: number, leave: any, isHalfDay = false) {
    try {
      const emp = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, customerId: true, firstName: true },
      });

      if (!emp || !emp.userId) {
        this.logger.warn(`Cannot send leave rejection notification: employee #${employeeId} has no linked userId`);
        return null;
      }

      const leaveTypeName = leave.leaveType?.name || 'Leave';
      const fromStr = leave.fromDate ? new Date(leave.fromDate).toISOString().split('T')[0] : '';
      const toStr = leave.toDate ? new Date(leave.toDate).toISOString().split('T')[0] : '';
      const dateText = fromStr === toStr ? fromStr : `${fromStr} to ${toStr}`;
      const reasonText = leave.rejectionReason ? ` Reason: ${leave.rejectionReason}` : '';

      const title = isHalfDay ? 'Half-Day Leave Rejected' : 'Leave Request Rejected';
      const body = `Your ${isHalfDay ? 'half-day ' : ''}${leaveTypeName} request for ${dateText} has been rejected.${reasonText}`;

      return await this.sendPushNotification({
        userId: emp.userId,
        customerId: emp.customerId,
        title,
        body,
        type: 'LEAVE_REJECTED',
        data: {
          type: 'LEAVE',
          leaveId: String(leave.id),
          leaveType: leaveTypeName,
          status: 'REJECTED',
          isHalfDay: String(isHalfDay),
          dates: dateText,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending leave rejection notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Send Remote Work Approval/Rejection Notification to Employee
   */
  async sendRemoteWorkNotification(employeeId: number, remoteRequest: any, approved: boolean) {
    try {
      const emp = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, customerId: true, firstName: true },
      });

      if (!emp || !emp.userId) {
        this.logger.warn(`Cannot send remote-work notification: employee #${employeeId} has no linked userId`);
        return null;
      }

      const fromStr = remoteRequest.fromDate
        ? new Date(remoteRequest.fromDate).toISOString().split('T')[0]
        : '';
      const toStr = remoteRequest.toDate
        ? new Date(remoteRequest.toDate).toISOString().split('T')[0]
        : '';
      const dateText = fromStr === toStr ? fromStr : `${fromStr} to ${toStr}`;
      const reasonText =
        !approved && remoteRequest.rejectionReason ? ` Reason: ${remoteRequest.rejectionReason}` : '';

      const title = approved ? 'Remote Work Request Approved' : 'Remote Work Request Rejected';
      const body = `Your remote work request for ${dateText} has been ${approved ? 'approved' : 'rejected'}.${reasonText}`;

      return await this.sendPushNotification({
        userId: emp.userId,
        customerId: emp.customerId,
        title,
        body,
        type: approved ? 'REMOTE_WORK_APPROVED' : 'REMOTE_WORK_REJECTED',
        data: {
          type: 'REMOTE_WORK',
          remoteRequestId: String(remoteRequest.id),
          status: approved ? 'APPROVED' : 'REJECTED',
          dates: dateText,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending remote-work notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Send Claim Approval/Rejection Notification to Employee
   */
  async sendClaimNotification(employeeId: number, claim: any, approved: boolean) {
    try {
      const emp = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, customerId: true, firstName: true },
      });

      if (!emp || !emp.userId) {
        this.logger.warn(`Cannot send claim notification: employee #${employeeId} has no linked userId`);
        return null;
      }

      const category = claim.category || 'Expense';
      const amountStr =
        claim.approvedAmount != null
          ? `₹${Number(claim.approvedAmount).toLocaleString('en-IN')}`
          : claim.amount != null
            ? `₹${Number(claim.amount).toLocaleString('en-IN')}`
            : '';
      const amountText = amountStr ? ` (${amountStr})` : '';
      const reasonText = !approved && claim.rejectionReason ? ` Reason: ${claim.rejectionReason}` : '';

      const title = approved ? 'Claim Request Approved' : 'Claim Request Rejected';
      const body = `Your ${category} claim request #${claim.id}${amountText} has been ${approved ? 'approved' : 'rejected'}.${reasonText}`;

      return await this.sendPushNotification({
        userId: emp.userId,
        customerId: emp.customerId,
        title,
        body,
        type: approved ? 'CLAIM_APPROVED' : 'CLAIM_REJECTED',
        data: {
          type: 'CLAIM',
          claimId: String(claim.id),
          category,
          status: approved ? 'APPROVED' : 'REJECTED',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending claim notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Send Loan Approval/Rejection Notification to Employee
   */
  async sendLoanNotification(employeeId: number, loan: any, approved: boolean) {
    try {
      const emp = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { userId: true, customerId: true, firstName: true },
      });

      if (!emp || !emp.userId) {
        this.logger.warn(`Cannot send loan notification: employee #${employeeId} has no linked userId`);
        return null;
      }

      const amountStr =
        loan.approvedAmount != null
          ? `₹${Number(loan.approvedAmount).toLocaleString('en-IN')}`
          : loan.loanAmount != null
            ? `₹${Number(loan.loanAmount).toLocaleString('en-IN')}`
            : '';
      const amountText = amountStr ? ` of ${amountStr}` : '';
      const reasonText = !approved && loan.rejectionReason ? ` Reason: ${loan.rejectionReason}` : '';

      const title = approved ? 'Loan Request Approved' : 'Loan Request Rejected';
      const body = `Your loan request #${loan.id}${amountText} has been ${approved ? 'approved' : 'rejected'}.${reasonText}`;

      return await this.sendPushNotification({
        userId: emp.userId,
        customerId: emp.customerId,
        title,
        body,
        type: approved ? 'LOAN_APPROVED' : 'LOAN_REJECTED',
        data: {
          type: 'LOAN',
          loanId: String(loan.id),
          status: approved ? 'APPROVED' : 'REJECTED',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending loan notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Send Influencer Application Approval/Rejection Notification to the Influencer user
   *
   * Influencers have their own user account (userId field on the Influencer record).
   * We use it directly so the notification lands on the correct device.
   */
  async sendInfluencerApplicationNotification(influencer: any, approved: boolean) {
    try {
      if (!influencer.userId) {
        this.logger.warn(`Cannot send influencer notification: influencer #${influencer.id} has no linked userId`);
        return null;
      }

      const name = influencer.name || 'Creator';
      const reasonText =
        !approved && influencer.rejectionReason ? ` Reason: ${influencer.rejectionReason}` : '';

      const title = approved ? 'Application Approved! 🎉' : 'Application Status Update';
      const body = approved
        ? `Congratulations ${name}! Your influencer application has been approved. You are now live on the platform.`
        : `Your influencer application has been reviewed and rejected.${reasonText}`;

      return await this.sendPushNotification({
        userId: influencer.userId,
        title,
        body,
        type: approved ? 'INFLUENCER_APPROVED' : 'INFLUENCER_REJECTED',
        data: {
          type: 'INFLUENCER',
          influencerId: String(influencer.id),
          status: approved ? 'APPROVED' : 'REJECTED',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending influencer application notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Send Admin Offer Notification to targeted customer or broadcast to all active customers
   */
  async sendAdminOfferNotification(dto: AdminOfferNotificationDto) {
    let targetCustomers: { id: number }[] = [];

    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: Number(dto.customerId), deletedAt: null },
        select: { id: true },
      });
      if (!customer) {
        throw new NotFoundException(`Customer with ID ${dto.customerId} not found or inactive`);
      }
      targetCustomers = [customer];
    } else {
      targetCustomers = await this.prisma.customer.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
    }

    if (targetCustomers.length === 0) {
      return {
        success: true,
        totalTargeted: 0,
        sentCount: 0,
        failedCount: 0,
        message: 'No active customers found to receive the offer notification.',
      };
    }

    let successCount = 0;
    let failedCount = 0;

    for (const cust of targetCustomers) {
      try {
        const payloadData: Record<string, string> = {
          type: 'OFFER',
          title: dto.title,
          message: dto.message,
        };
        if (dto.offerCode) payloadData.offerCode = String(dto.offerCode);
        if (dto.imageUrl) payloadData.imageUrl = String(dto.imageUrl);
        if (dto.deepLink) payloadData.deepLink = String(dto.deepLink);

        const res = await this.sendPushNotification({
          customerId: cust.id,
          title: dto.title,
          body: dto.message,
          type: 'ADMIN_OFFER',
          data: payloadData,
        });

        if (res) {
          successCount++;
        } else {
          failedCount++;
        }
      } catch (err: any) {
        failedCount++;
        this.logger.warn(`Failed to send offer notification to customer #${cust.id}: ${err?.message}`);
      }
    }

    return {
      success: true,
      totalTargeted: targetCustomers.length,
      sentCount: successCount,
      failedCount,
      message: `Offer notification dispatched to ${successCount} customer(s).`,
    };
  }
}

