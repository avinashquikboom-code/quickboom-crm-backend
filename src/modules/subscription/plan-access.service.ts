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

export interface UpcomingPlanSummary {
  id: number | string;
  subscriptionId?: number;
  planId: number;
  planName: string;
  planCode: string;
  startDate: Date | string;
  endDate: Date | string;
  status: 'UPCOMING';
  billingCycle: string;
  price: number;
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
  upcomingPlan?: UpcomingPlanSummary | null;
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

    const match = str.match(/^(?:QB[-_]?)?CUST[-_]?0*(\d+)$/i);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const digitsMatch = str.match(/(\d+)$/);
    if (digitsMatch && digitsMatch[1]) {
      const parsed = parseInt(digitsMatch[1], 10);
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
    // Allow small 60-second grace buffer for clock skew on newly activated subscriptions
    const clockGraceTime = new Date(now.getTime() + 60 * 1000);

    // 1. Separate Future / Upcoming Subscriptions (startDate > clockGraceTime)
    const upcomingSubs = subs
      .filter((s) => {
        if (s.status === SubscriptionStatus.CANCELED || s.status === SubscriptionStatus.EXPIRED) return false;
        if (!s.startDate) return false;
        return new Date(s.startDate) > clockGraceTime && s.plan;
      })
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    // 2. Identify Current Subscriptions (startDate <= clockGraceTime or missing startDate)
    const currentSubs = subs.filter((s) => {
      if (s.status === SubscriptionStatus.CANCELED) return false;
      if (!s.startDate) return true;
      return new Date(s.startDate) <= clockGraceTime;
    });

    // 3. Prioritize active non-expired current subscription
    const activeSub = currentSubs.find(
      (s) =>
        s.status === SubscriptionStatus.ACTIVE &&
        (!s.endDate || new Date(s.endDate) >= now) &&
        s.plan,
    );

    // 4. Determine upcoming queued subscription
    const upcomingSub = activeSub
      ? upcomingSubs.find((s) => s.id !== activeSub.id && (!activeSub.endDate || new Date(s.startDate) > new Date(activeSub.endDate))) || (upcomingSubs.length > 0 ? upcomingSubs[0] : null)
      : (upcomingSubs.length > 0 ? upcomingSubs[0] : null);

    const upcomingPlan: UpcomingPlanSummary | null = upcomingSub && upcomingSub.plan
      ? {
          id: upcomingSub.id,
          subscriptionId: upcomingSub.id,
          planId: upcomingSub.plan.id,
          planName: upcomingSub.plan.name,
          planCode: upcomingSub.plan.code,
          startDate: upcomingSub.startDate,
          endDate: upcomingSub.endDate,
          status: 'UPCOMING',
          billingCycle: upcomingSub.billingCycle || 'MONTHLY',
          price:
            upcomingSub.customPrice !== null && upcomingSub.customPrice !== undefined
              ? Number(upcomingSub.customPrice)
              : upcomingSub.billingCycle === 'YEARLY'
              ? Number(upcomingSub.plan.yearlyPrice)
              : Number(upcomingSub.plan.monthlyPrice),
        }
      : null;

    // 5. Select active or latest subscription with a plan for limits evaluation
    const sub =
      activeSub ||
      currentSubs.find((s) => s.status === SubscriptionStatus.ACTIVE && s.plan) ||
      currentSubs.find((s) => s.plan) ||
      subs.find((s) => s.plan);

    let basePlan = sub?.plan;

    // If no active subscription exists and there is an upcoming plan with future start date, return upcomingPlan structure with isActive: false
    if (!activeSub && upcomingPlan && (!sub || !sub.startDate || new Date(sub.startDate) > now)) {
      return {
        customerId: numCustomerId,
        planId: upcomingPlan.planId,
        planName: upcomingPlan.planName,
        planCode: upcomingPlan.planCode,
        status: SubscriptionStatus.PENDING,
        isExpired: false,
        isActive: false,
        billingCycle: upcomingPlan.billingCycle,
        startDate: new Date(upcomingPlan.startDate),
        endDate: new Date(upcomingPlan.endDate),
        price: upcomingPlan.price,
        basePrice: upcomingPlan.price,
        customPrice: null,
        isCustomized: false,
        userLimit: 5,
        leadLimit: 500,
        storageLimitBytes: 0,
        scheduleLimit: 0,
        usedSchedules: 0,
        remainingSchedules: 0,
        features: [],
        services: [],
        usage: {
          currentUsers: 0,
          currentLeads: 0,
          currentStorageBytes: 0,
          scheduledWorks: 0,
        },
        upcomingPlan,
      };
    }

    // If no subscription at all found:
    if (!sub || !basePlan) {
      if (numCustomerId === 1) {
        return {
          customerId: 1,
          planId: 0,
          planName: 'Enterprise System Plan',
          planCode: 'ENTERPRISE_SYSTEM',
          status: SubscriptionStatus.ACTIVE,
          isExpired: false,
          isActive: true,
          billingCycle: 'YEARLY',
          startDate: new Date('2020-01-01'),
          endDate: new Date('2099-12-31'),
          price: 0,
          basePrice: 0,
          customPrice: null,
          isCustomized: false,
          userLimit: 999999,
          leadLimit: 999999,
          storageLimitBytes: BigInt('1099511627776'),
          scheduleLimit: 999999,
          usedSchedules: 0,
          remainingSchedules: 999999,
          features: ['ALL_FEATURES'],
          services: [],
          usage: {
            currentUsers: 0,
            currentLeads: 0,
            currentStorageBytes: 0,
            scheduledWorks: 0,
          },
          upcomingPlan: null,
        };
      }

      this.logger.debug(`[PLAN_DEBUG] No subscription found for customer ${numCustomerId}`);
      return null as any;
    }

    // 2. Check expiration & active state
    const subStartDate = sub.startDate ? new Date(sub.startDate) : null;
    const subEndDate = sub.endDate ? new Date(sub.endDate) : null;
    const isDirectExpired = sub.status === SubscriptionStatus.EXPIRED || (subEndDate ? now > subEndDate : false);
    const isExpired = isDirectExpired;
    const isCanceled = sub.status === SubscriptionStatus.CANCELED;
    const isPastDue = sub.status === SubscriptionStatus.PAST_DUE || isDirectExpired;
    // An active subscription remains active throughout its validity period and cannot be upcoming or expired or canceled
    const isUpcoming = Boolean(subStartDate && subStartDate > clockGraceTime);
    const isActive = !isUpcoming && sub.status === SubscriptionStatus.ACTIVE && !isExpired && !isCanceled;

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
      paymentStatus = 'FIRST_INSTALLMENT_PAID';
      scheduleUnlockStatus = 'UNLOCKED_15_DAYS';
      unlockedDays = 15;
    }

    const bufferRemainingDays = 0;

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
        isRenewalFailed: isDirectExpired && !isFullyPaid,
        canRenewCurrentPlan: !isDirectExpired,
        amountRequiredToRestart: fullTotalAmount,
        termsMessage: isDirectExpired
          ? 'Under our Terms & Conditions, after the plan expires, a new plan must be purchased at the applicable full plan price.'
          : 'Please complete your second installment before the due date.',
        failureMessage: isDirectExpired
          ? 'Your installment plan period has expired. To continue using our services, you must start a new plan.'
          : null,
      },
      usage: {
        currentUsers,
        currentLeads,
        currentStorageBytes: 0,
        scheduledWorks,
      },
      upcomingPlan,
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
    if (!plan || !plan.isActive || plan.isExpired) {
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
