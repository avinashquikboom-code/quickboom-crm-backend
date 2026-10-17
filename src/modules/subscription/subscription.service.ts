import { subscriptionPrice } from '../customer/billing-price.util';
import { CustomerService } from '../customer/customer.service';
import { GoneException } from '@nestjs/common';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  Logger,
  Optional,
} from '@nestjs/common';
import { Prisma, PaymentMethod, InvoiceStatus,  } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUserSuperAdmin, isUserAdmin } from '../../common/utils/account.util';
import {
  SubscriptionBillingCycle,
  
  CreateOrderDto,
  RenewSubscriptionDto,
} from './dto/subscription.dto';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { NotificationService } from '../notification/notification.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService, renderEmailTemplate } from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InvoiceService } from '../invoice/invoice.service';
import { CommissionService } from '../commission/commission.service';
import { awardCommissionForPayment, QualifyingPayment } from '../commission/commission-trigger.util';
import { CouponService } from './coupon.service';
import { extractDeliverableQuotas } from '../../common/utils/plan-deliverable.util';
import {
  calculatePlanExpiry,
  calculateSubscriptionStartDate,
  calculateSubscriptionDates,
  resolvePlanSubscriptionDates,
  resolveSubscriptionActivationDate,
  resolveSubscriptionExpiryDate,
  calculateDaysRemaining,
  deriveSubscriptionStatus,
  getExpiryNotificationPayload,
} from '../../common/utils/subscription-date.util';
import {
  buildDefaultPlanLineItems,
  withInvoiceItemsSnapshot,
} from '../../common/utils/invoice-items.util';
import { generateAgreementPdfBuffer } from '../../common/utils/agreement-pdf.util';

