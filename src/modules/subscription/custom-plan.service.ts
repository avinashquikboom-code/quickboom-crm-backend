import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import {
  PreviewCustomPlanDto,
  CreateCustomPlanDto,
  VerifyCustomPlanPaymentDto,
  CreateCustomPlanOptionDto,
  UpdateCustomPlanOptionDto,
  FeatureSelectionItemDto,
} from './dto/custom-plan.dto';
import { calculatePlanExpiry } from '../../common/utils/subscription-date.util';
import { PaymentMethod } from '@prisma/client';

@Injectable()
export class CustomPlanService {
  private readonly logger = new Logger(CustomPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleService: ScheduleService,
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
          minQuantity: 2,
          maxQuantity: 30,
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
          minQuantity: 2,
          maxQuantity: 30,
          defaultQuantity: 4,
          isIncludedInStandard: true,
          sortOrder: 2,
        },
        {
          name: 'Influencer Collaborations',
          code: 'OPT_INFLUENCER',
          description: 'Micro/Macro creator partnership execution & shoutouts',
          category: 'CONTENT',
          monthlyPrice: 2500,
          pricingType: 'PER_UNIT',
          unitName: 'Promotion',
          minQuantity: 1,
          maxQuantity: 10,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 3,
        },
        {
          name: 'Daily Story Updates',
          code: 'OPT_STORIES',
          description: 'Engaging daily interactive stories with poll stickers & links',
          category: 'CREATIVES',
          monthlyPrice: 150,
          pricingType: 'PER_UNIT',
          unitName: 'Story',
          minQuantity: 5,
          maxQuantity: 60,
          defaultQuantity: 10,
          isIncludedInStandard: true,
          sortOrder: 4,
        },
        {
          name: 'Meta Ads Setup & Optimization',
          code: 'OPT_META_ADS',
          description: 'Targeted Facebook & Instagram Ads management (Client pays ad spend)',
          category: 'ADS',
          monthlyPrice: 3500,
          pricingType: 'FLAT',
          unitName: 'Campaign',
          minQuantity: 1,
          maxQuantity: 1,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 5,
        },
        {
          name: 'Google Search & Display Ads',
          code: 'OPT_GOOGLE_ADS',
          description: 'High-intent Google Ads management & keyword bidding',
          category: 'ADS',
          monthlyPrice: 3500,
          pricingType: 'FLAT',
          unitName: 'Campaign',
          minQuantity: 1,
          maxQuantity: 1,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 6,
        },
        {
          name: 'Dedicated Account Manager',
          code: 'OPT_MANAGER',
          description: 'Single point of contact with weekly strategy calls',
          category: 'SUPPORT',
          monthlyPrice: 4000,
          pricingType: 'FLAT',
          unitName: 'Manager',
          minQuantity: 1,
          maxQuantity: 1,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 7,
        },
        {
          name: 'Additional CRM Staff Seats',
          code: 'OPT_CRM_SEATS',
          description: 'Team logins with live GPS, attendance, and task tracking',
          category: 'CRM',
          monthlyPrice: 300,
          pricingType: 'PER_UNIT',
          unitName: 'User',
          minQuantity: 1,
          maxQuantity: 100,
          defaultQuantity: 5,
          isIncludedInStandard: true,
          sortOrder: 8,
        },
        {
          name: '10GB Cloud Media Storage',
          code: 'OPT_STORAGE_10GB',
          description: 'Cloud space for raw footage, designs, and contracts',
          category: 'STORAGE',
          monthlyPrice: 400,
          pricingType: 'PER_UNIT',
          unitName: '10GB Pack',
          minQuantity: 1,
          maxQuantity: 20,
          defaultQuantity: 1,
          isIncludedInStandard: false,
          sortOrder: 9,
        },
      ];

      for (const opt of defaultOptions) {
        await this.prisma.customPlanOption.create({ data: opt });
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
    featureSelections: FeatureSelectionItemDto[],
    durationMonths: number,
  ) {
    const duration = Math.max(1, Number(durationMonths) || 1);

    if (!Array.isArray(featureSelections) || featureSelections.length === 0) {
      throw new BadRequestException('At least one feature must be selected for a custom plan');
    }

    const optionIds = featureSelections.map((f) => Number(f.optionId));
    const dbOptions = await this.prisma.customPlanOption.findMany({
      where: {
        id: { in: optionIds },
        deletedAt: null,
        isActive: true,
      },
    });

    const dbOptionsMap = new Map<number, any>();
    for (const opt of dbOptions) {
      dbOptionsMap.set(opt.id, opt);
    }

    const calculatedItems = [];
    let monthlySubtotal = 0;

    for (const item of featureSelections) {
      const option = dbOptionsMap.get(Number(item.optionId));
      if (!option) {
        throw new BadRequestException(`Plan feature option ID ${item.optionId} is invalid or inactive`);
      }

      let quantity = Math.max(1, Number(item.quantity) || option.defaultQuantity || 1);
      if (option.minQuantity && quantity < option.minQuantity) {
        quantity = option.minQuantity;
      }
      if (option.maxQuantity && quantity > option.maxQuantity) {
        quantity = option.maxQuantity;
      }

      const unitPrice = Number(option.monthlyPrice);
      const monthlyTotal = option.pricingType === 'FLAT' ? unitPrice : unitPrice * quantity;
      const durationTotal = monthlyTotal * duration;

      monthlySubtotal += monthlyTotal;

      calculatedItems.push({
        optionId: option.id,
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

    // Configured duration discount tiers
    let discountPercentage = 0;
    if (duration >= 12) {
      discountPercentage = 15; // 15% discount for 1 year
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
   * Create custom plan order
   */
  async createCustomPlanOrder(customerId: number | string, dto: CreateCustomPlanDto) {
    const numCustomerId = Number(customerId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const priceBreakdown = await this.calculateCustomPlanPrice(dto.featureSelections, dto.duration);

    const orderNumber = `#QB-CP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const order = await this.prisma.customPlanOrder.create({
      data: {
        customerId: numCustomerId,
        orderNumber,
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

    return {
      success: true,
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
          currency: 'INR',
          orderId: `order_${order.orderNumber.replace(/[^a-zA-Z0-9]/g, '')}`,
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

    const startDate = new Date();
    const expiryDate = calculatePlanExpiry(startDate, order.duration);

    // Format custom features string array for UI display
    const items = (order.selectedFeatures as any[]) || [];
    const formattedFeatures = items.map((it) => `${it.quantity}x ${it.name} (${it.unitPrice}/mo)`);

    // Extract user & lead limits if selected
    const seatOption = items.find((it) => it.code === 'OPT_CRM_SEATS');
    const customUserLimit = seatOption ? Number(seatOption.quantity) + 5 : 10;

    return this.prisma.$transaction(async (tx) => {
      // 1. Cancel previous active subscription if any
      await tx.customerSubscription.updateMany({
        where: { customerId: numCustomerId, status: 'ACTIVE' },
        data: { status: 'CANCELED' },
      });

      // 2. Create new active subscription
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
          paymentId: paymentDto.paymentId,
          orderId: paymentDto.orderId || null,
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
          paymentId: paymentDto.paymentId,
          transactionId: `TXN-CP-${Date.now()}`,
        },
      });

      // 5. Update Customer Seat limit
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
    }).then(async (result) => {
      // Auto-generate monthly schedules (non-blocking in tx)
      try {
        await this.scheduleService.generateSchedulesForSubscription(result.subscription.id);
      } catch (err) {
        this.logger.error('Failed to auto-generate schedules for custom plan:', err);
      }

      return result;
    });
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

    return this.prisma.customPlanOption.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createOption(dto: CreateCustomPlanOptionDto) {
    const code = dto.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const existing = await this.prisma.customPlanOption.findUnique({
      where: { code },
    });

    if (existing) {
      throw new BadRequestException(`Option with code ${code} already exists`);
    }

    return this.prisma.customPlanOption.create({
      data: {
        name: dto.name,
        code,
        description: dto.description || null,
        category: dto.category || 'CONTENT',
        monthlyPrice: Number(dto.monthlyPrice),
        pricingType: dto.pricingType || 'PER_UNIT',
        unitName: dto.unitName || 'unit',
        minQuantity: dto.minQuantity || 1,
        maxQuantity: dto.maxQuantity || 50,
        defaultQuantity: dto.defaultQuantity || 1,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        sortOrder: dto.sortOrder || 0,
      },
    });
  }

  async updateOption(id: number | string, dto: UpdateCustomPlanOptionDto) {
    const optionId = Number(id);
    const existing = await this.prisma.customPlanOption.findUnique({
      where: { id: optionId },
    });

    if (!existing) {
      throw new NotFoundException(`Option with ID ${id} not found`);
    }

    return this.prisma.customPlanOption.update({
      where: { id: optionId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category && { category: dto.category }),
        ...(dto.monthlyPrice !== undefined && { monthlyPrice: Number(dto.monthlyPrice) }),
        ...(dto.pricingType && { pricingType: dto.pricingType }),
        ...(dto.unitName !== undefined && { unitName: dto.unitName }),
        ...(dto.minQuantity !== undefined && { minQuantity: Number(dto.minQuantity) }),
        ...(dto.maxQuantity !== undefined && { maxQuantity: Number(dto.maxQuantity) }),
        ...(dto.isActive !== undefined && { isActive: Boolean(dto.isActive) }),
        ...(dto.sortOrder !== undefined && { sortOrder: Number(dto.sortOrder) }),
      },
    });
  }

  async deleteOption(id: number | string) {
    const optionId = Number(id);
    await this.prisma.customPlanOption.update({
      where: { id: optionId },
      data: { isActive: false, deletedAt: new Date() },
    });
    return { success: true, message: `Option ${id} removed` };
  }

  /**
   * Admin: Get all custom plans
   */
  async getAdminCustomPlans(query: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { orderNumber: { contains: s, mode: 'insensitive' } },
        { customer: { name: { contains: s, mode: 'insensitive' } } },
        { customer: { email: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.customPlanOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          subscription: true,
        },
      }),
      this.prisma.customPlanOrder.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: items,
      items,
      pagination: {
        page,
        pageSize: limit,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getAdminCustomPlanById(id: number | string) {
    const order = await this.prisma.customPlanOrder.findUnique({
      where: { id: Number(id) },
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
