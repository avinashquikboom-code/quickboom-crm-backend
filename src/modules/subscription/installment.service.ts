import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ScheduleService } from '../schedule/schedule.service';
import {
  InstallmentStatus,
  SubscriptionStatus,
  SubscriptionBillingCycle,
  PaymentMethod,
  InvoiceStatus,
} from '@prisma/client';
import { calculateSubscriptionDates } from '../../common/utils/subscription-date.util';
import {
  buildDefaultPlanLineItems,
  withInvoiceItemsSnapshot,
} from '../../common/utils/invoice-items.util';

export const DEFAULT_BUFFER_DAYS = 0;

export const TERMS_CONDITIONS_RENEWAL_FAILED =
  'Under our Terms & Conditions, after the renewal period expires, the previous installment plan cannot be continued and a new plan must be purchased at the applicable full plan price.';

export const TERMS_CONDITIONS_BUFFER_ACTIVE =
  'Please complete your installment payment by the due date to continue your plan.';

export interface InstallmentBreakdownItem {
  id: number;
  installmentNumber: number;
  totalInstallments: number;
  title: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  status: InstallmentStatus | string;
  dueDate: Date;
  expiryDate: Date;
  bufferDays: number;
  bufferEndDate: Date;
  bufferRemainingDays: number;
  isInBuffer: boolean;
  isExpired: boolean;
  paidAt: Date | null;
  paymentHistoryId: number | null;
  invoiceId: number | null;
  notes: string | null;
  displayStatus: string;
}

export interface CustomerInstallmentSummary {
  customerId: number;
  subscriptionId: number;
  planId: number;
  planName: string;
  originalPlanValue: number;
  totalPlanAmount: number;
  totalPaidAmount: number;
  historicalPaidAmount: number;
  outstandingAmount: number;
  isFullyPaid: boolean;
  activeInstallmentNumber: number;
  subscriptionStatus: string;
  planStatus: string;
  isAccessAllowed: boolean;
  isInBuffer: boolean;
  isRenewalFailed: boolean;
  canRenewCurrentPlan: boolean;
  amountRequiredToContinue: number | null;
  amountRequiredToRestart: number;
  newPlanPrice: number;
  bufferDays: number;
  bufferRemainingDays: number;
  bufferStartDate: Date | null;
  bufferEndDate: Date | null;
  nextDueDate: Date | null;
  installments: InstallmentBreakdownItem[];
  statusMessage: string;
  failureMessage: string | null;
  bufferMessage: string | null;
  termsMessage: string;
}

@Injectable()
export class InstallmentService {
  private readonly logger = new Logger(InstallmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationService?: NotificationService,
    @Optional() private readonly scheduleService?: ScheduleService,
  ) {}

  /**
   * Returns the expiry date without adding buffer days.
   */
  public calculateBufferEndDate(expiryDate: Date, bufferDays: number = 0): Date {
    return new Date(expiryDate);
  }

  /**
   * Initializes or refreshes installment schedule for a subscription.
   * Enforces the 50% Advance Payment + 50% Second Installment concept.
   */
  async createInstallmentsForSubscription(
    customerId: number,
    subscriptionId: number,
    totalPlanAmount: number,
    totalInstallments: number = 2,
    startDate: Date = new Date(),
    installmentDurationDays: number = 30,
    bufferDays: number = 0,
  ): Promise<InstallmentBreakdownItem[]> {
    const numCustId = Number(customerId);
    const numSubId = Number(subscriptionId);

    // Delete existing unpaid installments to prevent duplicates if re-initializing
    await this.prisma.subscriptionInstallment.deleteMany({
      where: {
        subscriptionId: numSubId,
        status: { in: [InstallmentStatus.PENDING, InstallmentStatus.DUE, InstallmentStatus.UPCOMING] },
      },
    });

    const existingPaid = await this.prisma.subscriptionInstallment.findMany({
      where: { subscriptionId: numSubId, status: InstallmentStatus.PAID },
      orderBy: { installmentNumber: 'asc' },
    });

    const paidNumbers = new Set(existingPaid.map((p) => p.installmentNumber));
    const effectiveTotalInstallments = 2; // Strict 50% + 50%

    const halfTotal = Math.round(totalPlanAmount * 0.5 * 100) / 100;
    const remainingTotal = Math.round((totalPlanAmount - halfTotal) * 100) / 100;

    const createdList: any[] = [];

    for (let i = 1; i <= effectiveTotalInstallments; i++) {
      if (paidNumbers.has(i)) {
        continue;
      }

      const instTotal = i === 1 ? halfTotal : remainingTotal;
      const instBase = Math.round((instTotal / 1.18) * 100) / 100;
      const instTax = Math.round((instTotal - instBase) * 100) / 100;

      // Calculate dates for installment i
      const instStartDate = new Date(startDate);
      if (i > 1) {
        instStartDate.setDate(instStartDate.getDate() + (i - 1) * installmentDurationDays);
      }

      const instExpiryDate = new Date(instStartDate);
      instExpiryDate.setDate(instExpiryDate.getDate() + installmentDurationDays);

      const instDueDate = new Date(instStartDate);
      const instBufferEndDate = new Date(instExpiryDate);

      const isFirstDue = i === 1 && existingPaid.length === 0;
      const initialStatus = isFirstDue
        ? InstallmentStatus.DUE
        : existingPaid.length >= 1 && i === 2
        ? InstallmentStatus.DUE
        : InstallmentStatus.UPCOMING;

      const title = i === 1 ? 'Advance Payment (50%)' : 'Second Installment (50%)';

      const inst = await this.prisma.subscriptionInstallment.create({
        data: {
          customerId: numCustId,
          subscriptionId: numSubId,
          installmentNumber: i,
          totalInstallments: effectiveTotalInstallments,
          title,
          amount: instBase,
          taxAmount: instTax,
          totalAmount: instTotal,
          status: initialStatus,
          dueDate: instDueDate,
          expiryDate: instExpiryDate,
          bufferDays: 0,
          bufferEndDate: instBufferEndDate,
        },
      });

      this.logger.log(
        `[INSTALLMENT_STATUS] customerId: ${numCustId}, subscriptionId: ${numSubId}, installmentNumber: ${i}, expiryDate: ${instExpiryDate.toISOString()}, status: ${initialStatus}`,
      );
      createdList.push(inst);
    }

    return this.getCustomerInstallmentSummary(numCustId).then((res) => res.installments);
  }

