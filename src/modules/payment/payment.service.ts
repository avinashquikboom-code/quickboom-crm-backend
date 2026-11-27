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
import { PaymentMethod, SubscriptionStatus, InvoiceStatus, InstallmentStatus } from '@prisma/client';
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
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InvoiceService } from '../invoice/invoice.service';
import { CommissionService } from '../commission/commission.service';

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

    this.logger.log(`[PLAN_API_DEBUG]\nendpoint: /payments/razorpay/order\ncustomerId: ${customerId}\nrequestedPlanId: ${dto.planId}`);

    const proposalCtx = dto.proposalId
      ? await this.resolveProposalForPayment(customerId, dto.proposalId)
      : null;

    // Resolve plan by numeric ID or code (e.g. BASIC, STANDARD, PREMIUM)
    let plan: any = null;
    const requestedPlanRef = proposalCtx?.planId ?? dto.planId;
    const numPlanId = Number(requestedPlanRef);
    if (!isNaN(numPlanId) && numPlanId > 0) {
      plan = await this.prisma.plan.findFirst({
        where: { id: numPlanId, deletedAt: null, isActive: true },
      });
    }

    if (!plan && requestedPlanRef != null && String(requestedPlanRef).trim().length > 0) {
      const codeUpper = String(requestedPlanRef).trim().toUpperCase();
      plan = await this.prisma.plan.findFirst({
        where: {
          code: codeUpper,
          deletedAt: null,
          isActive: true,
        },
      });
    }

    if (!plan && proposalCtx) {
      plan = await this.prisma.plan.findFirst({
        where: { deletedAt: null, isActive: true },
        orderBy: { id: 'asc' },
      });
    }

    this.logger.log(`[PLAN_API_DEBUG]\ndatabaseResult: ${plan ? `Plan #${plan.id} (${plan.name}, active=${plan.isActive})` : 'NULL'}`);

    if (!plan) {
      throw new BadRequestException('This subscription plan is no longer available. Please refresh the plans.');
    }

    const cycle = proposalCtx?.billingCycle || dto.billingCycle || SubscriptionBillingCycle.MONTHLY;
    const fullBasePrice = proposalCtx
      ? proposalCtx.agreedPrice
      : cycle === SubscriptionBillingCycle.YEARLY
        ? Number(plan.yearlyPrice)
        : Number(plan.monthlyPrice);

    const fullTaxAmount = Math.round(fullBasePrice * 0.18);
    const fullTotalAmount = fullBasePrice + fullTaxAmount;

    // Determine payment option: FULL (100%), ADVANCE (50%), or BALANCE (remaining)
    const paymentOption = (dto.paymentOption || 'FULL').toUpperCase();
    let basePrice = fullBasePrice;
    let taxAmount = fullTaxAmount;
    let totalAmount = fullTotalAmount;

    if (paymentOption === 'ADVANCE' || paymentOption === 'HALF') {
      totalAmount = Math.round(fullTotalAmount * 0.5);
      taxAmount = Math.round(fullTaxAmount * 0.5);
      basePrice = totalAmount - taxAmount;
    } else if (paymentOption === 'BALANCE') {
      // Find existing successful payments for this customer's active subscription
      const successfulPayments = await this.prisma.paymentHistory.findMany({
        where: { customerId, status: 'SUCCESS' },
      });
      const previousTotalPaid = successfulPayments.reduce((s, p) => s + Number(p.totalAmount || 0), 0);
      totalAmount = Math.max(0, fullTotalAmount - previousTotalPaid);
      taxAmount = Math.round(totalAmount - (totalAmount / 1.18));
      basePrice = totalAmount - taxAmount;
    }

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
        planName: proposalCtx?.planName || plan.name,
        billingCycle: cycle,
        paymentOption,
        ...(proposalCtx ? { proposalId: String(proposalCtx.proposalId) } : {}),
        ...(dto.activationDate ? { activationDate: String(dto.activationDate) } : {}),
      },
    };

    this.logger.log('==================================================');
    this.logger.log('[RAZORPAY_ORDER_CREATE_REQUEST] Outgoing Order to Razorpay API:');
    this.logger.log(`Customer ID: ${customerId} (${customer.companyName || customer.name})`);
    this.logger.log(`Plan: ${plan.name} (ID: ${plan.id}, Code: ${plan.code})`);
    this.logger.log(`Billing Cycle: ${cycle} | Payment Option: ${paymentOption}`);
    this.logger.log(`Full Plan Total: ₹${fullTotalAmount} | Charged Amount: ₹${totalAmount}`);
    this.logger.log(`Payment Environment: ${rzpConfig.environment}`);
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
      `[PAYMENT_CREATE] orderId: ${razorpayOrderId} customerId: CUST-${customerId} totalAmount: ${fullTotalAmount} paymentType: ${paymentOption} calculatedAmount: ${totalAmount}`,
    );

    return {
      success: true,
      orderId: razorpayOrderId,
      amount: amountInPaise,
      totalAmountRupees: totalAmount,
      fullPlanAmountRupees: fullTotalAmount,
      basePriceRupees: basePrice,
      taxAmountRupees: taxAmount,
      paymentOption,
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
    let customerId = reqCustomerId != null && Number(reqCustomerId) > 0 ? Number(reqCustomerId) : Number(user?.customerId);
    if ((!customerId || isNaN(customerId)) && user?.id) {
      const cust = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { users: { some: { id: Number(user.id) } } },
            { employees: { some: { userId: Number(user.id) } } },
          ],
        },
        select: { id: true },
      });
      if (cust) {
        customerId = cust.id;
      }
    }
    if (!customerId || isNaN(customerId)) {
      throw new ForbiddenException('User does not belong to any customer organization');
    }

    this.logger.log(`[PLAN_API_DEBUG]\nendpoint: /payments/razorpay/verify\ncustomerId: ${customerId}\nplanId: ${dto.planId}\nproposalId: ${dto.proposalId ?? 'NONE'}`);

    const proposalCtx = dto.proposalId
      ? await this.resolveProposalForPayment(customerId, dto.proposalId, true)
      : null;

    // Resolve plan by numeric ID or code
    let plan: any = null;
    const requestedPlanRef = proposalCtx?.planId ?? dto.planId;
    const numPlanId = Number(requestedPlanRef);
    if (!isNaN(numPlanId) && numPlanId > 0) {
      plan = await this.prisma.plan.findFirst({
        where: { id: numPlanId, deletedAt: null, isActive: true },
      });
    }

    if (!plan && requestedPlanRef != null && String(requestedPlanRef).trim().length > 0) {
      const codeUpper = String(requestedPlanRef).trim().toUpperCase();
      plan = await this.prisma.plan.findFirst({
        where: {
          code: codeUpper,
          deletedAt: null,
          isActive: true,
        },
      });
    }

    if (!plan && proposalCtx) {
      plan = await this.prisma.plan.findFirst({
        where: { deletedAt: null, isActive: true },
        orderBy: { id: 'asc' },
      });
    }

    if (!plan) {
      throw new BadRequestException('This subscription plan is no longer available. Please refresh the plans.');
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

    const cycle = proposalCtx?.billingCycle || dto.billingCycle || SubscriptionBillingCycle.MONTHLY;
    const fullBasePrice = proposalCtx
      ? proposalCtx.agreedPrice
      : cycle === SubscriptionBillingCycle.YEARLY
        ? Number(plan.yearlyPrice)
        : Number(plan.monthlyPrice);
    const fullTaxAmount = Math.round(fullBasePrice * 0.18);
    const fullTotalAmount = fullBasePrice + fullTaxAmount;

    // Calculate charged amount based on payment option
    const paymentOption = (dto.paymentOption || 'FULL').toUpperCase();
    let chargedBase = fullBasePrice;
    let chargedTax = fullTaxAmount;
    let chargedTotal = fullTotalAmount;

    if (paymentOption === 'ADVANCE' || paymentOption === 'HALF') {
      chargedTotal = Math.round(fullTotalAmount * 0.5);
      chargedTax = Math.round(fullTaxAmount * 0.5);
      chargedBase = chargedTotal - chargedTax;
    } else if (paymentOption === 'BALANCE') {
      const priorPayments = await this.prisma.paymentHistory.findMany({
        where: { customerId, status: 'SUCCESS' },
      });
      const priorTotal = priorPayments.reduce((s, p) => s + Number(p.totalAmount || 0), 0);
      chargedTotal = Math.max(0, fullTotalAmount - priorTotal);
      chargedTax = Math.round(chargedTotal - (chargedTotal / 1.18));
      chargedBase = chargedTotal - chargedTax;
    }

    const durationMonths = cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1;
    const requestedActivation = dto.activationDate ?? (dto as any).startDate;
    let startDate: Date;
    let expiryDate: Date;

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
            planName: proposalCtx?.planName || plan.name,
            orderNumber,
            orderId: dto.razorpay_order_id,
            paymentId: dto.razorpay_payment_id,
            billingCycle: cycle as any,
            amount: chargedBase,
            taxAmount: chargedTax,
            totalAmount: chargedTotal,
            status: 'SUCCESS',
            paymentMethod: PaymentMethod.RAZORPAY,
            transactionId,
          },
        });
      }

      const subscriptionDates = resolvePlanSubscriptionDates(
        payment.createdAt,
        durationMonths,
        requestedActivation,
      );
      startDate = subscriptionDates.startDate;
      expiryDate = subscriptionDates.endDate;

      // 2. Create or update CustomerSubscription (Active so work starts on 50% advance)
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
            customPrice: proposalCtx ? proposalCtx.agreedPrice : null,
            customFeatures: proposalCtx ? (proposalCtx.effectiveFeatures as any) : null,
            customUserLimit: proposalCtx?.userLimit ?? null,
            customLeadLimit: proposalCtx?.leadLimit ?? null,
            customStorageLimit: proposalCtx?.storageLimitBytes != null ? BigInt(proposalCtx.storageLimitBytes) : null,
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
            customPrice: proposalCtx ? proposalCtx.agreedPrice : null,
            customFeatures: proposalCtx ? (proposalCtx.effectiveFeatures as any) : null,
            customUserLimit: proposalCtx?.userLimit ?? null,
            customLeadLimit: proposalCtx?.leadLimit ?? null,
            customStorageLimit: proposalCtx?.storageLimitBytes != null ? BigInt(proposalCtx.storageLimitBytes) : null,
          },
          include: { plan: true },
        });
      }

      // Ensure any older/other active subscriptions for this customer are marked EXPIRED
      await tx.customerSubscription.updateMany({
        where: {
          customerId,
          id: { not: sub.id },
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
        },
        data: {
          status: SubscriptionStatus.EXPIRED,
        },
      });

      // 3. Generate Receipt for this payment
      const receiptNo = `REC-${startDate.getFullYear()}-${String(payment.id).padStart(6, '0')}`;

      // Link payment to subscription & attach receipt number
      await tx.paymentHistory.update({
        where: { id: payment.id },
        data: {
          subscriptionId: sub.id,
          invoiceUrl: receiptNo,
        },
      });

      // 4. Calculate total paid across all successful payments for this subscription
      const allPayments = await tx.paymentHistory.findMany({
        where: { subscriptionId: sub.id, status: 'SUCCESS' },
      });
      const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0);
      const balanceAmount = Math.max(0, fullTotalAmount - totalPaid);
      const isFullyPaid = totalPaid >= fullTotalAmount;
      const paymentStatus = isFullyPaid ? 'FULLY_PAID' : 'PARTIALLY_PAID';

      this.logger.log(
        `[PAYMENT_SUCCESS] paymentId: ${payment.id} amount: ${chargedTotal} totalPaid: ${totalPaid} balance: ${balanceAmount} status: ${paymentStatus}`,
      );

      // Manage subscription installments in tx
      await tx.subscriptionInstallment.deleteMany({
        where: { subscriptionId: sub.id },
      });

      if (isFullyPaid) {
        await tx.subscriptionInstallment.create({
          data: {
            customerId,
            subscriptionId: sub.id,
            installmentNumber: 1,
            totalInstallments: 1,
            title: 'Full Plan Payment (100%)',
            amount: chargedBase,
            taxAmount: chargedTax,
            totalAmount: chargedTotal,
            status: InstallmentStatus.PAID,
            dueDate: startDate,
            expiryDate: expiryDate,
            bufferDays: 0,
            bufferEndDate: expiryDate,
            paidAt: startDate,
            paymentHistoryId: payment.id,
            notes: 'Complete 100% plan payment',
          },
        });
      } else {
        const halfTotal = Math.round(fullTotalAmount * 0.5 * 100) / 100;
        const halfBase = Math.round((halfTotal / 1.18) * 100) / 100;
        const halfTax = Math.round((halfTotal - halfBase) * 100) / 100;
        const secondDueDate = new Date(startDate);
        secondDueDate.setDate(secondDueDate.getDate() + 30);

        await tx.subscriptionInstallment.create({
          data: {
            customerId,
            subscriptionId: sub.id,
            installmentNumber: 1,
            totalInstallments: 2,
            title: 'Advance Payment (50%)',
            amount: halfBase,
            taxAmount: halfTax,
            totalAmount: halfTotal,
            status: InstallmentStatus.PAID,
            dueDate: startDate,
            expiryDate: secondDueDate,
            bufferDays: 0,
            bufferEndDate: secondDueDate,
            paidAt: startDate,
            paymentHistoryId: payment.id,
            notes: '50% advance payment',
          },
        });

        await tx.subscriptionInstallment.create({
          data: {
            customerId,
            subscriptionId: sub.id,
            installmentNumber: 2,
            totalInstallments: 2,
            title: 'Second Installment (50%)',
            amount: halfBase,
            taxAmount: halfTax,
            totalAmount: halfTotal,
            status: InstallmentStatus.DUE,
            dueDate: secondDueDate,
            expiryDate: expiryDate,
            bufferDays: 0,
            bufferEndDate: expiryDate,
            notes: 'Remaining 50% installment',
          },
        });
      }

      let finalInvoiceNo: string | null = null;

      // 5. Create or Update Authoritative Invoice for BOTH Full & Partial Payments
      finalInvoiceNo = `INV-${startDate.getFullYear()}-${String(payment.id).padStart(6, '0')}`;

      let contact = await tx.contact.findFirst({
        where: { customerId, deletedAt: null },
      });

      if (!contact) {
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
        });

        contact = await tx.contact.create({
          data: {
            customerId,
            firstName: customer?.companyName || customer?.name || 'Customer',
            lastName: 'Account',
            email: customer?.email || `billing-${customerId}@quikboom.com`,
            phone: customer?.phone || 'N/A',
          },
        });
      }

      const existingSubInvoice = await tx.invoice.findFirst({
        where: {
          customerId,
          deletedAt: null,
          OR: [{ subscriptionId: sub.id }, { invoiceNo: finalInvoiceNo }],
        },
        include: { payments: true },
      });

      const secondInstallmentDue = !isFullyPaid
        ? (() => {
            const d = new Date(startDate);
            d.setDate(d.getDate() + 30);
            return d;
          })()
        : null;

      const invoiceStatus = isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
      const clampedPaid = Math.min(totalPaid, fullTotalAmount);
      const remainingBal = Math.max(0, Math.round((fullTotalAmount - clampedPaid) * 100) / 100);
      const nextBillingAmt = sub.autoRenew ? fullTotalAmount : null;

      let targetInvoiceId: number;
      if (existingSubInvoice) {
        finalInvoiceNo = existingSubInvoice.invoiceNo;
        const hasOffline = (existingSubInvoice.payments || []).some((ip) => ip.paymentMode === 'OFFLINE');
        const resolvedMode = hasOffline ? 'MIXED' : 'ONLINE';
        const updated = await tx.invoice.update({
          where: { id: existingSubInvoice.id },
          data: {
            subscriptionId: sub.id,
            status: invoiceStatus,
            paidAmount: clampedPaid,
            balanceAmount: remainingBal,
            paymentMode: resolvedMode,
            lastPaymentDate: payment.createdAt,
            nextInstallmentDate: secondInstallmentDue,
            nextInstallmentAmount: !isFullyPaid ? remainingBal : null,
            nextBillingDate: expiryDate,
            nextBillingAmount: nextBillingAmt,
            billingCycle: String(cycle),
            planName: plan.name,
            notes: `Subscription payment for ${plan.name} (${cycle} billing). Purchase: ${payment.createdAt.toISOString().slice(0, 10)}. Plan activation: ${startDate.toISOString().slice(0, 10)}. Total Paid: ₹${clampedPaid}, Balance: ₹${remainingBal}. Order: ${payment.orderNumber || payment.orderId}`,
          },
        });
        targetInvoiceId = updated.id;
      } else {
        const created = await tx.invoice.create({
          data: {
            customerId,
            contactId: contact.id,
            subscriptionId: sub.id,
            invoiceNo: finalInvoiceNo,
            status: invoiceStatus,
            issueDate: payment.createdAt,
            dueDate: secondInstallmentDue || payment.createdAt,
            subTotal: fullBasePrice,
            taxAmount: fullTaxAmount,
            discount: 0,
            totalAmount: fullTotalAmount,
            paidAmount: clampedPaid,
            balanceAmount: remainingBal,
            paymentMode: 'ONLINE',
            lastPaymentDate: payment.createdAt,
            nextInstallmentDate: secondInstallmentDue,
            nextInstallmentAmount: !isFullyPaid ? remainingBal : null,
            nextBillingDate: expiryDate,
            nextBillingAmount: nextBillingAmt,
            billingCycle: String(cycle),
            planName: plan.name,
            notes: `Subscription payment for ${plan.name} (${cycle} billing). Purchase: ${payment.createdAt.toISOString().slice(0, 10)}. Plan activation: ${startDate.toISOString().slice(0, 10)}. Total Paid: ₹${clampedPaid}, Balance: ₹${remainingBal}. Order: ${payment.orderNumber || payment.orderId}`,
          },
        });
        targetInvoiceId = created.id;
      }

      // Link SubscriptionInstallments to this invoice and record InvoicePayment
      await tx.subscriptionInstallment.updateMany({
        where: { subscriptionId: sub.id },
        data: { invoiceId: targetInvoiceId },
      });

      const existingIp = await tx.invoicePayment.findFirst({
        where: { invoiceId: targetInvoiceId, paymentHistoryId: payment.id },
      });
      if (!existingIp) {
        await tx.invoicePayment.create({
          data: {
            invoiceId: targetInvoiceId,
            customerId,
            paymentHistoryId: payment.id,
            amount: chargedTotal,
            paymentMode: 'ONLINE',
            paymentMethod: String(payment.paymentMethod || 'RAZORPAY'),
            transactionRef: payment.transactionId || payment.paymentId || payment.orderNumber,
            gatewayPaymentId: payment.paymentId,
            gatewayOrderId: payment.orderId,
            receiptNo,
            status: 'CONFIRMED',
            paymentDate: payment.createdAt,
            remarks: isFullyPaid ? 'Full online subscription payment' : 'Partial online subscription payment',
            idempotencyKey: `payhist-${payment.id}`,
          },
        });
      }

      this.logger.log(
        `[INVOICE_STATUS] totalAmount: ${fullTotalAmount} totalPaid: ${clampedPaid} balance: ${remainingBal} status: ${invoiceStatus} invoiceNo: ${finalInvoiceNo}`,
      );

      // 6. Provision Plan Entitlements strictly from purchased plan / proposal features
      const serviceQuotas = extractDeliverableQuotas(proposalCtx?.effectiveFeatures || plan.features);

      if (proposalCtx && (tx as any).leadPlanProposal?.update) {
        await (tx as any).leadPlanProposal.update({
          where: { id: proposalCtx.proposalId },
          data: { status: 'ACCEPTED' },
        });
      }

      for (const sq of serviceQuotas) {
        if (sq.totalQty <= 0) continue;
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

      return {
        payment,
        subscription: sub,
        receiptNo,
        invoiceNo: finalInvoiceNo,
        isFullyPaid,
        totalPaid,
        balanceAmount,
      };
    });

    // 4. Trigger Automatic Dynamic Schedule Generation & Calendar Email Automation
    try {
      if (this.scheduleService) {
        await this.scheduleService.generateSchedulesForSubscription(result.subscription.id);
        await this.scheduleService.sendPlanPurchaseCalendarScheduleEmail({
          customerId,
          subscriptionId: result.subscription.id,
          planId: plan.id,
          paymentId: dto.razorpay_payment_id,
        });
      }
      await this.workService.generatePlanSchedules(customerId, result.subscription.id);
    } catch (schedErr: any) {
      this.logger.warn(`[AUTO_SCHEDULE_WARNING] Schedule generation notice: ${schedErr?.message}`);
    }

    // 5. Trigger Employee Commission Calculation for BPO/Telecaller/Telesales
    try {
      if (this.commissionService && result.payment) {
        await this.commissionService.calculateAndAwardCommission({
          customerId,
          purchaseId: result.payment.id,
          purchaseAmount: Number(result.payment.amount || chargedBase),
          planId: plan.id,
          orderId: dto.razorpay_order_id,
        });
      }
    } catch (commErr: any) {
      this.logger.error(
        `[COMMISSION_WARNING] Failed to award commission: ${commErr?.message}`,
        commErr?.stack,
      );
    }

    this.logger.log(
      `[PAYMENT] Payment verified: customerId=${customerId}, paymentId=${dto.razorpay_payment_id}`,
    );
    this.logger.log(`[PAYMENT] Payment verified`);
    this.logger.log(`[SUBSCRIPTION] ACTIVE`);
    this.logger.log(`[PLAN] Payment verified`);
    this.logger.log(`[PLAN] Subscription ID: ${result.subscription.id}`);
    this.logger.log(`[PLAN] Customer ID: ${customerId}`);
    this.logger.log(`[PLAN] Plan status: ACTIVE`);
    this.logger.log(`[PLAN] Triggering plan activation notification`);

    // Trigger Plan Purchase Success Notification
    try {
      if (this.notificationService) {
        await this.notificationService.sendPlanPurchaseSuccessNotification({
          customerId,
          userId: user?.id,
          subscriptionId: result.subscription.id,
          planId: plan.id,
          planName: plan.name,
          paymentId: dto.razorpay_payment_id,
        });
      }
    } catch (notifErr: any) {
      this.logger.warn(
        `Non-fatal: Failed to send plan purchase notification: ${notifErr?.message}`,
      );
    }

    // Trigger Payment Success & Invoice PDF communications (Email + WhatsApp)
    try {
      await this.sendPaymentAndInvoiceCommunications({
        customerId,
        paymentId: dto.razorpay_payment_id,
        amount: chargedTotal,
        planName: plan.name,
        transactionId: dto.razorpay_payment_id,
        orderId: dto.razorpay_order_id,
        paymentMethod: 'Razorpay / Online',
        invoiceNo: result.invoiceNo,
      });
    } catch (commErr: any) {
      this.logger.warn(`Non-fatal: Payment communications warning: ${commErr?.message}`);
    }

    this.logger.log(
      `[PAYMENT_VERIFIED_SUCCESS] customerId=${customerId} plan=${plan.name} paymentId=${dto.razorpay_payment_id}`,
    );
    this.logger.log(
      `[PLAN_PURCHASE]\ncustomerId: ${customerId}\nplanId: ${plan.id}\npurchaseDate: ${new Date().toISOString().split('T')[0]}\npaymentStatus: ${result.isFullyPaid ? 'PAID' : 'PARTIALLY_PAID'}\nsubscriptionId: ${result.subscription.id}`,
    );

    this.logger.log(
      `[PAYMENT_API_VERIFY] AUTH_USER_ID: ${customerId} | CUSTOMER_ID: ${customerId} | WORKSPACE_ID: ${customerId} | PLAN_ID: ${plan.id} | SUBSCRIPTION_ID: ${result.subscription.id} | SUBSCRIPTION_STATUS: ACTIVE | PAYMENT_ID: ${dto.razorpay_payment_id} | ORDER_ID: ${dto.razorpay_order_id} | START_DATE: ${startDate.toISOString()} | END_DATE: ${expiryDate.toISOString()}`,
    );

    const remainingDays = Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    const totalDays = cycle === SubscriptionBillingCycle.YEARLY ? 365 : 30;

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
          amount: chargedBase,
          taxAmount: chargedTax,
          totalAmount: chargedTotal,
          fullPlanAmount: fullTotalAmount,
          totalPaid: result.totalPaid,
          balanceAmount: result.balanceAmount,
          isFullyPaid: result.isFullyPaid,
          receiptNumber: result.receiptNo,
          invoiceUrl: result.invoiceNo,
          currency: 'INR',
          paymentStatus: result.isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
          paymentMethod: 'RAZORPAY',
          transactionId,
          purchaseDate: result.payment.createdAt,
          activationDate: startDate,
          expiryDate,
          features: plan.features,
        },
        subscription: {
          id: String(result.subscription.id),
          customerId: String(result.subscription.customerId),
          workspaceId: String(result.subscription.customerId),
          planId: String(plan.id),
          planName: plan.name,
          planCode: plan.code,
          status: 'ACTIVE',
          billingCycle: cycle,
          startDate,
          endDate: expiryDate,
          price: fullBasePrice,
          userLimit: plan.userLimit,
          leadLimit: plan.leadLimit,
          features: plan.features,
          isExpired: false,
        },
        effectivePlan: {
          id: plan.id,
          subscriptionId: result.subscription.id,
          name: plan.name,
          code: plan.code,
          billingCycle: cycle,
          price: fullBasePrice,
          startDate,
          endDate: expiryDate,
          expiryDate,
          isActive: true,
          isExpired: false,
          remainingDays,
          usedDays: 0,
          totalDays,
          features: Array.isArray(plan.features) ? plan.features : [],
          quotas: {
            userLimit: plan.userLimit,
            leadLimit: plan.leadLimit,
            storageLimitBytes: Number(plan.storageLimit),
            scheduleLimit: 10,
            usedSchedules: 0,
            remainingSchedules: 10,
          },
          services: [],
          usage: {
            currentUsers: 0,
            currentLeads: 0,
            currentStorageBytes: 0,
            scheduledWorks: 0,
          },
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
            activationDate: notes.activationDate ? String(notes.activationDate) : undefined,
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
    activationDate?: string;
  }) {
    const { customerId, planId, orderId, paymentId, billingCycle, activationDate } = params;

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

    const durationMonths = cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1;
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

      const subscriptionDates = resolvePlanSubscriptionDates(
        payment.createdAt,
        durationMonths,
        activationDate,
      );
      const startDate = subscriptionDates.startDate;
      const expiryDate = subscriptionDates.endDate;

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
    this.logger.log(`[PAYMENT] Payment verified`);
    this.logger.log(`[SUBSCRIPTION] ACTIVE`);
    this.logger.log(`[PLAN] Payment verified`);
    this.logger.log(`[PLAN] Customer ID: ${customerId}`);
    this.logger.log(`[PLAN] Plan status: ACTIVE`);
    this.logger.log(`[PLAN] Triggering plan activation notification`);

    // Trigger Plan Purchase Success Notification
    try {
      if (this.notificationService) {
        const activeSub = await this.prisma.customerSubscription.findFirst({
          where: { customerId, status: SubscriptionStatus.ACTIVE, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (activeSub) {
          try {
            if (this.scheduleService) {
              await this.scheduleService.generateSchedulesForSubscription(activeSub.id);
              await this.scheduleService.sendPlanPurchaseCalendarScheduleEmail({
                customerId,
                subscriptionId: activeSub.id,
                planId: plan.id,
                paymentId,
              });
            }
            if (this.workService) {
              await this.workService.generatePlanSchedules(customerId, activeSub.id);
            }
          } catch (schedErr: any) {
            this.logger.warn(`[WEBHOOK_SCHEDULE_WARN] Schedule generation notice: ${schedErr?.message}`);
          }

          await this.notificationService.sendPlanPurchaseSuccessNotification({
            customerId,
            subscriptionId: activeSub.id,
            planId: plan.id,
            planName: plan.name,
            paymentId,
          });

          await this.sendPaymentAndInvoiceCommunications({
            customerId,
            paymentId,
            amount: total,
            planName: plan.name,
            transactionId: paymentId,
            orderId: orderId,
            paymentMethod: 'Razorpay / Webhook',
            invoiceNo: null,
          }).catch((err) => this.logger.warn(`Non-fatal: Webhook payment communication notice: ${err?.message}`));
        }
      }
    } catch (notifErr: any) {
      this.logger.warn(`Non-fatal: Webhook plan purchase notification warning: ${notifErr?.message}`);
    }
  }

  /**
   * Helper to dispatch Payment Success Email + WhatsApp and Invoice PDF Email + WhatsApp
   */
  async sendPaymentAndInvoiceCommunications(params: {
    customerId: number;
    paymentId: number | string;
    amount: number | string;
    planName: string;
    transactionId?: string;
    orderId?: string;
    paymentMethod?: string;
    invoiceNo?: string | null;
  }) {
    const { customerId, paymentId, amount, planName, transactionId, orderId, paymentMethod, invoiceNo } = params;

    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          users: { where: { deletedAt: null }, select: { email: true, phone: true }, take: 1 },
        },
      });
      if (!customer) return;

      const customerEmail = customer.email || customer.users[0]?.email;
      const customerPhone = customer.phone || customer.users[0]?.phone;
      const customerName = customer.name || customer.companyName || 'Valued Customer';
      const companyName = customer.companyName || customer.name || 'QUIKBOOM Digital Marketing Agency';
      const formattedDate = new Date().toLocaleDateString('en-IN');

      // 1. Payment Success Email
      if (customerEmail && this.emailService && this.emailTemplateService) {
        try {
          const template = await this.emailTemplateService.findByKey('PAYMENT_SUCCESS', customerId);
          const rendered = renderEmailTemplate(
            { subject: template?.subject || 'Payment Confirmation: ₹{{amount}} for {{planName}} – {{companyName}}', body: template?.body || '' },
            {
              customerName,
              amount: String(amount),
              planName,
              paymentMethod: paymentMethod || 'Online / UPI',
              transactionId: transactionId || String(paymentId),
              orderId: orderId || 'N/A',
              paymentDate: formattedDate,
              companyName,
            },
          );

          await this.emailService.sendEmail({
            to: customerEmail,
            subject: rendered.subject,
            html: rendered.body,
            text: rendered.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
            recordType: 'customer',
            recordId: customerId,
            eventType: 'PAYMENT_SUCCESS',
            templateId: template?.id,
          });
          this.logger.log(`[EMAIL] Payment success confirmation email sent to ${customerEmail}`);
        } catch (emailErr: any) {
          this.logger.warn(`[EMAIL] Payment success email notice: ${emailErr?.message}`);
        }
      }

      // 2. Payment Success WhatsApp
      if (this.whatsappService) {
        try {
          await this.whatsappService.sendPaymentSuccessMessage({
            to: customerPhone,
            customerId,
            customerName,
            amount,
            planName,
            transactionId,
            paymentMethod,
          });
        } catch (waErr: any) {
          this.logger.warn(`[WHATSAPP] Payment success WhatsApp notice: ${waErr?.message}`);
        }
      }

      // 3. Invoice Email & WhatsApp with PDF
      if (invoiceNo && this.invoiceService) {
        try {
          const invoice = await this.prisma.invoice.findFirst({
            where: { customerId, invoiceNo },
            include: { contact: true },
          });

          if (invoice) {
            let pdfBuffer: Buffer | null = null;
            try {
              pdfBuffer = await this.invoiceService.generateInvoicePdfBuffer(invoice, invoiceNo);
            } catch (pdfErr: any) {
              this.logger.warn(`[PDF_GEN_WARN] Invoice PDF generation notice: ${pdfErr?.message}`);
            }

            // Invoice Email with PDF attachment
            if (customerEmail && this.emailService && this.emailTemplateService) {
              const invTemplate = await this.emailTemplateService.findByKey('INVOICE_GENERATED', customerId);
              const invRendered = renderEmailTemplate(
                { subject: invTemplate?.subject || 'Tax Invoice #{{invoiceNo}} from {{companyName}}', body: invTemplate?.body || '' },
                {
                  customerName,
                  invoiceNo,
                  amount: String(amount),
                  dueDate: formattedDate,
                  issueDate: formattedDate,
                  companyName,
                },
              );

              await this.emailService.sendEmail({
                to: customerEmail,
                subject: invRendered.subject,
                html: invRendered.body,
                text: invRendered.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
                recordType: 'invoice',
                recordId: invoice.id,
                eventType: 'INVOICE_GENERATED',
                templateId: invTemplate?.id,
                attachments: pdfBuffer ? [{ filename: `Invoice-${invoiceNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }] : undefined,
              });
              this.logger.log(`[EMAIL] Invoice PDF email sent to ${customerEmail}`);
            }

            // Invoice WhatsApp with Document
            if (this.whatsappService && customerPhone) {
              await this.whatsappService.sendDocumentMessage({
                to: customerPhone,
                pdfBuffer: pdfBuffer || undefined,
                filename: `Invoice-${invoiceNo}.pdf`,
                caption: `Invoice #${invoiceNo} for ₹${amount} from ${companyName}.`,
              });
            }
          }
        } catch (invErr: any) {
          this.logger.warn(`[INVOICE_COMMUNICATION_WARN] ${invErr?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`[PAYMENT_COMMUNICATION_ERROR] ${err?.message}`);
    }
  }

  /**
   * 5. Get Customer Purchase / Payment History with Receipts and Invoice status
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

    // Check active subscription total paid vs total amount
    const activeSub = await this.prisma.customerSubscription.findFirst({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    let activeSubTotalAmount = 0;
    let activeSubTotalPaid = 0;
    if (activeSub && activeSub.plan) {
      const cycle = activeSub.billingCycle || 'MONTHLY';
      const base = cycle === 'YEARLY' ? Number(activeSub.plan.yearlyPrice) : Number(activeSub.plan.monthlyPrice);
      activeSubTotalAmount = base + Math.round(base * 0.18);
      const subPayments = payments.filter((p) => p.subscriptionId === activeSub.id && p.status === 'SUCCESS');
      activeSubTotalPaid = subPayments.reduce((s, p) => s + Number(p.totalAmount || 0), 0);
    }

    const mapped = payments.map((p) => {
      const isSuccess = p.status === 'SUCCESS';
      const receiptNo = p.invoiceUrl?.startsWith('REC-') ? p.invoiceUrl : `REC-${p.createdAt.getFullYear()}-${String(p.id).padStart(6, '0')}`;
      const subFullTotal = p.subscription?.plan
        ? (Number(p.subscription.billingCycle === 'YEARLY' ? p.subscription.plan.yearlyPrice : p.subscription.plan.monthlyPrice) * 1.18)
        : Number(p.totalAmount || 0);

      const isFullyPaid = isSuccess && (activeSubTotalPaid >= activeSubTotalAmount || Number(p.totalAmount || 0) >= subFullTotal);
      const invoiceUrl = isFullyPaid ? (p.invoiceUrl?.startsWith('INV-') ? p.invoiceUrl : `INV-${p.createdAt.getFullYear()}-${String(p.id).padStart(6, '0')}`) : null;
      const subscriptionStartDate = p.subscription?.startDate
        ? new Date(p.subscription.startDate)
        : resolveSubscriptionActivationDate(p.createdAt, null);

      return {
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
        expiryDate: p.subscription?.endDate,
        features: p.subscription?.plan?.features || [],
      };
    });

    return {
      success: true,
      data: mapped,
    };
  }

  /**
   * 6. Create Offline Payment Request (Bank Transfer / Cash / Cheque)
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
      throw new BadRequestException('Cash payment is currently disabled by Admin.');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer organization #${customerId} not found`);
    }

    this.logger.log(`[PLAN_API_DEBUG]\nendpoint: /payments/offline/order\ncustomerId: ${customerId}\nplanId: ${dto.planId}`);

    // Resolve plan
    let plan: any = null;
    const numPlanId = Number(dto.planId);
    if (!isNaN(numPlanId) && numPlanId > 0) {
      plan = await this.prisma.plan.findFirst({
        where: { id: numPlanId, deletedAt: null, isActive: true },
      });
    }

    if (!plan && dto.planId != null) {
      const codeUpper = String(dto.planId).trim().toUpperCase();
      plan = await this.prisma.plan.findFirst({
        where: {
          code: codeUpper,
          deletedAt: null,
          isActive: true,
        },
      });
    }

    if (!plan) {
      throw new BadRequestException('This subscription plan is no longer available. Please refresh the plans.');
    }

    const cycle = dto.billingCycle || SubscriptionBillingCycle.MONTHLY;
    const fullBasePrice = cycle === SubscriptionBillingCycle.YEARLY ? Number(plan.yearlyPrice) : Number(plan.monthlyPrice);
    const fullTaxAmount = Math.round(fullBasePrice * 0.18);
    const fullTotalAmount = fullBasePrice + fullTaxAmount;

    // Calculate advance vs full
    const paymentOption = (dto.paymentOption || 'FULL').toUpperCase();
    let basePrice = fullBasePrice;
    let taxAmount = fullTaxAmount;
    let totalAmount = fullTotalAmount;

    if (paymentOption === 'ADVANCE' || paymentOption === 'HALF') {
      totalAmount = Math.round(fullTotalAmount * 0.5);
      taxAmount = Math.round(fullTaxAmount * 0.5);
      basePrice = totalAmount - taxAmount;
    } else if (paymentOption === 'BALANCE') {
      const previousPayments = await this.prisma.paymentHistory.findMany({
        where: { customerId, status: 'SUCCESS' },
      });
      const previousTotal = previousPayments.reduce((s, p) => s + Number(p.totalAmount || 0), 0);
      totalAmount = Math.max(0, fullTotalAmount - previousTotal);
      taxAmount = Math.round(totalAmount - (totalAmount / 1.18));
      basePrice = totalAmount - taxAmount;
    }

    const durationMonths = cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1;
    const purchaseDate = new Date();
    const subscriptionDates = resolvePlanSubscriptionDates(
      purchaseDate,
      durationMonths,
      dto.activationDate ?? dto.startDate,
    );
    const startDate = subscriptionDates.startDate;
    const expiryDate = subscriptionDates.endDate;

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
      `[OFFLINE_PAYMENT_REQUESTED] customerId=${customerId} plan=${plan.name} paymentOption=${paymentOption} charged=₹${totalAmount} full=₹${fullTotalAmount} subId=${subscription.id} orderNumber=${orderNumber}`,
    );

    return {
      success: true,
      message: 'Offline payment request submitted successfully and is pending Admin approval.',
      orderNumber,
      subscriptionId: subscription.id,
      paymentId: payment.id,
      totalAmountRupees: totalAmount,
      fullPlanAmountRupees: fullTotalAmount,
      paymentOption,
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
   * 7. Send Payment Reminder Notification for Partially Paid Subscriptions
   */
  async sendPaymentReminder(adminUser: any, dto: SendPaymentReminderDto) {
    const numCustomerId = Number(dto.customerId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId, deletedAt: null },
      include: { users: true },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${numCustomerId} not found`);
    }

    let sub: any = null;
    if (dto.subscriptionId) {
      sub = await this.prisma.customerSubscription.findUnique({
        where: { id: Number(dto.subscriptionId) },
        include: { plan: true },
      });
    } else {
      sub = await this.prisma.customerSubscription.findFirst({
        where: { customerId: numCustomerId, deletedAt: null, status: SubscriptionStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      });
    }

    if (!sub || !sub.plan) {
      throw new BadRequestException('No active plan subscription found for this customer');
    }

    const cycle = sub.billingCycle || 'MONTHLY';
    const basePrice = cycle === 'YEARLY' ? Number(sub.plan.yearlyPrice) : Number(sub.plan.monthlyPrice);
    const fullTotal = basePrice + Math.round(basePrice * 0.18);
    const paidPayments = await this.prisma.paymentHistory.findMany({
      where: { subscriptionId: sub.id, status: 'SUCCESS' },
    });
    const totalPaid = paidPayments.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0);
    const balance = Math.max(0, fullTotal - totalPaid);

    if (balance <= 0) {
      throw new BadRequestException('Subscription is already fully paid. No balance reminder needed.');
    }

    const dueDateStr = sub.endDate ? new Date(sub.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Work Completion';
    const defaultMsg = `Your remaining 50% payment of ₹${balance.toLocaleString('en-IN')} is pending. Please complete the payment for the upcoming second installation.`;
    const message = dto.customMessage || defaultMsg;

    const targetUser = customer.users?.[0] || adminUser;

    let notif: any;
    if (this.notificationService) {
      await this.notificationService.sendPushNotification({
        userId: targetUser?.id,
        customerId: numCustomerId,
        title: 'Payment Reminder: Remaining Balance Due (50%)',
        body: message,
        type: 'PAYMENT_REMINDER',
        data: {
          type: 'PAYMENT_REMINDER',
          subscriptionId: String(sub.id),
          planName: sub.plan.name,
          totalAmount: String(fullTotal),
          totalPaid: String(totalPaid),
          balanceAmount: String(balance),
          dueDate: sub.endDate ? sub.endDate.toISOString() : '',
        },
      });
      notif = await this.prisma.notification.findFirst({
        where: { customerId: numCustomerId, type: 'PAYMENT_REMINDER' },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      notif = await this.prisma.notification.create({
        data: {
          customerId: numCustomerId,
          userId: targetUser?.id,
          title: 'Payment Reminder: Remaining Balance Due (50%)',
          message,
          type: 'PAYMENT_REMINDER',
          data: {
            subscriptionId: sub.id,
            planName: sub.plan.name,
            totalAmount: fullTotal,
            totalPaid,
            balanceAmount: balance,
            dueDate: sub.endDate,
          },
        },
      });
    }

    this.logger.log(`[PAYMENT_REMINDER_SENT] customerId: CUST-${numCustomerId} balance: ₹${balance} notificationId: ${notif?.id || 'N/A'}`);

    return {
      success: true,
      message: 'Payment reminder notification sent successfully to customer.',
      data: {
        notificationId: notif.id,
        customerId: numCustomerId,
        subscriptionId: sub.id,
        balanceAmount: balance,
        message,
      },
    };
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
        razorpayEnabled: data.razorpayEnabled,
        enableRazorpay: data.razorpayEnabled,
        offlinePaymentEnabled: data.offlinePaymentEnabled,
        enableOfflinePayment: data.offlinePaymentEnabled,
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
    };
  }

  /**
   * Returns App Store Connect IAP product IDs mapped to active plans and AI credit packs.
   */
  async getAppleIapProducts() {
    const bundleId = process.env.APPLE_IAP_BUNDLE_ID || 'com.qbsuite.qbCustomer';
    const plans = await this.prisma.plan.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { monthlyPrice: 'asc' },
    });

    const planProducts = plans.flatMap((plan) => {
      const codeSlug = String(plan.code || plan.id).toLowerCase().replace(/[^a-z0-9_]/g, '_');
      return [
        {
          planId: plan.id,
          planCode: plan.code,
          planName: plan.name,
          billingCycle: 'MONTHLY',
          productId: `${bundleId}.plan.${codeSlug}.monthly`,
          price: Number(plan.monthlyPrice || 0),
        },
        {
          planId: plan.id,
          planCode: plan.code,
          planName: plan.name,
          billingCycle: 'YEARLY',
          productId: `${bundleId}.plan.${codeSlug}.yearly`,
          price: Number(plan.yearlyPrice || 0),
        },
      ];
    });

    const creditPacks = [
      { credits: 10, price: 100, productId: `${bundleId}.aicredits.10` },
      { credits: 25, price: 225, productId: `${bundleId}.aicredits.25` },
      { credits: 50, price: 400, productId: `${bundleId}.aicredits.50` },
      { credits: 100, price: 750, productId: `${bundleId}.aicredits.100` },
    ];

    return {
      success: true,
      data: {
        bundleId,
        planProducts,
        creditPacks,
      },
    };
  }

  /**
   * Verifies an Apple StoreKit 2 JWS signedTransactionInfo token using its embedded x5c certificate chain.
   */
  private verifyAppleJws(jws: string): Record<string, any> {
    const parts = String(jws || '').split('.');
    if (parts.length !== 3) {
      throw new BadRequestException('Invalid Apple signed transaction format.');
    }
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    const x5c: string[] = Array.isArray(header?.x5c) ? header.x5c : [];
    if (!x5c.length) {
      throw new BadRequestException('Apple transaction JWS missing x5c certificate chain.');
    }

    const leafPem = `-----BEGIN CERTIFICATE-----\n${x5c[0].match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;
    const leafCert = new crypto.X509Certificate(leafPem);

    // Verify certificate chain links if intermediate/root certificates are present
    for (let i = 0; i < x5c.length - 1; i++) {
      const childPem = `-----BEGIN CERTIFICATE-----\n${x5c[i].match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;
      const parentPem = `-----BEGIN CERTIFICATE-----\n${x5c[i + 1].match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;
      const child = new crypto.X509Certificate(childPem);
      const parent = new crypto.X509Certificate(parentPem);
      if (!child.verify(parent.publicKey)) {
        throw new BadRequestException('Apple certificate chain verification failed.');
      }
    }

    const signatureValid = crypto.verify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key: leafCert.publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(sigB64, 'base64url'),
    );

    if (!signatureValid) {
      throw new BadRequestException('Apple transaction JWS signature verification failed.');
    }

    return payload;
  }

  /**
   * Verifies StoreKit 2 / App Store transaction on backend and activates subscription or AI credits idempotently.
   */
  async verifyAppleIapPayment(user: any, dto: any, reqCustomerId?: number) {
    let customerId = reqCustomerId != null && Number(reqCustomerId) > 0 ? Number(reqCustomerId) : Number(user?.customerId);
    if ((!customerId || isNaN(customerId)) && user?.id) {
      const cust = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { users: { some: { id: Number(user.id) } } },
            { employees: { some: { userId: Number(user.id) } } },
          ],
        },
        select: { id: true },
      });
      if (cust) customerId = cust.id;
    }
    if (!customerId || isNaN(customerId)) {
      throw new ForbiddenException('User does not belong to any customer organization');
    }

    const expectedBundleId = process.env.APPLE_IAP_BUNDLE_ID || 'com.qbsuite.qbCustomer';
    let verifiedTxId = String(dto.transactionId || '').trim();
    let verifiedOriginalTxId = String(dto.originalTransactionId || verifiedTxId).trim();
    let verifiedProductId = String(dto.productId || '').trim();
    let environment = String(dto.environment || 'Production');

    if (dto.signedTransactionInfo && String(dto.signedTransactionInfo).includes('.')) {
      const decoded = this.verifyAppleJws(dto.signedTransactionInfo);
      if (decoded.bundleId && decoded.bundleId !== expectedBundleId) {
        throw new BadRequestException(`Apple bundleId mismatch (${decoded.bundleId}).`);
      }
      if (decoded.revocationDate) {
        throw new BadRequestException('This Apple transaction has been refunded or revoked.');
      }
      if (decoded.transactionId) verifiedTxId = String(decoded.transactionId);
      if (decoded.originalTransactionId) verifiedOriginalTxId = String(decoded.originalTransactionId);
      if (decoded.productId) verifiedProductId = String(decoded.productId);
      if (decoded.environment) environment = String(decoded.environment);
    } else if (!dto.signedTransactionInfo) {
      throw new BadRequestException('Signed StoreKit 2 transaction (signedTransactionInfo) is required for server verification.');
    }

    if (!verifiedTxId || !verifiedProductId) {
      throw new BadRequestException('Invalid Apple transaction identifier or product ID.');
    }

    // Idempotency check: prevent duplicate processing for same transactionId
    const existingPayment = await this.prisma.paymentHistory.findFirst({
      where: { paymentId: verifiedTxId, customerId },
    });
    if (existingPayment && existingPayment.status === 'SUCCESS') {
      const existingSub = existingPayment.subscriptionId
        ? await this.prisma.customerSubscription.findUnique({
            where: { id: existingPayment.subscriptionId },
            include: { plan: true },
          })
        : null;
      return {
        success: true,
        idempotent: true,
        message: 'Apple IAP transaction already verified.',
        data: {
          payment: existingPayment,
          subscription: existingSub,
          transactionId: existingPayment.transactionId,
          receiptNumber: existingPayment.invoiceUrl,
          environment,
        },
      };
    }

    const purchaseType = dto.purchaseType || (verifiedProductId.includes('.aicredits.') ? 'AI_CREDITS' : 'SUBSCRIPTION');

    if (purchaseType === 'AI_CREDITS') {
      const packCredits = Number(dto.credits || verifiedProductId.split('.').pop() || 0);
      if (!Number.isFinite(packCredits) || packCredits <= 0) {
        throw new BadRequestException('Invalid AI credit pack.');
      }
      const orderNumber = `#QBIAP-${Date.now().toString(36).toUpperCase()}`;
      const txnRef = `APPLE-${verifiedOriginalTxId}-${verifiedTxId}`;

      const result = await this.prisma.$transaction(async (tx) => {
        const payment = await tx.paymentHistory.create({
          data: {
            customerId,
            planId: 0,
            planName: `AI Credits (${packCredits})`,
            orderNumber,
            orderId: `APPLE_IAP_${verifiedProductId}`,
            paymentId: verifiedTxId,
            billingCycle: 'MONTHLY' as any,
            amount: 0,
            taxAmount: 0,
            totalAmount: 0,
            status: 'SUCCESS',
            paymentMethod: PaymentMethod.OTHER,
            transactionId: txnRef,
          },
        });
        const receiptNo = `REC-${new Date().getFullYear()}-${String(payment.id).padStart(6, '0')}`;
        await tx.paymentHistory.update({
          where: { id: payment.id },
          data: { invoiceUrl: receiptNo },
        });
        if ((tx as any).aiCreditWallet?.upsert) {
          await (tx as any).aiCreditWallet.upsert({
            where: { customerId },
            create: { customerId, balance: packCredits },
            update: { balance: { increment: packCredits } },
          });
        }
        return { payment: { ...payment, invoiceUrl: receiptNo }, receiptNo };
      });

      return {
        success: true,
        message: `Verified Apple IAP and added ${packCredits} AI credits.`,
        data: {
          payment: result.payment,
          creditsAdded: packCredits,
          transactionId: txnRef,
          receiptNumber: result.receiptNo,
          environment,
        },
      };
    }

    // Resolve Subscription Plan by planId or productId slug
    let plan: any = null;
    if (dto.planId != null) {
      const numPlanId = Number(dto.planId);
      if (!isNaN(numPlanId) && numPlanId > 0) {
        plan = await this.prisma.plan.findFirst({ where: { id: numPlanId, deletedAt: null, isActive: true } });
      }
      if (!plan) {
        plan = await this.prisma.plan.findFirst({
          where: { code: String(dto.planId).trim().toUpperCase(), deletedAt: null, isActive: true },
        });
      }
    }
    if (!plan) {
      const allPlans = await this.prisma.plan.findMany({ where: { deletedAt: null, isActive: true } });
      plan = allPlans.find((p) => {
        const slug = String(p.code || p.id).toLowerCase().replace(/[^a-z0-9_]/g, '_');
        return verifiedProductId.includes(`.plan.${slug}.`);
      });
    }
    if (!plan) {
      throw new BadRequestException('Matching subscription plan not found for Apple product.');
    }

    const cycle = dto.billingCycle || (verifiedProductId.endsWith('.yearly') ? SubscriptionBillingCycle.YEARLY : SubscriptionBillingCycle.MONTHLY);
    const fullBasePrice = cycle === SubscriptionBillingCycle.YEARLY ? Number(plan.yearlyPrice) : Number(plan.monthlyPrice);
    const fullTaxAmount = Math.round(fullBasePrice * 0.18);
    const fullTotalAmount = fullBasePrice + fullTaxAmount;
    const durationMonths = cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1;
    const orderNumber = `#QBIAP-${Date.now().toString(36).toUpperCase()}`;
    const txnRef = `APPLE-${verifiedOriginalTxId}-${verifiedTxId}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentHistory.create({
        data: {
          customerId,
          planId: plan.id,
          planName: plan.name,
          orderNumber,
          orderId: `APPLE_IAP_${verifiedProductId}`,
          paymentId: verifiedTxId,
          billingCycle: cycle as any,
          amount: fullBasePrice,
          taxAmount: fullTaxAmount,
          totalAmount: fullTotalAmount,
          status: 'SUCCESS',
          paymentMethod: PaymentMethod.OTHER,
          transactionId: txnRef,
        },
      });

      const subscriptionDates = resolvePlanSubscriptionDates(payment.createdAt, durationMonths, dto.activationDate);
      let sub = await tx.customerSubscription.findFirst({
        where: { customerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      const subData = {
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        billingCycle: cycle as any,
        startDate: subscriptionDates.startDate,
        endDate: subscriptionDates.endDate,
        duration: durationMonths,
        durationUnit: 'MONTH' as const,
        autoRenew: true,
        customPrice: null,
        customFeatures: null,
        customUserLimit: null,
        customLeadLimit: null,
        customStorageLimit: null,
      };

      sub = sub
        ? await tx.customerSubscription.update({ where: { id: sub.id }, data: subData, include: { plan: true } })
        : await tx.customerSubscription.create({ data: { customerId, ...subData }, include: { plan: true } });

      await tx.customerSubscription.updateMany({
        where: {
          customerId,
          id: { not: sub.id },
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
        },
        data: { status: SubscriptionStatus.EXPIRED },
      });

      const receiptNo = `REC-${subscriptionDates.startDate.getFullYear()}-${String(payment.id).padStart(6, '0')}`;
      await tx.paymentHistory.update({
        where: { id: payment.id },
        data: { subscriptionId: sub.id, invoiceUrl: receiptNo },
      });

      return { payment: { ...payment, subscriptionId: sub.id, invoiceUrl: receiptNo }, sub, receiptNo };
    });

    this.logger.log(`[APPLE_IAP_VERIFIED] customerId=${customerId} planId=${plan.id} txId=${verifiedTxId} env=${environment}`);

    return {
      success: true,
      message: 'Apple In-App Purchase verified and subscription activated.',
      data: {
        payment: result.payment,
        subscription: result.sub,
        transactionId: txnRef,
        receiptNumber: result.receiptNo,
        environment,
      },
    };
  }

  /**
   * Handles Apple App Store Server Notifications V2 (renewals, refunds, revocations).
   */
  async handleAppleWebhook(body: any) {
    const signedPayload = body?.signedPayload;
    if (!signedPayload) {
      throw new BadRequestException('Missing signedPayload in Apple Server Notification.');
    }
    const notification = this.verifyAppleJws(signedPayload);
    const notificationType = String(notification.notificationType || '').toUpperCase();
    const txJws = notification?.data?.signedTransactionInfo;
    const txInfo = txJws ? this.verifyAppleJws(txJws) : null;

    this.logger.log(`[APPLE_WEBHOOK] type=${notificationType} txId=${txInfo?.transactionId || 'N/A'}`);

    if (txInfo?.transactionId && (notificationType === 'REFUND' || notificationType === 'REVOKE')) {
      await this.prisma.paymentHistory.updateMany({
        where: { paymentId: String(txInfo.transactionId) },
        data: { status: 'REFUNDED' },
      });
    }

    return { received: true, notificationType };
  }

  /**
   * Returns current payment status by orderId or paymentId for delayed confirmation checks.
   */
  async getPaymentStatus(user: any, reqCustomerId?: number, orderId?: string, paymentId?: string) {
    const customerId = reqCustomerId != null && Number(reqCustomerId) > 0 ? Number(reqCustomerId) : Number(user?.customerId);
    if (!orderId && !paymentId) {
      throw new BadRequestException('orderId or paymentId is required.');
    }

    const record = await this.prisma.paymentHistory.findFirst({
      where: {
        ...(customerId ? { customerId } : {}),
        OR: [
          ...(paymentId ? [{ paymentId }, { transactionId: paymentId }] : []),
          ...(orderId ? [{ orderId }, { orderNumber: orderId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: record
        ? {
            found: true,
            status: record.status,
            orderId: record.orderId,
            paymentId: record.paymentId,
            transactionId: record.transactionId,
            totalAmount: Number(record.totalAmount || 0),
            receiptNumber: record.invoiceUrl,
            paymentMethod: record.paymentMethod,
            createdAt: record.createdAt,
          }
        : { found: false, status: 'PENDING' },
    };
  }

  private async resolveProposalForPayment(
    customerId: number,
    proposalIdRaw: unknown,
    allowAlreadyAccepted = false,
  ) {
    const proposalId = Number(proposalIdRaw);
    if (!proposalId || isNaN(proposalId)) {
      throw new BadRequestException('Invalid proposal ID.');
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, leadId: true, email: true, phone: true },
    });
    if (!customer) throw new NotFoundException('Customer organization not found');

    let leadId = customer.leadId || null;
    if (!leadId && (customer.email || customer.phone)) {
      const matched = await this.prisma.lead.findFirst({
        where: {
          deletedAt: null,
          OR: [
            ...(customer.email ? [{ email: { equals: customer.email, mode: 'insensitive' as const } }] : []),
            ...(customer.phone ? [{ phone: customer.phone }] : []),
          ],
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      leadId = matched?.id || null;
    }

    const proposal = leadId
      ? await this.prisma.leadPlanProposal.findFirst({
          where: { id: proposalId, leadId },
        })
      : null;

    if (!proposal) {
      throw new NotFoundException('Proposal not found for this customer.');
    }

    if (!allowAlreadyAccepted && (proposal.status === 'ACCEPTED' || proposal.status === 'CONVERTED')) {
      throw new BadRequestException('Payment for this proposal has already been recorded.');
    }

    const cfg = (proposal.customConfig || {}) as Record<string, any>;
    const rawFeatures = Array.isArray(cfg.features) ? cfg.features : [];
    const effectiveFeatures = rawFeatures
      .map((item: any) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const name = String(item.name || '').trim();
          const qty = String(item.quantity || '').trim();
          return qty ? `${qty} ${name}`.trim() : name;
        }
        return '';
      })
      .filter(Boolean);

    const storageUnit = String(cfg.storageUnit || 'GB').toUpperCase();
    const rawStorage = cfg.storageLimit != null ? Number(cfg.storageLimit) : null;
    const storageLimitBytes =
      cfg.storageLimitBytes != null
        ? Number(cfg.storageLimitBytes)
        : rawStorage != null && !isNaN(rawStorage)
          ? Math.round(rawStorage * (storageUnit === 'MB' ? 1024 * 1024 : 1024 * 1024 * 1024))
          : null;

    const billingCycle =
      String(cfg.billingCycle || 'MONTHLY').toUpperCase() === 'YEARLY'
        ? SubscriptionBillingCycle.YEARLY
        : SubscriptionBillingCycle.MONTHLY;

    return {
      proposalId: proposal.id,
      planId: proposal.planId,
      planName: proposal.planName || 'Custom Plan',
      agreedPrice: Number(proposal.planPrice || 0),
      billingCycle,
      effectiveFeatures,
      userLimit: cfg.userLimit != null ? Number(cfg.userLimit) : null,
      leadLimit: cfg.leadLimit != null ? Number(cfg.leadLimit) : null,
      storageLimitBytes,
    };
  }
}

