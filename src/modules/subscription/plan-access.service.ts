import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionStatus } from '@prisma/client';

export interface EffectivePlanUsage {
  currentUsers: number;
  currentLeads: number;
  currentStorageBytes: bigint;
  scheduledWorks: number;
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
  storageLimitBytes: bigint;
  scheduleLimit: number;
  usedSchedules: number;
  remainingSchedules: number;
  features: any;
  usage: EffectivePlanUsage;
}

@Injectable()
export class PlanAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the effective plan for a customer.
   * Priority:
   * 1. Customer Subscription custom fields (customUserLimit, customLeadLimit, customStorageLimit, customFeatures, customPrice)
   * 2. If custom field is null/undefined -> Fallback to Base Plan values.
   */
  async getEffectivePlan(customerId: number | string): Promise<EffectivePlan> {
    if (!customerId) {
      throw new BadRequestException('customerId is required for plan resolution');
    }
    const numCustomerId = Number(customerId);
    if (isNaN(numCustomerId)) {
      throw new BadRequestException('Invalid customerId provided');
    }

    // 1. Fetch latest customer subscription
    const sub = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    let basePlan = sub?.plan;

    // If no subscription found, check if a default/fallback plan exists in DB
    if (!sub || !basePlan) {
      basePlan = await this.prisma.plan.findFirst({
        where: { deletedAt: null, isActive: true },
        orderBy: { monthlyPrice: 'asc' },
      });

      if (!basePlan) {
        // Fallback default structure
        return {
          customerId: numCustomerId,
          planId: 0,
          planName: 'Basic Package',
          planCode: 'BASIC',
          status: SubscriptionStatus.ACTIVE,
          isExpired: false,
          isActive: true,
          billingCycle: 'MONTHLY',
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          price: 9999,
          basePrice: 9999,
          customPrice: null,
          isCustomized: false,
          userLimit: 5,
          leadLimit: 500,
          storageLimitBytes: BigInt(5368709120),
          scheduleLimit: 10,
          usedSchedules: 0,
          remainingSchedules: 10,
          features: ['Customer Management', 'Calendar', 'Schedule', 'Works', 'Reports'],
          usage: {
            currentUsers: 0,
            currentLeads: 0,
            currentStorageBytes: BigInt(0),
            scheduledWorks: 0,
          },
        };
      }
    }

    // 2. Check expiration
    const now = new Date();
    const isExpired = sub
      ? sub.status === SubscriptionStatus.EXPIRED || (sub.endDate && now > new Date(sub.endDate))
      : false;
    const isCanceled = sub ? sub.status === SubscriptionStatus.CANCELED : false;
    const isPastDue = sub ? sub.status === SubscriptionStatus.PAST_DUE : false;
    const isActive = sub ? !isExpired && !isCanceled && !isPastDue : true;

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
    const [currentUsers, currentLeads, scheduledWorks, entitlements] = await Promise.all([
      this.prisma.employee.count({
        where: { customerId: numCustomerId, status: 'ACTIVE' },
      }),
      this.prisma.lead.count({
        where: { customerId: numCustomerId },
      }),
      this.prisma.work.count({
        where: { customerId: numCustomerId, status: 'SCHEDULED' },
      }),
      this.prisma.planEntitlement.findMany({
        where: { customerId: numCustomerId },
      }),
    ]);

    // Calculate Schedule Limits and Quotas
    let totalScheduleLimit = basePlan.code === 'BASIC' ? 10 : (basePlan.code === 'STANDARD' ? 20 : 50);
    let totalUsedSchedules = scheduledWorks;

    if (entitlements && entitlements.length > 0) {
      const entSum = entitlements.reduce((acc, e) => acc + (e.totalQty || 0), 0);
      const entUsed = entitlements.reduce((acc, e) => acc + ((e.usedQty || 0) + (e.scheduledQty || 0)), 0);
      if (entSum > 0) {
        totalScheduleLimit = entSum;
        totalUsedSchedules = entUsed;
      }
    }

    const remainingSchedules = Math.max(0, totalScheduleLimit - totalUsedSchedules);

    return {
      customerId: numCustomerId,
      subscriptionId: sub?.id,
      planId: basePlan.id,
      planName: basePlan.name,
      planCode: basePlan.code,
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
      storageLimitBytes: effectiveStorageLimitBytes,
      scheduleLimit: totalScheduleLimit,
      usedSchedules: totalUsedSchedules,
      remainingSchedules,
      features: effectiveFeatures,
      usage: {
        currentUsers,
        currentLeads,
        currentStorageBytes: BigInt(0),
        scheduledWorks,
      },
    };
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

    if (plan.usage.currentStorageBytes + added > plan.storageLimitBytes) {
      const allowedGB = Number(plan.storageLimitBytes / BigInt(1024 * 1024 * 1024));
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
