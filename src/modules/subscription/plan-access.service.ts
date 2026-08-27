import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionStatus } from '@prisma/client';

export interface EffectivePlanUsage {
  currentUsers: number;
  currentLeads: number;
  currentStorageBytes: number | bigint;
  scheduledWorks: number;
}

export interface EffectivePlanServiceQuota {
  id?: number;
  serviceName: string;
  totalQty: number;
  usedQty: number;
  scheduledQty: number;
  remainingQty: number;
  validUntil?: Date;
}

export interface EffectivePlan {
  customerId: number;
  subscriptionId?: number;
  planId: number;
  planName: string;
  planCode: string;
  status: SubscriptionStatus;
  isExpired: boolean;
  isActive: boolean;
  billingCycle: string;
  startDate: Date;
  endDate: Date;
  price: number;
  basePrice: number;
  customPrice: number | null;
  isCustomized: boolean;
  userLimit: number;
  leadLimit: number;
  storageLimitBytes: number | bigint;
  scheduleLimit: number;
  usedSchedules: number;
  remainingSchedules: number;
  features: any;
  services: EffectivePlanServiceQuota[];
  quotas?: Record<string, any>;
  usage: EffectivePlanUsage;
}

@Injectable()
export class PlanAccessService {
  private readonly logger = new Logger(PlanAccessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to resolve customer ID from numeric, string, or alias formats
   */
  resolveCustomerId(customerId?: number | string): number | undefined {
    if (!customerId) return undefined;
    if (typeof customerId === 'number') {
      return !isNaN(customerId) && customerId > 0 ? customerId : undefined;
    }
    const str = String(customerId).trim();
    if (!str) return undefined;
    const directNum = Number(str);
    if (!isNaN(directNum) && directNum > 0) {
      return directNum;
    }

    const match = str.match(/^CUST[-_]?0*(\d+)$/i);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return undefined;
  }

  /**
   * Resolves the effective plan for a customer.
   * Priority:
   * 1. Customer Subscription custom fields (customUserLimit, customLeadLimit, customStorageLimit, customFeatures, customPrice)
   * 2. If custom field is null/undefined -> Fallback to Base Plan values.
   */
  async getEffectivePlan(customerId: number | string): Promise<EffectivePlan> {
    const startTime = Date.now();
    if (!customerId) {
      throw new BadRequestException('customerId is required for plan resolution');
    }
    const numCustomerId = this.resolveCustomerId(customerId);
    if (!numCustomerId) {
      throw new BadRequestException('Valid customerId is required for plan resolution');
    }
    this.logger.debug(`[PLAN_DEBUG] Start getEffectivePlan for customerId=${customerId} (resolved: ${numCustomerId})`);

    // 1. Fetch customer subscriptions
    const subStart = Date.now();
    const subs = await this.prisma.customerSubscription.findMany({
      where: { customerId: numCustomerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    this.logger.debug(`[PLAN_QUERY] subscription lookup: ${Date.now() - subStart}ms (count=${subs.length})`);

    const now = new Date();
    // Prioritize active non-expired subscription, otherwise latest active, otherwise latest created
    const sub =
      subs.find(
        (s) =>
          s.status === SubscriptionStatus.ACTIVE &&
          (!s.endDate || new Date(s.endDate) >= now),
      ) ||
      subs.find((s) => s.status === SubscriptionStatus.ACTIVE) ||
      subs[0];

    let basePlan = sub?.plan;

    // If no subscription found, return null so frontend/controllers know customer has no active plan
    if (!sub || !basePlan) {
      this.logger.debug(`[PLAN_DEBUG] No subscription found for customer ${numCustomerId}`);
      return null as any;
    }

    // 2. Check expiration & configurable buffer period (default 3 days)
    const bufferDays = 3;
    const subEndDate = sub.endDate ? new Date(sub.endDate) : null;
    const bufferEndDate = subEndDate ? new Date(subEndDate.getTime() + bufferDays * 24 * 60 * 60 * 1000) : null;

    const isDirectExpired = sub.status === SubscriptionStatus.EXPIRED || (subEndDate ? now > subEndDate : false);
    const isBufferExpired = bufferEndDate ? now > bufferEndDate : isDirectExpired;
    const isInBuffer = isDirectExpired && !isBufferExpired;

    // During buffer period, existing plan access continues!
    const isExpired = sub.status === SubscriptionStatus.EXPIRED || isBufferExpired;
    const isCanceled = sub.status === SubscriptionStatus.CANCELED;
    const isPastDue = sub.status === SubscriptionStatus.PAST_DUE && !isInBuffer;
    const isActive = (sub.status === SubscriptionStatus.ACTIVE || isInBuffer) && !isExpired && !isCanceled;

    // 3. Resolve Custom vs Base limits
    const effectiveUserLimit = sub?.customUserLimit !== null && sub?.customUserLimit !== undefined
      ? sub.customUserLimit
      : basePlan.userLimit;

    const effectiveLeadLimit = sub?.customLeadLimit !== null && sub?.customLeadLimit !== undefined
      ? sub.customLeadLimit
      : basePlan.leadLimit;

    const effectiveStorageLimitBytes = sub?.customStorageLimit !== null && sub?.customStorageLimit !== undefined
      ? BigInt(sub.customStorageLimit)
      : BigInt(basePlan.storageLimit);

    const effectiveFeatures = sub?.customFeatures || basePlan.features;

    const basePrice = sub?.billingCycle === 'YEARLY'
      ? Number(basePlan.yearlyPrice)
      : Number(basePlan.monthlyPrice);

    const effectivePrice = sub?.customPrice !== null && sub?.customPrice !== undefined
      ? Number(sub.customPrice)
      : basePrice;

    const isCustomized = Boolean(
      sub && (
        sub.customUserLimit !== null ||
        sub.customLeadLimit !== null ||
        sub.customStorageLimit !== null ||
        sub.customFeatures !== null ||
        sub.customPrice !== null
      )
    );

    // 4. Gather live usage counts & entitlements
    const usageStart = Date.now();
    const [currentUsers, currentLeads, scheduledWorks, completedWorks, entitlements] = await Promise.all([
      this.prisma.employee.count({
        where: { customerId: numCustomerId, status: 'ACTIVE' },
      }),
      this.prisma.lead.count({
        where: { customerId: numCustomerId },
      }),
      this.prisma.work.count({
        where: { customerId: numCustomerId, status: 'SCHEDULED' },
      }),
      this.prisma.work.count({
        where: {
          customerId: numCustomerId,
          subscriptionId: sub?.id,
          status: { in: ['COMPLETED', 'APPROVED'] },
        },
      }),
      this.prisma.planEntitlement.findMany({
        where: { customerId: numCustomerId },
      }),
    ]);
    this.logger.debug(`[PLAN_QUERY] usage counts (parallel): ${Date.now() - usageStart}ms (users=${currentUsers}, leads=${currentLeads}, works=${scheduledWorks}, completed=${completedWorks}, entitlements=${entitlements.length})`);

    // Calculate Schedule Limits and Quotas based on exact deliverables
    const planCodeUpper = (basePlan.code || '').toUpperCase();
    let totalScheduleLimit = planCodeUpper.includes('PREMIUM')
      ? 48
      : (planCodeUpper.includes('STANDARD') ? 17 : 11);
    let totalUsedSchedules = completedWorks;

    if (entitlements && entitlements.length > 0) {
      const entSum = entitlements.reduce((acc, e) => acc + (e.totalQty || 0), 0);
      const entUsed = entitlements.reduce((acc, e) => acc + (e.usedQty || 0), 0);
      if (entSum > 0) {
        totalScheduleLimit = entSum;
        totalUsedSchedules = entUsed > 0 ? entUsed : completedWorks;
      }
    }

    const remainingSchedules = Math.max(0, totalScheduleLimit - totalUsedSchedules);

    const services: EffectivePlanServiceQuota[] = (entitlements && entitlements.length > 0)
      ? entitlements.map((e) => ({
          id: e.id,
          serviceName: e.serviceName,
          totalQty: e.totalQty,
          usedQty: e.usedQty,
          scheduledQty: e.scheduledQty,
          remainingQty: Math.max(0, e.totalQty - e.usedQty),
          validUntil: e.validUntil || (sub?.endDate || new Date()),
        }))
      : (planCodeUpper.includes('PREMIUM')
          ? [
              { serviceName: 'Product Reels', totalQty: 2, usedQty: 0, scheduledQty: 0, remainingQty: 2 },
              { serviceName: 'Influencer Reels', totalQty: 8, usedQty: 0, scheduledQty: 0, remainingQty: 8 },
              { serviceName: 'Creative Posts', totalQty: 8, usedQty: 0, scheduledQty: 0, remainingQty: 8 },
              { serviceName: 'Stories', totalQty: 30, usedQty: 0, scheduledQty: 0, remainingQty: 30 },
            ]
          : (planCodeUpper.includes('STANDARD')
              ? [
                  { serviceName: 'Reels', totalQty: 6, usedQty: 0, scheduledQty: 0, remainingQty: 6 },
                  { serviceName: 'Creative Posts', totalQty: 4, usedQty: 0, scheduledQty: 0, remainingQty: 4 },
                  { serviceName: 'Influencer Promotions', totalQty: 2, usedQty: 0, scheduledQty: 0, remainingQty: 2 },
                  { serviceName: 'Stories', totalQty: 5, usedQty: 0, scheduledQty: 0, remainingQty: 5 },
                ]
              : [
                  { serviceName: 'Reels', totalQty: 4, usedQty: 0, scheduledQty: 0, remainingQty: 4 },
                  { serviceName: 'Creative Posts', totalQty: 3, usedQty: 0, scheduledQty: 0, remainingQty: 3 },
                  { serviceName: 'Influencer Promotion', totalQty: 1, usedQty: 0, scheduledQty: 0, remainingQty: 1 },
                  { serviceName: 'Stories', totalQty: 3, usedQty: 0, scheduledQty: 0, remainingQty: 3 },
                ]));

    const installments = this.prisma.subscriptionInstallment?.findMany
      ? await this.prisma.subscriptionInstallment.findMany({
          where: { customerId: numCustomerId, deletedAt: null },
          orderBy: { installmentNumber: 'asc' },
        })
      : [];

    let totalPaid = 0;
    let fullTotalAmount = Math.round(effectivePrice * 1.18);
    let remainingBalance = fullTotalAmount;

    if (installments.length > 0) {
      fullTotalAmount = installments.reduce((sum, inst) => sum + Number(inst.totalAmount || 0), 0);
      const paidInsts = installments.filter((inst) => inst.status === 'PAID');
      totalPaid = paidInsts.reduce((sum, inst) => sum + Number(inst.totalAmount || 0), 0);
      remainingBalance = Math.max(0, fullTotalAmount - totalPaid);
    } else {
      const payments = this.prisma.paymentHistory?.findMany
        ? await this.prisma.paymentHistory.findMany({
            where: { customerId: numCustomerId, status: 'SUCCESS' },
          })
        : [];
      totalPaid = Array.isArray(payments)
        ? payments.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0)
        : 0;
      remainingBalance = Math.max(0, fullTotalAmount - totalPaid);
    }

    const firstInstallmentAmount = Math.round(fullTotalAmount / (installments.length || 2));
    const secondInstallmentAmount = fullTotalAmount - firstInstallmentAmount;
    const isFullyPaid = remainingBalance === 0 && totalPaid >= fullTotalAmount;
    const isFirstInstallmentPaid = totalPaid > 0;

    let paymentStatus = 'PENDING_FIRST_INSTALLMENT';
    let scheduleUnlockStatus = 'LOCKED_ALL';
    let unlockedDays = 0;

    if (isFullyPaid) {
      paymentStatus = 'FULLY_PAID';
      scheduleUnlockStatus = 'UNLOCKED_FULL';
      unlockedDays = 30;
    } else if (isFirstInstallmentPaid) {
      paymentStatus = isInBuffer ? 'IN_BUFFER_PERIOD' : 'FIRST_INSTALLMENT_PAID';
      scheduleUnlockStatus = 'UNLOCKED_15_DAYS';
      unlockedDays = 15;
    }

    const bufferRemainingDays = isInBuffer && bufferEndDate
      ? Math.max(0, Math.ceil((bufferEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    const result: EffectivePlan = {
      customerId: numCustomerId,
      subscriptionId: sub?.id,
      planId: basePlan.id,
      planName: isCustomized ? 'Custom Plan' : basePlan.name,
      planCode: isCustomized ? 'CUSTOM' : basePlan.code,
      status: isExpired ? SubscriptionStatus.EXPIRED : (sub?.status || SubscriptionStatus.ACTIVE),
      isExpired,
      isActive,
      billingCycle: sub?.billingCycle || 'MONTHLY',
      startDate: sub?.startDate || new Date(),
      endDate: sub?.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      price: effectivePrice,
      basePrice,
      customPrice: sub?.customPrice !== null && sub?.customPrice !== undefined ? Number(sub.customPrice) : null,
      isCustomized,
      userLimit: effectiveUserLimit,
      leadLimit: effectiveLeadLimit,
      storageLimitBytes: Number(effectiveStorageLimitBytes),
      scheduleLimit: totalScheduleLimit,
      usedSchedules: totalUsedSchedules,
      remainingSchedules,
      features: effectiveFeatures,
      services,
      quotas: {
        scheduleLimit: totalScheduleLimit,
        usedSchedules: totalUsedSchedules,
        remainingSchedules,
        totalAmount: fullTotalAmount,
        totalPaid,
        remainingBalance,
        outstandingAmount: remainingBalance,
        firstInstallmentAmount,
        secondInstallmentAmount,
        isFullyPaid,
        isFirstInstallmentPaid,
        paymentStatus,
        isRenewalFailed: isDirectExpired && isBufferExpired && !isFullyPaid,
        canRenewCurrentPlan: !isBufferExpired,
        amountRequiredToRestart: fullTotalAmount,
        termsMessage: isDirectExpired && isBufferExpired
          ? 'Under our Terms & Conditions, after the renewal period expires, the previous installment plan cannot be continued and a new plan must be purchased at the applicable full plan price.'
          : 'Please renew your plan within the buffer period to continue under your current installment plan.',
        failureMessage: isDirectExpired && isBufferExpired
          ? 'Your installment plan renewal period has expired. You failed to renew your plan within the allowed buffer period. To continue using our services, you must start a new plan.'
          : null,
      },
      usage: {
        currentUsers,
        currentLeads,
        currentStorageBytes: 0,
        scheduledWorks,
      },
    };

    const duration = Date.now() - startTime;
    this.logger.log(
      `[API_PERFORMANCE] GET /subscriptions/effective-plan customerId=${customerId} total=${duration}ms`,
    );
    this.logger.debug(
      `[PLAN_DEBUG] completed - customerId=${numCustomerId}, scheduleLimit=${result.scheduleLimit}, services=${result.services.length}`,
    );

    return result;
  }

  /**
   * Verifies that the customer's subscription is active and not expired.
   */
  async checkSubscriptionActive(customerId: number | string): Promise<EffectivePlan> {
    const plan = await this.getEffectivePlan(customerId);
    if (!plan.isActive || plan.isExpired) {
      throw new ForbiddenException(
        'Your subscription is expired or inactive. Restricted plan operations are blocked. Please renew your plan.',
      );
    }
    return plan;
  }

  /**
   * Enforces User Limit before creating a new user / employee.
   */
  async checkUserLimit(customerId: number | string): Promise<EffectivePlan> {
    const plan = await this.checkSubscriptionActive(customerId);

    if (plan.usage.currentUsers >= plan.userLimit) {
      throw new BadRequestException(
        `User limit reached. Your current plan allows a maximum of ${plan.userLimit} users. (Current: ${plan.usage.currentUsers})`,
      );
    }

    return plan;
  }

  /**
   * Enforces Lead Limit before creating a new sales lead.
   */
  async checkLeadLimit(customerId: number | string): Promise<EffectivePlan> {
    const plan = await this.checkSubscriptionActive(customerId);

    if (plan.usage.currentLeads >= plan.leadLimit) {
      throw new BadRequestException(
        `Lead limit reached. Your current plan allows a maximum of ${plan.leadLimit} leads. (Current: ${plan.usage.currentLeads})`,
      );
    }

    return plan;
  }

  /**
   * Enforces Storage Limit before file uploads.
   */
  async checkStorageLimit(
    customerId: number | string,
    newFileSizeBytes: number | bigint = 0,
  ): Promise<EffectivePlan> {
    const plan = await this.checkSubscriptionActive(customerId);
    const added = BigInt(newFileSizeBytes);
    const currentBytes = BigInt(plan.usage.currentStorageBytes);
    const limitBytes = BigInt(plan.storageLimitBytes);

    if (currentBytes + added > limitBytes) {
      const allowedGB = Number(limitBytes / BigInt(1024 * 1024 * 1024));
      throw new BadRequestException(
        `Storage limit exceeded. Your current plan allows up to ${allowedGB} GB.`,
      );
    }

    return plan;
  }

  /**
   * Enforces Feature Access based on plan feature configuration.
   */
  async checkFeatureAccess(
    customerId: number | string,
    featureName: string,
  ): Promise<EffectivePlan> {
    const plan = await this.checkSubscriptionActive(customerId);
    const features = plan.features;

    let hasAccess = false;

    if (Array.isArray(features)) {
      const query = featureName.toLowerCase().trim();
      hasAccess = features.some((f: any) => {
        const str = typeof f === 'string' ? f.toLowerCase() : (f?.name || f?.id || '').toLowerCase();
        return str.includes(query) || query.includes(str);
      });
    } else if (typeof features === 'object' && features !== null) {
      hasAccess = Boolean((features as any)[featureName]);
    }

    // By default, core features are allowed unless explicitly restricted
    const coreFeatures = ['customer', 'employee', 'work', 'visit', 'lead', 'schedule', 'calendar'];
    const isCore = coreFeatures.some((c) => featureName.toLowerCase().includes(c));

    if (!hasAccess && !isCore) {
      throw new ForbiddenException(
        `Feature "${featureName}" is not available in your current plan (${plan.planName}).`,
      );
    }

    return plan;
  }

  /**
   * Enforces Schedule access and entitlement quotas for Customer.
   */
  async checkScheduleAccess(
    customerId: number | string,
    serviceName?: string,
  ): Promise<EffectivePlan> {
    const plan = await this.checkSubscriptionActive(customerId);

    // If customer has a specific PlanEntitlement configured for this service
    if (serviceName) {
      const entitlement = await this.prisma.planEntitlement.findFirst({
        where: { customerId: plan.customerId, serviceName },
      });

      if (entitlement && entitlement.totalQty > 0) {
        if (entitlement.usedQty + entitlement.scheduledQty >= entitlement.totalQty) {
          throw new BadRequestException(
            `Schedule limit reached. Your current plan allows ${entitlement.totalQty} schedules.`,
          );
        }
      }
    }

    // Total schedule limit check
    if (plan.usedSchedules >= plan.scheduleLimit) {
      throw new BadRequestException(
        `Schedule limit reached. Your current plan allows ${plan.scheduleLimit} schedules.`,
      );
    }

    return plan;
  }
}
