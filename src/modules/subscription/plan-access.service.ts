import { GoneException } from '@nestjs/common';
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {  } from '@prisma/client';
import { calculatePlanExpiry } from '../../common/utils/subscription-date.util';

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
  status: 'UPCOMING' | 'PENDING';
  billingCycle: string;
  price: number;
}

export interface EffectivePlan {
  customerId?: number;
  subscriptionId?: number;
  planId: number;
  planName: string;
  planCode: string;
  status: string | string;
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
  couponCode?: string | null;
  originalAmount?: number | null;
  discountAmount?: number | null;
  paidAmount?: number | null;
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
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Verifies that the customer's subscription is active and not expired.
   */
  async checkSubscriptionActive(customerId: number | string): Promise<EffectivePlan> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Enforces User Limit before creating a new user / employee.
   */
  async checkUserLimit(customerId: number | string): Promise<EffectivePlan> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Enforces Lead Limit before creating a new sales lead.
   */
  async checkLeadLimit(customerId: number | string): Promise<EffectivePlan> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Enforces Storage Limit before file uploads.
   */
  async checkStorageLimit(
    customerId: number | string,
    newFileSizeBytes: number | bigint = 0,
  ): Promise<EffectivePlan> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Enforces Feature Access based on plan feature configuration.
   */
  async checkFeatureAccess(
    customerId: number | string,
    featureName: string,
  ): Promise<EffectivePlan> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Enforces Schedule access and entitlement quotas for Customer.
   */
  async checkScheduleAccess(
    customerId: number | string,
    serviceName?: string,
  ): Promise<EffectivePlan> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }
}
