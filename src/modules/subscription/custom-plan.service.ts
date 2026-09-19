import { Injectable, BadRequestException, NotFoundException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { NotificationService } from '../notification/notification.service';
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
import { PaymentMethod } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class CustomPlanService {
  private readonly logger = new Logger(CustomPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
    private readonly workService: WorkService,
    private readonly integrationSettingsService: IntegrationSettingsService,
    @Optional() private readonly notificationService?: NotificationService,
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
  async createCustomPlanOrder(customerId: number | string, dto: CreateCustomPlanDto) {
    const numCustomerId = Number(customerId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const selections = dto.featureSelections || dto.items || [];
    const durationParam = dto.duration || dto.billingCycle || 1;
    const priceBreakdown = await this.calculateCustomPlanPrice(selections, durationParam);

    const orderNumber = `#QB-CP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Razorpay Order creation using dynamic IntegrationSettingsService
    let razorpayOrderId = `order_${orderNumber.replace(/[^a-zA-Z0-9]/g, '')}`;
    const rzpConfig = await this.integrationSettingsService.getRazorpayConfig();
    const keyId = rzpConfig.keyId;
    const keySecret = rzpConfig.keySecret;

    if (rzpConfig.isEnabled && keyId && keySecret) {
      try {
        const Razorpay = require('razorpay');
        const instance = new Razorpay({
          key_id: keyId,
          key_secret: keySecret,
        });
        const rzpOrder = await instance.orders.create({
          amount: Math.round(priceBreakdown.totalAmount * 100), // in paise
          currency: 'INR',
          receipt: orderNumber,
          notes: {
            customerId: String(numCustomerId),
            type: 'CUSTOM_PLAN',
          },
        });
        if (rzpOrder?.id) {
          razorpayOrderId = rzpOrder.id;
        }
      } catch (err: any) {
        this.logger.warn(`Razorpay SDK creation note: ${err?.message}`);
      }
    }

    const order = await this.prisma.customPlanOrder.create({
      data: {
        customerId: numCustomerId,
        orderNumber,
        orderId: razorpayOrderId,
        selectedFeatures: priceBreakdown.items,
        duration: priceBreakdown.duration,
        durationUnit: 'MONTH',
        subtotal: priceBreakdown.subtotal,
        discount: priceBreakdown.discount,
        tax: priceBreakdown.tax,
        totalAmount: priceBreakdown.totalAmount,
        currency: priceBreakdown.currency,
        status: 'PENDING_PAYMENT',
        paymentMethod: (dto.paymentMethod as PaymentMethod) || PaymentMethod.RAZORPAY,
      },
    });

    this.logger.log(`[CUSTOM_PLAN_ORDER] Created Order #${order.id} (${order.orderNumber}), amount: ₹${order.totalAmount}, razorpayOrderId: ${razorpayOrderId}`);

    return {
      success: true,
      quoteId: String(order.id),
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        duration: order.duration,
        durationUnit: order.durationUnit,
        subtotal: order.subtotal,
        discount: order.discount,
        tax: order.tax,
        totalAmount: order.totalAmount,
        currency: order.currency,
        status: order.status,
        selectedFeatures: order.selectedFeatures,
        paymentGatewayConfig: {
          gateway: 'RAZORPAY',
          amount: order.totalAmount,
          amountInPaise: Math.round(order.totalAmount * 100),
          currency: 'INR',
          orderId: razorpayOrderId,
          keyId,
          customerName: customer.name,
          customerEmail: customer.email,
        },
      },
      priceBreakdown,
    };
  }

  /**
   * Verify server-side payment and activate Custom Plan
   */
  async verifyAndActivateCustomPlan(
    customerId: number | string,
    orderId: number | string,
    paymentDto: VerifyCustomPlanPaymentDto,
  ) {
    const numCustomerId = Number(customerId);
    const numOrderId = Number(orderId);

    const order = await this.prisma.customPlanOrder.findFirst({
      where: {
        id: numOrderId,
        customerId: numCustomerId,
        deletedAt: null,
      },
    });

    if (!order) {
      throw new NotFoundException(`Custom Plan Order #${orderId} not found`);
    }

    if (order.status === 'ACTIVATED') {
      return {
        success: true,
        message: 'Custom plan is already active',
        order,
      };
    }

    // Dynamically retrieve secret from IntegrationSettingsService (Database / .env)
    const rzpConfig = await this.integrationSettingsService.getRazorpayConfig();
    const keySecret = rzpConfig.keySecret;
    const rzpPaymentId = paymentDto.paymentId || paymentDto.razorpay_payment_id;
    const rzpOrderId = paymentDto.orderId || paymentDto.razorpay_order_id || order.orderId;
    const signature = paymentDto.signature || paymentDto.razorpay_signature;

    if (keySecret && rzpOrderId && rzpPaymentId && signature) {
      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${rzpOrderId}|${rzpPaymentId}`)
        .digest('hex');

      if (generatedSignature !== signature) {
        this.logger.error(
          `[CUSTOM_PLAN_VERIFY] Razorpay signature mismatch for orderId=${rzpOrderId} paymentId=${rzpPaymentId}`,
        );
        throw new BadRequestException('Payment signature verification failed. Custom plan order rejected.');
      }
    }

    // Resolve or find standard Plan anchor (e.g. CUSTOM / STANDARD)
    let plan = await this.prisma.plan.findFirst({
      where: { code: 'CUSTOM', deletedAt: null },
    });

    if (!plan) {
      plan = await this.prisma.plan.findFirst({
        where: { deletedAt: null },
        orderBy: { id: 'asc' },
      });
    }

    if (!plan) {
      throw new NotFoundException('Base system plan not configured');
    }

    const { startDate, endDate: expiryDate } = calculateSubscriptionDates(new Date(), order.duration);

    // Format custom features string array for UI display
    const items = (order.selectedFeatures as any[]) || [];
    const formattedFeatures = items.map((it) => `${it.quantity}x ${it.name} (₹${it.unitPrice}/mo)`);

    // Extract user & lead limits if selected
    const seatOption = items.find((it) => it.code === 'OPT_CRM_SEATS');
    const customUserLimit = seatOption ? Number(seatOption.quantity) + 5 : 10;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Cancel previous active subscription if any
      await tx.customerSubscription.updateMany({
        where: { customerId: numCustomerId, status: 'ACTIVE' },
        data: { status: 'CANCELED' },
      });

      // 2. Create new active custom subscription
      const subscription = await tx.customerSubscription.create({
        data: {
          customerId: numCustomerId,
          planId: plan.id,
          status: 'ACTIVE',
          billingCycle: order.duration >= 12 ? 'YEARLY' : 'MONTHLY',
          startDate,
          endDate: expiryDate,
          duration: order.duration,
          durationUnit: 'MONTH',
          customPrice: order.totalAmount,
          customFeatures: formattedFeatures,
          customUserLimit,
          customLeadLimit: 2000 * order.duration,
          autoRenew: true,
        },
        include: { plan: true },
      });

      // 3. Update Custom Plan Order
      const updatedOrder = await tx.customPlanOrder.update({
        where: { id: order.id },
        data: {
          status: 'ACTIVATED',
          subscriptionId: subscription.id,
          paymentId: rzpPaymentId,
          orderId: rzpOrderId || null,
          startDate,
          expiryDate,
        },
      });

      // 4. Create Payment Record
      await tx.paymentHistory.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: subscription.id,
          planId: plan.id,
          planName: `Custom Plan (${order.duration} Months)`,
          orderNumber: order.orderNumber,
          billingCycle: order.duration >= 12 ? 'YEARLY' : 'MONTHLY',
          amount: order.subtotal - order.discount,
          taxAmount: order.tax,
          totalAmount: order.totalAmount,
          status: 'SUCCESS',
          paymentMethod: order.paymentMethod,
          paymentId: rzpPaymentId,
          transactionId: `TXN-CP-${Date.now()}`,
        },
      });

      // 5. Provision PlanEntitlements for each content deliverable
      for (const it of items) {
        if (Number(it.quantity) > 0) {
          const serviceName = it.name || it.unitName || it.code;
          const existingEnt = await tx.planEntitlement.findFirst({
            where: { customerId: numCustomerId, serviceName },
          });
          if (existingEnt) {
            await tx.planEntitlement.update({
              where: { id: existingEnt.id },
              data: {
                planId: plan.id,
                totalQty: Number(it.quantity),
                usedQty: 0,
                scheduledQty: 0,
                validUntil: expiryDate,
              },
            });
          } else {
            await tx.planEntitlement.create({
              data: {
                customerId: numCustomerId,
                planId: plan.id,
                serviceName,
                totalQty: Number(it.quantity),
                usedQty: 0,
                scheduledQty: 0,
                validUntil: expiryDate,
              },
            });
          }
        }
      }

      // 6. Update Customer Seat limit
      await tx.customer.update({
        where: { id: numCustomerId },
        data: { userLimit: customUserLimit },
      });

      return {
        success: true,
        message: 'Custom plan activated successfully!',
        subscription: {
          id: subscription.id,
          customerId: subscription.customerId,
          status: subscription.status,
          startDate: subscription.startDate,
          purchaseDate: subscription.startDate,
          expiryDate: subscription.endDate,
          endDate: subscription.endDate,
          duration: subscription.duration,
          durationUnit: subscription.durationUnit,
          price: subscription.customPrice,
          features: subscription.customFeatures,
        },
        order: updatedOrder,
      };
    });

    // 7. Auto-generate Work deliverable schedules across subscription period avoiding Sundays
    try {
      this.logger.log(`[CUSTOM_PLAN] Generating schedules for customer ID: ${numCustomerId}`);
      await this.workService.generatePlanSchedules(numCustomerId, result.subscription.id);
      await this.scheduleService.generateSchedulesForSubscription(result.subscription.id);
    } catch (err: any) {
      this.logger.error(`Failed to auto-generate schedules for custom plan: ${err?.message}`, err?.stack);
    }

    // Trigger Plan Purchase Success Notification
    try {
      if (this.notificationService) {
        await this.notificationService.sendPlanPurchaseSuccessNotification({
          customerId: numCustomerId,
          subscriptionId: result.subscription.id,
          planId: (result.subscription as any).planId || 1,
          planName: 'Custom Plan',
          paymentId: rzpPaymentId,
        });
      }
    } catch (notifErr: any) {
      this.logger.warn(`Non-fatal: Custom plan notification warning: ${notifErr?.message}`);
    }

    return result;
  }

  /**
   * Get Customer's Custom Plan Orders History
   */
  async getCustomerCustomPlans(customerId: number | string) {
    const numCustomerId = Number(customerId);
    const orders = await this.prisma.customPlanOrder.findMany({
      where: { customerId: numCustomerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: true,
      },
    });

    return orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      selectedFeatures: o.selectedFeatures,
      duration: o.duration,
      durationUnit: o.durationUnit,
      subtotal: o.subtotal,
      discount: o.discount,
      tax: o.tax,
      totalAmount: o.totalAmount,
      currency: o.currency,
      status: o.status,
      startDate: o.startDate,
      expiryDate: o.expiryDate,
      createdAt: o.createdAt,
    }));
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
  }) {
    const where: any = { deletedAt: null };
    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }
    if (query.search && query.search.trim()) {
      where.OR = [
        { orderNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { customer: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.customPlanOrder.count({ where }),
      this.prisma.customPlanOrder.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true },
          },
          subscription: true,
        },
      }),
    ]);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * Admin: Get single order details
   */
  async getAdminCustomPlanById(id: string | number) {
    const numId = Number(id);
    const order = await this.prisma.customPlanOrder.findUnique({
      where: { id: numId },
      include: {
        customer: true,
        subscription: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Custom Plan Order #${id} not found`);
    }

    return order;
  }
}
