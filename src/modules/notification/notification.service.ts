import { BadRequestException, Injectable, Logger, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmService, FcmSendResult } from './fcm.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService, renderEmailTemplate } from '../email/email-template.service';
import { S3Service } from '../s3/s3.service';
import { RegisterDeviceTokenDto, TestTokenDto, AdminOfferNotificationDto, UpdateOfferCampaignDto } from './dto/device-token.dto';

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
    @Optional() private readonly s3Service?: S3Service,
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
   * Delete a single notification (ensuring ownership)
   */
  async deleteNotification(
    notificationId: string,
    customerId: string | number,
    userId: string | number,
  ) {
    const numericId = parseInt(String(notificationId), 10);
    const numCustomerId = parseInt(String(customerId), 10);
    const numUserId = parseInt(String(userId), 10);

    const notif = await this.prisma.notification.findUnique({
      where: { id: numericId },
    });

    if (!notif) {
      throw new NotFoundException('Notification not found');
    }

    if (notif.customerId !== numCustomerId || notif.userId !== numUserId) {
      throw new ForbiddenException('You do not have permission to delete this notification');
    }

    return this.prisma.notification.delete({
      where: { id: numericId },
    });
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

      // Idempotency: avoid duplicate notification within 15 minutes for the same leave record
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId: emp.customerId,
          userId: emp.userId,
          type: 'LEAVE_APPROVED',
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (String(data.leaveId) === String(leave.id)) {
          return { skippedDuplicate: true };
        }
      }

      const leaveTypeName = leave.leaveType?.name || 'Leave';
      const fromStr = leave.fromDate ? new Date(leave.fromDate).toISOString().split('T')[0] : '';
      const toStr = leave.toDate ? new Date(leave.toDate).toISOString().split('T')[0] : '';
      const dateText = fromStr === toStr ? fromStr : `${fromStr} to ${toStr}`;
      const remarksText = leave.remarks || leave.approvalRemarks ? ` Remarks: ${leave.remarks || leave.approvalRemarks}` : '';
      const approverName = leave.approvedBy ? `${leave.approvedBy.firstName || ''} ${leave.approvedBy.lastName || ''}`.trim() : '';
      const approverText = approverName ? ` by ${approverName}` : '';

      const title = isHalfDay ? 'Half-Day Leave Approved' : 'Leave Request Approved';
      const body = `Your ${isHalfDay ? 'half-day ' : ''}${leaveTypeName} request for ${dateText} has been approved${approverText}.${remarksText}`;

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
          approver: approverName,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending leave approval notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Lead Assignment Push Notification (SUPPRESSED per business rules)
   * The following must remain silent:
   * Lead created -> Lead assigned -> NO notification
   * Lead reassigned -> NO notification
   * Lead owner changed -> NO notification
   */
  async sendLeadAssignedNotification(params: {
    customerId: number | string;
    employeeId?: number | string | null;
    userId?: number | string | null;
    leadId: number | string;
    leadName?: string | null;
  }) {
    // Intentionally suppressed: Lead assignment / reassignment must work normally but silently.
    this.logger.debug?.(`[FCM] Lead assignment notification suppressed for lead #${params?.leadId}`);
    return null;
  }

  /**
   * 1. DATA IMPORT -> LEAD NOTIFICATION
   * Fired ONLY after Lead data is successfully created via Data Import.
   * Notifies the appropriate existing recipient based on existing Lead assignment/ownership.
   */
  async sendLeadImportedNotification(params: {
    customerId: number | string;
    leadId: number | string;
    leadName?: string | null;
    companyName?: string | null;
    source?: string | null;
    employeeId?: number | string | null;
    userId?: number | string | null;
    createdById?: number | string | null;
  }) {
    const { customerId, leadId, leadName, companyName, source, employeeId, userId, createdById } = params;
    const numCustomerId = Number(customerId);
    const numLeadId = Number(leadId);

    try {
      // 1. Idempotency / duplicate check (within 15 minutes for this leadId)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId: numCustomerId,
          type: 'LEAD_IMPORTED',
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (String(data.leadId) === String(numLeadId)) {
          return { skippedDuplicate: true };
        }
      }

      // 2. Resolve recipient using existing Lead ownership/assignment model
      let targetUserId: number | null = userId ? Number(userId) : null;
      let targetEmployeeId: number | null = employeeId ? Number(employeeId) : null;

      if (!targetUserId && targetEmployeeId) {
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
      }

      if (!targetUserId && createdById) {
        targetUserId = Number(createdById);
      }

      if (!targetUserId) {
        const firstUser = await this.prisma.user.findFirst({
          where: { customerId: numCustomerId, deletedAt: null },
          select: { id: true },
        });
        if (firstUser) {
          targetUserId = firstUser.id;
        }
      }

      if (!targetUserId) {
        this.logger.warn(`[LEAD_IMPORT] No valid user found to notify for imported lead #${numLeadId}`);
        return null;
      }

      // 3. Prepare title and body
      const resolvedName = (leadName || '').trim() || (companyName || '').trim() || `Lead #${numLeadId}`;
      const companyPart = companyName && companyName !== resolvedName ? ` (${companyName})` : '';
      const sourcePart = source ? ` from ${source}` : '';

      const title = 'Lead Imported Successfully';
      const body = `Lead "${resolvedName}"${companyPart}${sourcePart} has been imported successfully.`;

      return await this.sendPushNotification({
        userId: targetUserId,
        customerId: numCustomerId,
        title,
        body,
        type: 'LEAD_IMPORTED',
        data: {
          type: 'LEAD_IMPORTED',
          leadId: String(numLeadId),
          leadName: resolvedName,
          companyName: companyName || '',
          source: source || 'Data Import',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending lead imported notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * 2. VISIT SCHEDULED -> VISITOR NOTIFICATION
   * Fired ONLY after Visit is successfully created and visitor assigned.
   * Recipient: ONLY the assigned Visitor/Field Officer.
   */
  async sendVisitScheduledNotification(params: {
    customerId: number | string;
    visitId: number | string;
    employeeId: number | string;
    customerName?: string | null;
    purpose?: string | null;
    date: Date | string;
    time?: string | null;
    location?: string | null;
    notes?: string | null;
    leadId?: number | string | null;
  }) {
    const { customerId, visitId, employeeId, customerName, purpose, date, time, location, notes, leadId } = params;
    const numCustomerId = Number(customerId);
    const numVisitId = Number(visitId);
    const numEmployeeId = Number(employeeId);

    try {
      // 1. Idempotency check: prevent duplicate notification within 15 minutes for the same visitId
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId: numCustomerId,
          type: 'VISIT_SCHEDULED',
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (String(data.visitId) === String(numVisitId)) {
          return { skippedDuplicate: true };
        }
      }

      // 2. Resolve assigned visitor's userId
      const emp = await this.prisma.employee.findUnique({
        where: { id: numEmployeeId },
        select: { id: true, userId: true, firstName: true, lastName: true, email: true },
      });

      let targetUserId = emp?.userId || null;
      if (!targetUserId && emp?.email) {
        const linkedUser = await this.prisma.user.findFirst({
          where: { email: emp.email, deletedAt: null },
          select: { id: true },
        });
        if (linkedUser) {
          targetUserId = linkedUser.id;
        }
      }

      if (!targetUserId) {
        this.logger.warn(`[VISIT_SCHEDULED] Visitor employee #${numEmployeeId} has no linked userId, skipping push.`);
        return null;
      }

      // 3. Format date and text
      let dateStr = '';
      if (date) {
        const d = new Date(date);
        dateStr = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : String(date);
      }
      const timeStr = time ? ` at ${time}` : '';
      const locStr = location ? ` at ${location}` : '';
      const purposeStr = purpose ? ` for ${purpose}` : '';
      const leadOrCustomer = customerName?.trim() || 'Customer';

      const title = 'New Visit Scheduled';
      const body = `New visit scheduled with ${leadOrCustomer}${purposeStr} on ${dateStr}${timeStr}${locStr}.`;

      return await this.sendPushNotification({
        userId: targetUserId,
        customerId: numCustomerId,
        title,
        body,
        type: 'VISIT_SCHEDULED',
        data: {
          type: 'VISIT_SCHEDULED',
          visitId: String(numVisitId),
          leadId: leadId ? String(leadId) : '',
          customerName: leadOrCustomer,
          purpose: purpose || '',
          date: dateStr,
          time: time || '',
          location: location || '',
          notes: notes || '',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending visit scheduled notification: ${err?.message}`, err?.stack);
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
      const endDate = subscription.endDate ? new Date(subscription.endDate).toISOString().split('T')[0] : 'today';

      const isToday = daysRemaining === 0;
      const title = isToday ? '⚠️ Your Plan Expires Today' : '⚠️ Your Plan Expires in 3 Days';
      const body = isToday
        ? `Your ${planName} plan expires today (${endDate}). Renew now to avoid service interruption.`
        : `Your ${planName} plan will expire in 3 days (${endDate}). Renew your plan to continue using QB Suite.`;
      const notifType = isToday ? 'SUBSCRIPTION_EXPIRING_TODAY' : 'SUBSCRIPTION_EXPIRING_SOON';

      const pushResult = await this.sendPushNotification({
        customerId,
        title,
        body,
        type: notifType,
        data: {
          type: 'SUBSCRIPTION',
          subscriptionId: String(subscription.id),
          customerId: String(customerId),
          planName,
          expiryDate: endDate,
          daysRemaining: String(daysRemaining),
        },
      });

      // 2. Email Plan Expiry Reminder
      try {
        if (this.emailService && this.emailTemplateService) {
          const { email, customerName, companyName } = await this.resolveCustomerEmail(customerId);
          if (email) {
            const template = await this.emailTemplateService.findByKey('PLAN_EXPIRY_REMINDER', customerId);
            const rendered = renderEmailTemplate(
              {
                subject: template?.subject || (isToday ? 'Action Required: Your {{planName}} Plan Expires Today – {{companyName}}' : 'Action Required: Your {{planName}} Plan Expires in 3 Days – {{companyName}}'),
                body: template?.body || '',
              },
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
              eventType: isToday ? 'PLAN_EXPIRY_TODAY' : 'PLAN_EXPIRY_REMINDER',
              templateId: template?.id,
            });
            this.logger.log(`[EMAIL] ${daysRemaining}-day plan expiry reminder email sent to customer #${customerId} (${email})`);
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
          this.logger.log(`[WHATSAPP] ${daysRemaining}-day plan expiry reminder WhatsApp sent to customer #${customerId}`);
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

      // Idempotency: avoid duplicate notification within 15 minutes for the same leave record
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId: emp.customerId,
          userId: emp.userId,
          type: 'LEAVE_REJECTED',
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (String(data.leaveId) === String(leave.id)) {
          return { skippedDuplicate: true };
        }
      }

      const leaveTypeName = leave.leaveType?.name || 'Leave';
      const fromStr = leave.fromDate ? new Date(leave.fromDate).toISOString().split('T')[0] : '';
      const toStr = leave.toDate ? new Date(leave.toDate).toISOString().split('T')[0] : '';
      const dateText = fromStr === toStr ? fromStr : `${fromStr} to ${toStr}`;
      const reasonText = leave.rejectionReason ? ` Reason: ${leave.rejectionReason}` : '';
      const approverName = leave.approvedBy ? `${leave.approvedBy.firstName || ''} ${leave.approvedBy.lastName || ''}`.trim() : '';
      const approverText = approverName ? ` by ${approverName}` : '';

      const title = isHalfDay ? 'Half-Day Leave Rejected' : 'Leave Request Rejected';
      const body = `Your ${isHalfDay ? 'half-day ' : ''}${leaveTypeName} request for ${dateText} has been rejected${approverText}.${reasonText}`;

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
          approver: approverName,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending leave rejection notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * 6. REMOTE WORK REQUEST APPROVAL / REJECTION
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

      // Idempotency: avoid duplicate notification within 15 minutes for the same remote request
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const notifType = approved ? 'REMOTE_WORK_APPROVED' : 'REMOTE_WORK_REJECTED';
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId: emp.customerId,
          userId: emp.userId,
          type: notifType,
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (String(data.remoteRequestId) === String(remoteRequest.id)) {
          return { skippedDuplicate: true };
        }
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
      const approverName = remoteRequest.approvedBy ? `${remoteRequest.approvedBy.firstName || ''} ${remoteRequest.approvedBy.lastName || ''}`.trim() : '';
      const approverText = approverName ? ` by ${approverName}` : '';

      const title = approved ? 'Remote Work Request Approved' : 'Remote Work Request Rejected';
      const body = `Your remote work request for ${dateText} has been ${approved ? 'approved' : 'rejected'}${approverText}.${reasonText}`;

      return await this.sendPushNotification({
        userId: emp.userId,
        customerId: emp.customerId,
        title,
        body,
        type: notifType,
        data: {
          type: 'REMOTE_WORK',
          remoteRequestId: String(remoteRequest.id),
          status: approved ? 'APPROVED' : 'REJECTED',
          dates: dateText,
          approver: approverName,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending remote-work notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * 7. EXPENSE APPROVAL / REJECTION
   * Send Expense/Claim Approval/Rejection Notification to Employee
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

      // Idempotency: avoid duplicate notification within 15 minutes for the same claim
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const notifType = approved ? 'CLAIM_APPROVED' : 'CLAIM_REJECTED';
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId: emp.customerId,
          userId: emp.userId,
          type: notifType,
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (String(data.claimId) === String(claim.id)) {
          return { skippedDuplicate: true };
        }
      }

      const category = claim.category || 'Expense';
      const amountStr =
        claim.approvedAmount != null
          ? `₹${Number(claim.approvedAmount).toLocaleString('en-IN')}`
          : claim.amount != null
            ? `₹${Number(claim.amount).toLocaleString('en-IN')}`
            : '';
      const amountText = amountStr ? ` (${amountStr})` : '';
      const approverName = claim.approvedBy ? `${claim.approvedBy.firstName || ''} ${claim.approvedBy.lastName || ''}`.trim() : '';
      const approverText = approverName ? ` by ${approverName}` : '';
      const reasonText = !approved && (claim.rejectionReason || claim.remarks) ? ` Reason: ${claim.rejectionReason || claim.remarks}` : '';

      const title = approved ? 'Expense Approved' : 'Expense Rejected';
      const body = `Your ${category} expense request #${claim.id}${amountText} has been ${approved ? 'approved' : 'rejected'}${approverText}.${reasonText}`;

      return await this.sendPushNotification({
        userId: emp.userId,
        customerId: emp.customerId,
        title,
        body,
        type: notifType,
        data: {
          type: 'CLAIM',
          claimId: String(claim.id),
          category,
          status: approved ? 'APPROVED' : 'REJECTED',
          approver: approverName,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending claim notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * 8. SALARY GENERATED -> EMPLOYEE NOTIFICATION
   * Fired when salary/payslip is successfully generated for an employee.
   * Does NOT expose sensitive salary amount in the push notification body.
   * "Your salary for September 2026 has been generated."
   */
  async sendSalaryGeneratedNotification(params: {
    customerId: number | string;
    employeeId: number | string;
    payPeriod: string;
    month?: number;
    year?: number;
    slipId?: number | string;
  }) {
    const { customerId, employeeId, payPeriod, month, year, slipId } = params;
    const numCustomerId = Number(customerId);
    const numEmployeeId = Number(employeeId);

    try {
      // 1. Idempotency: check if notification for this employee & payPeriod was already sent in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId: numCustomerId,
          type: 'SALARY_GENERATED',
          createdAt: { gte: thirtyDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (String(data.employeeId) === String(numEmployeeId) && data.payPeriod === payPeriod) {
          return { skippedDuplicate: true };
        }
      }

      // 2. Resolve employee user
      const emp = await this.prisma.employee.findUnique({
        where: { id: numEmployeeId },
        select: { id: true, userId: true, firstName: true, email: true },
      });

      let targetUserId = emp?.userId || null;
      if (!targetUserId && emp?.email) {
        const linkedUser = await this.prisma.user.findFirst({
          where: { email: emp.email, deletedAt: null },
          select: { id: true },
        });
        if (linkedUser) {
          targetUserId = linkedUser.id;
        }
      }

      if (!targetUserId) {
        this.logger.warn(`[SALARY_GENERATED] Employee #${numEmployeeId} has no linked userId, skipping push.`);
        return null;
      }

      const title = 'Salary Generated';
      const body = `Your salary for ${payPeriod} has been generated.`;

      return await this.sendPushNotification({
        userId: targetUserId,
        customerId: numCustomerId,
        title,
        body,
        type: 'SALARY_GENERATED',
        data: {
          type: 'SALARY',
          employeeId: String(numEmployeeId),
          payPeriod,
          month: month ? String(month) : '',
          year: year ? String(year) : '',
          slipId: slipId ? String(slipId) : '',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending salary generated notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * 9. CUSTOMER CALENDAR SCHEDULE -> CUSTOMER NOTIFICATION
   * Fired when a customer calendar task/appointment/schedule is successfully created.
   * Recipient is ONLY the relevant customer.
   */
  async sendCalendarScheduledNotification(params: {
    customerId: number | string;
    workId: number | string;
    title: string;
    scheduledDate?: Date | string | null;
    scheduledTime?: string | null;
    location?: string | null;
    employeeName?: string | null;
    serviceName?: string | null;
  }) {
    const { customerId, workId, title, scheduledDate, scheduledTime, location, employeeName, serviceName } = params;
    const numCustomerId = Number(customerId);
    const numWorkId = Number(workId);

    try {
      // 1. Idempotency: duplicate check within 15 minutes for this workId
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId: numCustomerId,
          type: 'CALENDAR_SCHEDULE_CREATED',
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (String(data.workId) === String(numWorkId)) {
          return { skippedDuplicate: true };
        }
      }

      let dateStr = '';
      if (scheduledDate) {
        const d = new Date(scheduledDate);
        dateStr = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : String(scheduledDate);
      }
      const timeStr = scheduledTime ? ` at ${scheduledTime}` : '';
      const empStr = employeeName ? ` with ${employeeName}` : '';
      const locStr = location ? ` at ${location}` : '';

      const notifTitle = 'New Calendar Schedule Created';
      const body = `Your schedule "${title}" has been scheduled for ${dateStr}${timeStr}${empStr}${locStr}.`;

      return await this.sendPushNotification({
        customerId: numCustomerId,
        title: notifTitle,
        body,
        type: 'CALENDAR_SCHEDULE_CREATED',
        data: {
          type: 'CALENDAR',
          workId: String(numWorkId),
          title,
          scheduledDate: dateStr,
          scheduledTime: scheduledTime || '',
          serviceName: serviceName || '',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending calendar schedule notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * 12. TASK RESCHEDULE -> PARTICULAR EMPLOYEE NOTIFICATION
   * Fired when a task assigned to an employee is rescheduled.
   * Recipient is ONLY the particular employee currently assigned to that task.
   */
  async sendTaskRescheduledNotification(params: {
    customerId: number | string;
    employeeId: number | string;
    workId: number | string;
    taskName: string;
    newDate?: Date | string | null;
    newTime?: string | null;
    customerName?: string | null;
  }) {
    const { customerId, employeeId, workId, taskName, newDate, newTime, customerName } = params;
    const numCustomerId = Number(customerId);
    const numEmployeeId = Number(employeeId);
    const numWorkId = Number(workId);

    try {
      let dateStr = '';
      if (newDate) {
        const d = new Date(newDate);
        dateStr = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : String(newDate);
      }
      const timeStr = newTime ? String(newTime).trim() : '';

      // 1. Idempotency: duplicate check within 15 minutes for this workId & newDate & newTime
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId: numCustomerId,
          type: 'TASK_RESCHEDULED',
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (
          String(data.workId) === String(numWorkId) &&
          String(data.employeeId) === String(numEmployeeId) &&
          data.newDate === dateStr &&
          data.newTime === timeStr
        ) {
          return { skippedDuplicate: true };
        }
      }

      // 2. Resolve employee userId
      const emp = await this.prisma.employee.findUnique({
        where: { id: numEmployeeId },
        select: { id: true, userId: true, email: true },
      });

      let targetUserId = emp?.userId || null;
      if (!targetUserId && emp?.email) {
        const linkedUser = await this.prisma.user.findFirst({
          where: { email: emp.email, deletedAt: null },
          select: { id: true },
        });
        if (linkedUser) {
          targetUserId = linkedUser.id;
        }
      }

      if (!targetUserId) {
        this.logger.warn(`[TASK_RESCHEDULED] Employee #${numEmployeeId} has no linked userId, skipping push.`);
        return null;
      }

      const formattedTimeStr = timeStr ? ` at ${timeStr}` : '';
      const custStr = customerName ? ` for ${customerName}` : '';

      const title = 'Task Rescheduled';
      const body = `Task "${taskName}"${custStr} has been rescheduled to ${dateStr}${formattedTimeStr}.`;

      return await this.sendPushNotification({
        userId: targetUserId,
        customerId: numCustomerId,
        title,
        body,
        type: 'TASK_RESCHEDULED',
        data: {
          type: 'WORK',
          workId: String(numWorkId),
          employeeId: String(numEmployeeId),
          taskName,
          newDate: dateStr,
          newTime: timeStr,
          customerName: customerName || '',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error sending task rescheduled notification: ${err?.message}`, err?.stack);
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
   * Send Admin Offer Notification to targeted customer(s) or employee(s), or schedule for future delivery.
   */
  async sendAdminOfferNotification(dto: AdminOfferNotificationDto, adminUserId?: number) {
    if (!dto.title || !dto.title.trim()) {
      throw new BadRequestException('Notification title is required.');
    }
    if (!dto.message || !dto.message.trim()) {
      throw new BadRequestException('Notification message is required.');
    }

    // CTA Button validation: if showCta is enabled, button text is required
    if (dto.showCta) {
      if (!dto.ctaText || !dto.ctaText.trim()) {
        throw new BadRequestException('Button text is required when CTA button is enabled.');
      }
      if (dto.ctaActionType === 'WEB_URL' && dto.ctaActionValue) {
        try {
          const parsed = new URL(dto.ctaActionValue.trim());
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol');
          }
        } catch (_) {
          throw new BadRequestException('Please provide a valid web URL (e.g. https://example.com)');
        }
      }
    }

    const isScheduled = dto.scheduledAt && new Date(dto.scheduledAt).getTime() > Date.now();
    const targetType = (dto.targetType || 'CUSTOMERS').toUpperCase();
    const audience = (dto.audience || (dto.customerId ? 'SPECIFIC' : 'ALL')).toUpperCase();
    let specificIds: number[] = [];
    if (Array.isArray(dto.targetIds) && dto.targetIds.length > 0) {
      specificIds = dto.targetIds.map(Number).filter((n) => !isNaN(n) && n > 0);
    } else if (dto.customerId) {
      specificIds = [Number(dto.customerId)];
    }

    // If future scheduled delivery is requested, save as SCHEDULED campaign
    if (isScheduled) {
      const scheduledDate = new Date(dto.scheduledAt!);
      const campaign = await this.prisma.notificationCampaign.create({
        data: {
          title: dto.title.trim(),
          message: dto.message.trim(),
          notificationType: 'OFFER',
          targetType,
          audience,
          targetIds: specificIds.length > 0 ? specificIds : null,
          imageUrl: dto.imageUrl?.trim() || null,
          showCta: Boolean(dto.showCta),
          ctaText: dto.showCta ? dto.ctaText?.trim() || null : null,
          ctaActionType: dto.showCta ? (dto.ctaActionType || 'DEEP_LINK').toUpperCase() : null,
          ctaActionValue: dto.showCta ? (dto.ctaActionValue?.trim() || dto.deepLink?.trim() || null) : null,
          scheduledAt: scheduledDate,
          status: 'SCHEDULED',
          createdById: adminUserId ? Number(adminUserId) : null,
        },
      });

      this.logger.log(
        `[OFFER_CAMPAIGN_SCHEDULED] Campaign #${campaign.id} "${dto.title}" scheduled for ${scheduledDate.toISOString()} (Target: ${targetType}, Audience: ${audience})`,
      );

      return {
        success: true,
        status: 'SCHEDULED',
        campaignId: campaign.id,
        scheduledAt: campaign.scheduledAt,
        message: `Offer notification successfully scheduled for ${scheduledDate.toLocaleString()}.`,
      };
    }

    // Immediate dispatch
    return this.dispatchOfferNotification(dto, adminUserId);
  }

  /**
   * Core dispatcher that sends rich offer notifications and creates DB in-app history
   */
  async dispatchOfferNotification(
    dto: AdminOfferNotificationDto,
    adminUserId?: number,
    existingCampaignId?: number,
  ) {
    const targetType = (dto.targetType || 'CUSTOMERS').toUpperCase();
    const audience = (dto.audience || (dto.customerId ? 'SPECIFIC' : 'ALL')).toUpperCase();
    let specificIds: number[] = [];
    if (Array.isArray(dto.targetIds) && dto.targetIds.length > 0) {
      specificIds = dto.targetIds.map(Number).filter((n) => !isNaN(n) && n > 0);
    } else if (dto.customerId) {
      specificIds = [Number(dto.customerId)];
    }

    const recipientPairs: { customerId: number; userId: number }[] = [];

    if (targetType === 'EMPLOYEES') {
      const whereClause: any = {
        status: 'ACTIVE',
        userId: { not: null },
      };
      if (audience === 'SPECIFIC' && specificIds.length > 0) {
        whereClause.id = { in: specificIds };
      }

      const employees = await this.prisma.employee.findMany({
        where: whereClause,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          customerId: true,
          userId: true,
        },
      });

      for (const emp of employees) {
        if (emp.userId) {
          recipientPairs.push({
            customerId: emp.customerId,
            userId: emp.userId,
          });
        }
      }
    } else {
      // Default: CUSTOMERS
      const whereClause: any = {
        deletedAt: null,
        isActive: true,
      };
      if (audience === 'SPECIFIC' && specificIds.length > 0) {
        whereClause.id = { in: specificIds };
      }

      const customers = await this.prisma.customer.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          users: {
            where: { deletedAt: null, isActive: true },
            select: { id: true },
          },
        },
      });

      for (const cust of customers) {
        for (const u of cust.users) {
          recipientPairs.push({
            customerId: cust.id,
            userId: u.id,
          });
        }
      }
    }

    if (recipientPairs.length === 0) {
      if (existingCampaignId) {
        await this.prisma.notificationCampaign.update({
          where: { id: existingCampaignId },
          data: { status: 'FAILED', recipientCount: 0, sentCount: 0, failedCount: 0 },
        });
      }
      return {
        success: true,
        totalTargeted: 0,
        sentCount: 0,
        failedCount: 0,
        message: `No active recipients found for target ${targetType} (${audience}).`,
      };
    }

    // Keep the stable S3 reference in campaign storage, but send a fresh
    // presigned URL so private-bucket images are accessible to FCM clients.
    const storedImageUrl = dto.imageUrl?.trim();
    const deliveryImageUrl =
      storedImageUrl && this.s3Service
        ? (await this.s3Service.getPresignedUrl(storedImageUrl, 604800)) ||
          storedImageUrl
        : storedImageUrl;

    // Build payload
    const payloadData: Record<string, string> = {
      type: 'OFFER',
      title: dto.title.trim(),
      body: dto.message.trim(),
      message: dto.message.trim(),
    };
    if (deliveryImageUrl) {
      payloadData.imageUrl = deliveryImageUrl;
    }
    if (dto.showCta) {
      payloadData.showCta = 'true';
      if (dto.ctaText?.trim()) payloadData.ctaText = dto.ctaText.trim();
      if (dto.ctaActionType) payloadData.ctaActionType = (dto.ctaActionType || 'DEEP_LINK').toUpperCase();
      const actionVal = dto.ctaActionValue?.trim() || dto.deepLink?.trim();
      if (actionVal) {
        payloadData.ctaActionValue = actionVal;
        if (dto.ctaActionType === 'DEEP_LINK' || (!dto.ctaActionType && actionVal.startsWith('/'))) {
          payloadData.route = actionVal;
        }
      }
    } else {
      payloadData.showCta = 'false';
    }
    if (dto.offerCode?.trim()) {
      payloadData.offerCode = dto.offerCode.trim();
    }

    // 1. Create in-app Notification records for all recipients
    const uniqueRecipientMap = new Map<string, { customerId: number; userId: number }>();
    for (const r of recipientPairs) {
      uniqueRecipientMap.set(`${r.customerId}_${r.userId}`, r);
    }
    const deduplicatedRecipients = Array.from(uniqueRecipientMap.values());

    const inAppNotifications = deduplicatedRecipients.map((r) => ({
      customerId: r.customerId,
      userId: r.userId,
      title: dto.title.trim(),
      message: dto.message.trim(),
      type: 'ADMIN_OFFER',
      data: payloadData as any,
      isRead: false,
    }));

    await this.prisma.notification.createMany({
      data: inAppNotifications,
    });

    // 2. Fetch active FCM device tokens for all recipient userIds
    const recipientUserIds = deduplicatedRecipients.map((r) => r.userId);
    const deviceRecords = await this.prisma.userDeviceToken.findMany({
      where: {
        userId: { in: recipientUserIds },
        isActive: true,
      },
      select: { token: true },
    });
    const tokens = Array.from(new Set(deviceRecords.map((d) => d.token.trim()).filter((t) => t.length > 0)));

    let fcmResult: FcmSendResult = {
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      messageIds: [],
    };

    if (tokens.length > 0) {
      this.logger.log(
        `[OFFER_PUSH] Dispatching rich offer push to ${tokens.length} active device(s) across ${deduplicatedRecipients.length} user(s)...`,
      );
      fcmResult = await this.fcmService.sendMulticast(
        tokens,
        dto.title.trim(),
        dto.message.trim(),
        payloadData,
        { notificationType: 'OFFER' },
      );
    } else {
      this.logger.warn(
        `[OFFER_PUSH] No active device tokens found for ${deduplicatedRecipients.length} recipients. In-app notifications stored.`,
      );
    }

    // 3. Clean up invalid tokens
    if (fcmResult.invalidTokens && fcmResult.invalidTokens.length > 0) {
      await this.prisma.userDeviceToken.updateMany({
        where: { token: { in: fcmResult.invalidTokens } },
        data: { isActive: false, updatedAt: new Date() },
      });
      this.logger.log(`Cleaned up ${fcmResult.invalidTokens.length} invalid FCM token(s).`);
    }

    // 4. Update or Create NotificationCampaign record
    let campaignId = existingCampaignId;
    if (campaignId) {
      await this.prisma.notificationCampaign.update({
        where: { id: campaignId },
        data: {
          status: 'SENT',
          recipientCount: deduplicatedRecipients.length,
          sentCount: fcmResult.successCount,
          failedCount: fcmResult.failureCount,
        },
      });
    } else {
      const createdCampaign = await this.prisma.notificationCampaign.create({
        data: {
          title: dto.title.trim(),
          message: dto.message.trim(),
          notificationType: 'OFFER',
          targetType,
          audience,
          targetIds: specificIds.length > 0 ? specificIds : null,
          imageUrl: dto.imageUrl?.trim() || null,
          showCta: Boolean(dto.showCta),
          ctaText: dto.showCta ? dto.ctaText?.trim() || null : null,
          ctaActionType: dto.showCta ? (dto.ctaActionType || 'DEEP_LINK').toUpperCase() : null,
          ctaActionValue: dto.showCta ? (dto.ctaActionValue?.trim() || dto.deepLink?.trim() || null) : null,
          status: 'SENT',
          recipientCount: deduplicatedRecipients.length,
          sentCount: fcmResult.successCount,
          failedCount: fcmResult.failureCount,
          createdById: adminUserId ? Number(adminUserId) : null,
        },
      });
      campaignId = createdCampaign.id;
    }

    this.logger.log(
      `[OFFER_CAMPAIGN_COMPLETE] Campaign #${campaignId} dispatched: ${fcmResult.successCount} sent, ${fcmResult.failureCount} failed, ${deduplicatedRecipients.length} in-app recipients`,
    );

    return {
      success: true,
      campaignId,
      totalTargeted: deduplicatedRecipients.length,
      activeDevices: tokens.length,
      sentCount: fcmResult.successCount,
      failedCount: fcmResult.failureCount,
      message: `Offer notification successfully sent to ${deduplicatedRecipients.length} recipient(s) (${fcmResult.successCount} push delivered).`,
    };
  }

  /**
   * Get paginated offer campaigns history for Admin
   */
  async getOfferCampaigns(page = 1, limit = 20) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [storedItems, total] = await Promise.all([
      this.prisma.notificationCampaign.findMany({
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notificationCampaign.count(),
    ]);

    const items = await Promise.all(
      storedItems.map(async (item) => ({
        ...item,
        imageUrl:
          item.imageUrl && this.s3Service
            ? (await this.s3Service.getPresignedUrl(item.imageUrl, 604800)) ||
              item.imageUrl
            : item.imageUrl,
      })),
    );

    return {
      items,
      pagination: {
        page: pageNum,
        pageSize: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  /**
   * Resend an existing offer campaign as a NEW broadcast.
   * Loads stored campaign configuration and reuses sendAdminOfferNotification.
   * Does not modify the original campaign record.
   */
  async resendOfferCampaign(campaignId: number, adminUserId?: number) {
    const id = Number(campaignId);
    if (!id || Number.isNaN(id)) {
      throw new BadRequestException('A valid campaign ID is required.');
    }

    const campaign = await this.prisma.notificationCampaign.findUnique({
      where: { id },
    });
    if (!campaign) {
      throw new NotFoundException('Offer notification campaign not found');
    }

    const rawIds = campaign.targetIds;
    const targetIds = Array.isArray(rawIds)
      ? rawIds.map(Number).filter((n) => !Number.isNaN(n) && n > 0)
      : undefined;

    const dto: AdminOfferNotificationDto = {
      title: campaign.title,
      message: campaign.message,
      targetType: campaign.targetType,
      audience: campaign.audience,
      targetIds: targetIds && targetIds.length > 0 ? targetIds : undefined,
      imageUrl: campaign.imageUrl || undefined,
      showCta: Boolean(campaign.showCta),
      ctaText: campaign.ctaText || undefined,
      ctaActionType: campaign.ctaActionType || undefined,
      ctaActionValue: campaign.ctaActionValue || undefined,
    };

    return this.sendAdminOfferNotification(dto, adminUserId);
  }

  /**
   * Update an existing offer notification campaign (Admin).
   * Modifies campaign configuration without altering historical recipient counts or delivery statistics.
   * Does NOT send notifications or trigger FCM.
   */
  async updateOfferCampaign(campaignId: number, dto: UpdateOfferCampaignDto) {
    const id = Number(campaignId);
    if (!id || Number.isNaN(id) || id <= 0) {
      throw new BadRequestException('A valid campaign ID is required.');
    }

    const existing = await this.prisma.notificationCampaign.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Offer notification campaign not found');
    }

    const data: any = {};

    if (dto.title !== undefined) {
      const trimmed = dto.title.trim();
      if (!trimmed) {
        throw new BadRequestException('Title cannot be empty.');
      }
      data.title = trimmed;
    }

    if (dto.message !== undefined) {
      const trimmed = dto.message.trim();
      if (!trimmed) {
        throw new BadRequestException('Message cannot be empty.');
      }
      data.message = trimmed;
    }

    if (dto.targetType !== undefined) {
      data.targetType = dto.targetType.toUpperCase();
    }

    if (dto.audience !== undefined) {
      const aud = dto.audience.toUpperCase();
      data.audience = aud;
      if (aud === 'ALL') {
        data.targetIds = null;
      }
    }

    if (dto.targetIds !== undefined && (dto.audience === 'SPECIFIC' || existing.audience === 'SPECIFIC')) {
      if (Array.isArray(dto.targetIds) && dto.targetIds.length > 0) {
        const cleanIds = dto.targetIds.map(Number).filter((n) => !Number.isNaN(n) && n > 0);
        data.targetIds = cleanIds.length > 0 ? cleanIds : null;
      } else {
        data.targetIds = null;
      }
    }

    if (dto.imageUrl !== undefined) {
      data.imageUrl = dto.imageUrl && dto.imageUrl.trim() ? dto.imageUrl.trim() : null;
    }

    if (dto.showCta !== undefined) {
      data.showCta = Boolean(dto.showCta);
      if (data.showCta) {
        if (dto.ctaText !== undefined) {
          data.ctaText = dto.ctaText?.trim() || null;
        }
        if (dto.ctaActionType !== undefined) {
          data.ctaActionType = (dto.ctaActionType || 'DEEP_LINK').toUpperCase();
        }
        if (dto.ctaActionValue !== undefined || dto.deepLink !== undefined) {
          data.ctaActionValue = dto.ctaActionValue?.trim() || dto.deepLink?.trim() || null;
        }
      } else {
        data.ctaText = null;
        data.ctaActionType = null;
        data.ctaActionValue = null;
      }
    } else {
      if (dto.ctaText !== undefined) {
        data.ctaText = dto.ctaText?.trim() || null;
      }
      if (dto.ctaActionType !== undefined) {
        data.ctaActionType = (dto.ctaActionType || 'DEEP_LINK').toUpperCase();
      }
      if (dto.ctaActionValue !== undefined || dto.deepLink !== undefined) {
        data.ctaActionValue = dto.ctaActionValue?.trim() || dto.deepLink?.trim() || null;
      }
    }

    if (dto.scheduledAt !== undefined) {
      if (dto.scheduledAt) {
        const parsedDate = new Date(dto.scheduledAt);
        if (isNaN(parsedDate.getTime())) {
          throw new BadRequestException('Invalid scheduled date format.');
        }
        data.scheduledAt = parsedDate;
      } else {
        data.scheduledAt = null;
      }
    }

    const updated = await this.prisma.notificationCampaign.update({
      where: { id },
      data,
    });

    const displayImageUrl =
      updated.imageUrl && this.s3Service
        ? (await this.s3Service.getPresignedUrl(updated.imageUrl, 604800)) ||
          updated.imageUrl
        : updated.imageUrl;

    return {
      success: true,
      message: 'Offer notification campaign updated successfully',
      data: {
        ...updated,
        imageUrl: displayImageUrl,
      },
    };
  }

  /**
   * Delete offer campaign history records by ID.
   * Follows existing in-app notification delete semantics (hard delete of the history row).
   * Does not modify FCM delivery or recipient in-app notifications.
   */
  async deleteOfferCampaigns(ids: number[]) {
    const uniqueIds = Array.from(
      new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)),
    );

    if (uniqueIds.length === 0) {
      throw new BadRequestException('At least one valid campaign ID is required.');
    }

    const existing = await this.prisma.notificationCampaign.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    const foundIds = existing.map((item) => item.id);
    const failedIds = uniqueIds.filter((id) => !foundIds.includes(id));

    if (foundIds.length > 0) {
      await this.prisma.notificationCampaign.deleteMany({
        where: { id: { in: foundIds } },
      });
    }

    const success = failedIds.length === 0;
    return {
      success,
      deletedCount: foundIds.length,
      requestedCount: uniqueIds.length,
      failedIds,
      message: success
        ? `Deleted ${foundIds.length} offer notification campaign(s).`
        : `Deleted ${foundIds.length} of ${uniqueIds.length} campaign(s). ${failedIds.length} not found.`,
    };
  }

  /**
   * Process all pending scheduled notifications (triggered by scheduler)
   */
  async processScheduledCampaigns(): Promise<number> {
    const now = new Date();
    const scheduled = await this.prisma.notificationCampaign.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: now },
      },
    });

    if (scheduled.length === 0) return 0;

    let processedCount = 0;
    for (const campaign of scheduled) {
      try {
        const dto: AdminOfferNotificationDto = {
          title: campaign.title,
          message: campaign.message,
          targetType: campaign.targetType,
          audience: campaign.audience,
          targetIds: Array.isArray(campaign.targetIds) ? (campaign.targetIds as number[]) : undefined,
          imageUrl: campaign.imageUrl || undefined,
          showCta: campaign.showCta,
          ctaText: campaign.ctaText || undefined,
          ctaActionType: campaign.ctaActionType || undefined,
          ctaActionValue: campaign.ctaActionValue || undefined,
        };

        await this.dispatchOfferNotification(dto, campaign.createdById || undefined, campaign.id);
        processedCount++;
      } catch (err: any) {
        this.logger.error(`Failed to process scheduled campaign #${campaign.id}: ${err?.message}`, err?.stack);
        await this.prisma.notificationCampaign.update({
          where: { id: campaign.id },
          data: { status: 'FAILED' },
        });
      }
    }

    return processedCount;
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
   * Notify the BPO assigned to a lead when a field visit is completed.
   */
  async sendVisitCompletedNotification(params: {
    customerId: number;
    visitId: number;
    leadId?: number | null;
    visitorName?: string | null;
    leadName?: string | null;
    purpose?: string | null;
    completedAt?: Date | string | null;
  }) {
    const { customerId, visitId, leadId, visitorName, leadName, purpose, completedAt } = params;
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const duplicate = await this.prisma.notification.findFirst({
        where: {
          customerId,
          type: 'VISIT_COMPLETED',
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        const data = (duplicate.data as any) || {};
        if (String(data.visitId) === String(visitId)) {
          return { skippedDuplicate: true };
        }
      }

      let targetUserId: number | null = null;
      let resolvedLeadName = (leadName || '').trim();

      if (leadId) {
        const lead = await this.prisma.lead.findFirst({
          where: { id: Number(leadId), customerId, deletedAt: null },
          select: {
            id: true,
            assignedToId: true,
            createdById: true,
            firstName: true,
            lastName: true,
            companyName: true,
            title: true,
          },
        });
        if (lead) {
          targetUserId = lead.assignedToId ? Number(lead.assignedToId) : null;
          if (!targetUserId && lead.createdById) {
            targetUserId = Number(lead.createdById);
          }
          if (!resolvedLeadName) {
            const fullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
            resolvedLeadName = fullName || lead.companyName || lead.title || `Lead #${lead.id}`;
          }
        }
      }

      if (!targetUserId) {
        this.logger.warn(
          `[FCM] Visit completed notification skipped — no BPO user for visitId=${visitId}, leadId=${leadId ?? 'none'}`,
        );
        return null;
      }

      const visitorLabel = (visitorName || '').trim() || 'Visitor';
      const purposePart = purpose ? ` (${purpose})` : '';
      const title = 'Visit Completed';
      const body = `${visitorLabel} completed the visit for ${resolvedLeadName || 'the lead'}${purposePart}. Status: Completed.`;

      const completionTimeStr = completedAt ? new Date(completedAt).toISOString() : new Date().toISOString();

      return await this.sendPushNotification({
        userId: targetUserId,
        customerId,
        title,
        body,
        type: 'VISIT_COMPLETED',
        data: {
          type: 'VISIT_COMPLETED',
          visitId: String(visitId),
          leadId: leadId ? String(leadId) : '',
          leadName: resolvedLeadName,
          visitorName: visitorLabel,
          status: 'COMPLETED',
          purpose: purpose || '',
          completedAt: completionTimeStr,
        },
      });
    } catch (err: any) {
      this.logger.warn(`[FCM] Visit completed notification failed: ${err?.message}`);
      return null;
    }
  }

  private async resolveBpoUserIdForCustomer(customerId: number): Promise<number | null> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        assignedEmployeeId: true,
        assignedEmployeeRel: { select: { userId: true } },
        originLead: {
          select: { assignedToId: true, createdById: true },
        },
      },
    });
    if (!customer) {
      return null;
    }

    const fromLead = customer.originLead?.assignedToId
      ? Number(customer.originLead.assignedToId)
      : null;
    if (fromLead) {
      return fromLead;
    }
    if (customer.assignedEmployeeRel?.userId) {
      return Number(customer.assignedEmployeeRel.userId);
    }
    if (customer.originLead?.createdById) {
      return Number(customer.originLead.createdById);
    }
    return null;
  }

  /**
   * Notify the relevant BPO when a customer successfully purchases a plan.
   */
  async sendPlanPurchaseBpoNotification(params: {
    customerId: number;
    subscriptionId: number;
    planId: number;
    planName: string;
    paymentId?: string | number;
    purchaseAmount?: number;
  }) {
    const { customerId, subscriptionId, planId, planName, paymentId, purchaseAmount } = params;
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const recent = await this.prisma.notification.findMany({
        where: {
          customerId,
          type: 'PLAN_PURCHASE_BPO',
          createdAt: { gte: fifteenMinutesAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      const isDuplicate = recent.some((n) => {
        const data = (n.data as any) || {};
        if (paymentId && data.paymentId && String(data.paymentId) === String(paymentId)) {
          return true;
        }
        return (
          String(data.subscriptionId) === String(subscriptionId) &&
          String(data.planId) === String(planId)
        );
      });
      if (isDuplicate) {
        return { skippedDuplicate: true };
      }

      const targetUserId = await this.resolveBpoUserIdForCustomer(customerId);
      if (!targetUserId) {
        this.logger.warn(
          `[FCM] Plan purchase BPO notification skipped — no assigned BPO for customerId=${customerId}`,
        );
        return null;
      }

      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { name: true, companyName: true },
      });
      const customerLabel = customer?.companyName || customer?.name || `Customer #${customerId}`;
      const title = 'Plan Purchased';
      const amountSuffix =
        purchaseAmount != null && purchaseAmount > 0 ? ` (₹${Math.round(purchaseAmount)})` : '';
      const body = `${customerLabel} purchased ${planName}${amountSuffix}.`;

      return await this.sendPushNotification({
        userId: targetUserId,
        customerId,
        title,
        body,
        type: 'PLAN_PURCHASE_BPO',
        data: {
          type: 'PLAN_PURCHASE_BPO',
          customerId: String(customerId),
          subscriptionId: String(subscriptionId),
          planId: String(planId),
          planName,
          paymentId: paymentId ? String(paymentId) : '',
        },
      });
    } catch (err: any) {
      this.logger.warn(`[FCM] Plan purchase BPO notification failed: ${err?.message}`);
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

      const title = 'Plan Purchase Successful';
      const body = `Your ${planName} has been purchased successfully.`;
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

      await this.sendPlanPurchaseBpoNotification({
        customerId,
        subscriptionId,
        planId,
        planName,
        paymentId,
      }).catch((bpoErr) =>
        this.logger.warn(`Failed notifying BPO of plan purchase: ${bpoErr?.message}`),
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


