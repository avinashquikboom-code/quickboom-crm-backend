import { GoneException } from '@nestjs/common';
import { Injectable, BadRequestException, NotFoundException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { NotificationService } from '../notification/notification.service';
import { CommissionService } from '../commission/commission.service';
import { awardCommissionForPayment, QualifyingPayment } from '../commission/commission-trigger.util';
import {
  PreviewCustomPlanDto,
  CreateCustomPlanDto,
  VerifyCustomPlanPaymentDto,
  CreateCustomPlanOptionDto,
  UpdateCustomPlanOptionDto,
  FeatureSelectionItemDto,
} from './dto/custom-plan.dto';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { calculatePlanExpiry, calculateSubscriptionDates } from '../../common/utils/subscription-date.util';
import { PaymentMethod, InvoiceStatus } from '@prisma/client';
import * as crypto from 'crypto';
import {
  buildCustomPlanLineItems,
  withInvoiceItemsSnapshot,
} from '../../common/utils/invoice-items.util';

/** Internal CustomPlanOrder.id only — never a Razorpay order_/pay_ id or the string "null". */
export function parseCustomPlanOrderId(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw <= 0 || !Number.isFinite(raw)) {
      return null;
    }
    return raw;
  }
  const text = String(raw).trim();
  if (
    !text ||
    text === 'null' ||
    text === 'undefined' ||
    text === 'NaN' ||
    text.startsWith('order_') ||
    text.startsWith('pay_')
  ) {
    return null;
  }
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0 || !Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

@Injectable()
export class CustomPlanService {
  private readonly logger = new Logger(CustomPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
    private readonly workService: WorkService,
    private readonly integrationSettingsService: IntegrationSettingsService,
    @Optional() private readonly notificationService?: NotificationService,
    @Optional() private readonly commissionService?: CommissionService,
  ) {}

