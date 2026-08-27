import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  InstallmentStatus,
  SubscriptionStatus,
  SubscriptionBillingCycle,
  PaymentMethod,
  InvoiceStatus,
} from '@prisma/client';

export const DEFAULT_BUFFER_DAYS = 3;

export const TERMS_CONDITIONS_RENEWAL_FAILED =
  'Under our Terms & Conditions, after the renewal period expires, the previous installment plan cannot be continued and a new plan must be purchased at the applicable full plan price.';

export const TERMS_CONDITIONS_BUFFER_ACTIVE =
  'Please renew your plan within the buffer period to continue under your current installment plan. If you do not renew within the buffer period, your installment plan will expire and you will need to start a new plan at the applicable full plan price.';

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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculates the buffer end date by adding buffer days to the expiry date.
   */
  public calculateBufferEndDate(expiryDate: Date, bufferDays: number = DEFAULT_BUFFER_DAYS): Date {
    const end = new Date(expiryDate);
    end.setDate(end.getDate() + bufferDays);
    return end;
  }

  /**
   * Initializes or refreshes installment schedule for a subscription.
   */
  async createInstallmentsForSubscription(
    customerId: number,
    subscriptionId: number,
    totalPlanAmount: number,
    totalInstallments: number = 3,
    startDate: Date = new Date(),
    installmentDurationDays: number = 30,
    bufferDays: number = DEFAULT_BUFFER_DAYS,
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
    const rawPerInstallment = Math.round((totalPlanAmount / totalInstallments) * 100) / 100;
    const basePerInstallment = Math.round((rawPerInstallment / 1.18) * 100) / 100;
    const taxPerInstallment = Math.round((rawPerInstallment - basePerInstallment) * 100) / 100;

    const createdList: any[] = [];

    for (let i = 1; i <= totalInstallments; i++) {
      if (paidNumbers.has(i)) {
        continue;
      }

      // Calculate dates for installment i
      const instStartDate = new Date(startDate);
      instStartDate.setDate(instStartDate.getDate() + (i - 1) * installmentDurationDays);

      const instExpiryDate = new Date(instStartDate);
      instExpiryDate.setDate(instExpiryDate.getDate() + installmentDurationDays);

      const instDueDate = new Date(instStartDate);
      const instBufferEndDate = this.calculateBufferEndDate(instExpiryDate, bufferDays);

      const isFirstDue = i === existingPaid.length + 1;
      const initialStatus = isFirstDue ? InstallmentStatus.DUE : InstallmentStatus.UPCOMING;

      const inst = await this.prisma.subscriptionInstallment.create({
        data: {
          customerId: numCustId,
          subscriptionId: numSubId,
          installmentNumber: i,
          totalInstallments,
          title: `Installment ${i} of ${totalInstallments}`,
          amount: basePerInstallment,
          taxAmount: taxPerInstallment,
          totalAmount: rawPerInstallment,
          status: initialStatus,
          dueDate: instDueDate,
          expiryDate: instExpiryDate,
          bufferDays,
          bufferEndDate: instBufferEndDate,
        },
      });

      this.logger.log(
        `[INSTALLMENT_STATUS] customerId: ${numCustId}, subscriptionId: ${numSubId}, installmentNumber: ${i}, expiryDate: ${instExpiryDate.toISOString()}, bufferEndDate: ${instBufferEndDate.toISOString()}, status: ${initialStatus}`,
      );
      createdList.push(inst);
    }

    return this.getCustomerInstallmentSummary(numCustId).then((res) => res.installments);
  }

  /**
   * Retrieves complete installment summary with accurate outstanding calculations, buffer state, and failure handling.
   */
  async getCustomerInstallmentSummary(customerId: number | string): Promise<CustomerInstallmentSummary> {
    const numCustomerId = Number(customerId);
    const now = new Date();

    const sub = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId, deletedAt: null },
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
      throw new NotFoundException(`No subscription found for customer ${numCustomerId}`);
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
      await this.createInstallmentsForSubscription(numCustomerId, sub.id, totalAmount, 3, sub.startDate);
      const reloaded = await this.prisma.subscriptionInstallment.findMany({
        where: { subscriptionId: sub.id },
        orderBy: { installmentNumber: 'asc' },
      });
      installments = reloaded;
    }

    // Compute total plan amount and paid amount
    const totalPlanAmount = installments.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
    const paidInstallments = installments.filter((item) => item.status === InstallmentStatus.PAID);
    const totalPaidAmount = paidInstallments.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
    const outstandingAmount = Math.max(0, totalPlanAmount - totalPaidAmount);
    const isFullyPaid = outstandingAmount === 0 && paidInstallments.length === installments.length;

    const breakdownItems: InstallmentBreakdownItem[] = installments.map((inst) => {
      const isPaid = inst.status === InstallmentStatus.PAID;
      const isExpiryPassed = now > new Date(inst.expiryDate);
      const isBufferPassed = now > new Date(inst.bufferEndDate);
      const isInThisBuffer = isExpiryPassed && !isBufferPassed;

      let remainingDaysInBuffer = 0;
      if (isInThisBuffer) {
        remainingDaysInBuffer = Math.max(
          0,
          Math.ceil((new Date(inst.bufferEndDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        );
      }

      let displayStatus: string = inst.status;
      if (isPaid) {
        displayStatus = 'PAID';
      } else if (isInThisBuffer) {
        displayStatus = 'IN_BUFFER';
      } else if (isBufferPassed) {
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
        bufferDays: inst.bufferDays,
        bufferEndDate: inst.bufferEndDate,
        bufferRemainingDays: remainingDaysInBuffer,
        isInBuffer: isInThisBuffer,
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
    let termsMessage = TERMS_CONDITIONS_BUFFER_ACTIVE;
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
        const isLastPaidBufferExpired = now > new Date(lastPaid.bufferEndDate);

        bufferStartDate = new Date(lastPaid.expiryDate);
        bufferEndDate = new Date(lastPaid.bufferEndDate);

        this.logger.log(
          `[RENEWAL_CHECK] customerId: ${numCustomerId}, subscriptionId: ${sub.id}, installmentNumber: ${lastPaid.installmentNumber}, expiryDate: ${lastPaid.expiryDate.toISOString()}, bufferEndDate: ${lastPaid.bufferEndDate.toISOString()}, currentDate: ${now.toISOString()}, isExpired: ${isLastPaidExpired}, isBufferExpired: ${isLastPaidBufferExpired}`,
        );

        if (!isLastPaidExpired) {
          // NORMAL VALIDITY
          isAccessAllowed = true;
          planStatus = 'ACTIVE';
          canRenewCurrentPlan = true;
          statusMessage = `Installment ${lastPaid.installmentNumber} active. Installment ${dueInstallment.installmentNumber} due on ${new Date(dueInstallment.dueDate).toLocaleDateString('en-IN')}.`;
          termsMessage = 'Please pay the upcoming installment by the due date to maintain uninterrupted plan access.';
        } else if (!isLastPaidBufferExpired) {
          // BUFFER PERIOD ACTIVE
          isAccessAllowed = true;
          isCustomerInBuffer = true;
          canRenewCurrentPlan = true;
          planStatus = 'BUFFER_PERIOD';
          bufferRemainingDays =
            lastPaid.bufferRemainingDays ||
            Math.max(0, Math.ceil((new Date(lastPaid.bufferEndDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
          const formattedBufferEnd = new Date(lastPaid.bufferEndDate).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });

          statusMessage = `Your plan renewal is pending. You have ${bufferRemainingDays} ${bufferRemainingDays === 1 ? 'day' : 'days'} to renew your plan. Renewal deadline: ${formattedBufferEnd}`;
          bufferMessage = `Your plan renewal is due. You have a limited buffer period to renew your plan. If you do not renew within the buffer period, your installment plan will expire and you will need to start a new plan at the applicable full plan price. Renewal deadline: ${formattedBufferEnd}`;
          termsMessage = TERMS_CONDITIONS_BUFFER_ACTIVE;
        } else {
          // BUFFER PERIOD EXPIRED -> RENEWAL FAILED
          isAccessAllowed = false;
          isRenewalFailed = true;
          canRenewCurrentPlan = false;
          planStatus = 'RENEWAL_FAILED';
          amountRequiredToContinue = null; // Cannot simply continue old plan!
          amountRequiredToRestart = totalPlanAmount;

          statusMessage = 'Plan Status: Renewal Failed. To continue using our services, you must start a new plan.';
          failureMessage =
            'Your installment plan renewal period has expired. You failed to renew your plan within the allowed buffer period. To continue using our services, you must start a new plan.';
          termsMessage = TERMS_CONDITIONS_RENEWAL_FAILED;
        }
      } else {
        // First installment not yet paid
        const isFirstBufferExpired = now > new Date(dueInstallment.bufferEndDate);
        if (isFirstBufferExpired) {
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
          notes: `Installment ${installment.installmentNumber} of ${installment.totalInstallments} payment for ${
            installment.subscription?.plan?.name || 'Plan'
          }. Method: ${paymentMethod}. Order: ${orderNumber}`,
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
    const planId = dto.planId || oldSub?.planId || 1;
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException(`Plan #${planId} not found`);
    }

    const cycle = (dto.billingCycle as SubscriptionBillingCycle) || SubscriptionBillingCycle.MONTHLY;
    const basePrice =
      dto.customPrice !== undefined && dto.customPrice !== null
        ? Number(dto.customPrice)
        : cycle === SubscriptionBillingCycle.YEARLY
        ? Number(plan.yearlyPrice)
        : Number(plan.monthlyPrice);

    const fullTotalAmount = Math.round(basePrice * 1.18);
    const totalInstallments = dto.totalInstallments || 3;
    const firstInstallmentTotal = Math.round((fullTotalAmount / totalInstallments) * 100) / 100;
    const firstInstallmentBase = Math.round((firstInstallmentTotal / 1.18) * 100) / 100;
    const firstInstallmentTax = Math.round((firstInstallmentTotal - firstInstallmentBase) * 100) / 100;

    const durationDays = cycle === SubscriptionBillingCycle.YEARLY ? 365 : 30;
    const newEndDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const newSubResult = await this.prisma.$transaction(async (tx) => {
      // 1. Create NEW Subscription Record
      const newSub = await tx.customerSubscription.create({
        data: {
          customerId: numCustomerId,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          billingCycle: cycle,
          startDate: now,
          endDate: newEndDate,
          customPrice: dto.customPrice !== undefined ? dto.customPrice : null,
          customUserLimit: plan.userLimit,
          customLeadLimit: plan.leadLimit,
          customStorageLimit: plan.storageLimit,
          customFeatures: plan.features,
        },
      });

      // 2. Create Payment for First Installment
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
          notes: `New Plan Purchase: Installment 1 of ${totalInstallments} for ${plan.name}. Order: ${orderNumber}`,
        },
      });

      await tx.paymentHistory.update({
        where: { id: payment.id },
        data: { invoiceUrl: invoiceNo },
      });

      // 4. Create Installments Schedule for the New Plan
      const inst1Expiry = new Date(now);
      inst1Expiry.setDate(inst1Expiry.getDate() + 30);
      const inst1BufferEnd = new Date(inst1Expiry);
      inst1BufferEnd.setDate(inst1BufferEnd.getDate() + DEFAULT_BUFFER_DAYS);

      await tx.subscriptionInstallment.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: newSub.id,
          installmentNumber: 1,
          totalInstallments,
          title: `Installment 1 of ${totalInstallments} (Advance)`,
          amount: firstInstallmentBase,
          taxAmount: firstInstallmentTax,
          totalAmount: firstInstallmentTotal,
          status: InstallmentStatus.PAID,
          dueDate: now,
          expiryDate: inst1Expiry,
          bufferDays: DEFAULT_BUFFER_DAYS,
          bufferEndDate: inst1BufferEnd,
          paidAt: now,
          paymentHistoryId: payment.id,
          invoiceId: invoice.id,
          notes: 'New plan initial installment payment',
        },
      });

      // Installment 2 (DUE)
      const inst2Start = new Date(inst1Expiry);
      const inst2Expiry = new Date(inst2Start);
      inst2Expiry.setDate(inst2Expiry.getDate() + 30);
      const inst2BufferEnd = new Date(inst2Expiry);
      inst2BufferEnd.setDate(inst2BufferEnd.getDate() + DEFAULT_BUFFER_DAYS);

      await tx.subscriptionInstallment.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: newSub.id,
          installmentNumber: 2,
          totalInstallments,
          title: `Installment 2 of ${totalInstallments}`,
          amount: firstInstallmentBase,
          taxAmount: firstInstallmentTax,
          totalAmount: firstInstallmentTotal,
          status: InstallmentStatus.DUE,
          dueDate: inst2Start,
          expiryDate: inst2Expiry,
          bufferDays: DEFAULT_BUFFER_DAYS,
          bufferEndDate: inst2BufferEnd,
        },
      });

      // Installment 3 (UPCOMING)
      if (totalInstallments >= 3) {
        const inst3Start = new Date(inst2Expiry);
        const inst3Expiry = new Date(inst3Start);
        inst3Expiry.setDate(inst3Expiry.getDate() + 30);
        const inst3BufferEnd = new Date(inst3Expiry);
        inst3BufferEnd.setDate(inst3BufferEnd.getDate() + DEFAULT_BUFFER_DAYS);

        await tx.subscriptionInstallment.create({
          data: {
            customerId: numCustomerId,
            subscriptionId: newSub.id,
            installmentNumber: 3,
            totalInstallments,
            title: `Installment 3 of ${totalInstallments}`,
            amount: firstInstallmentBase,
            taxAmount: firstInstallmentTax,
            totalAmount: firstInstallmentTotal,
            status: InstallmentStatus.UPCOMING,
            dueDate: inst3Start,
            expiryDate: inst3Expiry,
            bufferDays: DEFAULT_BUFFER_DAYS,
            bufferEndDate: inst3BufferEnd,
          },
        });
      }

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
   * Periodic scheduler to evaluate buffer expiry across active subscriptions.
   */
  async evaluateAllActiveInstallments(): Promise<{ evaluatedCount: number; overdueCount: number }> {
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
      const isBufferPassed = now > new Date(inst.bufferEndDate);
      if (isBufferPassed && inst.status !== InstallmentStatus.OVERDUE) {
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
          `[INSTALLMENT_BUFFER_EXPIRED] Customer #${inst.customerId} Subscription #${inst.subscriptionId} Installment #${inst.installmentNumber} marked OVERDUE / RENEWAL_FAILED.`,
        );
      }
    }

    return {
      evaluatedCount: unpaidInstallments.length,
      overdueCount,
    };
  }
}