  /**
   * If SUCCESS payments exist but installment rows are still unpaid (or were
   * auto-generated as DUE by a GET), mark the corresponding installments PAID.
   * Does not create extra subscriptions or change unpaid-first-installment PENDING.
   */
  private async applySuccessfulPaymentsToInstallments(
    sub: {
      id: number;
      payments?: Array<{ id: number; totalAmount?: number | null; createdAt?: Date }>;
    },
    installments: Array<{
      id: number;
      installmentNumber: number;
      totalAmount: number;
      status: InstallmentStatus;
    }>,
  ): Promise<boolean> {
    if (!installments.length) return false;

    const payments = sub.payments || [];
    const totalPaidFromPayments = payments.reduce(
      (sum, payment) => sum + Number(payment.totalAmount || 0),
      0,
    );
    if (totalPaidFromPayments <= 0) return false;
    const unpaidInstallments = installments.filter((item) => item.status !== InstallmentStatus.PAID);
    if (unpaidInstallments.length === 0) {
      return false;
    }

    const installmentTotal = installments.reduce(
      (sum, item) => sum + Number(item.totalAmount || 0),
      0,
    );
    const latestPayment = payments[0];
    const paidAt = latestPayment?.createdAt || new Date();
    const paymentHistoryId = latestPayment?.id ?? null;

    if (totalPaidFromPayments + 0.5 >= installmentTotal) {
      await this.prisma.subscriptionInstallment.updateMany({
        where: { subscriptionId: sub.id, deletedAt: null },
        data: {
          status: InstallmentStatus.PAID,
          paidAt,
          paymentHistoryId,
        },
      });
    } else if (installments.every((item) => item.status !== InstallmentStatus.PAID)) {
      const first =
        installments.find((item) => item.installmentNumber === 1) || installments[0];
      await this.prisma.subscriptionInstallment.update({
        where: { id: first.id },
        data: {
          status: InstallmentStatus.PAID,
          paidAt,
          paymentHistoryId,
        },
      });
    } else {
      return false;
    }

    this.logger.log(
      `[INSTALLMENT_RECONCILE] subscriptionId: ${sub.id} paymentTotal: ${totalPaidFromPayments} installmentTotal: ${installmentTotal}`,
    );

    return true;
  }

