import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import {
  CreateRazorpayOrderDto,
  VerifyRazorpayPaymentDto,
  SubscriptionBillingCycle,
} from './dto/payment.dto';
import { sanitizeSecret } from '../../common/utils/crypto.util';
import {
  IntegrationSettingsService,
  RazorpayDynamicConfig,
  maskKeyId,
} from '../integration-settings/integration-settings.service';
import { PaymentMethod, SubscriptionStatus } from '@prisma/client';
import * as crypto from 'crypto';
const Razorpay = require('razorpay');

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
    private readonly workService: WorkService,
    private readonly integrationSettingsService: IntegrationSettingsService,
  ) {}

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
  async createRazorpayOrder(user: any, dto: CreateRazorpayOrderDto, reqCustomerId?: number) {
    const customerId = reqCustomerId != null && Number(reqCustomerId) > 0 ? Number(reqCustomerId) : Number(user?.customerId);
    if (!customerId || isNaN(customerId)) {
      throw new ForbiddenException('User does not belong to any customer organization');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException('Customer organization not found');
    }

    // Resolve plan by numeric ID or code (e.g. BASIC, STANDARD, PREMIUM, STARTER, GROWTH, SCALE)
    let plan: any = null;
    const numPlanId = Number(dto.planId);
    if (!isNaN(numPlanId) && numPlanId > 0) {
      plan = await this.prisma.plan.findFirst({
        where: { id: numPlanId, deletedAt: null },
      });
    }

    if (!plan && dto.planId != null && String(dto.planId).trim().length > 0) {
      const codeUpper = String(dto.planId).trim().toUpperCase();
      plan = await this.prisma.plan.findFirst({
        where: {
          OR: [
            { code: codeUpper },
            {
              code:
                codeUpper === 'STARTER'
                  ? 'BASIC'
                  : codeUpper === 'GROWTH'
                  ? 'STANDARD'
                  : codeUpper === 'SCALE'
                  ? 'PREMIUM'
                  : codeUpper,
            },
          ],
          deletedAt: null,
        },
      });
    }

    if (!plan) {
      plan = await this.prisma.plan.findFirst({
        where: { deletedAt: null, isActive: true },
        orderBy: { monthlyPrice: 'asc' },
      });
    }

    if (!plan) {
      throw new NotFoundException(`Plan with ID/code ${dto.planId} not found`);
    }

    const cycle = dto.billingCycle || SubscriptionBillingCycle.MONTHLY;
    const basePrice =
      cycle === SubscriptionBillingCycle.YEARLY
        ? Number(plan.yearlyPrice)
        : Number(plan.monthlyPrice);

    const taxAmount = Math.round(basePrice * 0.18);
    const totalAmount = basePrice + taxAmount;
    const amountInPaise = Math.round(totalAmount * 100);

    const { instance: razorpayInstance, config: rzpConfig } = await this.getRazorpayClient();

    const receipt = `rcpt_${customerId}_${Date.now().toString(36)}`;
    const razorpayPayload = {
      amount: amountInPaise,
      currency: dto.currency || 'INR',
      receipt,
      notes: {
        customerId: String(customerId),
        planId: String(plan.id),
        planName: plan.name,
        billingCycle: cycle,
      },
    };

    this.logger.log('==================================================');
    this.logger.log('[RAZORPAY_ORDER_CREATE_REQUEST] Outgoing Order to Razorpay API:');
    this.logger.log(`Customer ID: ${customerId} (${customer.companyName || customer.name})`);
    this.logger.log(`Plan: ${plan.name} (ID: ${plan.id}, Code: ${plan.code})`);
    this.logger.log(`Billing Cycle: ${cycle}`);
    this.logger.log(`Base Amount: ₹${basePrice}`);
    this.logger.log(`Calculated GST (18%): ₹${taxAmount}`);
    this.logger.log(`Total Amount: ₹${totalAmount}`);
    this.logger.log(`Amount in Paise: ${amountInPaise}`);
    this.logger.log(`Payment Environment: ${rzpConfig.environment}`);
    this.logger.log(`Key ID: ${maskKeyId(rzpConfig.keyId)}`);
    this.logger.log(`Payload (Secrets omitted): ${JSON.stringify(razorpayPayload)}`);
    this.logger.log('==================================================');

    let razorpayOrderId: string;

    try {
      const order = await razorpayInstance.orders.create(razorpayPayload);
      if (!order || !order.id) {
        throw new Error('Razorpay returned an empty order response.');
      }
      razorpayOrderId = order.id;

      this.logger.log(
        `[RAZORPAY_ORDER_SUCCESS] HTTP 200/201 | Order ID: ${order.id} | Status: ${order.status} | Amount: ${order.amount} ${order.currency}`,
      );
    } catch (err: any) {
      const rzpErr = err?.error;
      const statusCode = err?.statusCode || rzpErr?.statusCode || 400;
      const errDesc = rzpErr?.description || err?.message || 'Failed to create payment order.';
      const isAuthFailed =
        errDesc.toLowerCase().includes('auth') ||
        statusCode === 401 ||
        (rzpErr?.code === 'BAD_REQUEST_ERROR' && errDesc.toLowerCase().includes('failed'));

      this.logger.error('==================================================');
      this.logger.error(`[RAZORPAY_ORDER_CREATE_FAILED] Status: ${statusCode} | Code: ${rzpErr?.code || 'UNKNOWN'}`);
      this.logger.error(`Description: ${errDesc}`);
      this.logger.error(`Environment: ${rzpConfig.environment} | Key ID: ${maskKeyId(rzpConfig.keyId)} | Source: ${rzpConfig.source}`);
      this.logger.error(`Raw Error: ${JSON.stringify(rzpErr || err?.message || err)}`);
      if (process.env.NODE_ENV !== 'production' && err?.stack) {
        this.logger.error(`Stack Trace: ${err.stack}`);
      }
      this.logger.error('==================================================');

      if (isAuthFailed) {
        throw new BadRequestException(
          `Razorpay authentication failed (${rzpConfig.environment} mode). Please configure valid Razorpay ${rzpConfig.environment} Key ID and Secret in Admin Panel Settings.`,
        );
      }

      throw new BadRequestException(
        `Razorpay order creation failed: ${errDesc}`,
      );
    }

    this.logger.log(
      `[RAZORPAY_ORDER_CREATED] orderId=${razorpayOrderId} customerId=${customerId} plan=${plan.name} amount=₹${totalAmount}`,
    );

    return {
      success: true,
      orderId: razorpayOrderId,
      amount: amountInPaise,
      totalAmountRupees: totalAmount,
      basePriceRupees: basePrice,
      taxAmountRupees: taxAmount,
      currency: dto.currency || 'INR',
      razorpayKeyId: rzpConfig.keyId,
      planId: plan.id,
      planName: plan.name,
      planCode: plan.code,
      billingCycle: cycle,
      customer: {
        id: customer.id,
        name: customer.companyName || customer.name || 'QuikBoom Customer',
        email: customer.email || user?.email || '',
        phone: customer.phone || user?.phone || '',
      },
    };
  }

  /**
   * 2. Verify Razorpay Payment Signature, Activate Subscription, Provision Entitlements & Generate Schedules
   */
  async verifyRazorpayPayment(user: any, dto: VerifyRazorpayPaymentDto, reqCustomerId?: number) {
    const customerId = reqCustomerId != null && Number(reqCustomerId) > 0 ? Number(reqCustomerId) : Number(user?.customerId);
    if (!customerId || isNaN(customerId)) {
      throw new ForbiddenException('User does not belong to any customer organization');
    }

    // Resolve plan by numeric ID or code
    let plan: any = null;
    const numPlanId = Number(dto.planId);
    if (!isNaN(numPlanId) && numPlanId > 0) {
      plan = await this.prisma.plan.findFirst({
        where: { id: numPlanId, deletedAt: null },
      });
    }

    if (!plan && dto.planId != null && String(dto.planId).trim().length > 0) {
      const codeUpper = String(dto.planId).trim().toUpperCase();
      plan = await this.prisma.plan.findFirst({
        where: {
          OR: [
            { code: codeUpper },
            {
              code:
                codeUpper === 'STARTER'
                  ? 'BASIC'
                  : codeUpper === 'GROWTH'
                  ? 'STANDARD'
                  : codeUpper === 'SCALE'
                  ? 'PREMIUM'
                  : codeUpper,
            },
          ],
          deletedAt: null,
        },
      });
    }

    if (!plan) {
      plan = await this.prisma.plan.findFirst({
        where: { deletedAt: null, isActive: true },
        orderBy: { monthlyPrice: 'asc' },
      });
    }

    if (!plan) {
      throw new NotFoundException(`Plan with ID/code ${dto.planId} not found`);
    }

    const orderId = dto.razorpay_order_id || (dto as any).orderId;
    const paymentId = dto.razorpay_payment_id || (dto as any).paymentId;
    const signature = dto.razorpay_signature || (dto as any).signature;

    this.logger.log(`[PAYMENT_VERIFY] orderId=${orderId}, paymentId=${paymentId}`);

    // Dynamically retrieve secret from IntegrationSettingsService (Database / .env)
    const rzpConfig = await this.integrationSettingsService.getRazorpayConfig();

    if (!rzpConfig.isConfigured || !rzpConfig.keyId) {
      this.logger.error('[RAZORPAY_VERIFY_ERROR] Razorpay gateway is not configured.');
      throw new BadRequestException('Razorpay payment gateway is not configured.');
    }

    if (!rzpConfig.isEnabled) {
      this.logger.error('[RAZORPAY_VERIFY_ERROR] Razorpay gateway is disabled.');
      throw new BadRequestException('Razorpay payment gateway is disabled.');
    }

    const keySecret = rzpConfig.keySecret;
    if (!keySecret) {
      this.logger.error('[RAZORPAY_VERIFY_ERROR] Razorpay Key Secret not configured in Database or .env — cannot verify signature.');
      throw new BadRequestException('Razorpay credentials are incomplete.');
    }

    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${dto.razorpay_order_id}|${dto.razorpay_payment_id}`)
      .digest('hex');

    // Only accept real HMAC match. No bypass in production.
    const isSignatureValid = generatedSignature === dto.razorpay_signature;

    if (!isSignatureValid) {
      this.logger.error(
        `[RAZORPAY_SIGNATURE_MISMATCH] orderId=${dto.razorpay_order_id} paymentId=${dto.razorpay_payment_id} — signature did not match`,
      );
      throw new BadRequestException('Payment signature verification failed. Transaction rejected.');
    }

    this.logger.log(
      `[RAZORPAY_SIGNATURE_VERIFIED] Payment Environment: ${rzpConfig.environment} | Order ID: ${dto.razorpay_order_id} | Payment ID: ${dto.razorpay_payment_id}`,
    );

    this.logger.log(`[SUBSCRIPTION_ACTIVATE] customerId=${customerId}, planId=${plan.id}`);

    const cycle = dto.billingCycle || SubscriptionBillingCycle.MONTHLY;
    const basePrice =
      cycle === SubscriptionBillingCycle.YEARLY
        ? Number(plan.yearlyPrice)
        : Number(plan.monthlyPrice);
    const tax = Math.round(basePrice * 0.18);
    const total = basePrice + tax;

    const startDate = new Date();
    const expiryDate = new Date(startDate);
    if (cycle === SubscriptionBillingCycle.YEARLY) {
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    } else {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
    }

    const orderNumber = `#QB-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const transactionId = `TXN-${dto.razorpay_payment_id}`;

    // Execute atomic transaction for payment, subscription, and entitlements
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create or verify PaymentHistory record (Idempotent check)
      let payment = await tx.paymentHistory.findFirst({
        where: {
          paymentId: dto.razorpay_payment_id,
          customerId,
        },
      });

      if (!payment) {
        payment = await tx.paymentHistory.create({
          data: {
            customerId,
            planId: plan.id,
            planName: plan.name,
            orderNumber,
            orderId: dto.razorpay_order_id,
            paymentId: dto.razorpay_payment_id,
            billingCycle: cycle as any,
            amount: basePrice,
            taxAmount: tax,
            totalAmount: total,
            status: 'SUCCESS',
            paymentMethod: PaymentMethod.RAZORPAY,
            transactionId,
          },
        });
      }

      // 2. Create or update CustomerSubscription
      let sub = await tx.customerSubscription.findFirst({
        where: { customerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      if (sub) {
        sub = await tx.customerSubscription.update({
          where: { id: sub.id },
          data: {
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            billingCycle: cycle as any,
            startDate,
            endDate: expiryDate,
            duration: cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1,
            durationUnit: 'MONTH',
            autoRenew: true,
          },
          include: { plan: true },
        });
      } else {
        sub = await tx.customerSubscription.create({
          data: {
            customerId,
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            billingCycle: cycle as any,
            startDate,
            endDate: expiryDate,
            duration: cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1,
            durationUnit: 'MONTH',
            autoRenew: true,
          },
          include: { plan: true },
        });
      }

      // Link payment to subscription
      await tx.paymentHistory.update({
        where: { id: payment.id },
        data: { subscriptionId: sub.id },
      });

      // 3. Provision Plan Entitlements based on Plan Code & Features
      const planCodeUpper = (plan.code || '').toUpperCase();
      const planNameUpper = (plan.name || '').toUpperCase();
      const serviceQuotas: { serviceName: string; totalQty: number }[] = [];

      if (planCodeUpper.includes('BASIC') || planNameUpper.includes('BASIC') || planNameUpper.includes('STARTER')) {
        serviceQuotas.push(
          { serviceName: 'Reels', totalQty: 4 },
          { serviceName: 'Creative Posts', totalQty: 3 },
          { serviceName: 'Influencer Promotion', totalQty: 1 },
          { serviceName: 'Stories', totalQty: 3 },
        );
      } else if (planCodeUpper.includes('STANDARD') || planNameUpper.includes('STANDARD') || planNameUpper.includes('GROWTH')) {
        serviceQuotas.push(
          { serviceName: 'Reels', totalQty: 6 },
          { serviceName: 'Creative Posts', totalQty: 4 },
          { serviceName: 'Influencer Promotions', totalQty: 2 },
          { serviceName: 'Stories', totalQty: 5 },
        );
      } else if (planCodeUpper.includes('PREMIUM') || planNameUpper.includes('PREMIUM') || planNameUpper.includes('SCALE')) {
        serviceQuotas.push(
          { serviceName: 'Product Reels', totalQty: 2 },
          { serviceName: 'Influencer Reels', totalQty: 8 },
          { serviceName: 'Creative Posts', totalQty: 8 },
          { serviceName: 'Stories', totalQty: 30 },
        );
      } else {
        const featureList = Array.isArray(plan.features) ? plan.features : [];
        for (const item of featureList) {
          const text = typeof item === 'string' ? item : ((item as any)?.name || (item as any)?.title || '');
          const match = text.match(/^(\d+)\s+(.+)$/i);
          if (match) {
            const qty = parseInt(match[1], 10);
            let name = match[2].trim();
            name = name.replace(/\s*\(total\s+\d+\s+reels\)/i, '').trim();
            serviceQuotas.push({ serviceName: name, totalQty: qty });
          }
        }
        if (!serviceQuotas.some((s) => s.serviceName.toLowerCase().includes('reel'))) {
          serviceQuotas.push({ serviceName: 'Reels', totalQty: 4 });
        }
        if (!serviceQuotas.some((s) => s.serviceName.toLowerCase().includes('post') || s.serviceName.toLowerCase().includes('creative'))) {
          serviceQuotas.push({ serviceName: 'Creative Posts', totalQty: 3 });
        }
        if (!serviceQuotas.some((s) => s.serviceName.toLowerCase().includes('story') || s.serviceName.toLowerCase().includes('stories'))) {
          serviceQuotas.push({ serviceName: 'Stories', totalQty: 3 });
        }
        if (!serviceQuotas.some((s) => s.serviceName.toLowerCase().includes('influencer'))) {
          serviceQuotas.push({ serviceName: 'Influencer Promotion', totalQty: 1 });
        }
      }

      for (const sq of serviceQuotas) {
        const existingEnt = await tx.planEntitlement.findFirst({
          where: { customerId, serviceName: sq.serviceName },
        });
        if (existingEnt) {
          await tx.planEntitlement.update({
            where: { id: existingEnt.id },
            data: {
              planId: plan.id,
              totalQty: sq.totalQty,
              validUntil: expiryDate,
            },
          });
        } else {
          await tx.planEntitlement.create({
            data: {
              customerId,
              planId: plan.id,
              serviceName: sq.serviceName,
              totalQty: sq.totalQty,
              usedQty: 0,
              scheduledQty: 0,
              validUntil: expiryDate,
            },
          });
        }
      }

      return { payment, subscription: sub };
    });

    // 4. Trigger Automatic Schedule Generation asynchronously
    try {
      await this.scheduleService.generateSchedulesForSubscription(result.subscription.id);
      await this.workService.generatePlanSchedules(customerId);
    } catch (schedErr: any) {
      this.logger.warn(`[AUTO_SCHEDULE_WARNING] Schedule generation notice: ${schedErr?.message}`);
    }

    this.logger.log(
      `[PAYMENT_VERIFIED_SUCCESS] customerId=${customerId} plan=${plan.name} paymentId=${dto.razorpay_payment_id}`,
    );

    return {
      success: true,
      message: 'Payment verified and plan subscription activated successfully!',
      data: {
        order: {
          id: result.payment.id,
          orderNumber: result.payment.orderNumber,
          orderId: result.payment.orderId,
          paymentId: result.payment.paymentId,
          planId: plan.id,
          planName: plan.name,
          billingCycle: cycle,
          amount: basePrice,
          taxAmount: tax,
          totalAmount: total,
          currency: 'INR',
          paymentStatus: 'PAID',
          paymentMethod: 'RAZORPAY',
          transactionId,
          purchaseDate: startDate,
          activationDate: startDate,
          expiryDate,
          features: plan.features,
        },
        subscription: {
          id: result.subscription.id,
          customerId: result.subscription.customerId,
          planId: plan.id,
          planName: plan.name,
          planCode: plan.code,
          status: 'ACTIVE',
          billingCycle: cycle,
          startDate,
          endDate: expiryDate,
          price: basePrice,
          userLimit: plan.userLimit,
          leadLimit: plan.leadLimit,
          features: plan.features,
          isExpired: false,
        },
      },
    };
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
      const customerId = Number(notes.customerId);
      const planId = Number(notes.planId);
      const billingCycle = notes.billingCycle || 'MONTHLY';

      if (customerId && planId && paymentId && orderId) {
        // Webhook event already passed HMAC verification at entry point.
        // Use the trusted internal activation path that skips client-side signature re-check.
        try {
          await this.activateSubscriptionTrusted({
            customerId,
            planId,
            orderId,
            paymentId,
            billingCycle,
          });
          this.logger.log(`[WEBHOOK_ACTIVATION_SUCCESS] customerId=${customerId} planId=${planId} paymentId=${paymentId}`);
        } catch (err: any) {
          this.logger.error(`[WEBHOOK_ACTIVATION_FAILED] customerId=${customerId} paymentId=${paymentId} — ${err?.message}`);
        }
      } else {
        this.logger.warn(`[WEBHOOK_SKIP] Insufficient data in webhook notes: customerId=${customerId} planId=${planId} paymentId=${paymentId} orderId=${orderId}`);
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
    customerId: number;
    planId: number;
    orderId: string;
    paymentId: string;
    billingCycle: string;
  }) {
    const { customerId, planId, orderId, paymentId, billingCycle } = params;

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId, deletedAt: null },
    });
    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    const cycle = (billingCycle as SubscriptionBillingCycle) || SubscriptionBillingCycle.MONTHLY;
    const basePrice = cycle === SubscriptionBillingCycle.YEARLY ? Number(plan.yearlyPrice) : Number(plan.monthlyPrice);
    const tax = Math.round(basePrice * 0.18);
    const total = basePrice + tax;

    const startDate = new Date();
    const expiryDate = new Date(startDate);
    if (cycle === SubscriptionBillingCycle.YEARLY) {
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    } else {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
    }

    const orderNumber = `#QB-WH-${Date.now().toString(36).toUpperCase()}`;
    const transactionId = `TXN-${paymentId}`;

    await this.prisma.$transaction(async (tx) => {
      // Idempotency: skip if payment already processed
      const existing = await tx.paymentHistory.findFirst({
        where: { paymentId, customerId },
      });
      if (existing) {
        this.logger.log(`[WEBHOOK_IDEMPOTENT] Payment ${paymentId} already processed. Skipping duplicate activation.`);
        return;
      }

      const payment = await tx.paymentHistory.create({
        data: {
          customerId,
          planId: plan.id,
          planName: plan.name,
          orderNumber,
          orderId,
          paymentId,
          billingCycle: cycle as any,
          amount: basePrice,
          taxAmount: tax,
          totalAmount: total,
          status: 'SUCCESS',
          paymentMethod: PaymentMethod.RAZORPAY,
          transactionId,
        },
      });

      let sub = await tx.customerSubscription.findFirst({
        where: { customerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      if (sub) {
        sub = await tx.customerSubscription.update({
          where: { id: sub.id },
          data: {
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            billingCycle: cycle as any,
            startDate,
            endDate: expiryDate,
            duration: cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1,
            durationUnit: 'MONTH',
            autoRenew: true,
          },
          include: { plan: true },
        });
      } else {
        sub = await tx.customerSubscription.create({
          data: {
            customerId,
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            billingCycle: cycle as any,
            startDate,
            endDate: expiryDate,
            duration: cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1,
            durationUnit: 'MONTH',
            autoRenew: true,
          },
          include: { plan: true },
        });
      }

      await tx.paymentHistory.update({ where: { id: payment.id }, data: { subscriptionId: sub.id } });
    });

    this.logger.log(`[TRUSTED_ACTIVATION_DONE] customerId=${customerId} planId=${planId} paymentId=${paymentId}`);
  }

  /**
   * 5. Get Customer Purchase / Payment History
   */

  async getPaymentHistory(user: any, reqCustomerId?: number) {
    const customerId = reqCustomerId != null && Number(reqCustomerId) > 0 ? Number(reqCustomerId) : Number(user?.customerId);
    if (!customerId || isNaN(customerId)) {
      throw new ForbiddenException('User does not belong to any customer organization');
    }

    const payments = await this.prisma.paymentHistory.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { subscription: { include: { plan: true } } },
    });

    return {
      success: true,
      data: payments.map((p) => ({
        id: p.id,
        orderNumber: p.orderNumber || `#QB-${p.id}`,
        orderId: p.orderId,
        paymentId: p.paymentId,
        planId: p.planId || p.subscription?.planId,
        planName: p.planName || p.subscription?.plan?.name || 'Standard Package',
        billingCycle: p.billingCycle || p.subscription?.billingCycle || 'MONTHLY',
        amount: Number(p.amount),
        taxAmount: Number(p.taxAmount || 0),
        totalAmount: Number(p.totalAmount || p.amount),
        currency: p.currency || 'INR',
        paymentStatus: p.status === 'SUCCESS' ? 'PAID' : p.status,
        paymentMethod: p.paymentMethod || 'RAZORPAY',
        transactionId: p.transactionId || `TXN-${p.id}`,
        purchaseDate: p.createdAt,
        activationDate: p.createdAt,
        expiryDate: p.subscription?.endDate,
        features: p.subscription?.plan?.features || [],
      })),
    };
  }

  /**
   * 3. Create Offline Payment Request (Bank Transfer / Cash / Cheque)
   * Subscription and Payment are set to PENDING status until Admin approval.
   */
  async createOfflinePayment(user: any, dto: any, reqCustomerId?: number) {
    const customerId = reqCustomerId != null && Number(reqCustomerId) > 0 ? Number(reqCustomerId) : Number(user?.customerId);
    if (!customerId || isNaN(customerId)) {
      throw new ForbiddenException('User does not belong to any customer organization');
    }

    // Verify if offline payments are enabled in the database
    const publicConfig = await this.getPublicPaymentConfig();
    if (!publicConfig.data.offlinePaymentEnabled) {
      throw new BadRequestException('Offline payment is currently disabled by Admin.');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer organization #${customerId} not found`);
    }

    // Resolve plan
    let plan: any = null;
    const numPlanId = Number(dto.planId);
    if (!isNaN(numPlanId) && numPlanId > 0) {
      plan = await this.prisma.plan.findFirst({
        where: { id: numPlanId, deletedAt: null },
      });
    }

    if (!plan && dto.planId != null) {
      const codeUpper = String(dto.planId).trim().toUpperCase();
      plan = await this.prisma.plan.findFirst({
        where: {
          OR: [
            { code: codeUpper },
            {
              code:
                codeUpper === 'STARTER'
                  ? 'BASIC'
                  : codeUpper === 'GROWTH'
                  ? 'STANDARD'
                  : codeUpper === 'SCALE'
                  ? 'PREMIUM'
                  : codeUpper,
            },
          ],
          deletedAt: null,
        },
      });
    }

    if (!plan) {
      throw new NotFoundException(`Plan with ID/code ${dto.planId} not found`);
    }

    const cycle = dto.billingCycle || SubscriptionBillingCycle.MONTHLY;
    const basePrice = cycle === SubscriptionBillingCycle.YEARLY ? Number(plan.yearlyPrice) : Number(plan.monthlyPrice);
    const taxAmount = Math.round(basePrice * 0.18);
    const totalAmount = basePrice + taxAmount;

    const startDate = new Date();
    const expiryDate = new Date(startDate);
    if (cycle === SubscriptionBillingCycle.YEARLY) {
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    } else {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
    }

    const orderNumber = `#QB-OFFLINE-${Date.now().toString(36).toUpperCase()}`;

    // Create Subscription with status PENDING
    const subscription = await this.prisma.customerSubscription.create({
      data: {
        customerId,
        planId: plan.id,
        status: SubscriptionStatus.PENDING,
        startDate,
        endDate: expiryDate,
        billingCycle: cycle,
        customUserLimit: plan.userLimit,
        customLeadLimit: plan.leadLimit,
        customStorageLimit: plan.storageLimit,
      },
    });

    // Create PaymentHistory with status PENDING
    const paymentMethodEnum =
      dto.paymentMethod === 'CASH'
        ? PaymentMethod.CASH
        : dto.paymentMethod === 'OTHER'
        ? PaymentMethod.OTHER
        : PaymentMethod.BANK_TRANSFER;

    const payment = await this.prisma.paymentHistory.create({
      data: {
        customerId,
        subscriptionId: subscription.id,
        amount: basePrice,
        taxAmount,
        totalAmount,
        currency: 'INR',
        paymentMethod: paymentMethodEnum,
        paymentId: dto.referenceNumber || `OFFLINE-${Date.now()}`,
        orderId: orderNumber,
        status: 'PENDING',
        orderNumber,
        planId: plan.id,
        planName: plan.name,
        billingCycle: cycle,
        transactionId: dto.referenceNumber || dto.notes || 'OFFLINE_PENDING',
      },
    });

    this.logger.log(
      `[OFFLINE_PAYMENT_REQUESTED] customerId=${customerId} plan=${plan.name} total=₹${totalAmount} subId=${subscription.id} orderNumber=${orderNumber}`,
    );

    return {
      success: true,
      message: 'Offline payment request submitted successfully and is pending Admin approval.',
      orderNumber,
      subscriptionId: subscription.id,
      paymentId: payment.id,
      totalAmountRupees: totalAmount,
      currency: 'INR',
      paymentStatus: 'PENDING',
      subscriptionStatus: 'PENDING',
      customer: {
        id: customer.id,
        name: customer.companyName || customer.name || 'QuikBoom Customer',
      },
    };
  }

  /**
   * Returns public, safe payment gateway settings from the Database for mobile and admin UI.
   * Single source of truth: PostgreSQL Database. Never exposes secrets.
   */
  async getPublicPaymentConfig() {
    const rzpConfig = await this.integrationSettingsService.getRazorpayConfig();
    const rawConf = await this.integrationSettingsService.getIntegrationConfig('RAZORPAY');
    const config = rawConf?.config || {};

    const razorpayEnabled = Boolean(rzpConfig.isEnabled && rzpConfig.isConfigured);
    const offlinePaymentEnabled = Boolean(config.enableOfflinePayment ?? false);

    return {
      success: true,
      data: {
        razorpayEnabled,
        enableRazorpay: razorpayEnabled, // Alias for backward compatibility
        offlinePaymentEnabled,
        enableOfflinePayment: offlinePaymentEnabled, // Alias for backward compatibility
        paymentMode: rzpConfig.environment,
        razorpayKeyId: rzpConfig.isEnabled ? rzpConfig.keyId : null,
        source: rzpConfig.source,
      },
    };
  }
}
