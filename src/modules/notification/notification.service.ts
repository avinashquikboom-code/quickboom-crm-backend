import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmService } from './fcm.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService, renderEmailTemplate } from '../email/email-template.service';
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
    @Optional() private readonly whatsappService?: WhatsappService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly emailTemplateService?: EmailTemplateService,
  ) {}

  async resolveCustomerEmail(customerId: number): Promise<{ email: string | null; customerName: string; companyName: string }> {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          name: true,
          companyName: true,
          email: true,
          users: {
            where: { deletedAt: null },
            select: { email: true, firstName: true, lastName: true },
            take: 1,
          },
        },
      });
      if (!customer) return { email: null, customerName: 'Customer', companyName: 'QUIKBOOM' };
      const rawEmail = customer.email || customer.users[0]?.email || null;
      const customerName = customer.name || (customer.users[0] ? `${customer.users[0].firstName || ''} ${customer.users[0].lastName || ''}`.trim() : 'Customer');
      const companyName = customer.companyName || customer.name || 'QUIKBOOM Digital Marketing Agency';
      return { email: rawEmail ? rawEmail.trim() : null, customerName, companyName };
    } catch {
      return { email: null, customerName: 'Customer', companyName: 'QUIKBOOM' };
    }
  }

  async findAll(
    customerId?: number | string,
    userId?: number | string,
    unreadOnly = false,
    page = 1,
    limit = 20,
    search?: string,
  ) {
    const numCustomerId = customerId !== undefined && customerId !== null ? Number(customerId) : NaN;
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
    customerId?: number | string,
    userId?: number | string,
  ) {
    const numId = Number(id);
    const numUserId = userId ? Number(userId) : undefined;
    const where: any = { id: numId };
    if (numUserId) {
      where.userId = numUserId;
    }
    return this.prisma.notification.updateMany({
      where,
      data: { isRead: true },
    });
  }

  async markAllAsRead(customerId?: number | string, userId?: number | string) {
    const numUserId = userId ? Number(userId) : undefined;
    const numCustomerId = customerId ? Number(customerId) : undefined;
    const where: any = { isRead: false };
    if (numUserId) {
      where.userId = numUserId;
    } else if (numCustomerId) {
      where.customerId = numCustomerId;
    }
    return this.prisma.notification.updateMany({
      where,
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

    // Check if user has an unread recent WELCOME notification and deliver it to this newly registered device
    try {
      const pendingWelcome = await this.prisma.notification.findFirst({
        where: {
          userId,
          type: 'WELCOME',
          isRead: false,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingWelcome) {
        this.logger.log(`[WELCOME] Delivering pending welcome push to newly registered token for userId=${userId}`);
        const payload: Record<string, string> = {
          type: 'WELCOME',
          customerId: String(pendingWelcome.customerId || ''),
          notificationId: String(pendingWelcome.id),
        };
        await this.fcmService.sendToSingleToken(cleanToken, pendingWelcome.title, pendingWelcome.message, payload, {
          customerId: pendingWelcome.customerId || undefined,
          notificationType: 'WELCOME',
        });
      }

      // Check if user has an unread recent PLAN_PURCHASE_SUCCESS notification to deliver
      const pendingPlan = await this.prisma.notification.findFirst({
        where: {
          userId,
          type: 'PLAN_PURCHASE_SUCCESS',
          isRead: false,
          createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingPlan) {
        this.logger.log(`[PLAN] Delivering pending plan purchase push to newly registered token for userId=${userId}`);
        const planData = (pendingPlan.data as any) || {};
        const payload: Record<string, string> = {
          type: 'PLAN_PURCHASE_SUCCESS',
          subscriptionId: String(planData.subscriptionId || ''),
          planId: String(planData.planId || ''),
          planName: String(planData.planName || ''),
          customerId: String(pendingPlan.customerId || ''),
          notificationId: String(pendingPlan.id),
        };
        await this.fcmService.sendToSingleToken(cleanToken, pendingPlan.title, pendingPlan.message, payload, {
          customerId: pendingPlan.customerId || undefined,
          notificationType: 'PLAN_PURCHASE_SUCCESS',
        });
      }
    } catch (pendingErr: any) {
      this.logger.warn(`Non-fatal: Failed to deliver pending push to new token: ${pendingErr?.message}`);
    }

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
    const fcmResult = await this.fcmService.sendMulticast(tokens, title, body, payloadData, {
      customerId: targetCustomerId,
      notificationType: type,
    });

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
    return this.fcmService.sendToSingleToken(dto.token, title, body, data, {
      notificationType: 'TEST_DIRECT_TOKEN',
    });
  }

  /**
   * Protected test endpoint for Section 14: POST /api/v1/notifications/test
   * Finds valid FCM tokens for the given customer, dispatches test FCM message,
   * logs with [FCM] prefix, and returns the messageId.
   */
  async sendCustomerTestNotification(targetCustomerId: number | string | undefined) {
    const customerId = Number(targetCustomerId);
    if (!customerId || isNaN(customerId)) {
      throw new BadRequestException('A valid customerId must be provided.');
    }

    const deviceRecords = await this.prisma.userDeviceToken.findMany({
      where: {
        isActive: true,
        user: { customerId, deletedAt: null },
      },
      select: { token: true, userId: true },
    });

    const tokens = deviceRecords.map((d) => d.token);

    if (tokens.length === 0) {
      this.logger.warn(
        `[FCM]\ncustomerId: ${customerId}\ntoken: none\nnotificationType: TEST\nmessageId: none\nsend result: NO_VALID_TOKEN`,
      );
      return {
        success: false,
        message: 'No active FCM device tokens registered for this customer.',
        customerId,
      };
    }

    const title = 'Test Push Notification 🚀';
    const body = 'This is a test notification outside the app to verify background FCM delivery.';
    const payloadData: Record<string, string> = {
      type: 'TEST',
      customerId: String(customerId),
      timestamp: new Date().toISOString(),
    };

    const fcmResult = await this.fcmService.sendMulticast(tokens, title, body, payloadData, {
      customerId,
      notificationType: 'TEST',
    });

    const messageId = fcmResult.messageIds.length > 0 ? fcmResult.messageIds[0] : undefined;

    return {
      success: fcmResult.successCount > 0,
      messageId: messageId || (fcmResult.successCount > 0 ? 'FCM_SENT' : undefined),
      deliveredCount: fcmResult.successCount,
      failureCount: fcmResult.failureCount,
      customerId,
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
   * Send New Lead Assignment Push Notification to Employee (Requirement: Task Send Push Notification when a new Lead is assigned)
   */
  async sendLeadAssignedNotification(params: {
    customerId: number | string;
    employeeId?: number | string | null;
    userId?: number | string | null;
    leadId: number | string;
    leadName?: string | null;
  }) {
    const { customerId, employeeId, userId, leadId, leadName } = params;
    const numCustomerId = Number(customerId);
    const numLeadId = Number(leadId);

    try {
      let targetUserId: number | null = userId ? Number(userId) : null;
      let targetEmployeeId: number | null = employeeId ? Number(employeeId) : null;

      // 1. Resolve employee and userId
      if (targetEmployeeId && !targetUserId) {
        const emp = await this.prisma.employee.findUnique({
          where: { id: targetEmployeeId },
          select: { id: true, userId: true, email: true },
        });
        if (emp?.userId) {
          targetUserId = emp.userId;
        } else if (emp?.email) {
          const linkedUser = await this.prisma.user.findFirst({
            where: { email: emp.email, deletedAt: null },
            select: { id: true },
          });
          if (linkedUser) {
            targetUserId = linkedUser.id;
          }
        }
      } else if (targetUserId && !targetEmployeeId) {
        const emp = await this.prisma.employee.findFirst({
          where: { userId: targetUserId, customerId: numCustomerId },
          select: { id: true },
        });
        if (emp) {
          targetEmployeeId = emp.id;
        }
      }

      // If targetUserId is not found in User table, check if targetUserId was actually an Employee ID
      if (targetUserId) {
        const userExists = await this.prisma.user.findUnique({
          where: { id: targetUserId },
          select: { id: true },
        });
        if (!userExists) {
          const emp = await this.prisma.employee.findUnique({
            where: { id: targetUserId },
            select: { id: true, userId: true },
          });
          if (emp?.userId) {
            targetEmployeeId = emp.id;
            targetUserId = emp.userId;
          }
        }
      }

      if (!targetUserId) {
        this.logger.warn(
          `[FCM] Lead assignment notification:\nEmployee ID: ${targetEmployeeId ?? 'none'}\nLead ID: ${numLeadId}\nToken found: no\nSend status: skipped (no linked userId)`,
        );
        return null;
      }

      // 2. Resolve lead name if not provided
      let resolvedLeadName = (leadName || '').trim();
      if (!resolvedLeadName) {
        const lead = await this.prisma.lead.findUnique({
          where: { id: numLeadId },
          select: { id: true, firstName: true, lastName: true, companyName: true, title: true },
        });
        if (lead) {
          const fullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
          resolvedLeadName = fullName || lead.companyName || lead.title || lead.firstName || `Lead #${lead.id}`;
        } else {
          resolvedLeadName = `Lead #${numLeadId}`;
        }
      }

      const title = 'New Lead Assigned';
      const body = `You have been assigned a new lead: ${resolvedLeadName}`;

      const res = await this.sendPushNotification({
        userId: targetUserId,
        customerId: numCustomerId,
        title,
        body,
        type: 'LEAD_ASSIGNED',
        data: {
          type: 'LEAD_ASSIGNED',
          leadId: String(numLeadId),
          customerId: String(numCustomerId),
          channel: 'LEAD',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
      });

      const tokenFound = (res?.status === 'NO_ACTIVE_TOKENS') ? 'no' : 'yes';
      const sendStatus = (res?.delivered) ? 'success' : (res?.status === 'NO_ACTIVE_TOKENS' ? 'skipped (no tokens)' : 'failed');

      this.logger.log(
        `[FCM] Lead assignment notification:\nEmployee ID: ${targetEmployeeId ?? targetUserId ?? 'none'}\nLead ID: ${numLeadId}\nToken found: ${tokenFound}\nSend status: ${sendStatus}`,
      );

      return res;
    } catch (err: any) {
      this.logger.warn(
        `[FCM] Lead assignment notification:\nEmployee ID: ${employeeId ?? 'none'}\nLead ID: ${numLeadId}\nToken found: unknown\nSend status: failed (${err?.message})`,
      );
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

      const pushResult = await this.sendPushNotification({
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

      // 2. Email Plan Expiry Reminder
      try {
        if (this.emailService && this.emailTemplateService) {
          const { email, customerName, companyName } = await this.resolveCustomerEmail(customerId);
          if (email) {
            const template = await this.emailTemplateService.findByKey('PLAN_EXPIRY_REMINDER', customerId);
            const rendered = renderEmailTemplate(
              { subject: template?.subject || 'Action Required: Your {{planName}} Plan Expires in 3 Days – {{companyName}}', body: template?.body || '' },
              {
                customerName,
                planName,
                expiryDate: endDate,
                daysRemaining: String(daysRemaining),
                companyName,
              },
            );

            await this.emailService.sendEmail({
              to: email,
              subject: rendered.subject,
              html: rendered.body,
              text: rendered.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
              recordType: 'customer',
              recordId: customerId,
              eventType: 'PLAN_EXPIRY_REMINDER',
              templateId: template?.id,
            });
            this.logger.log(`[EMAIL] 3-day plan expiry reminder email sent to customer #${customerId} (${email})`);
          }
        }
      } catch (emailErr: any) {
        this.logger.warn(`[EMAIL] Plan expiry reminder email notice: ${emailErr?.message}`);
      }

      // 3. WhatsApp Plan Expiry Reminder
      try {
        if (this.whatsappService) {
          await this.whatsappService.sendPlanExpiryReminderMessage({
            customerId,
            planName,
            expiryDate: endDate,
            daysRemaining,
          });
          this.logger.log(`[WHATSAPP] 3-day plan expiry reminder WhatsApp sent to customer #${customerId}`);
        }
      } catch (waErr: any) {
        this.logger.warn(`[WHATSAPP] Plan expiry reminder WhatsApp notice: ${waErr?.message}`);
      }

      return pushResult;
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

  /**
   * Send Customer Registration Welcome Notification
   * Triggers after customer account is committed in the database.
   * Creates in-app DB notification and dispatches FCM push to all valid customer devices.
   */
  async sendCustomerWelcomeNotification(params: {
    customerId: number;
    userId?: number;
    customerName?: string;
  }) {
    const { customerId } = params;
    let targetUserId = params.userId;

    this.logger.log(`[WELCOME] Customer created: ${params.customerName || 'Customer'}`);
    this.logger.log(`[WELCOME] Customer ID: ${customerId}`);
    this.logger.log(`[FCM] Notification recipient customerId: ${customerId}`);

    try {
      // 1. Resolve userId if not explicitly provided
      if (!targetUserId) {
        const firstUser = await this.prisma.user.findFirst({
          where: { customerId, deletedAt: null },
          select: { id: true },
        });
        if (firstUser) {
          targetUserId = firstUser.id;
        }
      }

      if (!targetUserId) {
        this.logger.warn(
          `[NOTIFICATION] No active user found for customerId=${customerId} to link welcome notification.`,
        );
        return null;
      }

      // 2. Idempotency Check: prevent duplicate welcome notifications for same customer
      const existingNotif = await this.prisma.notification.findFirst({
        where: {
          customerId,
          type: { in: ['WELCOME', 'CUSTOMER_WELCOME'] },
        },
      });

      const title = 'Welcome to QuikBoom! 🎉';
      const body = 'Your account has been created successfully. Welcome to QuikBoom!';
      const payloadData: Record<string, string> = {
        type: 'WELCOME',
        customerId: String(customerId),
      };

      let dbNotification = existingNotif;
      if (!dbNotification) {
        dbNotification = await this.prisma.notification.create({
          data: {
            customerId,
            userId: targetUserId,
            title,
            message: body,
            type: 'WELCOME',
            isRead: false,
            data: payloadData as any,
          },
        });
      } else {
        this.logger.log(
          `[NOTIFICATION] Welcome notification already exists for customerId=${customerId}. Skipping DB duplicate.`,
        );
      }

      this.logger.log(`[NOTIFICATION] WELCOME created`);
      this.logger.log(`[FCM] Customer ID found`);

      // 3. Find active device tokens for the customer and target user
      this.logger.log(`[WELCOME] Looking for FCM tokens...`);
      this.logger.log(`[FCM] Customer token lookup started`);
      this.logger.log(`[FCM] Customer ID: ${customerId}`);
      const deviceRecords = await this.prisma.userDeviceToken.findMany({
        where: {
          isActive: true,
          OR: [
            { userId: targetUserId },
            { user: { customerId: Number(customerId), deletedAt: null } },
          ],
        },
        select: { token: true },
      });

      const rawTokens = deviceRecords.map((d) => d.token.trim()).filter((t) => t.length > 0);
      const tokens = Array.from(new Set(rawTokens));
      const tokenFound = tokens.length > 0;

      this.logger.log(`[FCM] Token found: ${tokenFound ? 'YES' : 'NO'}`);
      this.logger.log(`[FCM] Number of active tokens: ${tokens.length}`);

      let fcmSent = false;
      let fcmResult: any = null;

      if (tokens.length === 0) {
        this.logger.log(`[FCM] No active device tokens found for customer ${customerId}`);
        this.logger.log(`[WELCOME] Notification completed`);
      } else {
        this.logger.log(`[FCM] Device token found`);
        const maskedTokens = tokens.map((t) => (t.length > 8 ? `****${t.slice(-4)}` : '****'));
        this.logger.log(`[FCM] Active token suffix: ${maskedTokens.join(', ')}`);
        this.logger.log(`[WELCOME] FCM tokens found: ${tokens.length}`);
        this.logger.log(`[WELCOME] Calling FCM service...`);

        // 4. Send FCM Push Notification to all active customer devices
        const fcmPayload: Record<string, string> = {
          ...payloadData,
          notificationId: dbNotification ? String(dbNotification.id) : '',
        };

        fcmResult = await this.fcmService.sendMulticast(tokens, title, body, fcmPayload, {
          customerId,
          notificationType: 'WELCOME',
        });

        this.logger.log(
          `[WELCOME] FCM response: successCount=${fcmResult.successCount}, failureCount=${fcmResult.failureCount}`,
        );

        if (fcmResult.successCount > 0) {
          fcmSent = true;
        }

        // 5. Clean up any invalid or expired tokens
        if (fcmResult.invalidTokens.length > 0) {
          await this.prisma.userDeviceToken.updateMany({
            where: { token: { in: fcmResult.invalidTokens } },
            data: { isActive: false, updatedAt: new Date() },
          });
          this.logger.log(
            `[FCM] Cleaned up ${fcmResult.invalidTokens.length} invalid FCM token(s).`,
          );
        }

        this.logger.log(`[WELCOME] Notification completed`);
      }

      // WhatsApp Customer Welcome Message (independent of FCM, non-blocking)
      try {
        if (this.whatsappService) {
          await this.whatsappService.sendCustomerWelcomeMessage({
            customerId,
            customerName: params.customerName,
            notificationId: dbNotification?.id,
          });
        }
      } catch (waErr: any) {
        this.logger.warn(`[WHATSAPP] Customer welcome message notice: ${waErr?.message}`);
      }

      // 5b. Email Customer Welcome (independent of FCM & WhatsApp, non-blocking)
      try {
        if (this.emailService && this.emailTemplateService) {
          const { email, customerName, companyName } = await this.resolveCustomerEmail(customerId);
          if (email) {
            const template = await this.emailTemplateService.findByKey('CUSTOMER_WELCOME', customerId);
            const rendered = renderEmailTemplate(
              { subject: template?.subject || 'Welcome to {{companyName}}!', body: template?.body || '' },
              {
                customerName: params.customerName || customerName,
                companyName,
                contactEmail: email,
                supportPhone: 'Support Desk',
                email,
              },
            );

            await this.emailService.sendEmail({
              to: email,
              subject: rendered.subject,
              html: rendered.body,
              text: rendered.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
              recordType: 'customer',
              recordId: customerId,
              eventType: 'CUSTOMER_WELCOME',
              templateId: template?.id,
            });
            this.logger.log(`[EMAIL] Welcome email sent to customer #${customerId} (${email})`);
          }
        }
      } catch (emailErr: any) {
        this.logger.warn(`[EMAIL] Customer welcome email notice: ${emailErr?.message}`);
      }

      // 6. Non-blocking Notification to Super Admins / Platform Admins
      this.notifyAdmins({
        title: 'New Customer Registered',
        body: `A new customer account has been created successfully.`,
        type: 'CUSTOMER_REGISTERED',
        data: {
          type: 'CUSTOMER_REGISTERED',
          customerId: String(customerId),
          route: '/customers',
        },
      }).catch((adminErr) =>
        this.logger.warn(`Failed notifying admins of customer registration: ${adminErr?.message}`),
      );

      return {
        notification: dbNotification,
        fcmSent,
        result: fcmResult,
        reason: tokens.length === 0 ? 'NO_DEVICE_TOKEN' : undefined,
      };
    } catch (err: any) {
      this.logger.error(`[FCM] Send failed:\n${err?.message}`);
      return null;
    }
  }

  /**
   * Send Plan Purchase Success Notification
   * Triggers after payment verification succeeds and subscription is activated (ACTIVE).
   * Creates in-app DB notification and dispatches FCM push to all valid customer devices.
   */
  async sendPlanPurchaseSuccessNotification(params: {
    customerId: number;
    userId?: number;
    subscriptionId: number;
    planId: number;
    planName: string;
    paymentId?: string | number;
  }) {
    const { customerId, subscriptionId, planId, planName, paymentId } = params;
    let targetUserId = params.userId;

    this.logger.log(`[PLAN] Payment verified: ${paymentId || 'N/A'}`);
    this.logger.log(`[PLAN] Subscription ID: ${subscriptionId}`);
    this.logger.log(`[PLAN] Subscription activated: ${subscriptionId}`);
    this.logger.log(`[PLAN] Customer ID: ${customerId}`);
    this.logger.log(`[PLAN] Plan status: ACTIVE`);
    this.logger.log(`[PLAN] Triggering plan activation notification`);
    this.logger.log(`[FCM] Notification recipient customerId: ${customerId}`);

    try {
      // 1. Resolve userId if not explicitly provided
      if (!targetUserId) {
        const firstUser = await this.prisma.user.findFirst({
          where: { customerId, deletedAt: null },
          select: { id: true },
        });
        if (firstUser) {
          targetUserId = firstUser.id;
        }
      }

      if (!targetUserId) {
        this.logger.warn(
          `[NOTIFICATION] No active user found for customerId=${customerId} to link plan purchase notification.`,
        );
        return null;
      }

      // 2. Idempotency Check: Prevent duplicate notifications within 15 minutes for the same payment or subscription
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const recentNotifs = await this.prisma.notification.findMany({
        where: {
          customerId,
          type: 'PLAN_PURCHASE_SUCCESS',
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      const isDuplicate = recentNotifs.some((n) => {
        const data = (n.data as any) || {};
        if (paymentId && data.paymentId && String(data.paymentId) === String(paymentId)) {
          return true;
        }
        if (
          String(data.subscriptionId) === String(subscriptionId) &&
          String(data.planId) === String(planId)
        ) {
          return true;
        }
        return false;
      });

      if (isDuplicate) {
        this.logger.log(
          `[NOTIFICATION] Plan purchase notification already sent for customerId=${customerId}, subscriptionId=${subscriptionId}. Skipping duplicate.`,
        );
        return {
          notification: recentNotifs[0],
          fcmSent: true,
          skippedDuplicate: true,
        };
      }

      const title = 'Plan Activated Successfully';
      const body = `Your ${planName} has been activated successfully.`;
      const payloadData: Record<string, string> = {
        type: 'PLAN_PURCHASE_SUCCESS',
        subscriptionId: String(subscriptionId),
        planId: String(planId),
        planName,
        customerId: String(customerId),
        status: 'ACTIVE',
      };

      // 3. Create in-app Notification database record
      const dbNotification = await this.prisma.notification.create({
        data: {
          customerId,
          userId: targetUserId,
          title,
          message: body,
          type: 'PLAN_PURCHASE_SUCCESS',
          isRead: false,
          data: {
            ...payloadData,
            status: 'ACTIVE',
            paymentId: paymentId ? String(paymentId) : '',
          } as any,
        },
      });

      this.logger.log(`[NOTIFICATION] PLAN_PURCHASE_SUCCESS created`);
      this.logger.log(`[FCM] Customer ID found`);

      // 4. Fetch active device tokens for the customer and target user
      this.logger.log(`[PLAN] Looking for FCM tokens...`);
      this.logger.log(`[FCM] Customer token lookup started`);
      this.logger.log(`[FCM] Customer ID: ${customerId}`);
      const deviceRecords = await this.prisma.userDeviceToken.findMany({
        where: {
          isActive: true,
          OR: [
            { userId: targetUserId },
            { user: { customerId: Number(customerId), deletedAt: null } },
          ],
        },
        select: { token: true },
      });

      const rawTokens = deviceRecords.map((d) => d.token.trim()).filter((t) => t.length > 0);
      const tokens = Array.from(new Set(rawTokens));
      const tokenFound = tokens.length > 0;

      this.logger.log(`[FCM] Token found: ${tokenFound ? 'YES' : 'NO'}`);
      this.logger.log(`[FCM] Number of active tokens: ${tokens.length}`);

      if (tokens.length === 0) {
        this.logger.log(`[FCM] No active device tokens found for customer ${customerId}`);
        this.logger.log(`[PLAN] Notification completed`);
      } else {
        this.logger.log(`[FCM] Device token found`);
        const maskedTokens = tokens.map((t) => (t.length > 8 ? `****${t.slice(-4)}` : '****'));
        this.logger.log(`[FCM] Active token suffix: ${maskedTokens.join(', ')}`);
        this.logger.log(`[PLAN] FCM tokens found: ${tokens.length}`);
        this.logger.log(`[PLAN] Calling FCM service...`);

        // 5. Dispatch multicast push via FCM Service
        const fcmPayload: Record<string, string> = {
          ...payloadData,
          notificationId: String(dbNotification.id),
        };

        const fcmResult = await this.fcmService.sendMulticast(tokens, title, body, fcmPayload, {
          customerId,
          notificationType: 'PLAN_PURCHASE_SUCCESS',
        });

        this.logger.log(
          `[PLAN] FCM response: successCount=${fcmResult.successCount}, failureCount=${fcmResult.failureCount}`,
        );

        // 6. Clean up invalid tokens
        if (fcmResult.invalidTokens.length > 0) {
          await this.prisma.userDeviceToken.updateMany({
            where: { token: { in: fcmResult.invalidTokens } },
            data: { isActive: false, updatedAt: new Date() },
          });
          this.logger.log(
            `[FCM] Cleaned up ${fcmResult.invalidTokens.length} invalid FCM token(s).`,
          );
        }

        this.logger.log(`[PLAN] Notification completed`);
      }

      // WhatsApp Plan Activation Message (independent of FCM, non-blocking)
      try {
        if (this.whatsappService) {
          const subDetails = await this.prisma.customerSubscription.findUnique({
            where: { id: subscriptionId },
            select: { billingCycle: true, startDate: true, endDate: true },
          });

          await this.whatsappService.sendPlanActivationMessage({
            customerId,
            planName,
            subscriptionId,
            paymentId,
            billingCycle: subDetails?.billingCycle || 'Monthly',
            startDate: subDetails?.startDate,
            expiryDate: subDetails?.endDate,
            notificationId: dbNotification?.id,
          });
        }
      } catch (waErr: any) {
        this.logger.warn(`[WHATSAPP] Plan activation message notice: ${waErr?.message}`);
      }

      // 6b. Email Plan Activation (independent of FCM & WhatsApp, non-blocking)
      try {
        if (this.emailService && this.emailTemplateService) {
          const { email, customerName, companyName } = await this.resolveCustomerEmail(customerId);
          if (email) {
            const subDetails = await this.prisma.customerSubscription.findUnique({
              where: { id: subscriptionId },
              include: { plan: true },
            });
            const cycle = subDetails?.billingCycle || 'Monthly';
            const startStr = subDetails?.startDate ? new Date(subDetails.startDate).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
            const expiryStr = subDetails?.endDate ? new Date(subDetails.endDate).toLocaleDateString('en-IN') : 'Ongoing';
            const plan = subDetails?.plan?.name || planName;

            const template = await this.emailTemplateService.findByKey('PLAN_PURCHASE_SUCCESS', customerId);
            const rendered = renderEmailTemplate(
              { subject: template?.subject || 'Plan Activated: {{planName}} – {{companyName}}', body: template?.body || '' },
              {
                customerName: customerName || 'Valued Customer',
                planName: plan,
                billingCycle: cycle,
                startDate: startStr,
                expiryDate: expiryStr,
                price: subDetails?.plan ? String(cycle === 'YEARLY' ? subDetails.plan.yearlyPrice : subDetails.plan.monthlyPrice) : '',
                transactionId: paymentId ? String(paymentId) : 'Verified',
                companyName,
              },
            );

            await this.emailService.sendEmail({
              to: email,
              subject: rendered.subject,
              html: rendered.body,
              text: rendered.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
              recordType: 'customer',
              recordId: customerId,
              eventType: 'PLAN_PURCHASE_SUCCESS',
              templateId: template?.id,
            });
            this.logger.log(`[EMAIL] Plan activation email sent to customer #${customerId} (${email}) for plan "${plan}"`);
          }
        }
      } catch (emailErr: any) {
        this.logger.warn(`[EMAIL] Plan activation email notice: ${emailErr?.message}`);
      }

      // 7. Non-blocking Notification to Super Admins / Platform Admins
      this.notifyAdmins({
        title: 'New Plan Purchase',
        body: `Customer #${customerId} has successfully purchased plan "${planName}".`,
        type: 'PLAN_PURCHASE_SUCCESS',
        data: {
          type: 'PLAN_PURCHASE_SUCCESS',
          customerId: String(customerId),
          subscriptionId: String(subscriptionId),
          planId: String(planId),
          planName,
          route: '/subscriptions',
        },
      }).catch((adminErr) =>
        this.logger.warn(`Failed notifying admins of plan purchase: ${adminErr?.message}`),
      );

      return {
        notification: dbNotification,
        fcmSent: tokens.length > 0,
      };
    } catch (err: any) {
      this.logger.error(`[FCM] Send failed:\n${err?.message}`);
      return null;
    }
  }

  /**
   * Send notification to all active Super Admins & Platform Admins (both in-app and FCM push)
   * Supports webpush (Admin Panel) and mobile.
   */
  async notifyAdmins(params: {
    title: string;
    body: string;
    type: string;
    data?: Record<string, string>;
    customerId?: number | string;
  }) {
    const { title, body, type, data = {}, customerId } = params;
    const numCustomerId = customerId ? Number(customerId) : undefined;

    try {
      // 1. Find all active Admin / Super Admin users (and company admins if customerId is specified)
      const orConditions: any[] = [
        {
          userRoles: {
            some: {
              role: {
                OR: [
                  { type: 'SUPER_ADMIN' as any },
                  { name: { in: ['SUPER_ADMIN', 'Super Admin', 'Super Administrator', 'ADMIN', 'Admin'] } },
                ],
              },
            },
          },
        },
        { customerId: null },
      ];

      if (numCustomerId) {
        orConditions.push({
          customerId: numCustomerId,
          userRoles: {
            some: {
              role: {
                name: { in: ['ADMIN', 'Admin', 'COMPANY_ADMIN', 'Company Admin', 'SUPER_ADMIN', 'Super Admin'] },
              },
            },
          },
        });
      }

      const adminUsers = await this.prisma.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          OR: orConditions,
        },
        select: { id: true, customerId: true },
      });

      if (adminUsers.length === 0) {
        this.logger.log(`[FCM] Target user: admin, Tokens found: 0 (no admin users found in DB)`);
        return;
      }

      const adminUserIds = adminUsers.map((u) => u.id);

      // 2. Create in-app Notification database records for each admin
      for (const admin of adminUsers) {
        const fallbackCustomerId = admin.customerId || numCustomerId || 1;
        try {
          await this.prisma.notification.create({
            data: {
              customerId: fallbackCustomerId,
              userId: admin.id,
              title,
              message: body,
              type,
              data: data as any,
              isRead: false,
            },
          });
        } catch (dbErr: any) {
          this.logger.warn(`Failed to create admin notification DB record for userId=${admin.id}: ${dbErr?.message}`);
        }
      }

      // 3. Find active device tokens for all admin users
      const deviceRecords = await this.prisma.userDeviceToken.findMany({
        where: {
          isActive: true,
          userId: { in: adminUserIds },
        },
        select: { token: true, userId: true, platform: true },
      });

      const tokens = deviceRecords.map((d) => d.token);
      this.logger.log(
        `[FCM] Target user: admin (${adminUsers.length}), Tokens found: ${tokens.length}, Sending notification: "${title}"`,
      );

      if (tokens.length === 0) {
        return;
      }

      const payloadData: Record<string, string> = {
        type,
        title,
        body,
        targetRole: 'SUPER_ADMIN',
        ...data,
      };

      const fcmResult = await this.fcmService.sendMulticast(tokens, title, body, payloadData, {
        notificationType: type,
      });

      // 4. Cleanup invalid tokens
      if (fcmResult.invalidTokens.length > 0) {
        await this.prisma.userDeviceToken.updateMany({
          where: { token: { in: fcmResult.invalidTokens } },
          data: { isActive: false, updatedAt: new Date() },
        });
        this.logger.log(`[FCM] Invalid token removed: ${fcmResult.invalidTokens.length}`);
      }
    } catch (err: any) {
      this.logger.error(`[FCM] Error notifying admins (non-fatal): ${err?.message}`);
    }
  }
}