  /**
   * Retrieves complete installment summary with accurate outstanding calculations, buffer state, and failure handling.
   */
  async getCustomerInstallmentSummary(customerId: number | string): Promise<CustomerInstallmentSummary> {
    const numCustomerId = Number(customerId);
    const now = new Date();

    let sub = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId, status: SubscriptionStatus.ACTIVE, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: true,
        installments: {
          orderBy: { installmentNumber: 'asc' },
        },
        payments: {
          where: { status: 'SUCCESS' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!sub) {
      sub = await this.prisma.customerSubscription.findFirst({
        where: {
          customerId: numCustomerId,
          status: { in: [SubscriptionStatus.PENDING, SubscriptionStatus.EXPIRED, SubscriptionStatus.CANCELED] },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          plan: true,
          installments: {
            orderBy: { installmentNumber: 'asc' },
          },
          payments: {
            where: { status: 'SUCCESS' },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${numCustomerId} not found`);
    }

    if (!sub) {
      return null;
    }

    let installments = sub.installments || [];

    // If no installment records exist in DB yet, generate them dynamically from plan value
    if (installments.length === 0) {
      const planPrice =
        sub.customPrice !== null && sub.customPrice !== undefined
          ? Number(sub.customPrice)
          : sub.billingCycle === SubscriptionBillingCycle.YEARLY
          ? Number(sub.plan?.yearlyPrice || 9599)
          : Number(sub.plan?.monthlyPrice || 999);
      const totalAmount = Math.round(planPrice * 1.18);
      await this.createInstallmentsForSubscription(numCustomerId, sub.id, totalAmount, 2, sub.startDate);
      const reloaded = await this.prisma.subscriptionInstallment.findMany({
        where: { subscriptionId: sub.id },
        orderBy: { installmentNumber: 'asc' },
      });
      installments = reloaded;
    }

    // A successful plan payment may exist without installment rows (webhook
    // activation) or with unpaid rows created by the GET fallback above.
    // Reconcile from SUCCESS payments so a paid purchase is not PENDING.
    const reconciled = await this.applySuccessfulPaymentsToInstallments(sub, installments);
    if (reconciled) {
      installments = await this.prisma.subscriptionInstallment.findMany({
        where: { subscriptionId: sub.id },
        orderBy: { installmentNumber: 'asc' },
      });
    }

    // Compute total plan amount and paid amount
    const totalPlanAmount = installments.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
    const paidInstallments = installments.filter((item) => item.status === InstallmentStatus.PAID);
    const totalPaidAmount = paidInstallments.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
    const outstandingAmount = Math.max(0, totalPlanAmount - totalPaidAmount);
    const isFullyPaid =
      installments.length > 0 &&
      outstandingAmount === 0 &&
      paidInstallments.length === installments.length;

    const breakdownItems: InstallmentBreakdownItem[] = installments.map((inst) => {
      const isPaid = inst.status === InstallmentStatus.PAID;
      const isExpiryPassed = now > new Date(inst.expiryDate);

      let displayStatus: string = inst.status;
      if (isPaid) {
        displayStatus = 'PAID';
      } else if (isExpiryPassed) {
        displayStatus = 'OVERDUE';
      } else if (inst.status === InstallmentStatus.DUE) {
        displayStatus = 'DUE';
      } else {
        displayStatus = 'UPCOMING';
      }

      return {
        id: inst.id,
        installmentNumber: inst.installmentNumber,
        totalInstallments: inst.totalInstallments,
        title: inst.title || `Installment ${inst.installmentNumber}`,
        amount: Number(inst.amount),
        taxAmount: Number(inst.taxAmount),
        totalAmount: Number(inst.totalAmount),
        status: inst.status,
        dueDate: inst.dueDate,
        expiryDate: inst.expiryDate,
        bufferDays: 0,
        bufferEndDate: inst.expiryDate,
        bufferRemainingDays: 0,
        isInBuffer: false,
        isExpired: isExpiryPassed,
        paidAt: inst.paidAt,
        paymentHistoryId: inst.paymentHistoryId,
        invoiceId: inst.invoiceId,
        notes: inst.notes,
        displayStatus,
      };
    });

    // Find first unpaid installment
    const dueInstallment = breakdownItems.find((i) => i.status !== InstallmentStatus.PAID);

    let isAccessAllowed = false;
    let isCustomerInBuffer = false;
    let isRenewalFailed = false;
    let canRenewCurrentPlan = true;
    let bufferRemainingDays = 0;
    let bufferStartDate: Date | null = null;
    let bufferEndDate: Date | null = null;
    let nextDueDate: Date | null = null;
    let activeInstallmentNumber = 1;
    let statusMessage = 'Your plan is active.';
    let failureMessage: string | null = null;
    let bufferMessage: string | null = null;
    let termsMessage = 'Please pay the upcoming installment by the due date to maintain uninterrupted plan access.';
    let planStatus = 'ACTIVE';
    let amountRequiredToContinue: number | null = null;
    let amountRequiredToRestart = totalPlanAmount;

    if (isFullyPaid) {
      isAccessAllowed = true;
      planStatus = 'FULLY_PAID';
      statusMessage = 'All installments paid in full. Plan is active.';
      activeInstallmentNumber = installments.length;
      canRenewCurrentPlan = false;
      amountRequiredToContinue = 0;
    } else if (dueInstallment) {
      activeInstallmentNumber = dueInstallment.installmentNumber;
      nextDueDate = dueInstallment.dueDate;
      amountRequiredToContinue = dueInstallment.totalAmount;

      const previousPaid = breakdownItems.filter(
        (i) => i.installmentNumber < dueInstallment.installmentNumber && i.status === InstallmentStatus.PAID,
      );
      const lastPaid = previousPaid[previousPaid.length - 1];

      if (lastPaid) {
        const isLastPaidExpired = now > new Date(lastPaid.expiryDate);

        this.logger.log(
          `[RENEWAL_CHECK] customerId: ${numCustomerId}, subscriptionId: ${sub.id}, installmentNumber: ${lastPaid.installmentNumber}, expiryDate: ${lastPaid.expiryDate.toISOString()}, currentDate: ${now.toISOString()}, isExpired: ${isLastPaidExpired}`,
        );

        if (!isLastPaidExpired) {
          // NORMAL VALIDITY
          isAccessAllowed = true;
          planStatus = 'ACTIVE';
          canRenewCurrentPlan = true;
          statusMessage = `Installment ${lastPaid.installmentNumber} active. Installment ${dueInstallment.installmentNumber} due on ${new Date(dueInstallment.dueDate).toLocaleDateString('en-IN')}.`;
          termsMessage = 'Please pay the upcoming installment by the due date to maintain uninterrupted plan access.';
        } else {
          // EXPIRED -> RENEWAL FAILED
          isAccessAllowed = false;
          isRenewalFailed = true;
          canRenewCurrentPlan = false;
          planStatus = 'RENEWAL_FAILED';
          amountRequiredToContinue = null; // Cannot simply continue old plan!
          amountRequiredToRestart = totalPlanAmount;

          statusMessage = 'Plan Status: Renewal Failed. To continue using our services, you must start a new plan.';
          failureMessage =
            'Your installment plan period has expired. To continue using our services, you must start a new plan.';
          termsMessage = TERMS_CONDITIONS_RENEWAL_FAILED;
        }
      } else {
        // First installment not yet paid
        const isFirstExpired = now > new Date(dueInstallment.expiryDate);
        if (isFirstExpired) {
          isAccessAllowed = false;
          isRenewalFailed = true;
          canRenewCurrentPlan = false;
          planStatus = 'RENEWAL_FAILED';
          statusMessage = 'First installment payment period has expired. Please start a new plan.';
          failureMessage = 'Initial installment payment deadline missed. Please start a new plan.';
          termsMessage = TERMS_CONDITIONS_RENEWAL_FAILED;
        } else {
          isAccessAllowed = false;
          planStatus = 'PENDING';
          canRenewCurrentPlan = true;
          statusMessage = 'Initial installment payment pending.';
        }
      }
    }

    this.logger.log(
      `[RENEWAL_RESULT] status: ${planStatus}, renewed: ${isFullyPaid || (isAccessAllowed && !isCustomerInBuffer)}, renewalFailed: ${isRenewalFailed}`,
    );

    return {
      customerId: numCustomerId,
      subscriptionId: sub.id,
      planId: sub.planId,
      planName: sub.plan?.name || 'Subscription Plan',
      originalPlanValue: totalPlanAmount,
      totalPlanAmount,
      totalPaidAmount,
      historicalPaidAmount: totalPaidAmount,
      outstandingAmount: isRenewalFailed ? 0 : outstandingAmount,
      isFullyPaid,
      activeInstallmentNumber,
      subscriptionStatus: planStatus,
      planStatus,
      isAccessAllowed,
      isInBuffer: isCustomerInBuffer,
      isRenewalFailed,
      canRenewCurrentPlan,
      amountRequiredToContinue,
      amountRequiredToRestart,
      newPlanPrice: totalPlanAmount,
      bufferDays: DEFAULT_BUFFER_DAYS,
      bufferRemainingDays,
      bufferStartDate,
      bufferEndDate,
      nextDueDate,
      installments: breakdownItems,
      statusMessage,
      failureMessage,
      bufferMessage,
      termsMessage,
    };
  }

  /**
   * Processes installment payment / renewal during active or buffer period.
   * If the buffer period has expired, it rejects continuation and requires a new plan purchase.
   */
  async payInstallment(
    customerId: number | string,
    installmentId: number | string,
    paymentDetails: {
      amount?: number;
      paymentMethod?: PaymentMethod | string;
      transactionId?: string;
      orderId?: string;
      paidByAdmin?: boolean;
      notes?: string;
    } = {},
  ) {
    const numCustomerId = Number(customerId);
    const numInstId = Number(installmentId);
    const now = new Date();

    const installment = await this.prisma.subscriptionInstallment.findFirst({
      where: { id: numInstId, customerId: numCustomerId, deletedAt: null },
      include: { subscription: { include: { plan: true } }, customer: true },
    });

    if (!installment) {
      throw new NotFoundException(`Installment #${numInstId} not found for customer ${numCustomerId}`);
    }

    // IDEMPOTENCY CHECK: If already paid, return existing result without duplicate side-effects
    if (installment.status === InstallmentStatus.PAID) {
      this.logger.warn(`[IDEMPOTENT_REPAYMENT_IGNORED] Installment #${numInstId} is already paid.`);
      return {
        success: true,
        message: `Installment #${installment.installmentNumber} was already paid.`,
        installmentId: installment.id,
        installmentNumber: installment.installmentNumber,
        isIdempotent: true,
      };
    }

    // Check if the previous installment expired beyond the buffer period
    const prevPaid = await this.prisma.subscriptionInstallment.findMany({
      where: {
        subscriptionId: installment.subscriptionId,
        installmentNumber: { lt: installment.installmentNumber },
        status: InstallmentStatus.PAID,
      },
      orderBy: { installmentNumber: 'desc' },
    });

    const lastPaid = prevPaid[0];
    if (lastPaid) {
      const isBufferExpired = now > new Date(lastPaid.bufferEndDate);
      if (isBufferExpired && !paymentDetails.paidByAdmin) {
        this.logger.warn(
          `[RENEWAL_REJECTED_BUFFER_EXPIRED] Customer #${numCustomerId} attempted to pay Installment #${installment.installmentNumber} after buffer expiry date ${lastPaid.bufferEndDate.toISOString()}`,
        );
        throw new BadRequestException(
          'Your installment plan renewal period has expired. Under our Terms & Conditions, the previous installment plan cannot be continued and a new plan must be purchased at the applicable full plan price.',
        );
      }
    }

    const payAmount = Number(paymentDetails.amount || installment.totalAmount);
    const baseAmount = Number(installment.amount || Math.round((payAmount / 1.18) * 100) / 100);
    const taxAmount = Number(installment.taxAmount || payAmount - baseAmount);
    const paymentMethod = (paymentDetails.paymentMethod as PaymentMethod) || PaymentMethod.RAZORPAY;
    const transactionId = paymentDetails.transactionId || `INST-TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const orderNumber =
      paymentDetails.orderId || `#QB-INST-${installment.subscriptionId}-${installment.installmentNumber}`;

    // Execute atomic transaction for installment settlement, payment history, invoice, and subscription extension
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create Payment History Record
      const payment = await tx.paymentHistory.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: installment.subscriptionId,
          planId: installment.subscription?.planId,
          planName: installment.subscription?.plan?.name || 'Subscription Plan',
          amount: baseAmount,
          taxAmount,
          totalAmount: payAmount,
          currency: 'INR',
          status: 'SUCCESS',
          paymentMethod,
          transactionId,
          orderNumber,
        },
      });

      // 2. Generate Invoice Record
      const invoiceNo = `INV-${now.getFullYear()}-${String(payment.id).padStart(6, '0')}`;
      let contact = await tx.contact.findFirst({
        where: { customerId: numCustomerId, deletedAt: null },
      });
      if (!contact) {
        contact = await tx.contact.create({
          data: {
            customerId: numCustomerId,
            firstName: installment.customer?.name || 'Customer',
            lastName: 'Account',
            email: installment.customer?.email || 'billing@customer.com',
            phone: installment.customer?.phone || 'N/A',
          },
        });
      }

      const invoice = await tx.invoice.create({
        data: {
          customerId: numCustomerId,
          contactId: contact.id,
          invoiceNo,
          status: InvoiceStatus.PAID,
          issueDate: now,
          dueDate: now,
          subTotal: baseAmount,
          taxAmount,
          discount: 0,
          totalAmount: payAmount,
          notes: withInvoiceItemsSnapshot(
            `Installment ${installment.installmentNumber} of ${installment.totalInstallments} payment for ${
              installment.subscription?.plan?.name || 'Plan'
            }. Method: ${paymentMethod}. Order: ${orderNumber}`,
            buildDefaultPlanLineItems(
              `Installment ${installment.installmentNumber} of ${installment.totalInstallments} - ${
                installment.subscription?.plan?.name || 'Plan'
              }`,
              baseAmount,
            ),
          ),
        },
      });

      await tx.paymentHistory.update({
        where: { id: payment.id },
        data: { invoiceUrl: invoiceNo },
      });

      // 3. Mark Installment as PAID
      const updatedInst = await tx.subscriptionInstallment.update({
        where: { id: installment.id },
        data: {
          status: InstallmentStatus.PAID,
          paidAt: now,
          paymentHistoryId: payment.id,
          invoiceId: invoice.id,
          notes: paymentDetails.notes || `Paid via ${paymentMethod} on ${now.toISOString()}`,
        },
      });

      // 4. Update subsequent installment status to DUE
      const nextInst = await tx.subscriptionInstallment.findFirst({
        where: {
          subscriptionId: installment.subscriptionId,
          installmentNumber: installment.installmentNumber + 1,
          deletedAt: null,
        },
      });

      if (nextInst && nextInst.status === InstallmentStatus.UPCOMING) {
        await tx.subscriptionInstallment.update({
          where: { id: nextInst.id },
          data: { status: InstallmentStatus.DUE },
        });
      }

      // 5. Extend subscription end date & ensure subscription is ACTIVE without resetting start date
      const extendedEndDate = new Date(installment.expiryDate);
      if (extendedEndDate < now) {
        extendedEndDate.setTime(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      }

      await tx.customerSubscription.update({
        where: { id: installment.subscriptionId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          endDate: extendedEndDate,
        },
      });

      await tx.customer.update({
        where: { id: numCustomerId },
        data: { isActive: true },
      });

      return {
        payment,
        invoice,
        installment: updatedInst,
      };
    });

    this.logger.log(
      `[INSTALLMENT_PAYMENT] installmentNumber: ${installment.installmentNumber}, amount: ${payAmount}, paymentStatus: SUCCESS`,
    );

    const summary = await this.getCustomerInstallmentSummary(numCustomerId);

    return {
      success: true,
      message: `Installment #${installment.installmentNumber} settled successfully.`,
      paymentId: result.payment.id,
      invoiceNumber: result.invoice.invoiceNo,
      installmentId: result.installment.id,
      installmentNumber: result.installment.installmentNumber,
      summary,
    };
  }

  /**
   * Starts a completely new plan when a customer's previous installment renewal has failed.
   * Closes the old subscription and provisions a fresh subscription, order, and installment schedule.
   */
  async startNewPlan(
    customerId: number | string,
    dto: {
      planId?: number;
      billingCycle?: SubscriptionBillingCycle | string;
      customPrice?: number;
      totalInstallments?: number;
      paymentMethod?: PaymentMethod | string;
      transactionId?: string;
      orderNumber?: string;
    } = {},
  ) {
    const numCustomerId = Number(customerId);
    const now = new Date();

    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${numCustomerId} not found`);
    }

    // Find and close prior subscription
    const oldSub = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (oldSub) {
      await this.prisma.customerSubscription.update({
        where: { id: oldSub.id },
        data: { status: SubscriptionStatus.EXPIRED },
      });

      // Mark uncompleted old installments as CANCELLED/EXPIRED
      await this.prisma.subscriptionInstallment.updateMany({
        where: {
          subscriptionId: oldSub.id,
          status: { in: [InstallmentStatus.PENDING, InstallmentStatus.DUE, InstallmentStatus.UPCOMING] },
        },
        data: { status: InstallmentStatus.CANCELLED },
      });
    }

    // Resolve plan to purchase
    const planId = Number(dto.planId || oldSub?.planId || 1);
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null, isActive: true },
    });

    if (!plan) {
      throw new BadRequestException('This subscription plan is no longer available. Please refresh the plans.');
    }

    const cycle = (dto.billingCycle as SubscriptionBillingCycle) || SubscriptionBillingCycle.MONTHLY;
    const basePrice =
      dto.customPrice !== undefined && dto.customPrice !== null
        ? Number(dto.customPrice)
        : cycle === SubscriptionBillingCycle.YEARLY
        ? Number(plan.yearlyPrice)
        : Number(plan.monthlyPrice);

    const fullTotalAmount = Math.round(basePrice * 1.18);
    const totalInstallments = 2; // Strict 50% Advance + 50% Second Installment
    const firstInstallmentTotal = Math.round(fullTotalAmount * 0.5 * 100) / 100;
    const firstInstallmentBase = Math.round((firstInstallmentTotal / 1.18) * 100) / 100;
    const firstInstallmentTax = Math.round((firstInstallmentTotal - firstInstallmentBase) * 100) / 100;

    const secondInstallmentTotal = Math.round((fullTotalAmount - firstInstallmentTotal) * 100) / 100;
    const secondInstallmentBase = Math.round((secondInstallmentTotal / 1.18) * 100) / 100;
    const secondInstallmentTax = Math.round((secondInstallmentTotal - secondInstallmentBase) * 100) / 100;

    const durationMonths = cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1;
    const { startDate, endDate: newEndDate } = calculateSubscriptionDates(now, durationMonths);
    const secondDueDate = new Date(startDate);
    secondDueDate.setDate(secondDueDate.getDate() + 30);

    const newSubResult = await this.prisma.$transaction(async (tx) => {
      // 1. Create NEW Subscription Record
      const newSub = await tx.customerSubscription.create({
        data: {
          customerId: numCustomerId,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          billingCycle: cycle,
          startDate,
          endDate: newEndDate,
          customPrice: dto.customPrice !== undefined ? dto.customPrice : null,
          customUserLimit: plan.userLimit,
          customLeadLimit: plan.leadLimit,
          customStorageLimit: plan.storageLimit,
          customFeatures: plan.features,
        },
      });

      // 2. Create Payment for First Installment (50% Advance)
      const paymentMethod = (dto.paymentMethod as PaymentMethod) || PaymentMethod.RAZORPAY;
      const orderNumber = dto.orderNumber || `#QB-NEW-${newSub.id}-INST-1`;
      const transactionId = dto.transactionId || `NEW-TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const payment = await tx.paymentHistory.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: newSub.id,
          planId: plan.id,
          planName: plan.name,
          amount: firstInstallmentBase,
          taxAmount: firstInstallmentTax,
          totalAmount: firstInstallmentTotal,
          currency: 'INR',
          status: 'SUCCESS',
          paymentMethod,
          transactionId,
          orderNumber,
        },
      });

      // 3. Generate Invoice
      const invoiceNo = `INV-${now.getFullYear()}-${String(payment.id).padStart(6, '0')}`;
      let contact = await tx.contact.findFirst({
        where: { customerId: numCustomerId, deletedAt: null },
      });
      if (!contact) {
        contact = await tx.contact.create({
          data: {
            customerId: numCustomerId,
            firstName: customer.name || 'Customer',
            lastName: 'Account',
            email: customer.email || 'billing@customer.com',
            phone: customer.phone || 'N/A',
          },
        });
      }

      const invoice = await tx.invoice.create({
        data: {
          customerId: numCustomerId,
          contactId: contact.id,
          invoiceNo,
          status: InvoiceStatus.PAID,
          issueDate: now,
          dueDate: now,
          subTotal: firstInstallmentBase,
          taxAmount: firstInstallmentTax,
          discount: 0,
          totalAmount: firstInstallmentTotal,
          notes: withInvoiceItemsSnapshot(
            `New Plan Purchase: Advance Payment (50%) for ${plan.name}. Order: ${orderNumber}`,
            buildDefaultPlanLineItems(`${plan.name} - Advance Payment (50%)`, firstInstallmentBase),
          ),
        },
      });

      await tx.paymentHistory.update({
        where: { id: payment.id },
        data: { invoiceUrl: invoiceNo },
      });

      // 4. Create Installments Schedule for the New Plan (50% + 50%)
      await tx.subscriptionInstallment.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: newSub.id,
          installmentNumber: 1,
          totalInstallments,
          title: 'Advance Payment (50%)',
          amount: firstInstallmentBase,
          taxAmount: firstInstallmentTax,
          totalAmount: firstInstallmentTotal,
          status: InstallmentStatus.PAID,
          dueDate: startDate,
          expiryDate: secondDueDate,
          bufferDays: 0,
          bufferEndDate: secondDueDate,
          paidAt: now,
          paymentHistoryId: payment.id,
          invoiceId: invoice.id,
          notes: 'New plan 50% advance payment',
        },
      });

      // Installment 2 (Second 50% Installment)
      await tx.subscriptionInstallment.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: newSub.id,
          installmentNumber: 2,
          totalInstallments,
          title: 'Second Installment (50%)',
          amount: secondInstallmentBase,
          taxAmount: secondInstallmentTax,
          totalAmount: secondInstallmentTotal,
          status: InstallmentStatus.DUE,
          dueDate: secondDueDate,
          expiryDate: newEndDate,
          bufferDays: 0,
          bufferEndDate: newEndDate,
        },
      });

      await tx.customer.update({
        where: { id: numCustomerId },
        data: { isActive: true },
      });

      return {
        newSub,
        payment,
        invoice,
      };
    });

    this.logger.log(
      `[NEW_PLAN] oldSubscriptionId: ${oldSub?.id || null}, newSubscriptionId: ${newSubResult.newSub.id}, originalPlanValue: ${fullTotalAmount}, newPlanValue: ${fullTotalAmount}`,
    );
    this.logger.log(
      `[PLAN_PURCHASE]\ncustomerId: ${numCustomerId}\nplanId: ${plan.id}\npurchaseDate: ${now.toISOString().split('T')[0]}\npaymentStatus: PARTIALLY_PAID\nsubscriptionId: ${newSubResult.newSub.id}`,
    );

    // Trigger Plan Purchase Calendar Email & Notification
    try {
      if (this.scheduleService) {
        await this.scheduleService.generateSchedulesForSubscription(newSubResult.newSub.id);
        await this.scheduleService.sendPlanPurchaseCalendarScheduleEmail({
          customerId: numCustomerId,
          subscriptionId: newSubResult.newSub.id,
          planId: plan.id,
          paymentId: newSubResult.payment.paymentId,
        });
      }
    } catch (schedErr: any) {
      this.logger.warn(`Non-fatal: Installment plan schedule email warning: ${schedErr?.message}`);
    }

    try {
      if (this.notificationService) {
        await this.notificationService.sendPlanPurchaseSuccessNotification({
          customerId: numCustomerId,
          subscriptionId: newSubResult.newSub.id,
          planId: plan.id,
          planName: plan.name,
          paymentId: newSubResult.payment.paymentId,
        });
      }
    } catch (notifErr: any) {
      this.logger.warn(`Non-fatal: Installment plan purchase notification warning: ${notifErr?.message}`);
    }

    const summary = await this.getCustomerInstallmentSummary(numCustomerId);

    return {
      success: true,
      message: `New plan '${plan.name}' started successfully with fresh installment schedule.`,
      newSubscriptionId: newSubResult.newSub.id,
      orderNumber: newSubResult.payment.orderNumber,
      invoiceNo: newSubResult.invoice.invoiceNo,
      summary,
    };
  }

  /**
   * Returns current subscription details formatted for GET /subscriptions/current
   */
  async getCurrentSubscription(customerId: number | string) {
    const numCustomerId = Number(customerId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${numCustomerId} not found`);
    }