@Injectable()
export class SubscriptionService {
  private validatePlanPricing(dto: any) {
    for (const key of ["monthlyPrice"])
      if (
        dto[key] !== undefined &&
        (!Number.isFinite(Number(dto[key])) ||
          Number(dto[key]) < 0 ||
          !new Prisma.Decimal(String(dto[key])).mul(100).isInteger())
      )
        throw new BadRequestException(
          "Price must be non-negative rupees with at most two decimals",
        );
    for (const key of ["taxRateBps", "yearlyDiscountBps"])
      if (
        dto[key] !== undefined &&
        (!Number.isInteger(dto[key]) || dto[key] < 0 || dto[key] > 10000)
      )
        throw new BadRequestException(
          "Rates must be integer basis points from 0 to 10000",
        );
    if (
      dto.billingIntervals !== undefined &&
      (!Array.isArray(dto.billingIntervals) ||
        !dto.billingIntervals.length ||
        dto.billingIntervals.some((c) => !["MONTHLY", "YEARLY"].includes(c)))
    )
      throw new BadRequestException("Invalid billing intervals");
    for (const key of ["isActive", "isRecommended"])
      if (dto[key] !== undefined && typeof dto[key] !== "boolean")
        throw new BadRequestException("Expected boolean");
  }

  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private prisma: PrismaService,
    private scheduleService?: ScheduleService,
    private workService?: WorkService,
    @Optional() private notificationService?: NotificationService,
    @Optional() private emailService?: EmailService,
    @Optional() private emailTemplateService?: EmailTemplateService,
    @Optional() private whatsappService?: WhatsappService,
    @Optional() private invoiceService?: InvoiceService,
    @Optional() private commissionService?: CommissionService,
    @Optional() private couponService?: CouponService,
    @Optional() private customers?: CustomerService,
  ) {}

  static calculateExpiryDate(startDate: Date, cycle: SubscriptionBillingCycle, durationMonths?: number): Date {
    const months = durationMonths || (cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1);
    return calculatePlanExpiry(startDate, months);
  }

  async getPlans(includeInactive = false) {
    this.logger.log(
      `[PLAN_API_DEBUG]\nendpoint: /plans\nincludeInactive: ${includeInactive}`,
    );

    const where: any = { deletedAt: null };
    if (!includeInactive) {
      where.isActive = true;
    }

    const plans = await this.prisma.plan.findMany({
      where,
      orderBy: { monthlyPrice: "asc" },
    });

    this.logger.log(`[PLAN_API_DEBUG]\ndatabaseResult count: ${plans.length}`);

    const paymentMethods = await this.resolvePaymentMethodsConfig();

    const mapped = plans.map((p) => {
      let subtitle = "Custom Plan";
      if (p.code === "BASIC") subtitle = "Starter Plan";
      else if (p.code === "STANDARD") subtitle = "Growth Plan";
      else if (p.code === "PREMIUM") subtitle = "Scale Plan";
      else if (p.description) subtitle = p.description;

      return {
        id: p.id,
        name: p.name,
        code: p.code,
        subtitle,
        description: p.description,
        monthlyPrice: Number(p.monthlyPrice),
        yearlyPrice: Number(p.yearlyPrice),
        userLimit: p.userLimit,

        storageLimitBytes: Number(p.storageLimit),
        features: p.features,
        isActive: p.isActive,
        isRecommended: p.isRecommended,
        taxRateBps: p.taxRateBps,
        yearlyDiscountBps: p.yearlyDiscountBps,
        billingIntervals: p.billingIntervals,
        pricing: Object.fromEntries(
          p.billingIntervals.map((cycle) => [
            cycle,
            subscriptionPrice(p, cycle),
          ]),
        ),
        paymentMethods,
        onlinePaymentEnabled: paymentMethods.online,
        offlinePaymentEnabled: paymentMethods.offline,
      };
    });

    this.logger.log(`[PLAN_API_DEBUG]\nresponseData count: ${mapped.length}`);
    return mapped;
  }

  async getPlanById(id: number | string, includeInactive = false) {
    const numId = Number(id);
    if (!numId || isNaN(numId)) {
      throw new BadRequestException("Valid Plan ID is required");
    }

    const where: any = { id: numId, deletedAt: null };
    if (!includeInactive) {
      where.isActive = true;
    }

    const plan = await this.prisma.plan.findFirst({
      where,
    });

    if (!plan) {
      throw new NotFoundException(
        "This subscription plan is no longer available.",
      );
    }

    let subtitle = "Custom Plan";
    if (plan.code === "BASIC") subtitle = "Starter Plan";
    else if (plan.code === "STANDARD") subtitle = "Growth Plan";
    else if (plan.code === "PREMIUM") subtitle = "Scale Plan";
    else if (plan.description) subtitle = plan.description;

    const paymentMethods = await this.resolvePaymentMethodsConfig();

    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      subtitle,
      description: plan.description,
      monthlyPrice: Number(plan.monthlyPrice),
      yearlyPrice: Number(plan.yearlyPrice),
      userLimit: plan.userLimit,

      storageLimitBytes: Number(plan.storageLimit),
      features: plan.features,
      isActive: plan.isActive,
      isRecommended: plan.isRecommended,
      taxRateBps: plan.taxRateBps,
      yearlyDiscountBps: plan.yearlyDiscountBps,
      billingIntervals: plan.billingIntervals,
      pricing: Object.fromEntries(
        plan.billingIntervals.map((cycle) => [
          cycle,
          subscriptionPrice(plan, cycle),
        ]),
      ),
      paymentMethods,
      onlinePaymentEnabled: paymentMethods.online,
      offlinePaymentEnabled: paymentMethods.offline,
    };
  }

  private async resolvePaymentMethodsConfig(): Promise<{ online: boolean; offline: boolean }> {
    try {
      const [psRecord, intRecord] = await Promise.all([
        (this.prisma as any).paymentSetting?.findFirst().catch(() => null),
        this.prisma.integrationSetting?.findUnique({ where: { provider: 'RAZORPAY' } }).catch(() => null),
      ]);

      const config = (intRecord?.config as any) || {};

      let offline = true;
      if (config.enableOfflinePayment !== undefined) {
        offline = Boolean(config.enableOfflinePayment);
      } else if (psRecord?.offlinePaymentEnabled !== undefined) {
        offline = Boolean(psRecord.offlinePaymentEnabled);
      }

      let online = Boolean(process.env.RAZORPAY_KEY_ID);
      if (intRecord?.isEnabled !== undefined) {
        online = Boolean(intRecord.isEnabled);
      } else if (psRecord?.razorpayEnabled !== undefined) {
        online = Boolean(psRecord.razorpayEnabled);
      }

      return { online, offline };
    } catch (_) {
      return { online: true, offline: true };
    }
  }

  async getCurrentSubscription(customerId: number | string) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  async getCustomerOrders(
    customerId: number | string,
    query: { page?: number; limit?: number; search?: string; status?: string } = {},
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  async getOrderInvoice(customerId: number | string, orderIdOrNumber: string | number) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  async createOrder(customerId: number | string, dto: CreateOrderDto) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  async renewSubscription(customerId: number | string, dto: RenewSubscriptionDto) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  async createPlan(dto: {
    name: string;
    code?: string;
    description?: string;
    monthlyPrice: number;
    yearlyPrice?: number;
    userLimit?: number;
    leadLimit?: number;
    storageLimitBytes?: number;
    features?: string[];
    taxRateBps?: number;
    yearlyDiscountBps?: number;
    billingIntervals?: string[];
    isRecommended?: boolean;
    isActive?: boolean;
  }) {
    this.validatePlanPricing(dto);
    const code = dto.code || dto.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const monthlyPrice = Number(dto.monthlyPrice) || 0;
    const yearlyPrice = Number(
      (
        monthlyPrice *
        12 *
        (1 - (dto.yearlyDiscountBps ?? 2000) / 10000)
      ).toFixed(2),
    );
    const userLimit = Number(dto.userLimit) || 20;
    const leadLimit = Number(dto.leadLimit) || 1000;
    const storageLimit = dto.storageLimitBytes
      ? BigInt(dto.storageLimitBytes)
      : BigInt(10737418240);
    const features = Array.isArray(dto.features)
      ? dto.features
      : ["CRM", "HRM", "Payroll Automation"];

    const plan = await this.prisma.plan.create({
      data: {
        name: dto.name,
        code,
        description: dto.description || "",
        monthlyPrice,
        yearlyPrice,
        userLimit,

        storageLimit,
        features,
        isActive: dto.isActive ?? true,
        taxRateBps: dto.taxRateBps ?? 1800,
        yearlyDiscountBps: dto.yearlyDiscountBps ?? 2000,
        billingIntervals: dto.billingIntervals ?? ["MONTHLY", "YEARLY"],
        isRecommended: dto.isRecommended ?? false,
      },
    });

    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      description: plan.description,
      monthlyPrice: Number(plan.monthlyPrice),
      yearlyPrice: Number(plan.yearlyPrice),
      userLimit: plan.userLimit,

      features: plan.features,
    };
  }

  async updatePlan(id: number | string, dto: any) {
    const planId = Number(id);
    if (!planId || isNaN(planId)) {
      throw new BadRequestException("Valid Plan ID is required");
    }

    const existing = await this.prisma.plan.findUnique({
      where: { id: planId },
    });
    if (!existing) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    this.validatePlanPricing(dto);
    const updateData: any = {};
    for (const key of [
      "taxRateBps",
      "yearlyDiscountBps",
      "billingIntervals",
      "isRecommended",
    ])
      if (dto[key] !== undefined) updateData[key] = dto[key];
    if (
      dto.name !== undefined &&
      typeof dto.name === "string" &&
      dto.name.trim().length > 0
    ) {
      updateData.name = dto.name.trim();
    }
    if (
      dto.code !== undefined &&
      typeof dto.code === "string" &&
      dto.code.trim().length > 0
    ) {
      updateData.code = dto.code.trim().toUpperCase();
    }
    if (dto.description !== undefined) {
      updateData.description =
        typeof dto.description === "string" ? dto.description.trim() : "";
    }
    if (dto.monthlyPrice !== undefined && !isNaN(Number(dto.monthlyPrice))) {
      updateData.monthlyPrice = Number(dto.monthlyPrice);
    }
    if (dto.yearlyPrice !== undefined && !isNaN(Number(dto.yearlyPrice))) {
      updateData.yearlyPrice = Number(dto.yearlyPrice);
    }
    if (dto.userLimit !== undefined && !isNaN(Number(dto.userLimit))) {
      updateData.userLimit = Number(dto.userLimit);
    }
    if (dto.leadLimit !== undefined && !isNaN(Number(dto.leadLimit))) {
      updateData.leadLimit = Number(dto.leadLimit);
    }
    if (dto.storageLimit !== undefined || dto.storageLimitBytes !== undefined) {
      const storage =
        dto.storageLimit !== undefined
          ? dto.storageLimit
          : dto.storageLimitBytes;
      if (!isNaN(Number(storage))) {
        updateData.storageLimit = BigInt(storage);
      }
    }
    if (dto.features !== undefined) {
      if (Array.isArray(dto.features)) {
        updateData.features = dto.features;
      } else if (typeof dto.features === "string") {
        try {
          const parsed = JSON.parse(dto.features);
          updateData.features = Array.isArray(parsed) ? parsed : [dto.features];
        } catch {
          updateData.features = [dto.features];
        }
      }
    }
    if (dto.isActive !== undefined) {
      updateData.isActive = Boolean(dto.isActive);
    }

    updateData.yearlyPrice = Number(
      (
        (updateData.monthlyPrice ?? existing.monthlyPrice) *
        12 *
        (1 -
          (updateData.yearlyDiscountBps ?? existing.yearlyDiscountBps) / 10000)
      ).toFixed(2),
    );
    const plan = await this.prisma.plan.update({
      where: { id: planId },
      data: updateData,
    });

    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      description: plan.description,
      monthlyPrice: Number(plan.monthlyPrice),
      yearlyPrice: Number(plan.yearlyPrice),
      userLimit: plan.userLimit,

      storageLimitBytes: Number(plan.storageLimit),
      features: plan.features,
      isActive: plan.isActive,
    };
  }

  async updatePlanStatus(id: number | string, isActive: boolean) {
    const planId = Number(id);
    const plan = await this.prisma.plan.update({
      where: { id: planId },
      data: { isActive },
    });
    return {
      id: plan.id,
      name: plan.name,
      isActive: plan.isActive,
    };
  }

  async getPlanFeatures(id: number | string) {
    const plan = await this.getPlanById(id);
    return Array.isArray(plan.features) ? plan.features : [];
  }

  async addPlanFeature(id: number | string, feature: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: Number(id) } });
    if (!plan) throw new NotFoundException(`Plan with ID ${id} not found`);
    const features = Array.isArray(plan.features) ? [...(plan.features as string[]), feature] : [feature];
    const updated = await this.prisma.plan.update({
      where: { id: Number(id) },
      data: { features },
    });
    return updated.features;
  }

  async updatePlanFeature(id: number | string, featureIndex: number, newFeature: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: Number(id) } });
    if (!plan) throw new NotFoundException(`Plan with ID ${id} not found`);
    const features = Array.isArray(plan.features) ? [...(plan.features as string[])] : [];
    if (featureIndex >= 0 && featureIndex < features.length) {
      features[featureIndex] = newFeature;
    }
    const updated = await this.prisma.plan.update({
      where: { id: Number(id) },
      data: { features },
    });
    return updated.features;
  }

  async deletePlanFeature(id: number | string, featureIndex: number) {
    const plan = await this.prisma.plan.findUnique({ where: { id: Number(id) } });
    if (!plan) throw new NotFoundException(`Plan with ID ${id} not found`);
    const features = Array.isArray(plan.features) ? [...(plan.features as string[])] : [];
    if (featureIndex >= 0 && featureIndex < features.length) {
      features.splice(featureIndex, 1);
    }
    const updated = await this.prisma.plan.update({
      where: { id: Number(id) },
      data: { features },
    });
    return updated.features;
  }

  async deletePlan(id: number | string) {
    const planId = Number(id);
    if (!planId || isNaN(planId)) {
      throw new BadRequestException('Valid Plan ID is required');
    }

    const existing = await this.prisma.plan.findFirst({
      where: { id: planId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Plan with ID ${planId} not found or already deleted`);
    }

    // Soft-delete / deactivate plan so existing customer subscriptions and records remain linked
    const plan = await this.prisma.plan.update({
      where: { id: planId },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    this.logger.log(
      `[PLAN_DELETE_DEBUG]\nplanId: ${planId}\ndeleteResponse: SUCCESS\ndatabaseStatusAfterDelete: isActive=${plan.isActive}, deletedAt=${plan.deletedAt}`,
    );

    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      isActive: plan.isActive,
      deletedAt: plan.deletedAt,
      message: `Plan "${plan.name}" (${planId}) deactivated successfully`,
    };
  }

  /**
   * Get all subscriptions for Admin/Super Admin with search, pagination, and derived expiry status
   */
  async getAllSubscriptions(query: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Get subscriptions expiring in <= days (e.g. 10 days, 5 days, 1 day, 0 days)
   */
  async getExpiringSubscriptions(days = 10) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Get expired subscriptions
   */
  async getExpiredSubscriptions() : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Daily expiry runner: checks days remaining, dispatches multi-stage notifications with idempotency, and updates statuses.
   */
  async runDailyExpiryCheck() {
    return this.customers!.expire();
  }

  /**
   * Admin: Get all subscription details for a specific customer
   */
  async getAdminCustomerSubscriptions(customerId: number | string) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Create and Activate a subscription manually for a customer
   */
  async createOrActivateCustomerSubscription(
    customerId: number | string,
    dto: {
      planId: number | string;
      billingCycle?: SubscriptionBillingCycle | string;
      startDate?: string;
      endDate?: string;
      customPrice?: number;
      customUserLimit?: number;
      customLeadLimit?: number;
      customStorageLimit?: number | bigint;
      customFeatures?: any;
      notes?: string;
    },
    adminUserId?: number,
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Change customer's subscription plan
   */
  async changeCustomerPlan(
    subscriptionId: number | string,
    dto: {
      newPlanId: number | string;
      billingCycle?: SubscriptionBillingCycle | string;
      startDate?: string;
      customPrice?: number;
      notes?: string;
    },
    adminUserId?: number,
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Renew a customer subscription
   */
  async renewCustomerSubscription(
    subscriptionId: number | string,
    dto: {
      billingCycle?: SubscriptionBillingCycle | string;
      customPrice?: number;
      notes?: string;
    },
    adminUserId?: number,
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Manually activate a customer subscription
   */
  async activateCustomerSubscription(subscriptionId: number | string, adminUserId?: number) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Deactivate an active subscription
   */
  async deactivateCustomerSubscription(subscriptionId: number | string, adminUserId?: number) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Safely soft-delete a customer subscription
   */
  async deleteCustomerSubscription(subscriptionId: number | string, userOrAdminId?: any) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Bulk soft-delete multiple customer subscriptions
   */
  async bulkDeleteCustomerSubscriptions(rawIds: (number | string)[], user: any) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: List all Offline Payment Requests with status filter & pagination
   */
  async getAdminOfflinePaymentRequests(query: { status?: string; search?: string; page?: number; limit?: number } = {}) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Approve Offline Payment Request
   * 1. Sets paymentStatus = PAID (SUCCESS), subscriptionStatus = ACTIVE, paymentMethod = OFFLINE
   * 2. Sets startDate = now, calculates endDate from duration & billing cycle
   * 3. Activates the customer plan, provisions quotas & 1:1 calendar deliverables
   * 4. Generates Paid Invoice (INV-YYYY-XXXXXX)
   */
  async approveOfflinePaymentRequest(requestIdOrSubId: number | string, adminUserId?: number) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Helper to dispatch Offline Payment Success Email + WhatsApp and Invoice PDF Email + WhatsApp
   */
  async sendOfflinePaymentCommunications(params: {
    customerId?: number;
    paymentId: number | string;
    amount: number | string;
    planName: string;
    transactionId?: string;
    orderId?: string;
    paymentMethod?: string;
    invoiceNo?: string | null;
  }) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Resolve an offline request by payment id first.
   * Falling back to subscriptionId must not pick an older approved payment
   * when a pending offline request exists for that subscription.
   */
  private async findOfflinePaymentRequest(numId: number) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Reject Offline Payment Request
   * Sets paymentStatus = REJECTED, subscriptionStatus = REJECTED
   */
  async rejectOfflinePaymentRequest(requestIdOrSubId: number | string, adminUserId?: number, reason?: string) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Safely delete a single Offline Payment Request
   * Enforces role authorization, tenant isolation, and subscription safety.
   * Performs soft deletion on PaymentHistory, preserving customer and invoice data.
   */
  async deleteOfflinePaymentRequest(requestId: number | string, user: any) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Safely bulk delete Offline Payment Requests
   * Enforces role authorization and tenant isolation across ALL selected records.
   * Performs atomic database transaction.
   */
  async bulkDeleteOfflinePaymentRequests(rawIds: (number | string)[], user: any) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }
}



