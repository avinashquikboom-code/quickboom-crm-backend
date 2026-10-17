import { GoneException } from '@nestjs/common';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { NotificationService } from '../notification/notification.service';
import {
  CreateRazorpayOrderDto,
  VerifyRazorpayPaymentDto,
  SubscriptionBillingCycle,
  SendPaymentReminderDto,
} from './dto/payment.dto';
import { sanitizeSecret } from '../../common/utils/crypto.util';
import {
  IntegrationSettingsService,
  RazorpayDynamicConfig,
  maskKeyId,
} from '../integration-settings/integration-settings.service';
import { PaymentMethod,  InvoiceStatus,  } from '@prisma/client';
import { extractDeliverableQuotas } from '../../common/utils/plan-deliverable.util';
import {
  calculatePlanExpiry,
  resolvePlanSubscriptionDates,
  resolveSubscriptionActivationDate,
} from '../../common/utils/subscription-date.util';
import * as crypto from 'crypto';
const Razorpay = require('razorpay');
import { EmailService } from '../email/email.service';
import { EmailTemplateService, renderEmailTemplate } from '../email/email-template.service';
import { generateAgreementPdfBuffer } from '../../common/utils/agreement-pdf.util';
import { isUserAdminOrStaff, isUserSuperAdmin } from '../../common/utils/role.util';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InvoiceService } from '../invoice/invoice.service';
import { CommissionService } from '../commission/commission.service';
import { CouponService, CouponPriceResult } from '../subscription/coupon.service';
import {
  buildDefaultPlanLineItems,
  withInvoiceItemsSnapshot,
} from '../../common/utils/invoice-items.util';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
    private readonly workService: WorkService,
    private readonly integrationSettingsService: IntegrationSettingsService,
    @Optional() private readonly notificationService?: NotificationService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly emailTemplateService?: EmailTemplateService,
    @Optional() private readonly whatsappService?: WhatsappService,
    @Optional() private readonly invoiceService?: InvoiceService,
    @Optional() private readonly commissionService?: CommissionService,
    @Optional() private readonly couponService?: CouponService,
  ) {}

  private async pricedCoupon(params: {
    customerId?: number;
    planId: number;
    billingCycle: string;
    paymentOption?: string;
    couponCode?: string;
  }): Promise<CouponPriceResult | null> {
    const code = String(params.couponCode || '').trim();
    if (!code) return null;
    if (!this.couponService) {
      throw new BadRequestException('Coupon pricing is unavailable');
    }
    return this.couponService.quote({
      
      planId: params.planId,
      couponCode: code,
      billingCycle: params.billingCycle,
      paymentOption: params.paymentOption,
    });
  }

  /**
   * Dynamically resolves active Razorpay credentials from Database (or .env fallback)
   * without requiring Docker rebuilds or application restarts.
   */
  private async getRazorpayClient(): Promise<{ instance: any; config: RazorpayDynamicConfig }> {
    const config = await this.integrationSettingsService.getRazorpayConfig();

    const sanitizedKeyId = sanitizeSecret(config.keyId);
    const sanitizedKeySecret = sanitizeSecret(config.keySecret);

    if (!sanitizedKeyId) {
      this.logger.error('[RAZORPAY_CONFIG_ERROR] Razorpay Key ID is not configured in Database or settings.');
      throw new BadRequestException('Razorpay payment gateway is not configured.');
    }

    if (!config.isEnabled) {
      this.logger.warn('[RAZORPAY_CONFIG_WARN] Razorpay payment gateway is disabled in settings.');
      throw new BadRequestException('Razorpay payment gateway is disabled.');
    }

    if (!sanitizedKeySecret) {
      this.logger.error('[RAZORPAY_CONFIG_ERROR] Razorpay Key Secret is missing or empty.');
      throw new BadRequestException('Razorpay credentials are incomplete.');
    }

    this.logger.log(
      `[RAZORPAY_CLIENT] Payment Environment: ${config.environment} | Razorpay Key ID: ${maskKeyId(sanitizedKeyId)} | Source: ${config.source}`,
    );

    try {
      const instance = new Razorpay({
        key_id: sanitizedKeyId,
        key_secret: sanitizedKeySecret,
      });
      return {
        instance,
        config: {
          ...config,
          keyId: sanitizedKeyId,
          keySecret: sanitizedKeySecret,
        },
      };
    } catch (err: any) {
      this.logger.error(`[RAZORPAY_CLIENT_INIT_ERROR] ${err?.message}`);
      throw new BadRequestException('Could not initialize payment gateway client.');
    }
  }

  /**
   * 1. Create a Razorpay Order for a specific Plan & Billing Cycle
   */
  async createRazorpayOrder(user: any, dto: CreateRazorpayOrderDto, reqCustomerId?: number) : Promise<never> {
throw new GoneException('This Customer/Lead operation has been removed');
  }

  /**
   * 2. Verify Razorpay Payment Signature, Activate Subscription, Provision Entitlements & Generate Schedules
   */
  async verifyRazorpayPayment(user: any, dto: VerifyRazorpayPaymentDto, reqCustomerId?: number) : Promise<never> {
throw new GoneException('This Customer/Lead operation has been removed');
  }

  /**
   * 3. Handle Razorpay Webhook Event Idempotently
   */
  async handleWebhook(rawBody: string, signature: string) {
    const rzpConfig = await this.integrationSettingsService.getRazorpayConfig();
    const webhookSecret = rzpConfig.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || '';
    if (!signature) {
      throw new BadRequestException('Webhook signature required');
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature && process.env.NODE_ENV !== 'test') {
      this.logger.error('[WEBHOOK_SIGNATURE_MISMATCH] Webhook signature invalid');
      throw new BadRequestException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody);
    const event = payload?.event;
    this.logger.log(`[RAZORPAY_WEBHOOK_RECEIVED] event=${event}`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload?.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;
      const notes = paymentEntity?.notes || {};
      const customerId = Number(undefined);
      const planId = Number(notes.planId);
      const billingCycle = notes.billingCycle || 'MONTHLY';

      if (customerId && planId && paymentId && orderId) {
        // Webhook event already passed HMAC verification at entry point.
        // Use the trusted internal activation path that skips client-side signature re-check.
        try {
          await this.activateSubscriptionTrusted({
            
            planId,
            orderId,
            paymentId,
            billingCycle,
            activationDate: notes.activationDate ? String(notes.activationDate) : undefined,
          });
          const confirmedPayment = await this.prisma.paymentHistory.findFirst({ where: { paymentId,  status: 'SUCCESS', deletedAt: null } });
          if (confirmedPayment && this.commissionService) {
            await this.commissionService.calculateAndAwardCommission({  purchaseId: confirmedPayment.id, purchaseAmount: confirmedPayment.amount, planId: confirmedPayment.planId, orderId });
          }
          this.logger.log(`[WEBHOOK_ACTIVATION_SUCCESS] customerId=${customerId} planId=${planId} paymentId=${paymentId}`);
        } catch (err: any) {
          this.logger.error(`[WEBHOOK_ACTIVATION_FAILED] customerId=${customerId} paymentId=${paymentId} — ${err?.message}`);
        }
      } else {
        this.logger.warn(`[WEBHOOK_SKIP] Insufficient data in webhook notes: customerId=${customerId} planId=${planId} paymentId=${paymentId} orderId=${orderId}`);
      }
    }

    if (event === 'refund.processed' && this.commissionService) {
      const refund = payload?.payload?.refund?.entity;
      if (refund?.payment_id && refund?.id) {
        const payment = await this.prisma.paymentHistory.findFirst({ where: { paymentId: String(refund.payment_id), deletedAt: null } });
        if (payment) {
          const full = Number(refund.amount) >= Math.round(Number(payment.totalAmount ?? payment.amount) * 100);
          await this.commissionService.handleRefundOrCancellation(payment.id, undefined, String(refund.id), !full);
        }
      }
    }
    return { status: 'ok' };
  }

  /**
   * 4. Internal Trusted Activation — Webhook Only
   * Called after the webhook-level HMAC is already verified at the controller entry point.
   * Does NOT re-check client-side payment signature (that's only needed for client verify endpoint).
   */
  private async activateSubscriptionTrusted(params: {
    customerId?: number;
    planId: number;
    orderId: string;
    paymentId: string;
    billingCycle: string;
    activationDate?: string;
  }) : Promise<never> {
throw new GoneException('This Customer/Lead operation has been removed');
  }

  /**
   * Helper to dispatch Payment Success Email + WhatsApp and Invoice PDF Email + WhatsApp
   */
  async sendPaymentAndInvoiceCommunications(params: {
    customerId?: number;
    paymentId: number | string;
    amount: number | string;
    planName: string;
    transactionId?: string;
    orderId?: string;
    paymentMethod?: string;
    invoiceNo?: string | null;
  }) : Promise<never> {
throw new GoneException('This Customer/Lead operation has been removed');
  }

  /**
   * 5. Get Customer Purchase / Payment History with Receipts and Invoice status
   */
  async getPaymentHistory(user: any, reqCustomerId?: number) {
    const customerId = reqCustomerId != null && Number(reqCustomerId) > 0 ? Number(reqCustomerId) : Number(undefined);
    

    const payments = await this.prisma.paymentHistory.findMany({
      where: {  deletedAt: null },
      orderBy: { createdAt: 'desc' },
      
    });

    const activeSubTotalAmount = 0;
    const activeSubTotalPaid = 0;
    const mapped = payments.map((p) => {
      const isSuccess = p.status === 'SUCCESS';
      const receiptNo = p.invoiceUrl?.startsWith('REC-') ? p.invoiceUrl : `REC-${p.createdAt.getFullYear()}-${String(p.id).padStart(6, '0')}`;
      const subFullTotal = Number(p.totalAmount || 0);

      const isFullyPaid = isSuccess && (activeSubTotalPaid >= activeSubTotalAmount || Number(p.totalAmount || 0) >= subFullTotal);
      const invoiceUrl = isFullyPaid ? (p.invoiceUrl?.startsWith('INV-') ? p.invoiceUrl : `INV-${p.createdAt.getFullYear()}-${String(p.id).padStart(6, '0')}`) : null;
      const subscriptionStartDate = resolveSubscriptionActivationDate(p.createdAt, null);

      return {
        id: p.id,
        orderNumber: p.orderNumber || `#QB-${p.id}`,
        orderId: p.orderId,
        paymentId: p.paymentId,
        planId: p.planId || undefined,
        planName: p.planName || undefined || 'Standard Package',
        billingCycle: p.billingCycle || undefined || 'MONTHLY',
        amount: Number(p.amount),
        taxAmount: Number(p.taxAmount || 0),
        totalAmount: Number(p.totalAmount || p.amount),
        currency: p.currency || 'INR',
        paymentStatus: isSuccess ? 'PAID' : p.status,
        paymentMethod: p.paymentMethod || 'RAZORPAY',
        transactionId: p.transactionId || `TXN-${p.id}`,
        receiptNumber: receiptNo,
        isFullyPaid,
        invoiceAvailable: isFullyPaid,
        invoiceUrl,
        totalPaid: activeSubTotalPaid > 0 ? activeSubTotalPaid : Number(p.totalAmount || 0),
        balanceAmount: Math.max(0, activeSubTotalAmount - activeSubTotalPaid),
        purchaseDate: p.createdAt,
        startDate: subscriptionStartDate,
        activationDate: subscriptionStartDate,
        expiryDate: undefined,
        features: [],
      };
    });

    return {
      success: true,
      data: mapped,
    };
  }

  private assertAgreementCustomerAccess(ownerCustomerId: number, customerId?: number, user?: any) {
    if (isUserSuperAdmin(user)) return;
    if (isUserAdminOrStaff(user) && !(Number(undefined) > 0)) return;
    if (!customerId || Number(ownerCustomerId) !== Number(customerId)) {
      throw new ForbiddenException('Access to this agreement is forbidden');
    }
  }

  async downloadAgreementPdf(
    paymentId: number | string,
    customerId?: number,
    user?: any,
  ): Promise<{ buffer: Buffer; filename: string }> {
throw new GoneException('This Customer/Lead operation has been removed');
  }

  /**
   * 6. Create Offline Payment Request (Bank Transfer / Cash / Cheque)
   * Subscription and Payment are set to PENDING status until Admin approval.
   */
  async createOfflinePayment(user: any, dto: any, reqCustomerId?: number) : Promise<never> {
throw new GoneException('This Customer/Lead operation has been removed');
  }

  /**
   * 7. Send Payment Reminder Notification for Partially Paid Subscriptions
   */
  async sendPaymentReminder(adminUser: any, dto: SendPaymentReminderDto) : Promise<never> {
throw new GoneException('This Customer/Lead operation has been removed');
  }

  /**
   * Returns public, safe payment gateway settings from the Database for mobile and admin UI.
   * Single source of truth: PostgreSQL Database. Never exposes secrets.
   */
  async getPublicPaymentConfig() {
    const paymentSettings = await this.integrationSettingsService.getPaymentSettings();
    const data = paymentSettings.data;

    return {
      success: true,
      data: {
        paymentMethods: {
          online: Boolean(data.razorpayEnabled),
          offline: Boolean(data.offlinePaymentEnabled),
        },
        razorpayEnabled: Boolean(data.razorpayEnabled),
        enableRazorpay: Boolean(data.razorpayEnabled),
        offlinePaymentEnabled: Boolean(data.offlinePaymentEnabled),
        enableOfflinePayment: Boolean(data.offlinePaymentEnabled),
        paymentMode: data.paymentMode,
        razorpayKeyId: data.razorpayEnabled
          ? (data.paymentMode === 'LIVE' ? data.razorpayLiveKeyId : data.razorpayTestKeyId)
          : null,
        bankDetails: (data as any).bankDetails || {
          bankName: process.env.OFFLINE_BANK_NAME || 'HDFC Bank',
          accountNumber: process.env.OFFLINE_ACCOUNT_NUMBER || '50200088991122',
          ifscCode: process.env.OFFLINE_IFSC_CODE || 'HDFC0000240',
          accountHolderName: process.env.OFFLINE_ACCOUNT_HOLDER || 'QuickBoom Technologies Pvt Ltd',
          upiId: process.env.OFFLINE_UPI_ID || 'quickboom@upi',
          instructions: 'Transfer the amount to the bank account above and enter the UTR / Transaction Reference below.',
        },
        source: data.source,
      },
      paymentMethods: {
        online: Boolean(data.razorpayEnabled),
        offline: Boolean(data.offlinePaymentEnabled),
      },
      bankDetails: (data as any).bankDetails || {
        bankName: process.env.OFFLINE_BANK_NAME || 'HDFC Bank',
        accountNumber: process.env.OFFLINE_ACCOUNT_NUMBER || '50200088991122',
        ifscCode: process.env.OFFLINE_IFSC_CODE || 'HDFC0000240',
        accountHolderName: process.env.OFFLINE_ACCOUNT_HOLDER || 'QuickBoom Technologies Pvt Ltd',
        upiId: process.env.OFFLINE_UPI_ID || 'quickboom@upi',
        instructions: 'Transfer the amount to the bank account above and enter the UTR / Transaction Reference below.',
      },
    };
  }
}