    const summary = await this.getCustomerInstallmentSummary(numCustomerId);

    const now = new Date();
    const upcomingSub = await this.prisma.customerSubscription.findFirst({
      where: {
        customerId: numCustomerId,
        status: { not: SubscriptionStatus.CANCELED },
        deletedAt: null,
        startDate: { gt: now },
      },
      orderBy: { startDate: 'asc' },
      include: { plan: true },
    });

    const upcomingPlan = upcomingSub && upcomingSub.plan
      ? {
          id: String(upcomingSub.id),
          subscriptionId: String(upcomingSub.id),
          planId: String(upcomingSub.plan.id),
          planName: upcomingSub.plan.name,
          planCode: upcomingSub.plan.code,
          startDate: upcomingSub.startDate ? new Date(upcomingSub.startDate).toISOString().split('T')[0] : null,
          endDate: upcomingSub.endDate ? new Date(upcomingSub.endDate).toISOString().split('T')[0] : null,
          status: 'UPCOMING',
          billingCycle: upcomingSub.billingCycle || 'MONTHLY',
          price:
            upcomingSub.customPrice !== null && upcomingSub.customPrice !== undefined
              ? Number(upcomingSub.customPrice)
              : upcomingSub.billingCycle === SubscriptionBillingCycle.YEARLY
              ? Number(upcomingSub.plan.yearlyPrice)
              : Number(upcomingSub.plan.monthlyPrice),
        }
      : null;