  /**
   * Seed standard custom plan options if none exist
   */
  async getAvailableOptions() {
    let options = await this.prisma.customPlanOption.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    if (options.length === 0) {
      const defaultOptions = [
        {
          name: 'Social Media Reels',
          code: 'OPT_REELS',
          description: 'High engagement scripted and edited reels with trending audio',
          category: 'CONTENT',
          monthlyPrice: 1000,
          pricingType: 'PER_UNIT',
          unitName: 'Reel',
          minQuantity: 0,
          maxQuantity: 50,
          defaultQuantity: 4,
          isIncludedInStandard: true,
          sortOrder: 1,
        },
        {
          name: 'Creative Graphic Posts',
          code: 'OPT_CREATIVES',
          description: 'High-converting custom visual posts & infographics',
          category: 'CREATIVES',
          monthlyPrice: 600,
          pricingType: 'PER_UNIT',
          unitName: 'Post',
          minQuantity: 0,
          maxQuantity: 50,
          defaultQuantity: 3,
          isIncludedInStandard: true,
          sortOrder: 2,
        },
        {
          name: 'Daily Story Updates',
          code: 'OPT_STORIES',
          description: 'Engaging daily interactive stories with poll stickers & links',
          category: 'CREATIVES',
          monthlyPrice: 150,
          pricingType: 'PER_UNIT',
          unitName: 'Story',
          minQuantity: 0,
          maxQuantity: 60,
          defaultQuantity: 5,
          isIncludedInStandard: true,
          sortOrder: 3,
        },
        {
          name: 'Influencer Collaborations',
          code: 'OPT_INFLUENCER',
          description: 'Micro/Macro creator partnership execution & shoutouts',
          category: 'CONTENT',
          monthlyPrice: 2500,
          pricingType: 'PER_UNIT',
          unitName: 'Promotion',
          minQuantity: 0,
          maxQuantity: 20,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 4,
        },
        {
          name: 'Product Reels',
          code: 'OPT_PRODUCT_REELS',
          description: 'High definition studio shoot product reels',
          category: 'CONTENT',
          monthlyPrice: 2000,
          pricingType: 'PER_UNIT',
          unitName: 'Reel',
          minQuantity: 0,
          maxQuantity: 30,
          defaultQuantity: 2,
          isIncludedInStandard: false,
          sortOrder: 5,
        },
        {
          name: 'Meta Ads Setup & Optimization',
          code: 'OPT_META_ADS',
          description: 'Targeted Facebook & Instagram Ads management (Client pays ad spend)',
          category: 'ADS',
          monthlyPrice: 3500,
          pricingType: 'FLAT',
          unitName: 'Campaign',
          minQuantity: 0,
          maxQuantity: 1,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 6,
        },
        {
          name: 'Google Search & Display Ads',
          code: 'OPT_GOOGLE_ADS',
          description: 'High-intent Google Ads management & keyword bidding',
          category: 'ADS',
          monthlyPrice: 3500,
          pricingType: 'FLAT',
          unitName: 'Campaign',
          minQuantity: 0,
          maxQuantity: 1,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 7,
        },
        {
          name: 'Dedicated Account Manager',
          code: 'OPT_MANAGER',
          description: 'Single point of contact with weekly strategy calls',
          category: 'SUPPORT',
          monthlyPrice: 4000,
          pricingType: 'FLAT',
          unitName: 'Manager',
          minQuantity: 0,
          maxQuantity: 1,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 8,
        },
        {
          name: 'Content Writing & Captions',
          code: 'OPT_CONTENT_WRITING',
          description: 'Custom captions, hashtags, and copywriting strategy',
          category: 'SUPPORT',
          monthlyPrice: 1500,
          pricingType: 'FLAT',
          unitName: 'Package',
          minQuantity: 0,
          maxQuantity: 1,
          defaultQuantity: 1,
          isIncludedInStandard: true,
          sortOrder: 9,
        },
        {
          name: 'Monthly Analytics Report',
          code: 'OPT_ANALYTICS_REPORT',
          description: 'Detailed monthly performance and engagement report',
          category: 'SUPPORT',
          monthlyPrice: 1000,
          pricingType: 'FLAT',
          unitName: 'Report',
          minQuantity: 0,
          maxQuantity: 1,
          defaultQuantity: 1,
          isIncludedInStandard: true,
          sortOrder: 10,
        },
        {
          name: 'Additional CRM Staff Seats',
          code: 'OPT_CRM_SEATS',
          description: 'Team logins with live GPS, attendance, and task tracking',
          category: 'CRM',
          monthlyPrice: 300,
          pricingType: 'PER_UNIT',
          unitName: 'User',
          minQuantity: 0,
          maxQuantity: 100,
          defaultQuantity: 5,
          isIncludedInStandard: true,
          sortOrder: 11,
        },
        {
          name: '10GB Cloud Media Storage',
          code: 'OPT_STORAGE_10GB',
          description: 'Cloud space for raw footage, designs, and contracts',
          category: 'STORAGE',
          monthlyPrice: 400,
          pricingType: 'PER_UNIT',
          unitName: '10GB Pack',
          minQuantity: 0,
          maxQuantity: 20,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 12,
        },
      ];

      for (const opt of defaultOptions) {
        await this.prisma.customPlanOption.upsert({
          where: { code: opt.code },
          update: {
            deletedAt: null,
            isActive: true,
            name: opt.name,
            description: opt.description,
            category: opt.category,
            monthlyPrice: opt.monthlyPrice,
            pricingType: opt.pricingType,
            unitName: opt.unitName,
            minQuantity: opt.minQuantity,
            maxQuantity: opt.maxQuantity,
            defaultQuantity: opt.defaultQuantity,
            isIncludedInStandard: opt.isIncludedInStandard,
            sortOrder: opt.sortOrder,
          },
          create: opt,
        });
      }

      options = await this.prisma.customPlanOption.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
    }

    return options.map((opt) => ({
      id: opt.id,
      name: opt.name,
      code: opt.code,
      description: opt.description,
      category: opt.category,
      monthlyPrice: Number(opt.monthlyPrice),
      yearlyPrice: Number(opt.monthlyPrice) * 12 * 0.8, // 20% savings on yearly
      pricingType: opt.pricingType,
      unitName: opt.unitName,
      minQuantity: opt.minQuantity,
      maxQuantity: opt.maxQuantity,
      defaultQuantity: opt.defaultQuantity,
      isIncludedInStandard: opt.isIncludedInStandard,
      isActive: opt.isActive,
    }));
  }

