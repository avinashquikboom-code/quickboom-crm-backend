import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SubscriptionBillingCycle,
  SubscriptionStatus,
  CreateOrderDto,
  RenewSubscriptionDto,
} from './dto/subscription.dto';
import {
  calculatePlanExpiry,
  calculateDaysRemaining,
  deriveSubscriptionStatus,
  getExpiryNotificationPayload,
} from '../../common/utils/subscription-date.util';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(private prisma: PrismaService) {}

  static calculateExpiryDate(startDate: Date, cycle: SubscriptionBillingCycle, durationMonths?: number): Date {
    const months = durationMonths || (cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1);
    return calculatePlanExpiry(startDate, months);
  }

  async getPlans(includeInactive = false) {
    const where: any = { deletedAt: null };
    if (!includeInactive) {
      where.isActive = true;
    }

    let plans = await this.prisma.plan.findMany({
      where,
      orderBy: { monthlyPrice: 'asc' },
    });

    if (plans.length === 0 && !includeInactive) {
      // Seed standard QuikBoom subscription packages
      const standardPlans = [
        {
          name: 'Basic Package',
          code: 'BASIC',
          description: 'Starter Plan for emerging businesses',
          monthlyPrice: 9999,
          yearlyPrice: 95990,
          userLimit: 5,
          leadLimit: 500,
          storageLimit: BigInt(5368709120),
          features: [
            '4 Reels',
            '3 Creative Posts',
            '1 Influencer Promotion',
            '3 Stories',
            'Social Media Account Management',
            'Content Writing & Captions',
            'Trending Hashtags',
            'Meta Ads Campaign Setup & Management',
            'Google Ads Campaign Setup & Management',
            'Monthly Performance Report',
            'Ads will run only during the content execution period.',
            'Meta & Google Ads Budget will be paid by the client.',
          ],
        },
        {
          name: 'Standard Package',
          code: 'STANDARD',
          description: 'Growth Plan for expanding companies',
          monthlyPrice: 14999,
          yearlyPrice: 143990,
          userLimit: 25,
          leadLimit: 5000,
          storageLimit: BigInt(26843545600),
          features: [
            '6 Reels',
            '4 Creative Posts',
            '2 Influencer Promotions',
            '5 Stories',
            'Social Media Account Management',
            'Trending Hashtags',
            'Meta Ads Campaign Setup & Management',
            'Google Ads Campaign Setup & Management',
            'Monthly Performance Report',
            'Ads will run only during the content execution period.',
            'Meta & Google Ads Budget will be paid by the client.',
          ],
        },
        {
          name: 'Premium Package',
          code: 'PREMIUM',
          description: 'Full-service enterprise scale suite',
          monthlyPrice: 24999,
          yearlyPrice: 239990,
          userLimit: 100,
          leadLimit: 50000,
          storageLimit: BigInt(107374182400),
          features: [
            '10 Reels',
            '6 Creative Posts',
            '3 Influencer Promotions',
            '8 Stories',
            'Social Media Account Management',
            'Trending Hashtags',
            'Meta Ads Campaign Setup & Management',
            'Google Ads Campaign Setup & Management',
            'Monthly Performance Report',
            'Ads will run only during the content execution period.',
            'Meta & Google Ads Budget will be paid by the client.',
          ],
        },
      ];

      for (const p of standardPlans) {
        await this.prisma.plan.create({ data: p });
      }

      plans = await this.prisma.plan.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { monthlyPrice: 'asc' },
      });
    }

    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description,
      monthlyPrice: Number(p.monthlyPrice),
      yearlyPrice: Number(p.yearlyPrice),
      userLimit: p.userLimit,
      leadLimit: p.leadLimit,
      storageLimitBytes: Number(p.storageLimit),
      features: p.features,
      isActive: p.isActive,
      isRecommended: p.code === 'STANDARD',
    }));
  }

  async getPlanById(id: number | string) {
    const plan = await this.prisma.plan.findFirst({
      where: { id: Number(id), deletedAt: null },
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID ${id} not found`);
    }

    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      description: plan.description,
      monthlyPrice: Number(plan.monthlyPrice),
      yearlyPrice: Number(plan.yearlyPrice),
      userLimit: plan.userLimit,
      leadLimit: plan.leadLimit,
      storageLimitBytes: Number(plan.storageLimit),
      features: plan.features,
      isActive: plan.isActive,
      isRecommended: plan.code === 'STANDARD',
    };
  }

  async getCurrentSubscription(customerId: number | string) {
    if (!customerId) {
      throw new BadRequestException('customerId is required');
    }
    const numCustomerId = Number(customerId);

    const sub: any = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: true,
        customPlanOrders: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!sub) {
      return null;
    }

    const latestCustomOrder = sub.customPlanOrders?.[0] || await this.prisma.customPlanOrder.findFirst({
      where: { customerId: numCustomerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const daysRemaining = calculateDaysRemaining(sub.endDate);
    const derivedStatus = deriveSubscriptionStatus(sub.status, sub.endDate);
    const isExpired = derivedStatus === 'EXPIRED';

    const planMonthlyPrice = sub.plan ? Number(sub.plan.monthlyPrice) : 999;
    const planYearlyPrice = sub.plan ? Number(sub.plan.yearlyPrice) : 9599;

    const effectivePrice = sub.customPrice !== null && sub.customPrice !== undefined
      ? Number(sub.customPrice)
      : (latestCustomOrder?.totalAmount !== undefined
          ? Number(latestCustomOrder.totalAmount)
          : (sub.billingCycle === SubscriptionBillingCycle.YEARLY ? planYearlyPrice : planMonthlyPrice));

    const effectiveUserLimit = sub.customUserLimit !== null && sub.customUserLimit !== undefined
      ? sub.customUserLimit
      : (sub.plan?.userLimit || 5);

    const effectiveLeadLimit = sub.customLeadLimit !== null && sub.customLeadLimit !== undefined
      ? sub.customLeadLimit
      : (sub.plan?.leadLimit || 500);

    const effectiveFeatures = sub.customFeatures || (latestCustomOrder?.selectedFeatures as any) || sub.plan?.features || [];

    const isCustomPlan = Boolean(
      latestCustomOrder ||
      sub.plan?.code === 'CUSTOM' ||
      sub.customFeatures ||
      sub.customPrice !== null,
    );

    const planType = isCustomPlan ? 'CUSTOM' : 'DEFAULT';
    const planName = isCustomPlan
      ? (sub.plan?.name === 'Custom Plan' ? 'Custom Plan' : (sub.plan?.name || 'Custom Plan'))
      : (sub.plan?.name || 'Starter Plan');

    let reminder: '10_DAYS' | '5_DAYS' | '1_DAY' | 'EXPIRED' | null = null;
    let statusMessage = 'Your plan is active.';

    if (daysRemaining < 0 || isExpired) {
      reminder = 'EXPIRED';
      statusMessage = 'Your plan has expired. Please renew your subscription.';
    } else if (daysRemaining === 0) {
      reminder = '1_DAY';
      statusMessage = 'Your plan expires today.';
    } else if (daysRemaining === 1) {
      reminder = '1_DAY';
      statusMessage = 'Your plan expires tomorrow.';
    } else if (daysRemaining <= 5) {
      reminder = '5_DAYS';
      statusMessage = `Your plan expires in ${daysRemaining} days.`;
    } else if (daysRemaining <= 10) {
      reminder = '10_DAYS';
      statusMessage = `Your plan expires in ${daysRemaining} days.`;
    }

    return {
      id: sub.id,
      customerId: sub.customerId,
      planId: sub.planId,
      planName,
      planCode: sub.plan?.code || 'CUSTOM',
      planType,
      status: derivedStatus,
      rawStatus: sub.status,
      billingCycle: sub.billingCycle || SubscriptionBillingCycle.MONTHLY,
      startDate: sub.startDate,
      purchaseDate: sub.startDate,
      expiryDate: sub.endDate,
      endDate: sub.endDate,
      duration: sub.duration || 1,
      durationUnit: sub.durationUnit || 'MONTH',
      daysRemaining,
      reminder,
      statusMessage,
      price: effectivePrice,
      purchasedPrice: effectivePrice,
      basePrice: sub.billingCycle === SubscriptionBillingCycle.YEARLY ? planYearlyPrice : planMonthlyPrice,
      customPrice: sub.customPrice !== null ? Number(sub.customPrice) : (latestCustomOrder ? Number(latestCustomOrder.totalAmount) : null),
      isCustomized: isCustomPlan,
      userLimit: effectiveUserLimit,
      leadLimit: effectiveLeadLimit,
      features: Array.isArray(effectiveFeatures)
        ? effectiveFeatures
        : (typeof effectiveFeatures === 'object' && effectiveFeatures !== null
            ? Object.entries(effectiveFeatures).map(([k, v]: [string, any]) => `${v?.name || k}: ${v?.quantity || v}`)
            : (sub.plan?.features || [])),
      isExpired,
      customOrder: latestCustomOrder ? {
        orderNumber: latestCustomOrder.orderNumber,
        totalAmount: Number(latestCustomOrder.totalAmount),
        selectedFeatures: latestCustomOrder.selectedFeatures,
        duration: latestCustomOrder.duration,
        status: latestCustomOrder.status,
      } : null,
    };
  }

  async getCustomerOrders(
    customerId: number | string,
    query: { page?: number; limit?: number; search?: string; status?: string } = {},
  ) {
    if (!customerId) {
      throw new BadRequestException('customerId is required');
    }
    const numCustomerId = Number(customerId);
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    const [payments, customOrders, currentSub, customer] = await Promise.all([
      this.prisma.paymentHistory.findMany({
        where: { customerId: numCustomerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: {
            include: { plan: true },
          },
        },
      }),
      this.prisma.customPlanOrder.findMany({
        where: { customerId: numCustomerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: {
            include: { plan: true },
          },
        },
      }),
      this.prisma.customerSubscription.findFirst({
        where: { customerId: numCustomerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      }),
      this.prisma.customer.findUnique({
        where: { id: numCustomerId },
      }),
    ]);

    const combinedOrders: any[] = [];

    // Map standard / package payments
    for (const p of payments) {
      const isPaid = p.status === 'SUCCESS' || p.status === 'PAID';
      const billingCycle = (p.billingCycle as SubscriptionBillingCycle) || SubscriptionBillingCycle.MONTHLY;
      const baseAmount = Number(p.amount);
      const taxAmount = Number(p.taxAmount || (baseAmount * 0.18));
      const totalAmount = Number(p.totalAmount || (baseAmount + taxAmount));

      const purchaseDate = p.createdAt;
      const activationDate = p.createdAt;
      const expiryDate = p.subscription?.endDate || SubscriptionService.calculateExpiryDate(purchaseDate, billingCycle);

      combinedOrders.push({
        id: p.id,
        orderId: `ORD-PAY-${p.id}`,
        orderNumber: p.orderNumber || `#QB-${String(p.id).padStart(6, '0')}`,
        planId: p.planId || p.subscription?.planId || currentSub?.planId || 1,
        planName: p.planName || p.subscription?.plan?.name || currentSub?.plan?.name || 'Standard Package',
        planType: 'DEFAULT',
        billingCycle,
        billingDuration: billingCycle === SubscriptionBillingCycle.YEARLY ? 'YEARLY' : 'MONTHLY',
        amount: baseAmount,
        subtotal: baseAmount,
        discount: 0,
        taxAmount,
        totalAmount,
        status: isPaid ? 'PAID' : (p.status === 'FAILED' ? 'FAILED' : 'PENDING'),
        paymentStatus: isPaid ? 'PAID' : (p.status === 'FAILED' ? 'FAILED' : 'PENDING'),
        paymentMethod: p.paymentMethod || 'RAZORPAY',
        transactionId: p.transactionId || `TXN-${p.id.toString().padStart(8, '0')}`,
        purchaseDate,
        activationDate,
        startDate: purchaseDate,
        expiryDate,
        customerName: customer?.name || 'Customer Account',
        customerEmail: customer?.email || '',
        features: p.subscription?.plan?.features || currentSub?.plan?.features || [],
      });
    }

    // Map custom plan orders
    for (const co of customOrders) {
      const isPaid = co.status === 'PAID' || co.status === 'ACTIVATED';
      const isPending = co.status === 'PENDING_PAYMENT' || co.status === 'PENDING';
      const duration = co.duration || 1;
      const durationUnit = co.durationUnit || 'MONTH';

      const purchaseDate = co.createdAt;
      const startDate = co.startDate || co.createdAt;
      const expiryDate = co.expiryDate || (durationUnit === 'YEAR'
        ? SubscriptionService.calculateExpiryDate(startDate, SubscriptionBillingCycle.YEARLY)
        : SubscriptionService.calculateExpiryDate(startDate, SubscriptionBillingCycle.MONTHLY));

      const selectedFeats = co.selectedFeatures as any;
      const featureList = Array.isArray(selectedFeats)
        ? selectedFeats
        : (typeof selectedFeats === 'object' && selectedFeats !== null
            ? Object.entries(selectedFeats).map(([k, v]: [string, any]) => `${v?.name || k}: ${v?.quantity || v}`)
            : []);

      combinedOrders.push({
        id: co.id + 100000, // Namespace ID for custom orders
        customOrderId: co.id,
        orderId: `ORD-CUST-${co.id}`,
        orderNumber: co.orderNumber,
        planId: co.subscriptionId || 999,
        planName: `Custom Plan (${duration} ${durationUnit.toLowerCase()}${duration > 1 ? 's' : ''})`,
        planType: 'CUSTOM',
        billingCycle: duration >= 12 ? SubscriptionBillingCycle.YEARLY : SubscriptionBillingCycle.MONTHLY,
        billingDuration: `${duration} ${durationUnit}`,
        amount: Number(co.subtotal),
        subtotal: Number(co.subtotal),
        discount: Number(co.discount || 0),
        taxAmount: Number(co.tax || (co.subtotal * 0.18)),
        totalAmount: Number(co.totalAmount),
        status: isPaid ? 'PAID' : (isPending ? 'PENDING' : co.status),
        paymentStatus: isPaid ? 'PAID' : (isPending ? 'PENDING' : co.status),
        paymentMethod: co.paymentMethod || 'RAZORPAY',
        transactionId: co.transactionId || `TXN-CP-${co.id}`,
        purchaseDate,
        activationDate: startDate,
        startDate,
        expiryDate,
        customerName: customer?.name || 'Customer Account',
        customerEmail: customer?.email || '',
        features: featureList,
      });
    }

    // Sort by purchaseDate desc
    combinedOrders.sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());

    // Filter by search
    let filtered = combinedOrders;
    if (query.search && query.search.trim()) {
      const s = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(s) ||
          o.planName.toLowerCase().includes(s) ||
          (o.transactionId && o.transactionId.toLowerCase().includes(s)),
      );
    }

    // Filter by status
    if (query.status && query.status !== 'ALL') {
      const targetStatus = query.status.toUpperCase();
      filtered = filtered.filter((o) => {
        if (targetStatus === 'PAID') return o.paymentStatus === 'PAID';
        if (targetStatus === 'PENDING') return o.paymentStatus === 'PENDING';
        if (targetStatus === 'FAILED') return o.paymentStatus === 'FAILED';
        if (targetStatus === 'MONTHLY') return o.billingCycle === SubscriptionBillingCycle.MONTHLY;
        if (targetStatus === 'YEARLY') return o.billingCycle === SubscriptionBillingCycle.YEARLY;
        return o.status === targetStatus || o.paymentStatus === targetStatus;
      });
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const paginatedItems = filtered.slice(skip, skip + limit);

    return {
      success: true,
      items: paginatedItems,
      data: {
        items: paginatedItems,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getOrderInvoice(customerId: number | string, orderIdOrNumber: string | number) {
    const numCustomerId = Number(customerId);
    const searchVal = String(orderIdOrNumber).trim();

    // Check payment history
    const payment = await this.prisma.paymentHistory.findFirst({
      where: {
        customerId: numCustomerId,
        OR: [
          { orderNumber: searchVal },
          { id: !isNaN(Number(searchVal)) ? Number(searchVal) : undefined },
        ],
      },
      include: {
        customer: true,
        subscription: { include: { plan: true } },
      },
    });

    if (payment) {
      const baseAmount = Number(payment.amount);
      const taxAmount = Number(payment.taxAmount || (baseAmount * 0.18));
      const totalAmount = Number(payment.totalAmount || (baseAmount + taxAmount));
      const billingCycle = (payment.billingCycle as SubscriptionBillingCycle) || SubscriptionBillingCycle.MONTHLY;
      const expiryDate = payment.subscription?.endDate || SubscriptionService.calculateExpiryDate(payment.createdAt, billingCycle);

      return {
        success: true,
        invoiceNumber: `INV-${payment.orderNumber ? payment.orderNumber.replace(/[^A-Za-z0-9]/g, '') : payment.id}`,
        orderNumber: payment.orderNumber || `#QB-${String(payment.id).padStart(6, '0')}`,
        customerName: payment.customer.name,
        customerEmail: payment.customer.email,
        planName: payment.planName || payment.subscription?.plan?.name || 'Standard Package',
        planType: 'DEFAULT',
        features: payment.subscription?.plan?.features || [],
        purchaseDate: payment.createdAt,
        startDate: payment.createdAt,
        expiryDate,
        subtotal: baseAmount,
        discount: 0,
        tax: taxAmount,
        totalAmount,
        currency: payment.currency,
        paymentStatus: payment.status === 'SUCCESS' ? 'PAID' : payment.status,
        paymentMethod: payment.paymentMethod,
        transactionId: payment.transactionId || `TXN-${payment.id}`,
      };
    }

    // Check custom plan order
    const customOrder = await this.prisma.customPlanOrder.findFirst({
      where: {
        customerId: numCustomerId,
        OR: [
          { orderNumber: searchVal },
          { id: !isNaN(Number(searchVal)) ? Number(searchVal) : undefined },
        ],
      },
      include: {
        customer: true,
        subscription: { include: { plan: true } },
      },
    });

    if (customOrder) {
      const selectedFeats = customOrder.selectedFeatures as any;
      const featureList = Array.isArray(selectedFeats)
        ? selectedFeats
        : (typeof selectedFeats === 'object' && selectedFeats !== null
            ? Object.entries(selectedFeats).map(([k, v]: [string, any]) => `${v?.name || k}: ${v?.quantity || v}`)
            : []);

      return {
        success: true,
        invoiceNumber: `INV-${customOrder.orderNumber.replace(/[^A-Za-z0-9]/g, '')}`,
        orderNumber: customOrder.orderNumber,
        customerName: customOrder.customer.name,
        customerEmail: customOrder.customer.email,
        planName: `Custom Plan (${customOrder.duration} ${customOrder.durationUnit.toLowerCase()})`,
        planType: 'CUSTOM',
        features: featureList,
        purchaseDate: customOrder.createdAt,
        startDate: customOrder.startDate || customOrder.createdAt,
        expiryDate: customOrder.expiryDate,
        subtotal: Number(customOrder.subtotal),
        discount: Number(customOrder.discount || 0),
        tax: Number(customOrder.tax || (customOrder.subtotal * 0.18)),
        totalAmount: Number(customOrder.totalAmount),
        currency: customOrder.currency,
        paymentStatus: customOrder.status === 'ACTIVATED' || customOrder.status === 'PAID' ? 'PAID' : customOrder.status,
        paymentMethod: customOrder.paymentMethod,
        transactionId: customOrder.transactionId || `TXN-${customOrder.id}`,
      };
    }

    throw new NotFoundException(`Order or invoice matching "${orderIdOrNumber}" not found for this customer.`);
  }

  async createOrder(customerId: number | string, dto: CreateOrderDto) {
    const numCustomerId = Number(customerId);
    const numPlanId = Number(dto.planId);
    const plan = await this.prisma.plan.findUnique({
      where: { id: numPlanId },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const cycle = dto.billingCycle || SubscriptionBillingCycle.MONTHLY;
    const basePrice = cycle === SubscriptionBillingCycle.MONTHLY ? Number(plan.monthlyPrice) : Number(plan.yearlyPrice);
    const tax = basePrice * 0.18;
    const total = basePrice + tax;

    const startDate = new Date();
    const expiryDate = SubscriptionService.calculateExpiryDate(startDate, cycle);
    const orderNumber = `#QB-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const transactionId = `TXN-${Date.now().toString().substring(3)}`;

    return this.prisma.$transaction(async (tx) => {
      // 1. Create or update customer subscription
      const existingSub = await tx.customerSubscription.findFirst({
        where: { customerId: numCustomerId },
        orderBy: { createdAt: 'desc' },
      });

      let updatedSub;
      if (existingSub) {
        updatedSub = await tx.customerSubscription.update({
          where: { id: existingSub.id },
          data: {
            planId: plan.id,
            status: 'ACTIVE',
            billingCycle: cycle,
            startDate,
            endDate: expiryDate,
          },
          include: { plan: true },
        });
      } else {
        updatedSub = await tx.customerSubscription.create({
          data: {
            customerId: numCustomerId,
            planId: plan.id,
            status: 'ACTIVE',
            billingCycle: cycle,
            startDate,
            endDate: expiryDate,
          },
          include: { plan: true },
        });
      }

      // 2. Create Payment / Order Record
      const payment = await tx.paymentHistory.create({
        data: {
          customerId: numCustomerId,
          planId: plan.id,
          planName: plan.name,
          orderNumber,
          billingCycle: cycle,
          amount: basePrice,
          taxAmount: tax,
          totalAmount: total,
          status: 'SUCCESS',
          paymentMethod: (dto.paymentMethod as PaymentMethod) || PaymentMethod.RAZORPAY,
          transactionId,
        },
      });

      return {
        order: {
          id: payment.id,
          orderNumber: payment.orderNumber,
          planId: plan.id,
          planName: plan.name,
          billingCycle: cycle,
          amount: basePrice,
          taxAmount: tax,
          totalAmount: total,
          paymentStatus: 'PAID',
          paymentMethod: dto.paymentMethod || 'RAZORPAY',
          transactionId,
          purchaseDate: startDate,
          activationDate: startDate,
          expiryDate,
          features: plan.features,
        },
        subscription: {
          id: updatedSub.id,
          customerId: updatedSub.customerId,
          planId: plan.id,
          planName: plan.name,
          planCode: plan.code,
          status: SubscriptionStatus.ACTIVE,
          billingCycle: cycle,
          startDate,
          endDate: expiryDate,
          price: basePrice,
          userLimit: plan.userLimit,
          leadLimit: plan.leadLimit,
          features: plan.features,
          isExpired: false,
        },
      };
    });
  }

  async renewSubscription(customerId: number | string, dto: RenewSubscriptionDto) {
    const numCustomerId = Number(customerId);
    const sub = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!sub) {
      throw new NotFoundException('No existing subscription to renew');
    }

    const cycle = dto.billingCycle || (sub.billingCycle as SubscriptionBillingCycle) || SubscriptionBillingCycle.MONTHLY;
    return this.createOrder(numCustomerId, {
      planId: sub.planId,
      billingCycle: cycle,
      paymentMethod: dto.paymentMethod,
    });
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
  }) {
    const code = dto.code || dto.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const monthlyPrice = Number(dto.monthlyPrice) || 0;
    const yearlyPrice = dto.yearlyPrice ? Number(dto.yearlyPrice) : monthlyPrice * 10;
    const userLimit = Number(dto.userLimit) || 20;
    const leadLimit = Number(dto.leadLimit) || 1000;
    const storageLimit = dto.storageLimitBytes ? BigInt(dto.storageLimitBytes) : BigInt(10737418240);
    const features = Array.isArray(dto.features) ? dto.features : ['CRM', 'HRM', 'Payroll Automation'];

    const plan = await this.prisma.plan.create({
      data: {
        name: dto.name,
        code,
        description: dto.description || '',
        monthlyPrice,
        yearlyPrice,
        userLimit,
        leadLimit,
        storageLimit,
        features,
        isActive: true,
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
      leadLimit: plan.leadLimit,
      features: plan.features,
    };
  }

  async updatePlan(id: number | string, dto: any) {
    const planId = Number(id);
    const updateData: any = {};
    if (dto.name) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.monthlyPrice !== undefined) updateData.monthlyPrice = Number(dto.monthlyPrice);
    if (dto.yearlyPrice !== undefined) updateData.yearlyPrice = Number(dto.yearlyPrice);
    if (dto.userLimit !== undefined) updateData.userLimit = Number(dto.userLimit);
    if (dto.leadLimit !== undefined) updateData.leadLimit = Number(dto.leadLimit);
    if (dto.features !== undefined) updateData.features = dto.features;
    if (dto.isActive !== undefined) updateData.isActive = Boolean(dto.isActive);

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
      leadLimit: plan.leadLimit,
      features: plan.features,
    };
  }

  async deletePlan(id: number | string) {
    const planId = Number(id);
    await this.prisma.plan.update({
      where: { id: planId },
      data: { isActive: false, deletedAt: new Date() },
    });
    return { success: true, message: `Plan ${planId} deactivated` };
  }

  /**
   * Get all subscriptions for Admin/Super Admin with search, pagination, and derived expiry status
   */
  async getAllSubscriptions(query: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { customer: { name: { contains: s, mode: 'insensitive' } } },
        { customer: { email: { contains: s, mode: 'insensitive' } } },
        { plan: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.customerSubscription.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true, assignedEmployee: true } },
          plan: { select: { id: true, name: true, code: true, monthlyPrice: true } },
        },
      }),
      this.prisma.customerSubscription.count({ where }),
    ]);

    const formatted = items.map((s) => {
      const daysRemaining = calculateDaysRemaining(s.endDate);
      const derivedStatus = deriveSubscriptionStatus(s.status, s.endDate);

      return {
        id: s.id,
        customerId: s.customerId,
        customerName: s.customer?.name || 'N/A',
        customerEmail: s.customer?.email || 'N/A',
        assignedEmployee: s.customer?.assignedEmployee || 'Unassigned',
        planId: s.planId,
        planName: s.plan?.name || 'Starter Plan',
        startDate: s.startDate,
        purchaseDate: s.startDate,
        expiryDate: s.endDate,
        endDate: s.endDate,
        duration: s.duration || 1,
        durationUnit: s.durationUnit || 'MONTH',
        billingCycle: s.billingCycle,
        daysRemaining,
        status: derivedStatus,
        rawStatus: s.status,
        price: s.customPrice !== null ? Number(s.customPrice) : Number(s.plan?.monthlyPrice || 0),
        isExpired: derivedStatus === 'EXPIRED',
        createdAt: s.createdAt,
      };
    });

    let filtered = formatted;
    if (query.status && query.status !== 'ALL') {
      filtered = formatted.filter((s) => s.status === query.status || s.rawStatus === query.status);
    }

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: filtered,
      items: filtered,
      pagination: {
        page,
        pageSize: limit,
        limit,
        total,
        totalPages,
      },
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Get subscriptions expiring in <= days (e.g. 10 days, 5 days, 1 day, 0 days)
   */
  async getExpiringSubscriptions(days = 10) {
    const numDays = Math.max(0, Number(days) || 10);
    const now = new Date();
    const targetThreshold = new Date(now.getTime() + (numDays + 1) * 24 * 60 * 60 * 1000);

    const subscriptions = await this.prisma.customerSubscription.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'TRIAL'] },
        endDate: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          lte: targetThreshold,
        },
      },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true, assignedEmployee: true } },
        plan: { select: { id: true, name: true, code: true, monthlyPrice: true } },
      },
      orderBy: { endDate: 'asc' },
    });

    return subscriptions.map((s) => {
      const daysRemaining = calculateDaysRemaining(s.endDate);
      const derivedStatus = deriveSubscriptionStatus(s.status, s.endDate);

      return {
        id: s.id,
        customerId: s.customerId,
        customerName: s.customer?.name || 'N/A',
        customerEmail: s.customer?.email || 'N/A',
        assignedEmployee: s.customer?.assignedEmployee || 'Unassigned',
        planId: s.planId,
        planName: s.plan?.name || 'Starter Plan',
        startDate: s.startDate,
        expiryDate: s.endDate,
        daysRemaining,
        status: derivedStatus,
        price: s.customPrice !== null ? Number(s.customPrice) : Number(s.plan?.monthlyPrice || 0),
      };
    });
  }

  /**
   * Get expired subscriptions
   */
  async getExpiredSubscriptions() {
    const now = new Date();
    const subscriptions = await this.prisma.customerSubscription.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: 'EXPIRED' },
          { endDate: { lt: now } },
        ],
      },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true, assignedEmployee: true } },
        plan: { select: { id: true, name: true, code: true, monthlyPrice: true } },
      },
      orderBy: { endDate: 'desc' },
    });

    return subscriptions.map((s) => {
      const daysRemaining = calculateDaysRemaining(s.endDate);
      return {
        id: s.id,
        customerId: s.customerId,
        customerName: s.customer?.name || 'N/A',
        customerEmail: s.customer?.email || 'N/A',
        assignedEmployee: s.customer?.assignedEmployee || 'Unassigned',
        planId: s.planId,
        planName: s.plan?.name || 'Starter Plan',
        startDate: s.startDate,
        expiryDate: s.endDate,
        daysRemaining,
        status: 'EXPIRED',
        price: s.customPrice !== null ? Number(s.customPrice) : Number(s.plan?.monthlyPrice || 0),
      };
    });
  }

  /**
   * Daily expiry runner: checks days remaining, dispatches multi-stage notifications with idempotency, and updates statuses.
   */
  async runDailyExpiryCheck() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    this.logger.log('Starting daily plan expiry and reminder scan...');

    const activeSubscriptions = await this.prisma.customerSubscription.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'TRIAL'] },
      },
      include: {
        customer: {
          include: {
            users: { where: { deletedAt: null }, take: 5 },
          },
        },
        plan: true,
      },
    });

    let remindersDispatched = 0;
    let expiredUpdated = 0;

    for (const sub of activeSubscriptions) {
      const daysRemaining = calculateDaysRemaining(sub.endDate, now);
      const payload = getExpiryNotificationPayload(sub.plan?.name || 'Your Plan', daysRemaining, sub.endDate);

      if (payload) {
        // Idempotency: verify this specific reminder hasn't already been sent today
        const existingNotification = await this.prisma.notification.findFirst({
          where: {
            customerId: sub.customerId,
            type: payload.type,
            createdAt: {
              gte: todayStart,
              lte: todayEnd,
            },
          },
        });

        if (!existingNotification) {
          // Dispatch notification to customer users
          const targetUsers = sub.customer?.users || [];
          for (const user of targetUsers) {
            await this.prisma.notification.create({
              data: {
                customerId: sub.customerId,
                userId: user.id,
                title: payload.title,
                message: payload.message,
                type: payload.type,
                data: {
                  subscriptionId: sub.id,
                  planId: sub.planId,
                  daysRemaining,
                  expiryDate: sub.endDate,
                },
              },
            });
            remindersDispatched++;
          }
        }
      }

      // Mark expired subscriptions
      if (daysRemaining < 0 && sub.status !== 'EXPIRED') {
        await this.prisma.customerSubscription.update({
          where: { id: sub.id },
          data: { status: 'EXPIRED' },
        });
        expiredUpdated++;
      }
    }

    this.logger.log(`Daily scan completed: ${remindersDispatched} reminders dispatched, ${expiredUpdated} subscriptions expired.`);

    return {
      success: true,
      checkedCount: activeSubscriptions.length,
      remindersDispatched,
      expiredUpdated,
      timestamp: new Date().toISOString(),
    };
  }
}