    if (!summary) {
      this.logger.log(`[SUBSCRIPTION_DEBUG] customerId: ${numCustomerId}, no active subscription found`);
      return {
        success: true,
        data: null,
        currentPlan: null,
        upcomingPlan,
      };
    }

    this.logger.log(
      `[SUBSCRIPTION_DEBUG] customerId: ${numCustomerId}, subscriptionId: ${summary.subscriptionId}, planId: ${summary.planId}, status: ${summary.planStatus}`,
    );

    const paidInsts = (summary.installments || []).filter((i) => i.status === InstallmentStatus.PAID);
    const lastPaidInst = paidInsts.length > 0 ? paidInsts[paidInsts.length - 1] : null;
    const currentInst = lastPaidInst || (summary.installments && summary.installments.length > 0 ? summary.installments[0] : null);

    const activeSub = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId, status: SubscriptionStatus.ACTIVE, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    const targetSub =
      activeSub ||
      (await this.prisma.customerSubscription.findFirst({
        where: { customerId: numCustomerId, status: SubscriptionStatus.PENDING, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      }));

    if (!targetSub || !targetSub.plan) {
      this.logger.log(
        `[SUBSCRIPTION_DEBUG] customerId: ${numCustomerId}, no active or pending subscription found (planStatus: ${summary.planStatus})`,
      );
      return {
        success: true,
        data: null,
        currentPlan: null,
        subscription: null,
        upcomingPlan,
      };
    }

    const subscriptionObj = {
      id: String(targetSub.id),
      status: targetSub.status,
      customerId: String(numCustomerId),
      workspaceId: String(numCustomerId),
      planId: String(targetSub.planId),
      planName: targetSub.plan.name,
      planCode: targetSub.plan.code,
      billingCycle: targetSub.billingCycle || 'MONTHLY',
      price: targetSub.customPrice !== null && targetSub.customPrice !== undefined
        ? Number(targetSub.customPrice)
        : (targetSub.billingCycle === SubscriptionBillingCycle.YEARLY
            ? Number(targetSub.plan.yearlyPrice)
            : Number(targetSub.plan.monthlyPrice)),
      startDate: targetSub.startDate ? new Date(targetSub.startDate).toISOString() : null,
      endDate: targetSub.endDate ? new Date(targetSub.endDate).toISOString() : null,
      expiryDate: targetSub.endDate ? new Date(targetSub.endDate).toISOString() : null,
      isActive: targetSub.status === SubscriptionStatus.ACTIVE,
    };

    const currentData = {
      id: String(targetSub.id || summary.subscriptionId || ''),
      subscriptionId: summary.subscriptionId ? String(summary.subscriptionId) : String(targetSub.id),
      customerId: String(numCustomerId),
      workspaceId: String(numCustomerId),
      planId: String(targetSub.planId || summary.planId || ''),
      planName: targetSub.plan.name || summary.planName || 'No Active Plan',
      planCode: targetSub.plan.code || 'STANDARD',
      billingCycle: targetSub.billingCycle || 'MONTHLY',
      price: subscriptionObj.price ?? summary.originalPlanValue,
      originalPlanValue: summary.originalPlanValue,
      startDate: subscriptionObj.startDate,
      endDate: subscriptionObj.endDate,
      expiryDate: subscriptionObj.endDate,
      isActive: targetSub.status === SubscriptionStatus.ACTIVE,
      status: targetSub.status,
      currentInstallment: currentInst
        ? {
            number: currentInst.installmentNumber,
            amount: currentInst.totalAmount,
            paidAmount: currentInst.status === InstallmentStatus.PAID ? currentInst.totalAmount : 0,
            status: currentInst.status,
            expiryDate: currentInst.expiryDate
              ? new Date(currentInst.expiryDate).toISOString().split('T')[0]
              : null,
          }
        : null,
      renewal: {
        status: summary.planStatus,
        canRenew: summary.canRenewCurrentPlan,
        bufferStartDate: summary.bufferStartDate
          ? new Date(summary.bufferStartDate).toISOString().split('T')[0]
          : null,
        bufferEndDate: summary.bufferEndDate
          ? new Date(summary.bufferEndDate).toISOString().split('T')[0]
          : null,
        daysRemaining: summary.bufferRemainingDays,
      },
      newPlanRequired: summary.isRenewalFailed,
      newPlanPrice: summary.isRenewalFailed ? summary.newPlanPrice : null,
    };

    this.logger.log(
      `[SUBSCRIPTION_CURRENT_API] AUTH_USER_ID: ${numCustomerId} | CUSTOMER_ID: ${numCustomerId} | WORKSPACE_ID: ${numCustomerId} | PLAN_ID: ${subscriptionObj?.planId || 'NONE'} | SUBSCRIPTION_ID: ${subscriptionObj?.id || 'NONE'} | SUBSCRIPTION_STATUS: ${subscriptionObj?.status || 'NONE'} | START_DATE: ${subscriptionObj?.startDate || 'NONE'} | END_DATE: ${subscriptionObj?.endDate || 'NONE'}`,
    );

    return {
      success: true,
      data: currentData,
      currentPlan: currentData,
      subscription: subscriptionObj,
      upcomingPlan,
    };
  }

