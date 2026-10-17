import { GoneException } from '@nestjs/common';
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
import { CommissionService } from '../commission/commission.service';
import { awardCommissionForPayment } from '../commission/commission-trigger.util';
import {
  
  
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
  status: string | string;
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
  customerId?: number;
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
    @Optional() private readonly commissionService?: CommissionService,
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
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
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
      status: string;
    }>,
  ): Promise<boolean> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Retrieves complete installment summary with accurate outstanding calculations, buffer state, and failure handling.
   */
  async getCustomerInstallmentSummary(customerId: number | string): Promise<CustomerInstallmentSummary> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
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
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
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
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Returns current subscription details formatted for GET /subscriptions/current
   */
  async getCurrentSubscription(customerId: number | string) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Returns renewal status payload for GET /subscriptions/renewal-status
   */
  async getRenewalStatus(customerId: number | string) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Initiates renewal for an existing installment under active buffer period
   */
  async renewExistingInstallment(
    customerId: number | string,
    subscriptionId: number | string,
    dto: { installmentId: number | string; paymentMethod?: string },
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Sends 3-day reminders for pending second installments (50%) before due date.
   */
  async sendUpcomingInstallmentReminders(): Promise<{ remindersSent: number }> {
return;
  }

  /**
   * Periodic scheduler to evaluate installment expiry and send upcoming 3-day reminders.
   */
  async evaluateAllActiveInstallments(): Promise<{ evaluatedCount: number; overdueCount: number; remindersSent: number }> {
return;
  }
}
