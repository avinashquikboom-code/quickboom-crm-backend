import { CustomerService } from '../customer/customer.service';
import { recalculateCustomer } from '../customer/customer-lifecycle.util';
import { GoneException } from '@nestjs/common';
import {
  Injectable,
  BadRequestException,
  ConflictException,
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
import { isUserAdminOrStaff, isUserSuperAdmin } from '../../common/utils/account.util';
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
  private verifySignature(expected: string, supplied: string) {
    if (
      !supplied ||
      !/^[a-f0-9]{64}$/i.test(supplied) ||
      !crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(supplied, "hex"),
      )
    )
      throw new BadRequestException("Invalid payment signature");
  }

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
    @Optional() private readonly customers?: CustomerService,
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
  async createRazorpayOrder(
    user: any,
    dto: CreateRazorpayOrderDto,
    reqCustomerId?: number,
  ) {
    if (dto.paymentOption && dto.paymentOption !== "FULL")
      throw new BadRequestException("This checkout requires full payment");
    if (
      dto.couponCode ||
      dto.activationDate ||
      (dto.currency && dto.currency !== "INR")
    )
      throw new BadRequestException("Unsupported checkout option");
    if (!dto.idempotencyKey || dto.idempotencyKey.length < 8)
      throw new BadRequestException("Idempotency key required");
    const checkout = await this.customers!.prepare(user, dto);
    const { instance, config } = await this.getRazorpayClient();
    if (checkout.orderId)
      return {
        ...checkout,
        keyId: config.keyId,
        amount: checkout.totalPaise,
        currency: "INR",
      };
    if (checkout.totalPaise <= 0)
      throw new BadRequestException(
        "Online checkout requires a positive amount",
      );
    const claimed = await this.prisma.customerCheckout.updateMany({
      where: { id: checkout.id, status: "PENDING", orderId: null },
      data: { status: "CREATING" },
    });
    if (!claimed.count)
      throw new ConflictException(
        "Order creation is in progress. Retry with the same key; contact support if it remains pending.",
      );
    // A network timeout deliberately leaves CREATING: never blindly create another gateway order.
    const order = await instance.orders.create({
      amount: checkout.totalPaise,
      currency: "INR",
      receipt: checkout.id,
      notes: { checkoutId: checkout.id },
    });
    const saved = await this.prisma.customerCheckout.update({
      where: { id: checkout.id },
      data: { orderId: order.id, status: "PENDING" },
    });
    return {
      ...saved,
      keyId: config.keyId,
      amount: saved.totalPaise,
      currency: "INR",
    };
  }

  /**
   * 2. Verify Razorpay Payment Signature, Activate Subscription, Provision Entitlements & Generate Schedules
   */
  async verifyRazorpayPayment(
    user: any,
    dto: VerifyRazorpayPaymentDto,
    reqCustomerId?: number,
  ) {
    const checkout = await this.prisma.customerCheckout.findUnique({
      where: { orderId: dto.razorpay_order_id },
    });
    if (!checkout) throw new NotFoundException("Checkout not found");
    await this.customers!.authorize(user, checkout.customerId);
    const { instance, config } = await this.getRazorpayClient();
    const expected = crypto
      .createHmac("sha256", config.keySecret)
      .update(`${checkout.orderId}|${dto.razorpay_payment_id}`)
      .digest("hex");
    this.verifySignature(expected, dto.razorpay_signature);
    const payment = await instance.payments.fetch(dto.razorpay_payment_id);
    return this.customers!.settle(checkout.orderId!, payment);
  }

  /**
   * 3. Handle Razorpay Webhook Event Idempotently
   */
  async handleWebhook(rawBody: string, signature: string) {
    const config = await this.integrationSettingsService.getRazorpayConfig();
    const secret = config.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new BadRequestException("Webhook secret not configured");
    this.verifySignature(
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex"),
      signature,
    );
    const payload = JSON.parse(rawBody);
    const entity = payload?.payload?.payment?.entity;
    if (
      ["payment.captured", "order.paid"].includes(payload.event) &&
      entity?.order_id &&
      entity?.id
    ) {
      let checkout = await this.prisma.customerCheckout.findUnique({
        where: { orderId: String(entity.order_id) },
      });
      const { instance } = await this.getRazorpayClient();
      if (!checkout) {
        // Recover a gateway order whose creation response was lost in transit.
        // Receipt and amount come from the authenticated gateway API, never callback notes.
        const order = await instance.orders.fetch(String(entity.order_id));
        const candidate = typeof order.receipt === 'string' ? await this.prisma.customerCheckout.findUnique({ where: { id: order.receipt } }) : null;
        if (candidate && candidate.status === 'CREATING' && !candidate.orderId && Number(order.amount) === candidate.totalPaise && order.currency === 'INR') {
          await this.prisma.customerCheckout.updateMany({ where: { id: candidate.id, status: 'CREATING', orderId: null }, data: { orderId: String(order.id), status: 'PENDING' } });
          checkout = await this.prisma.customerCheckout.findUnique({ where: { orderId: String(entity.order_id) } });
        }
      }
      if (checkout) {
        const payment = await instance.payments.fetch(entity.id);
        await this.customers!.settle(checkout.orderId!, payment);
      }
    }
    // Failed attempts never override a captured payment or activate a customer.
    if (payload.event === "payment.failed" && entity?.order_id) {
      await this.prisma.customerCheckout.updateMany({
        where: { orderId: String(entity.order_id), status: "PENDING" },
        data: { status: "FAILED" },
      });
    }
    if (payload.event === "refund.processed") {
      const refund = payload?.payload?.refund?.entity;
      if (refund?.payment_id && refund?.id) {
        const payment = await this.prisma.paymentHistory.findFirst({
          where: { paymentId: String(refund.payment_id), deletedAt: null },
        });
        if (payment) {
          const full =
            Number(refund.amount) >=
            Math.round(Number(payment.totalAmount ?? payment.amount) * 100);
          if (this.commissionService) {
            await this.commissionService.handleRefundOrCancellation(
              payment.id,
              undefined,
              String(refund.id),
              !full,
            );
          }
          if (full) {
            const checkout = await this.prisma.customerCheckout.findFirst({
              where: { paymentHistoryId: payment.id },
            });
            if (checkout) {
              await this.prisma.$transaction(async (tx) => {
                await tx.customerSubscription.updateMany({
                  where: {
                    checkoutId: checkout.id,
                    status: { in: ["PENDING_ACTIVATION", "ACTIVE"] },
                  },
                  data: { status: "CANCELLED" },
                });
                await recalculateCustomer(tx, checkout.customerId);
              });
            }
          }
        }
      }
    }
    return { status: "ok" };
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
    const customer = await this.customers!.authorize(user, reqCustomerId);
    return this.prisma.customerCheckout.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      include: { subscription: true },
    });
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