  /**
   * Returns renewal status payload for GET /subscriptions/renewal-status
   */
  async getRenewalStatus(customerId: number | string) {
    const numCustomerId = Number(customerId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${numCustomerId} not found`);
    }

    const sub = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: true,
        installments: {
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });

    const summary = await this.getCustomerInstallmentSummary(numCustomerId);

    const now = new Date();
    let daysRemaining = 0;
    if (sub?.endDate && now < new Date(sub.endDate)) {
      const diffMs = new Date(sub.endDate).getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    } else if (summary && summary.isInBuffer && summary.bufferRemainingDays > 0) {
      daysRemaining = summary.bufferRemainingDays;
    }

    this.logger.log(`[RENEWAL_STATUS_DEBUG]
customerId: ${numCustomerId}`);
    this.logger.log(`[RENEWAL_STATUS_DEBUG]
activeSubscriptionId: ${sub?.id ?? 'NONE'}`);
    this.logger.log(`[RENEWAL_STATUS_DEBUG]
renewalRecord: ${summary ? JSON.stringify({ subscriptionId: summary.subscriptionId, planStatus: summary.planStatus, isInBuffer: summary.isInBuffer }) : 'NONE'}`);
    this.logger.log(`[RENEWAL_STATUS_DEBUG]
isInBuffer: ${summary ? summary.isInBuffer : false}`);
    this.logger.log(`[RENEWAL_STATUS_DEBUG]
renewalStatus: ${summary ? summary.planStatus : (sub ? sub.status : 'NO_SUBSCRIPTION')}`);

    if (!sub || !summary) {
      return {
        success: true,
        data: {
          subscriptionId: null,
          status: 'NO_SUBSCRIPTION',
          canRenew: false,
          bufferPeriodActive: false,
          bufferStartDate: null,
          bufferEndDate: null,
          daysRemaining: 0,
          originalPlanValue: 0,
          nextInstallment: null,
          newPlanRequired: true,
        },
      };
    }

    const nextInst = (summary.installments || []).find(
      (i) => i.status !== InstallmentStatus.PAID,
    );

    return {
      success: true,
      data: {
        subscriptionId: summary.subscriptionId ? String(summary.subscriptionId) : null,
        status: summary.planStatus,
        canRenew: summary.canRenewCurrentPlan,
        bufferPeriodActive: summary.isInBuffer,
        bufferStartDate: summary.isInBuffer && summary.bufferStartDate
          ? new Date(summary.bufferStartDate).toISOString().split('T')[0]
          : null,
        bufferEndDate: summary.isInBuffer && summary.bufferEndDate
          ? new Date(summary.bufferEndDate).toISOString().split('T')[0]
          : null,
        daysRemaining,
        originalPlanValue: summary.originalPlanValue,
        nextInstallment: nextInst
          ? {
              number: nextInst.installmentNumber,
              amount: nextInst.totalAmount,
              status: nextInst.status,
            }
          : null,
        newPlanRequired: summary.isRenewalFailed,
      },
    };
  }

  /**
   * Initiates renewal for an existing installment under active buffer period
   */
  async renewExistingInstallment(
    customerId: number | string,
    subscriptionId: number | string,
    dto: { installmentId: number | string; paymentMethod?: string },
  ) {
    const numCustomerId = Number(customerId);
    const numSubId = Number(subscriptionId);
    const numInstId = Number(dto.installmentId);

    const sub = await this.prisma.customerSubscription.findFirst({
      where: { id: numSubId, customerId: numCustomerId, deletedAt: null },
    });

    if (!sub) {
      throw new NotFoundException('Subscription not found or not owned by customer.');
    }

    const installment = await this.prisma.subscriptionInstallment.findFirst({
      where: { id: numInstId, subscriptionId: numSubId, customerId: numCustomerId, deletedAt: null },
    });

    if (!installment) {
      throw new NotFoundException('Installment not found on this subscription.');
    }

    if (installment.status === InstallmentStatus.PAID) {
      throw new BadRequestException('This installment has already been paid.');
    }

    // Check offline payment setting if OFFLINE / CASH requested
    const paymentMethodUpper = (dto.paymentMethod || 'ONLINE').toUpperCase();
    if (paymentMethodUpper === 'OFFLINE' || paymentMethodUpper === 'CASH') {
      const paymentSetting = await this.prisma.paymentSetting.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      if (paymentSetting && paymentSetting.offlinePaymentEnabled === false) {
        throw new BadRequestException('Offline payment is currently disabled by Admin.');
      }
    }

    // Process payment / initiation
    const payResult = await this.payInstallment(numCustomerId, numInstId, {
      paymentMethod: paymentMethodUpper as PaymentMethod,
    });

    return {
      success: true,
      message: 'Installment renewal initiated successfully.',
      data: {
        subscriptionId: String(numSubId),
        installmentId: String(numInstId),
        status: 'PENDING',
        amount: installment.totalAmount,
        nextAction: 'PAYMENT',
      },
    };
  }

  /**
   * Sends 3-day reminders for pending second installments (50%) before due date.
   */
  async sendUpcomingInstallmentReminders(): Promise<{ remindersSent: number }> {
    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Find active second installments due within the next 3 days
    const upcomingSecondInstallments = await this.prisma.subscriptionInstallment.findMany({
      where: {
        installmentNumber: 2,
        status: { in: [InstallmentStatus.DUE, InstallmentStatus.PENDING, InstallmentStatus.UPCOMING] },
        dueDate: {
          gte: now,
          lte: threeDaysLater,
        },
        deletedAt: null,
      },
      include: {
        customer: {
          include: { users: { select: { id: true, email: true }, take: 1 } },
        },
        subscription: {
          include: { plan: true },
        },
      },
    });

    let remindersSent = 0;

    for (const inst of upcomingSecondInstallments) {
      // Check if a reminder for this installment has already been recorded
      const existingNotif = await this.prisma.notification.findFirst({
        where: {
          customerId: inst.customerId,
          type: 'PAYMENT_REMINDER',
          title: { contains: 'Second Installment' },
          createdAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) }, // Don't send more than once in 48h
        },
      });

      if (!existingNotif) {
        const dueDateFormatted = inst.dueDate
          ? new Date(inst.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'due date';
        const amountStr = Number(inst.totalAmount).toLocaleString('en-IN');
        const planName = inst.subscription?.plan?.name || 'Subscription Plan';
        const title = 'Second Installment Reminder (50%)';
        const body = `Your remaining 50% payment of ₹${amountStr} for ${planName} is due on ${dueDateFormatted} for the upcoming second installation.`;

        const targetUserId = inst.customer?.users?.[0]?.id;

        if (this.notificationService) {
          await this.notificationService.sendPushNotification({
            userId: targetUserId,
            customerId: inst.customerId,
            title,
            body,
            type: 'PAYMENT_REMINDER',
            data: {
              type: 'INSTALLMENT_REMINDER',
              installmentId: String(inst.id),
              subscriptionId: String(inst.subscriptionId),
              customerId: String(inst.customerId),
              amount: String(inst.totalAmount),
              dueDate: inst.dueDate ? inst.dueDate.toISOString() : '',
            },
          });
        } else if (targetUserId) {
          await this.prisma.notification.create({
            data: {
              customerId: inst.customerId,
              userId: targetUserId,
              title,
              message: body,
              type: 'PAYMENT_REMINDER',
              data: {
                installmentId: inst.id,
                subscriptionId: inst.subscriptionId,
                amount: inst.totalAmount,
                dueDate: inst.dueDate,
              },
            },
          });
        }

        remindersSent++;
        this.logger.log(
          `[INSTALLMENT_3DAY_REMINDER_SENT] Customer #${inst.customerId} Installment #${inst.id} Amount: ₹${amountStr} Due: ${dueDateFormatted}`,
        );
      }
    }

    return { remindersSent };
  }

  /**
   * Periodic scheduler to evaluate installment expiry and send upcoming 3-day reminders.
   */
  async evaluateAllActiveInstallments(): Promise<{ evaluatedCount: number; overdueCount: number; remindersSent: number }> {
    const now = new Date();
    const unpaidInstallments = await this.prisma.subscriptionInstallment.findMany({
      where: {
        status: { in: [InstallmentStatus.DUE, InstallmentStatus.PENDING] },
        deletedAt: null,
      },
      include: { subscription: true },
    });

    let overdueCount = 0;

    for (const inst of unpaidInstallments) {
      const isExpiryPassed = now > new Date(inst.expiryDate);
      if (isExpiryPassed && inst.status !== InstallmentStatus.OVERDUE) {
        await this.prisma.subscriptionInstallment.update({
          where: { id: inst.id },
          data: { status: InstallmentStatus.OVERDUE },
        });

        await this.prisma.customerSubscription.update({
          where: { id: inst.subscriptionId },
          data: { status: SubscriptionStatus.EXPIRED },
        });

        overdueCount++;
        this.logger.warn(
          `[INSTALLMENT_EXPIRED] Customer #${inst.customerId} Subscription #${inst.subscriptionId} Installment #${inst.installmentNumber} marked OVERDUE / RENEWAL_FAILED.`,
        );
      }
    }

    // Trigger 3-day installment reminders
    const { remindersSent } = await this.sendUpcomingInstallmentReminders();

    return {
      evaluatedCount: unpaidInstallments.length,
      overdueCount,
      remindersSent,
    };
  }
}