  /**
   * Server-side price calculation engine
   * Never trusts client-sent prices, subtotals, or taxes.
   */
  async calculateCustomPlanPrice(
    featureSelections: FeatureSelectionItemDto[] | undefined,
    durationMonthsOrBillingCycle?: number | string,
  ) {
    let duration = 1;
    if (typeof durationMonthsOrBillingCycle === 'string') {
      duration = durationMonthsOrBillingCycle.toUpperCase() === 'YEARLY' ? 12 : 1;
    } else if (typeof durationMonthsOrBillingCycle === 'number') {
      duration = Math.max(1, durationMonthsOrBillingCycle);
    }

    const items = featureSelections || [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('At least one service must be selected for a custom plan');
    }

    // Filter items with quantity > 0
    const activeItems = items.filter((it) => (it.quantity !== undefined ? it.quantity > 0 : true));
    if (activeItems.length === 0) {
      throw new BadRequestException('At least one service with quantity > 0 must be selected');
    }

    const allDbOptions = await this.prisma.customPlanOption.findMany({
      where: {
        deletedAt: null,
        isActive: true,
      },
    });

    const dbOptionsMap = new Map<string, any>();
    for (const opt of allDbOptions) {
      dbOptionsMap.set(String(opt.id), opt);
      dbOptionsMap.set(opt.code.toLowerCase(), opt);
      dbOptionsMap.set(opt.name.toLowerCase(), opt);
    }

    const calculatedItems = [];
    let monthlySubtotal = 0;

    for (const item of activeItems) {
      const lookupKey = String(item.optionId !== undefined ? item.optionId : (item.serviceId !== undefined ? item.serviceId : '')).toLowerCase();
      const option = dbOptionsMap.get(lookupKey);

      if (!option) {
        throw new BadRequestException(`Plan service option ${lookupKey} is invalid or inactive`);
      }

      let quantity = Math.max(1, Number(item.quantity) || option.defaultQuantity || 1);
      if (option.minQuantity !== undefined && quantity < option.minQuantity) {
        quantity = option.minQuantity;
      }
      if (option.maxQuantity !== undefined && quantity > option.maxQuantity) {
        quantity = option.maxQuantity;
      }

      const unitPrice = Number(option.monthlyPrice);
      const monthlyTotal = option.pricingType === 'FLAT' ? unitPrice : unitPrice * quantity;
      const durationTotal = monthlyTotal * duration;

      monthlySubtotal += monthlyTotal;

      calculatedItems.push({
        optionId: option.id,
        serviceId: option.id,
        code: option.code,
        name: option.name,
        category: option.category,
        pricingType: option.pricingType,
        unitName: option.unitName,
        unitPrice,
        quantity,
        monthlyTotal,
        totalPrice: durationTotal,
      });
    }

    const subtotal = monthlySubtotal * duration;

    // Configured duration discount tiers (20% for 12 months)
    let discountPercentage = 0;
    if (duration >= 12) {
      discountPercentage = 20; // 20% discount for 1 year
    } else if (duration >= 6) {
      discountPercentage = 10; // 10% discount for 6 months
    } else if (duration >= 3) {
      discountPercentage = 5; // 5% discount for 3 months
    }

    const discount = Math.round((subtotal * discountPercentage) / 100);
    const taxableAmount = Math.max(0, subtotal - discount);
    const tax = Math.round(taxableAmount * 0.18); // 18% GST
    const totalAmount = taxableAmount + tax;

    return {
      items: calculatedItems,
      duration,
      durationUnit: 'MONTH',
      billingCycle: duration >= 12 ? 'YEARLY' : 'MONTHLY',
      monthlySubtotal,
      subtotal,
      discountPercentage,
      discount,
      taxableAmount,
      tax,
      total: totalAmount,
      totalAmount,
      currency: 'INR',
    };
  }

  /**
   * Create custom plan order & Razorpay order
   */
  async createCustomPlanOrder(customerId: number | string, dto: CreateCustomPlanDto) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Verify server-side payment and activate Custom Plan
   */
  async verifyAndActivateCustomPlan(
    customerId: number | string,
    orderId: number | string,
    paymentDto: VerifyCustomPlanPaymentDto,
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Get Customer's Custom Plan Orders History
   */
  async getCustomerCustomPlans(customerId: number | string) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Get all options with CRUD
   */
  async getAdminOptions(query: { search?: string; category?: string }) {
    const where: any = { deletedAt: null };
    if (query.category && query.category !== 'ALL') {
      where.category = query.category;
    }
    if (query.search && query.search.trim()) {
      where.OR = [
        { name: { contains: query.search.trim(), mode: 'insensitive' } },
        { code: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }

    const options = await this.prisma.customPlanOption.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });

    if (options.length === 0 && !query.search && (!query.category || query.category === 'ALL')) {
      await this.getAvailableOptions();
      return this.prisma.customPlanOption.findMany({
        where,
        orderBy: { sortOrder: 'asc' },
      });
    }

    return options;
  }

  /**
   * Admin: Create new custom plan option
   */
  async createOption(dto: CreateCustomPlanOptionDto) {
    const existing = await this.prisma.customPlanOption.findUnique({
      where: { code: dto.code },
    });

    if (existing) {
      throw new BadRequestException(`Custom plan option with code '${dto.code}' already exists`);
    }

    return this.prisma.customPlanOption.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        category: dto.category || 'CONTENT',
        monthlyPrice: dto.monthlyPrice,
        pricingType: dto.pricingType || 'PER_UNIT',
        unitName: dto.unitName || 'unit',
        minQuantity: dto.minQuantity || 1,
        maxQuantity: dto.maxQuantity || 100,
        defaultQuantity: dto.defaultQuantity || 1,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        sortOrder: dto.sortOrder || 0,
      },
    });
  }

  /**
   * Admin: Update custom plan option
   */
  async updateOption(id: string | number, dto: UpdateCustomPlanOptionDto) {
    const numId = Number(id);
    const existing = await this.prisma.customPlanOption.findUnique({
      where: { id: numId },
    });

    if (!existing) {
      throw new NotFoundException(`Custom plan option #${id} not found`);
    }

    return this.prisma.customPlanOption.update({
      where: { id: numId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category && { category: dto.category }),
        ...(dto.monthlyPrice !== undefined && { monthlyPrice: dto.monthlyPrice }),
        ...(dto.pricingType && { pricingType: dto.pricingType }),
        ...(dto.unitName && { unitName: dto.unitName }),
        ...(dto.minQuantity !== undefined && { minQuantity: dto.minQuantity }),
        ...(dto.maxQuantity !== undefined && { maxQuantity: dto.maxQuantity }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  /**
   * Admin: Delete/Deactivate option
   */
  async deleteOption(id: string | number) {
    const numId = Number(id);
    await this.prisma.customPlanOption.update({
      where: { id: numId },
      data: { deletedAt: new Date(), isActive: false },
    });

    return {
      success: true,
      message: `Custom plan option #${id} deactivated successfully`,
    };
  }

  /**
   * Admin: Get all custom plan orders
   */
  async getAdminCustomPlans(query: {
    status?: string;
    search?: string;
    page: number;
    limit: number;
  }) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }

  /**
   * Admin: Get single order details
   */
  async getAdminCustomPlanById(id: string | number) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
  }
}
