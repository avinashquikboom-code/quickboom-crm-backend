import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PaymentMethod, InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SubscriptionBillingCycle,
  SubscriptionStatus,
  CreateOrderDto,
  RenewSubscriptionDto,
} from './dto/subscription.dto';
import { ScheduleService } from '../schedule/schedule.service';
import { WorkService } from '../work/work.service';
import { extractDeliverableQuotas } from '../../common/utils/plan-deliverable.util';
import {
  calculatePlanExpiry,
  calculateSubscriptionStartDate,
  calculateSubscriptionDates,
  calculateDaysRemaining,
  deriveSubscriptionStatus,
  getExpiryNotificationPayload,
} from '../../common/utils/subscription-date.util';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private prisma: PrismaService,
    private scheduleService?: ScheduleService,
    private workService?: WorkService,
  ) {}

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
          description: 'Scale Plan for enterprise-level growth',
          monthlyPrice: 25999,
          yearlyPrice: 249590,
          userLimit: 100,
          leadLimit: 50000,
          storageLimit: BigInt(107374182400),
          features: [
            '2 Product Reels',
            '8 Influencer Reels (Total 10 Reels)',
            '8 Creative Posts',
            '30 Stories',
            'Complete Social Media Management',
            'Premium Content Strategy & Caption Writing',
            'Advanced Hashtag Research',
            'Meta Ads Campaign Setup & Management',
            'Google Ads Campaign Setup & Management',
            'Detailed Monthly Analytics Report',
            'Priority Graphic Designing',
            'Ads will run throughout the campaign/content execution period.',
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

    return plans.map((p) => {
      let subtitle = 'Custom Plan';
      if (p.code === 'BASIC') subtitle = 'Starter Plan';
      else if (p.code === 'STANDARD') subtitle = 'Growth Plan';
      else if (p.code === 'PREMIUM') subtitle = 'Scale Plan';
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
        leadLimit: p.leadLimit,
        storageLimitBytes: Number(p.storageLimit),
        features: p.features,
        isActive: p.isActive,
        isRecommended: p.code === 'STANDARD',
      };
    });
  }

  async getPlanById(id: number | string) {
    const plan = await this.prisma.plan.findFirst({
      where: { id: Number(id), deletedAt: null },
    });

    let subtitle = 'Custom Plan';
    if (plan.code === 'BASIC') subtitle = 'Starter Plan';
    else if (plan.code === 'STANDARD') subtitle = 'Growth Plan';
    else if (plan.code === 'PREMIUM') subtitle = 'Scale Plan';
    else if (plan.description) subtitle = plan.description;

    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      subtitle,
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

    const [payments, customOrders, currentSub, customer, invoices] = await Promise.all([
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
      this.prisma.invoice.findMany({
        where: { customerId: numCustomerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const combinedOrders: any[] = [];

    // Map standard / package payments
    for (const p of payments) {
      const isPaid = p.status === 'SUCCESS' || p.status === 'PAID';
      const isPending = p.status === 'PENDING';
      const billingCycle = (p.billingCycle as SubscriptionBillingCycle) || SubscriptionBillingCycle.MONTHLY;
      const baseAmount = Number(p.amount);
      const taxAmount = Number(p.taxAmount || (baseAmount * 0.18));
      const totalAmount = Number(p.totalAmount || (baseAmount + taxAmount));

      const purchaseDate = p.createdAt;
      const activationDate = p.createdAt;
      const expiryDate = p.subscription?.endDate || SubscriptionService.calculateExpiryDate(purchaseDate, billingCycle);

      const receiptNo = p.invoiceUrl?.startsWith('REC-')
        ? p.invoiceUrl
        : `REC-${p.createdAt.getFullYear()}-${String(p.id).padStart(6, '0')}`;

      // Check if this is an installment payment or full payment
      const planPrice = billingCycle === SubscriptionBillingCycle.YEARLY
        ? Number(p.subscription?.plan?.yearlyPrice || 0)
        : Number(p.subscription?.plan?.monthlyPrice || 0);
      const isAdvance = (p.billingCycle as any) === 'ADVANCE' || (planPrice > 0 && Number(p.amount) < planPrice);
      const matchingInvoice = invoices.find((inv) => inv.id === p.id || inv.status === 'PAID');

      // Installments structure
      const installments: any[] = [];
      if (isAdvance) {
        // 2 Installments: 50% + 50%
        installments.push({
          number: 1,
          title: 'First Installment (50% Advance)',
          amount: totalAmount,
          status: isPaid ? 'PAID' : (isPending ? 'PENDING' : 'FAILED'),
          receiptAvailable: isPaid,
          receiptId: isPaid ? receiptNo : null,
          receiptNumber: isPaid ? receiptNo : null,
          downloadUrl: isPaid ? `/receipts/${receiptNo}/download` : null,
          lockReason: isPaid ? null : (isPending ? 'Pending admin approval' : 'Payment required'),
        });
        installments.push({
          number: 2,
          title: 'Second Installment (50% Balance)',
          amount: totalAmount,
          status: 'PENDING',
          receiptAvailable: false,
          receiptId: null,
          receiptNumber: null,
          downloadUrl: null,
          lockReason: 'Available after second installment',
        });
      } else {
        // 100% Full Payment
        installments.push({
          number: 1,
          title: 'Full Payment (100%)',
          amount: totalAmount,
          status: isPaid ? 'PAID' : (isPending ? 'PENDING' : 'FAILED'),
          receiptAvailable: isPaid,
          receiptId: isPaid ? receiptNo : null,
          receiptNumber: isPaid ? receiptNo : null,
          downloadUrl: isPaid ? `/receipts/${receiptNo}/download` : null,
          lockReason: isPaid ? null : (isPending ? 'Pending admin approval' : 'Payment required'),
        });
      }

      const invoiceAvailable = isPaid && !isAdvance && !!matchingInvoice;

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
        paidAmount: isPaid ? totalAmount : 0,
        remainingAmount: isPaid ? (isAdvance ? totalAmount : 0) : totalAmount,
        status: isPaid ? 'PAID' : (p.status === 'FAILED' ? 'FAILED' : 'PENDING'),
        paymentStatus: isPaid ? (isAdvance ? 'PARTIALLY_PAID' : 'FULLY_PAID') : (p.status === 'FAILED' ? 'FAILED' : 'PENDING'),
        paymentMethod: p.paymentMethod || 'RAZORPAY',
        transactionId: p.transactionId || `TXN-${p.id.toString().padStart(8, '0')}`,
        purchaseDate,
        activationDate,
        startDate: purchaseDate,
        expiryDate,
        customerName: customer?.name || 'Customer Account',
        customerEmail: customer?.email || '',
        features: p.subscription?.plan?.features || currentSub?.plan?.features || [],
        receiptAvailable: isPaid,
        receiptId: isPaid ? receiptNo : null,
        receiptNumber: isPaid ? receiptNo : null,
        documentNumber: isPaid ? receiptNo : `DOC-${p.id}`,
        receiptDownloadUrl: isPaid ? `/receipts/${receiptNo}/download` : null,
        receiptLockReason: isPaid ? null : (isPending ? 'Pending admin approval' : 'Payment required'),
        invoiceAvailable,
        invoiceId: invoiceAvailable ? matchingInvoice.id : null,
        invoiceNumber: invoiceAvailable ? matchingInvoice.invoiceNo : null,
        invoiceDownloadUrl: invoiceAvailable ? `/invoices/${matchingInvoice.id}/download` : null,
        invoiceLockReason: isAdvance
          ? 'Available after complete payment'
          : (!isPaid ? (isPending ? 'Pending admin approval' : 'Payment required') : null),
        installments,
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

      const receiptNo = `REC-${co.createdAt.getFullYear()}-CP${String(co.id).padStart(4, '0')}`;
      const matchingInvoice = invoices.find((inv) => inv.status === 'PAID');
      const invoiceAvailable = isPaid && !!matchingInvoice;

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
        paidAmount: isPaid ? Number(co.totalAmount) : 0,
        remainingAmount: isPaid ? 0 : Number(co.totalAmount),
        status: isPaid ? 'PAID' : (isPending ? 'PENDING' : co.status),
        paymentStatus: isPaid ? 'FULLY_PAID' : (isPending ? 'PENDING' : co.status),
        paymentMethod: co.paymentMethod || 'RAZORPAY',
        transactionId: co.transactionId || `TXN-CP-${co.id}`,
        purchaseDate,
        activationDate: startDate,
        startDate,
        expiryDate,
        customerName: customer?.name || 'Customer Account',
        customerEmail: customer?.email || '',
        features: featureList,
        receiptAvailable: isPaid,
        receiptId: isPaid ? receiptNo : null,
        receiptNumber: isPaid ? receiptNo : null,
        documentNumber: isPaid ? receiptNo : `DOC-${co.id + 100000}`,
        receiptDownloadUrl: isPaid ? `/receipts/${receiptNo}/download` : null,
        receiptLockReason: isPaid ? null : (isPending ? 'Pending admin approval' : 'Payment required'),
        invoiceAvailable,
        invoiceId: invoiceAvailable ? matchingInvoice.id : null,
        invoiceNumber: invoiceAvailable ? matchingInvoice.invoiceNo : null,
        invoiceDownloadUrl: invoiceAvailable ? `/invoices/${matchingInvoice.id}/download` : null,
        invoiceLockReason: !isPaid ? (isPending ? 'Pending admin approval' : 'Payment required') : null,
        installments: [
          {
            number: 1,
            title: 'Custom Plan Payment',
            amount: Number(co.totalAmount),
            status: isPaid ? 'PAID' : (isPending ? 'PENDING' : 'FAILED'),
            receiptAvailable: isPaid,
            receiptId: isPaid ? receiptNo : null,
            receiptNumber: isPaid ? receiptNo : null,
            downloadUrl: isPaid ? `/receipts/${receiptNo}/download` : null,
            lockReason: isPaid ? null : (isPending ? 'Pending admin approval' : 'Payment required'),
          },
        ],
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
      data: paginatedItems,
      orders: paginatedItems,
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

    const result = await this.prisma.$transaction(async (tx) => {
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
            customPrice: null,
            customFeatures: null,
            customUserLimit: null,
            customLeadLimit: null,
            customStorageLimit: null,
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
            customPrice: null,
            customFeatures: null,
            customUserLimit: null,
            customLeadLimit: null,
            customStorageLimit: null,
          },
          include: { plan: true },
        });
      }

      // Mark other subscriptions for this customer as EXPIRED
      await tx.customerSubscription.updateMany({
        where: {
          customerId: numCustomerId,
          id: { not: updatedSub.id },
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
        },
        data: {
          status: SubscriptionStatus.EXPIRED,
        },
      });

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

      // Generate Invoice record for this subscription transaction
      const invoiceNo = `INV-${new Date(startDate).getFullYear()}-${String(payment.id).padStart(6, '0')}`;
      let contact = await tx.contact.findFirst({
        where: { customerId: numCustomerId, deletedAt: null },
      });
      if (!contact) {
        const cust = await tx.customer.findUnique({ where: { id: numCustomerId } });
        contact = await tx.contact.create({
          data: {
            customerId: numCustomerId,
            firstName: cust?.name || 'Customer',
            lastName: 'Account',
            email: cust?.email || 'billing@customer.com',
            phone: cust?.phone || 'N/A',
          },
        });
      }
      await tx.invoice.create({
        data: {
          customerId: numCustomerId,
          contactId: contact.id,
          invoiceNo,
          status: InvoiceStatus.PAID,
          issueDate: startDate,
          dueDate: startDate,
          subTotal: basePrice,
          taxAmount: tax,
          discount: 0,
          totalAmount: total,
          notes: `Subscription payment for ${plan.name} (${cycle} billing). Payment Method: ${(dto.paymentMethod as PaymentMethod) || PaymentMethod.RAZORPAY}. Order: ${orderNumber}`,
        },
      });
      await tx.paymentHistory.update({
        where: { id: payment.id },
        data: { invoiceUrl: invoiceNo },
      });

      // Generate 3 Installments for subscription
      const totalInstallments = 3;
      const rawInstAmt = Math.round((total / totalInstallments) * 100) / 100;
      const baseInstAmt = Math.round((basePrice / totalInstallments) * 100) / 100;
      const taxInstAmt = Math.round((tax / totalInstallments) * 100) / 100;

      await tx.subscriptionInstallment.deleteMany({
        where: { subscriptionId: updatedSub.id },
      });

      const inst1Expiry = new Date(startDate);
      inst1Expiry.setDate(inst1Expiry.getDate() + 30);
      const inst1BufferEnd = new Date(inst1Expiry);
      inst1BufferEnd.setDate(inst1BufferEnd.getDate() + 3);

      const createdInvoice = await tx.invoice.findFirst({ where: { invoiceNo } });

      await tx.subscriptionInstallment.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: updatedSub.id,
          installmentNumber: 1,
          totalInstallments,
          title: 'Installment 1 of 3 (Advance)',
          amount: baseInstAmt,
          taxAmount: taxInstAmt,
          totalAmount: rawInstAmt,
          status: 'PAID',
          dueDate: startDate,
          expiryDate: inst1Expiry,
          bufferDays: 3,
          bufferEndDate: inst1BufferEnd,
          paidAt: startDate,
          paymentHistoryId: payment.id,
          invoiceId: createdInvoice?.id,
          notes: 'Initial advance installment payment',
        },
      });

      const inst2Start = new Date(inst1Expiry);
      const inst2Expiry = new Date(inst2Start);
      inst2Expiry.setDate(inst2Expiry.getDate() + 30);
      const inst2BufferEnd = new Date(inst2Expiry);
      inst2BufferEnd.setDate(inst2BufferEnd.getDate() + 3);

      await tx.subscriptionInstallment.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: updatedSub.id,
          installmentNumber: 2,
          totalInstallments,
          title: 'Installment 2 of 3',
          amount: baseInstAmt,
          taxAmount: taxInstAmt,
          totalAmount: rawInstAmt,
          status: 'DUE',
          dueDate: inst2Start,
          expiryDate: inst2Expiry,
          bufferDays: 3,
          bufferEndDate: inst2BufferEnd,
        },
      });

      const inst3Start = new Date(inst2Expiry);
      const inst3Expiry = new Date(inst3Start);
      inst3Expiry.setDate(inst3Expiry.getDate() + 30);
      const inst3BufferEnd = new Date(inst3Expiry);
      inst3BufferEnd.setDate(inst3BufferEnd.getDate() + 3);

      await tx.subscriptionInstallment.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: updatedSub.id,
          installmentNumber: 3,
          totalInstallments,
          title: 'Installment 3 of 3',
          amount: baseInstAmt,
          taxAmount: taxInstAmt,
          totalAmount: rawInstAmt,
          status: 'UPCOMING',
          dueDate: inst3Start,
          expiryDate: inst3Expiry,
          bufferDays: 3,
          bufferEndDate: inst3BufferEnd,
        },
      });

      // 3. Initialize or refresh service entitlements based on plan features
      const featureList = Array.isArray(plan.features) ? plan.features : [];
      const serviceQuotas: { serviceName: string; totalQty: number }[] = [];

      for (const item of featureList) {
        const text = typeof item === 'string' ? item : ((item as any)?.name || (item as any)?.title || '');
        const match = text.match(/^(\d+)\s+(.+)$/i);
        if (match) {
          const qty = parseInt(match[1], 10);
          const name = match[2].trim();
          serviceQuotas.push({ serviceName: name, totalQty: qty });
        }
      }

      if (!serviceQuotas.some((s) => s.serviceName.toLowerCase().includes('reel'))) {
        serviceQuotas.push({ serviceName: 'Reels', totalQty: plan.code === 'PREMIUM' ? 10 : (plan.code === 'STANDARD' ? 6 : 4) });
      }
      if (!serviceQuotas.some((s) => s.serviceName.toLowerCase().includes('post') || s.serviceName.toLowerCase().includes('creative'))) {
        serviceQuotas.push({ serviceName: 'Creative Posts', totalQty: plan.code === 'PREMIUM' ? 6 : (plan.code === 'STANDARD' ? 4 : 3) });
      }
      if (!serviceQuotas.some((s) => s.serviceName.toLowerCase().includes('story') || s.serviceName.toLowerCase().includes('stories'))) {
        serviceQuotas.push({ serviceName: 'Stories', totalQty: plan.code === 'PREMIUM' ? 8 : (plan.code === 'STANDARD' ? 5 : 3) });
      }
      if (!serviceQuotas.some((s) => s.serviceName.toLowerCase().includes('influencer'))) {
        serviceQuotas.push({ serviceName: 'Influencer Promotion', totalQty: plan.code === 'PREMIUM' ? 3 : (plan.code === 'STANDARD' ? 2 : 1) });
      }

      for (const sq of serviceQuotas) {
        const existingEnt = await tx.planEntitlement.findFirst({
          where: { customerId: numCustomerId, serviceName: sq.serviceName },
        });
        if (existingEnt) {
          await tx.planEntitlement.update({
            where: { id: existingEnt.id },
            data: {
              planId: plan.id,
              totalQty: sq.totalQty,
              validUntil: expiryDate,
            },
          });
        } else {
          await tx.planEntitlement.create({
            data: {
              customerId: numCustomerId,
              planId: plan.id,
              serviceName: sq.serviceName,
              totalQty: sq.totalQty,
              usedQty: 0,
              scheduledQty: 0,
              validUntil: expiryDate,
            },
          });
        }
      }

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

    // 4. Trigger Automatic Dynamic Schedule Generation for admin activated subscription
    try {
      if (this.scheduleService) {
        await this.scheduleService.generateSchedulesForSubscription(result.subscription.id);
      }
      if (this.workService) {
        await this.workService.generatePlanSchedules(numCustomerId, result.subscription.id);
      }
    } catch (schedErr: any) {
      this.logger.warn(`[AUTO_SCHEDULE_WARNING] Schedule generation notice: ${schedErr?.message}`);
    }

    return result;
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
    if (!planId || isNaN(planId)) {
      throw new BadRequestException('Valid Plan ID is required');
    }

    const existing = await this.prisma.plan.findUnique({
      where: { id: planId },
    });
    if (!existing) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    const updateData: any = {};
    if (dto.name !== undefined && typeof dto.name === 'string' && dto.name.trim().length > 0) {
      updateData.name = dto.name.trim();
    }
    if (dto.code !== undefined && typeof dto.code === 'string' && dto.code.trim().length > 0) {
      updateData.code = dto.code.trim().toUpperCase();
    }
    if (dto.description !== undefined) {
      updateData.description = typeof dto.description === 'string' ? dto.description.trim() : '';
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
      const storage = dto.storageLimit !== undefined ? dto.storageLimit : dto.storageLimitBytes;
      if (!isNaN(Number(storage))) {
        updateData.storageLimit = BigInt(storage);
      }
    }
    if (dto.features !== undefined) {
      if (Array.isArray(dto.features)) {
        updateData.features = dto.features;
      } else if (typeof dto.features === 'string') {
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

    const existing = await this.prisma.plan.findUnique({
      where: { id: planId },
    });
    if (!existing) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    // Soft-delete / deactivate plan so existing customer subscriptions and records remain linked
    const plan = await this.prisma.plan.update({
      where: { id: planId },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

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

  /**
   * Admin: Get all subscription details for a specific customer
   */
  async getAdminCustomerSubscriptions(customerId: number | string) {
    const numCustomerId = Number(customerId);
    if (!numCustomerId || isNaN(numCustomerId)) {
      throw new BadRequestException('Invalid customerId');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
      include: {
        _count: { select: { users: true, leads: true, works: true } },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer #${customerId} not found`);
    }

    // Fetch all non-deleted subscriptions for this customer
    const subscriptions = await this.prisma.customerSubscription.findMany({
      where: { customerId: numCustomerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: true,
        payments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
        customPlanOrders: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: { works: true },
        },
      },
    });

    const now = new Date();

    // Map each subscription to formatted object with exact quota snapshot and payment data
    const formattedList = subscriptions.map((sub) => {
      const isExpired = sub.status === SubscriptionStatus.EXPIRED || (sub.endDate ? now > new Date(sub.endDate) : false);
      const isCanceled = sub.status === SubscriptionStatus.CANCELED;
      const isPastDue = sub.status === SubscriptionStatus.PAST_DUE;
      const isTrial = sub.status === SubscriptionStatus.TRIAL;

      let displayStatus = 'ACTIVE';
      if (isCanceled) {
        displayStatus = 'DEACTIVATED';
      } else if (isExpired) {
        displayStatus = 'EXPIRED';
      } else if (isPastDue) {
        displayStatus = 'PAST_DUE';
      } else if (isTrial) {
        displayStatus = isExpired ? 'EXPIRED' : 'TRIAL';
      } else if (sub.status === SubscriptionStatus.ACTIVE) {
        displayStatus = isExpired ? 'EXPIRED' : 'ACTIVE';
      }

      const customOrder = sub.customPlanOrders?.[0];
      const isCustomPlan = Boolean(
        customOrder ||
        sub.plan?.code === 'CUSTOM' ||
        sub.customFeatures ||
        sub.customPrice !== null,
      );

      const planType = isCustomPlan ? 'CUSTOM' : 'STANDARD';
      const planName = isCustomPlan
        ? (sub.plan?.name === 'Custom Plan' ? 'Custom Plan' : (sub.plan?.name || 'Custom Marketing Plan'))
        : (sub.plan?.name || 'Starter Plan');

      const planMonthlyPrice = sub.plan ? Number(sub.plan.monthlyPrice) : 0;
      const planYearlyPrice = sub.plan ? Number(sub.plan.yearlyPrice) : 0;
      const basePrice = sub.customPrice !== null && sub.customPrice !== undefined
        ? Number(sub.customPrice)
        : (customOrder?.totalAmount !== undefined
            ? Number(customOrder.totalAmount)
            : (sub.billingCycle === SubscriptionBillingCycle.YEARLY ? planYearlyPrice : planMonthlyPrice));

      const gst = Math.round(basePrice * 0.18);
      const totalAmount = basePrice + gst;

      const latestPayment = sub.payments?.[0];
      const paymentStatus = latestPayment?.status || (sub.status === SubscriptionStatus.ACTIVE ? 'PAID' : 'PENDING');
      const paymentMethod = latestPayment?.paymentMethod || 'RAZORPAY';
      const paymentId = latestPayment?.paymentId || latestPayment?.transactionId || (latestPayment ? `TXN-${latestPayment.id}` : null);
      const orderId = latestPayment?.orderId || latestPayment?.orderNumber || (customOrder?.orderNumber || null);

      const userLimit = sub.customUserLimit || sub.plan?.userLimit || 5;
      const leadLimit = sub.customLeadLimit || sub.plan?.leadLimit || 500;
      const storageLimit = sub.customStorageLimit ? Number(sub.customStorageLimit) : Number(sub.plan?.storageLimit || 5368709120);

      // Quotas / Deliverables calculation
      let deliverablesQuota: Array<{ name: string; total: number; used: number; remaining: number }> = [];

      if (customOrder && customOrder.selectedFeatures && typeof customOrder.selectedFeatures === 'object') {
        const feats = customOrder.selectedFeatures as any[];
        if (Array.isArray(feats)) {
          deliverablesQuota = feats.map((f: any) => ({
            name: f.name || f.optionName || f.optionId || 'Deliverable',
            total: Number(f.quantity || f.qty || 1),
            used: 0,
            remaining: Number(f.quantity || f.qty || 1),
          }));
        }
      }

      if (deliverablesQuota.length === 0 && sub.plan?.features) {
        const feats = sub.plan.features as any;
        if (Array.isArray(feats)) {
          deliverablesQuota = feats.map((f: any) => ({
            name: String(f),
            total: 1,
            used: 0,
            remaining: 1,
          }));
        } else if (typeof feats === 'object' && feats !== null) {
          deliverablesQuota = Object.entries(feats).map(([k, v]: [string, any]) => ({
            name: v?.name || k,
            total: Number(v?.quantity || v || 1),
            used: 0,
            remaining: Number(v?.quantity || v || 1),
          }));
        }
      }

      return {
        id: sub.id,
        subscriptionId: `SUB-${String(sub.id).padStart(4, '0')}`,
        customerId: sub.customerId,
        planId: sub.planId,
        planName,
        planCode: sub.plan?.code || 'CUSTOM',
        planType,
        billingCycle: sub.billingCycle || SubscriptionBillingCycle.MONTHLY,
        startDate: sub.startDate,
        expiryDate: sub.endDate,
        endDate: sub.endDate,
        baseAmount: basePrice,
        gst,
        totalAmount,
        paymentStatus,
        paymentMethod,
        paymentId,
        orderId,
        paymentDate: latestPayment?.createdAt || sub.createdAt,
        subscriptionStatus: displayStatus,
        rawStatus: sub.status,
        isActive: displayStatus === 'ACTIVE',
        isCurrent: false,
        includedUsers: `${customer._count.users || 1} / ${userLimit} Users`,
        userLimit,
        leadLimit,
        storageLimit,
        quotas: deliverablesQuota,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt,
      };
    });

    // Determine current subscription:
    // Prefer the first one that is ACTIVE, otherwise latest created
    let currentSub = formattedList.find((s) => s.subscriptionStatus === 'ACTIVE');
    if (!currentSub && formattedList.length > 0) {
      currentSub = formattedList[0];
    }

    if (currentSub) {
      currentSub.isCurrent = true;
    }

    const previousSubscriptions = formattedList.filter((s) => s.id !== currentSub?.id);

    return {
      success: true,
      currentSubscription: currentSub || null,
      subscriptionHistory: formattedList,
      previousSubscriptions,
      totalCount: formattedList.length,
    };
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
  ) {
    const numCustomerId = Number(customerId);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numCustomerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer #${customerId} not found`);
    }

    const numPlanId = Number(dto.planId);
    const plan = await this.prisma.plan.findUnique({
      where: { id: numPlanId },
    });
    if (!plan) {
      throw new NotFoundException(`Plan #${dto.planId} not found`);
    }

    const cycle =
      dto.billingCycle === 'YEARLY'
        ? SubscriptionBillingCycle.YEARLY
        : SubscriptionBillingCycle.MONTHLY;

    const durationMonths = cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1;
    const startDate = dto.startDate ? new Date(dto.startDate) : calculateSubscriptionStartDate(new Date());
    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : calculatePlanExpiry(startDate, durationMonths);

    const basePrice =
      dto.customPrice !== undefined && dto.customPrice !== null
        ? Number(dto.customPrice)
        : cycle === SubscriptionBillingCycle.YEARLY
        ? Number(plan.yearlyPrice)
        : Number(plan.monthlyPrice);

    const gst = Math.round(basePrice * 0.18);
    const totalAmount = basePrice + gst;

    const newSub = await this.prisma.$transaction(async (tx) => {
      // 1. Deactivate any existing active subscriptions for this customer
      await tx.customerSubscription.updateMany({
        where: {
          customerId: numCustomerId,
          status: SubscriptionStatus.ACTIVE,
        },
        data: {
          status: SubscriptionStatus.EXPIRED,
        },
      });

      // 2. Create the new active subscription
      const sub = await tx.customerSubscription.create({
        data: {
          customerId: numCustomerId,
          planId: plan.id,
          billingCycle: cycle,
          status: SubscriptionStatus.ACTIVE,
          startDate,
          endDate,
          duration: durationMonths,
          customPrice: dto.customPrice !== undefined ? dto.customPrice : null,
          customUserLimit: dto.customUserLimit || null,
          customLeadLimit: dto.customLeadLimit || null,
          customStorageLimit: dto.customStorageLimit ? BigInt(dto.customStorageLimit) : null,
          customFeatures: dto.customFeatures || null,
        },
        include: { plan: true },
      });

      // 3. Record payment history as PAID / SUCCESS
      await tx.paymentHistory.create({
        data: {
          customerId: numCustomerId,
          subscriptionId: sub.id,
          planId: plan.id,
          planName: plan.name,
          billingCycle: cycle,
          amount: totalAmount,
          taxAmount: gst,
          totalAmount,
          currency: 'INR',
          status: 'SUCCESS',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          transactionId: `ADMIN-MANUAL-${Date.now()}`,
          orderId: `ORD-${Date.now()}`,
          orderNumber: `#QB-MANUAL-${Date.now().toString(36).toUpperCase()}`,
        },
      });

      // 4. Update customer active status
      await tx.customer.update({
        where: { id: numCustomerId },
        data: {
          isActive: true,
        },
      });

      return sub;
    });

    // 5. Generate Monthly Schedules and Work deliverables for the subscription period
    try {
      if (this.scheduleService) {
        await this.scheduleService.generateSchedulesForSubscription(newSub.id, { force: true });
      }
      if (this.workService) {
        await this.workService.generatePlanSchedules(numCustomerId, newSub.id);
      }
    } catch (err: any) {
      this.logger.warn(`[SCHEDULE_GEN_WARN] Failed auto-generating schedule: ${err?.message}`);
    }

    // 6. Write audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'MANUAL_ACTIVATE_SUBSCRIPTION',
          module: 'SUBSCRIPTIONS',
          userId: adminUserId,
          customerId: numCustomerId,
          details: {
            subscriptionId: newSub.id,
            planName: plan.name,
            billingCycle: cycle,
            totalAmount,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            mode: 'ADMIN_MANUAL',
          },
        },
      });
    } catch (_) {}

    return this.getAdminCustomerSubscriptions(numCustomerId);
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
  ) {
    const numSubId = Number(subscriptionId);
    const oldSub = await this.prisma.customerSubscription.findUnique({
      where: { id: numSubId },
      include: { plan: true },
    });

    if (!oldSub) {
      throw new NotFoundException(`Subscription #${subscriptionId} not found`);
    }

    const numNewPlanId = Number(dto.newPlanId);
    const newPlan = await this.prisma.plan.findUnique({
      where: { id: numNewPlanId },
    });

    if (!newPlan) {
      throw new NotFoundException(`New Plan #${dto.newPlanId} not found`);
    }

    const cycle =
      dto.billingCycle === 'YEARLY'
        ? SubscriptionBillingCycle.YEARLY
        : dto.billingCycle === 'MONTHLY'
        ? SubscriptionBillingCycle.MONTHLY
        : oldSub.billingCycle || SubscriptionBillingCycle.MONTHLY;

    const durationMonths = cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1;
    const startDate = dto.startDate ? new Date(dto.startDate) : calculateSubscriptionStartDate(new Date());
    const endDate = calculatePlanExpiry(startDate, durationMonths);

    const basePrice =
      dto.customPrice !== undefined && dto.customPrice !== null
        ? Number(dto.customPrice)
        : cycle === SubscriptionBillingCycle.YEARLY
        ? Number(newPlan.yearlyPrice)
        : Number(newPlan.monthlyPrice);

    const gst = Math.round(basePrice * 0.18);
    const totalAmount = basePrice + gst;

    const newSub = await this.prisma.$transaction(async (tx) => {
      // 1. Mark current and older subscriptions as EXPIRED
      await tx.customerSubscription.updateMany({
        where: {
          customerId: oldSub.customerId,
          status: SubscriptionStatus.ACTIVE,
        },
        data: {
          status: SubscriptionStatus.EXPIRED,
        },
      });

      // 2. Create the new subscription
      const sub = await tx.customerSubscription.create({
        data: {
          customerId: oldSub.customerId,
          planId: newPlan.id,
          billingCycle: cycle,
          status: SubscriptionStatus.ACTIVE,
          startDate,
          endDate,
          duration: durationMonths,
          customPrice: dto.customPrice !== undefined ? dto.customPrice : null,
        },
        include: { plan: true },
      });

      // 3. Record payment history
      await tx.paymentHistory.create({
        data: {
          customerId: oldSub.customerId,
          subscriptionId: sub.id,
          planId: newPlan.id,
          planName: newPlan.name,
          billingCycle: cycle,
          amount: totalAmount,
          taxAmount: gst,
          totalAmount,
          currency: 'INR',
          status: 'SUCCESS',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          transactionId: `PLAN-CHANGE-${Date.now()}`,
          orderId: `ORD-${Date.now()}`,
          orderNumber: `#QB-CHG-${Date.now().toString(36).toUpperCase()}`,
        },
      });

      // 4. Update customer active status
      await tx.customer.update({
        where: { id: oldSub.customerId },
        data: {
          isActive: true,
        },
      });

      return sub;
    });

    // 5. Generate schedules for new plan
    try {
      if (this.scheduleService) {
        await this.scheduleService.generateSchedulesForSubscription(newSub.id, { force: true });
      }
      if (this.workService) {
        await this.workService.generatePlanSchedules(oldSub.customerId, newSub.id);
      }
    } catch (err: any) {
      this.logger.warn(`[SCHEDULE_GEN_WARN] Failed generating schedule on plan change: ${err?.message}`);
    }

    // 6. Write audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'CHANGE_PLAN',
          module: 'SUBSCRIPTIONS',
          userId: adminUserId,
          customerId: oldSub.customerId,
          details: {
            oldSubscriptionId: oldSub.id,
            oldPlanName: oldSub.plan?.name,
            newSubscriptionId: newSub.id,
            newPlanName: newPlan.name,
            billingCycle: cycle,
            totalAmount,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          },
        },
      });
    } catch (_) {}

    return this.getAdminCustomerSubscriptions(oldSub.customerId);
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
  ) {
    const numSubId = Number(subscriptionId);
    const sub = await this.prisma.customerSubscription.findUnique({
      where: { id: numSubId },
      include: { plan: true },
    });

    if (!sub) {
      throw new NotFoundException(`Subscription #${subscriptionId} not found`);
    }

    const cycle =
      dto.billingCycle === 'YEARLY'
        ? SubscriptionBillingCycle.YEARLY
        : dto.billingCycle === 'MONTHLY'
        ? SubscriptionBillingCycle.MONTHLY
        : sub.billingCycle || SubscriptionBillingCycle.MONTHLY;

    const durationMonths = cycle === SubscriptionBillingCycle.YEARLY ? 12 : 1;
    const now = new Date();

    // If currently expired, start from today. If currently active, extend from existing endDate.
    const isCurrentlyExpired = now > new Date(sub.endDate);
    const newStartDate = isCurrentlyExpired ? now : sub.startDate;
    const newEndDate = isCurrentlyExpired
      ? calculatePlanExpiry(now, durationMonths)
      : calculatePlanExpiry(new Date(sub.endDate), durationMonths);

    const basePrice =
      dto.customPrice !== undefined && dto.customPrice !== null
        ? Number(dto.customPrice)
        : cycle === SubscriptionBillingCycle.YEARLY
        ? Number(sub.plan.yearlyPrice)
        : Number(sub.plan.monthlyPrice);

    const gst = Math.round(basePrice * 0.18);
    const totalAmount = basePrice + gst;

    await this.prisma.$transaction(async (tx) => {
      await tx.customerSubscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          startDate: newStartDate,
          endDate: newEndDate,
          billingCycle: cycle,
          deletedAt: null,
        },
      });

      await tx.paymentHistory.create({
        data: {
          customerId: sub.customerId,
          subscriptionId: sub.id,
          planId: sub.planId,
          planName: sub.plan.name,
          billingCycle: cycle,
          amount: totalAmount,
          taxAmount: gst,
          totalAmount,
          currency: 'INR',
          status: 'SUCCESS',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          transactionId: `RENEWAL-${Date.now()}`,
          orderId: `ORD-RNW-${Date.now()}`,
          orderNumber: `#QB-RNW-${Date.now().toString(36).toUpperCase()}`,
        },
      });

      await tx.customer.update({
        where: { id: sub.customerId },
        data: {
          isActive: true,
        },
      });
    });

    // Generate schedules
    try {
      if (this.scheduleService) {
        await this.scheduleService.generateSchedulesForSubscription(sub.id, { force: true });
      }
      if (this.workService) {
        await this.workService.generatePlanSchedules(sub.customerId, sub.id);
      }
    } catch (err: any) {
      this.logger.warn(`[SCHEDULE_GEN_WARN] Failed generating schedule on renewal: ${err?.message}`);
    }

    // Write audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'RENEW_SUBSCRIPTION',
          module: 'SUBSCRIPTIONS',
          userId: adminUserId,
          customerId: sub.customerId,
          details: {
            subscriptionId: sub.id,
            planName: sub.plan.name,
            billingCycle: cycle,
            totalAmount,
            startDate: newStartDate.toISOString(),
            endDate: newEndDate.toISOString(),
          },
        },
      });
    } catch (_) {}

    return this.getAdminCustomerSubscriptions(sub.customerId);
  }

  /**
   * Admin: Manually activate a customer subscription
   */
  async activateCustomerSubscription(subscriptionId: number | string, adminUserId?: number) {
    const numSubId = Number(subscriptionId);

    this.logger.log(
      `[SUBSCRIPTION_ACTIVATE_REQUEST]\nmethod: PATCH/POST\nsubscriptionId: ${subscriptionId}`,
    );

    const sub = await this.prisma.customerSubscription.findUnique({
      where: { id: numSubId },
      include: { plan: true },
    });

    if (!sub) {
      throw new NotFoundException(`Subscription #${subscriptionId} not found`);
    }

    const now = new Date();
    const durationMonths = sub.duration || (sub.billingCycle === SubscriptionBillingCycle.YEARLY ? 12 : 1);
    let startDate = sub.startDate;
    let endDate = sub.endDate;

    if (now > new Date(sub.endDate)) {
      startDate = now;
      endDate = calculatePlanExpiry(now, durationMonths);
    }

    const oldStatus = sub.status;

    this.logger.log(
      `[SUBSCRIPTION_ACTIVATE_DEBUG]\nsubscriptionId: ${sub.id}\ncustomerId: ${sub.customerId}\noldStatus: ${oldStatus}\nnewStatus: ${SubscriptionStatus.ACTIVE}\nplanId: ${sub.planId}\nplanName: ${sub.plan?.name}\nstartDate: ${startDate.toISOString()}\nexpiryDate: ${endDate.toISOString()}`,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.customerSubscription.updateMany({
        where: {
          customerId: sub.customerId,
          id: { not: sub.id },
          status: SubscriptionStatus.ACTIVE,
        },
        data: {
          status: SubscriptionStatus.EXPIRED,
        },
      });

      await tx.paymentHistory.updateMany({
        where: {
          subscriptionId: sub.id,
          status: 'PENDING',
        },
        data: {
          status: 'SUCCESS',
        },
      });

      await tx.customer.update({
        where: { id: sub.customerId },
        data: {
          isActive: true,
        },
      });

      return tx.customerSubscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          startDate,
          endDate,
          deletedAt: null,
        },
        include: { plan: true },
      });
    });

    try {
      if (this.scheduleService) {
        await this.scheduleService.generateSchedulesForSubscription(sub.id, { force: true });
      }
      if (this.workService) {
        await this.workService.generatePlanSchedules(sub.customerId, sub.id);
      }
    } catch (err: any) {
      this.logger.warn(`[SCHEDULE_GEN_WARN] Failed generating schedule on activation: ${err?.message}`);
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'ACTIVATE_SUBSCRIPTION',
          module: 'SUBSCRIPTIONS',
          userId: adminUserId,
          customerId: sub.customerId,
          details: {
            subscriptionId: sub.id,
            planName: sub.plan.name,
            startDate: updated.startDate.toISOString(),
            endDate: updated.endDate.toISOString(),
            mode: 'MANUAL_ADMIN_ACTIVATION',
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (_) {}

    this.logger.log(
      `[SUBSCRIPTION_ACTIVATE_RESPONSE]\nsuccess: true\nsubscriptionId: ${updated.id}\nstatus: ${updated.status}`,
    );

    return this.getAdminCustomerSubscriptions(sub.customerId);
  }

  /**
   * Admin: Deactivate an active subscription
   */
  async deactivateCustomerSubscription(subscriptionId: number | string, adminUserId?: number) {
    const numSubId = Number(subscriptionId);
    const sub = await this.prisma.customerSubscription.findUnique({
      where: { id: numSubId },
      include: { plan: true },
    });

    if (!sub) {
      throw new NotFoundException(`Subscription #${subscriptionId} not found`);
    }

    await this.prisma.customerSubscription.update({
      where: { id: numSubId },
      data: {
        status: SubscriptionStatus.CANCELED,
      },
    });

    // Write audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'DEACTIVATE_SUBSCRIPTION',
          module: 'SUBSCRIPTIONS',
          userId: adminUserId,
          customerId: sub.customerId,
          details: {
            subscriptionId: sub.id,
            planName: sub.plan.name,
            previousStatus: sub.status,
            newStatus: 'CANCELED',
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (_) {}

    return this.getAdminCustomerSubscriptions(sub.customerId);
  }

  /**
   * Admin: Safely soft-delete a customer subscription
   */
  async deleteCustomerSubscription(subscriptionId: number | string, adminUserId?: number) {
    const numSubId = Number(subscriptionId);
    const sub = await this.prisma.customerSubscription.findUnique({
      where: { id: numSubId },
      include: { plan: true },
    });

    if (!sub) {
      throw new NotFoundException(`Subscription #${subscriptionId} not found`);
    }

    await this.prisma.customerSubscription.update({
      where: { id: numSubId },
      data: {
        deletedAt: new Date(),
        status: SubscriptionStatus.CANCELED,
      },
    });

    // Write audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'DELETE_SUBSCRIPTION',
          module: 'SUBSCRIPTIONS',
          userId: adminUserId,
          customerId: sub.customerId,
          details: {
            subscriptionId: sub.id,
            planName: sub.plan.name,
            deletedAt: new Date().toISOString(),
          },
        },
      });
    } catch (_) {}

    return {
      success: true,
      message: `Subscription #${subscriptionId} deleted successfully`,
    };
  }

  /**
   * Admin: List all Offline Payment Requests with status filter & pagination
   */
  async getAdminOfflinePaymentRequests(query: { status?: string; search?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {
      paymentMethod: { in: [PaymentMethod.BANK_TRANSFER, PaymentMethod.CASH, PaymentMethod.OTHER] },
      deletedAt: null,
    };

    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { paymentId: { contains: q, mode: 'insensitive' } },
        { planName: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { companyName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.paymentHistory.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: true,
          subscription: {
            include: { plan: true },
          },
        },
      }),
      this.prisma.paymentHistory.count({ where }),
    ]);

    const formatted = items.map((p) => {
      const sub = p.subscription;
      const plan = sub?.plan;
      return {
        id: p.id,
        paymentId: p.id,
        subscriptionId: p.subscriptionId,
        orderNumber: p.orderNumber || `#QB-OFFLINE-${p.id}`,
        transactionId: p.transactionId || p.paymentId,
        customerId: p.customerId,
        customerName: p.customer?.name || 'Customer',
        businessName: p.customer?.companyName || p.customer?.name || 'Customer Business',
        planId: p.planId || plan?.id,
        planName: p.planName || plan?.name || 'Custom Plan',
        billingCycle: p.billingCycle || sub?.billingCycle || 'MONTHLY',
        baseAmount: p.amount,
        gst: p.taxAmount || Math.round(p.amount * 0.18),
        totalAmount: p.totalAmount || (p.amount + (p.taxAmount || Math.round(p.amount * 0.18))),
        paymentMethod: 'OFFLINE',
        paymentMethodDetail: p.paymentMethod,
        paymentStatus: p.status, // PENDING, SUCCESS, REJECTED, FAILED
        subscriptionStatus: sub?.status || 'PENDING',
        requestDate: p.createdAt,
        startDate: sub?.startDate,
        endDate: sub?.endDate,
        receiptId: (p.status === 'SUCCESS' || p.status === 'PAID')
          ? (p.invoiceUrl?.startsWith('REC-') ? p.invoiceUrl : `REC-${new Date(p.createdAt).getFullYear()}-${String(p.id).padStart(6, '0')}`)
          : null,
        receiptNumber: (p.status === 'SUCCESS' || p.status === 'PAID')
          ? (p.invoiceUrl?.startsWith('REC-') ? p.invoiceUrl : `REC-${new Date(p.createdAt).getFullYear()}-${String(p.id).padStart(6, '0')}`)
          : null,
        documentNumber: (p.status === 'SUCCESS' || p.status === 'PAID')
          ? (p.invoiceUrl?.startsWith('REC-') ? p.invoiceUrl : `REC-${new Date(p.createdAt).getFullYear()}-${String(p.id).padStart(6, '0')}`)
          : `DOC-${p.id}`,
        receiptDownloadUrl: (p.status === 'SUCCESS' || p.status === 'PAID')
          ? `/receipts/${p.invoiceUrl?.startsWith('REC-') ? p.invoiceUrl : `REC-${new Date(p.createdAt).getFullYear()}-${String(p.id).padStart(6, '0')}`}/download`
          : null,
        invoiceNumber: p.invoiceUrl || (p.status === 'SUCCESS' ? `INV-${new Date(p.createdAt).getFullYear()}-${String(p.id).padStart(6, '0')}` : null),
      };
    });

    return {
      success: true,
      items: formatted,
      data: formatted,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Admin: Approve Offline Payment Request
   * 1. Sets paymentStatus = PAID (SUCCESS), subscriptionStatus = ACTIVE, paymentMethod = OFFLINE
   * 2. Sets startDate = now, calculates endDate from duration & billing cycle
   * 3. Activates the customer plan, provisions quotas & 1:1 calendar deliverables
   * 4. Generates Paid Invoice (INV-YYYY-XXXXXX)
   */
  async approveOfflinePaymentRequest(requestIdOrSubId: number | string, adminUserId?: number) {
    const numId = Number(requestIdOrSubId);
    if (!numId || isNaN(numId)) {
      throw new BadRequestException('Valid payment request ID is required');
    }

    // Try finding by PaymentHistory ID or Subscription ID
    let payment = await this.prisma.paymentHistory.findFirst({
      where: {
        OR: [{ id: numId }, { subscriptionId: numId }],
      },
      include: {
        customer: true,
        subscription: { include: { plan: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Offline payment request #${requestIdOrSubId} not found`);
    }

    const sub = payment.subscription;
    if (!sub) {
      throw new NotFoundException(`Subscription linked to payment request #${payment.id} not found`);
    }

    const plan = sub.plan;
    if (!plan) {
      throw new NotFoundException(`Plan linked to subscription #${sub.id} not found`);
    }

    const cycle = sub.billingCycle || SubscriptionBillingCycle.MONTHLY;
    const durationMonths = sub.duration || (cycle === 'YEARLY' ? 12 : 1);
    const startDate = new Date();
    const endDate = calculatePlanExpiry(startDate, durationMonths);

    const fullBaseAmount = cycle === 'YEARLY' ? Number(plan.yearlyPrice) : Number(plan.monthlyPrice);
    const fullGstAmount = Math.round(fullBaseAmount * 0.18);
    const fullTotalAmount = fullBaseAmount + fullGstAmount;

    const receiptNo = `REC-${startDate.getFullYear()}-${String(payment.id).padStart(6, '0')}`;
    let finalInvoiceNo: string | null = null;
    let isFullyPaid = false;

    // Execute atomic transaction
    await this.prisma.$transaction(async (tx) => {
      // 1. Expire other active subscriptions for this customer
      await tx.customerSubscription.updateMany({
        where: {
          customerId: sub.customerId,
          id: { not: sub.id },
          status: SubscriptionStatus.ACTIVE,
        },
        data: { status: SubscriptionStatus.EXPIRED },
      });

      // 2. Activate target subscription
      await tx.customerSubscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          startDate,
          endDate,
          updatedAt: new Date(),
        },
      });

      // 3. Mark payment as SUCCESS (PAID) & attach receipt number
      await tx.paymentHistory.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          invoiceUrl: receiptNo,
          updatedAt: new Date(),
        },
      });

      // 4. Calculate total paid across all approved payments for this subscription
      const allPayments = await tx.paymentHistory.findMany({
        where: { subscriptionId: sub.id, status: 'SUCCESS' },
      });
      const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0);
      isFullyPaid = totalPaid >= fullTotalAmount;

      // 5. Generate Final Invoice ONLY if 100% Fully Settled
      if (isFullyPaid) {
        finalInvoiceNo = `INV-${startDate.getFullYear()}-${String(payment.id).padStart(6, '0')}`;
        const invoiceNo = finalInvoiceNo;

        let contact = await tx.contact.findFirst({
          where: { customerId: sub.customerId, deletedAt: null },
        });

        if (!contact) {
          contact = await tx.contact.create({
            data: {
              customerId: sub.customerId,
              firstName: payment.customer?.name || 'Customer',
              lastName: 'Account',
              email: payment.customer?.email || `billing-${sub.customerId}@quikboom.com`,
              phone: payment.customer?.phone || 'N/A',
            },
          });
        }

        const existingInvoice = await tx.invoice.findFirst({
          where: { customerId: sub.customerId, invoiceNo },
        });

        if (!existingInvoice) {
          await tx.invoice.create({
            data: {
              customerId: sub.customerId,
              contactId: contact.id,
              invoiceNo,
              status: InvoiceStatus.PAID,
              issueDate: startDate,
              dueDate: startDate,
              subTotal: fullBaseAmount,
              taxAmount: fullGstAmount,
              discount: 0,
              totalAmount: fullTotalAmount,
              notes: `Subscription payment for ${plan.name} (${cycle} billing). Payment Method: OFFLINE. Total Paid: ₹${totalPaid}, Balance: ₹0. Order: ${payment.orderNumber || payment.orderId}`,
            },
          });
        }

        this.logger.log(
          `[INVOICE_STATUS] totalAmount: ${fullTotalAmount} totalPaid: ${totalPaid} invoiceAvailable: true invoiceNo: ${invoiceNo}`,
        );
      } else {
        this.logger.log(
          `[INVOICE_STATUS] totalAmount: ${fullTotalAmount} totalPaid: ${totalPaid} invoiceAvailable: false`,
        );
      }

      // 6. Provision Plan Entitlements strictly from purchased plan features
      const deliverableFeatures = sub.customFeatures || plan.features;
      const quotas = extractDeliverableQuotas(deliverableFeatures);

      for (const q of quotas) {
        if (q.totalQty <= 0) continue;
        const existingEnt = await tx.planEntitlement.findFirst({
          where: { customerId: sub.customerId, serviceName: q.serviceName },
        });

        if (existingEnt) {
          await tx.planEntitlement.update({
            where: { id: existingEnt.id },
            data: {
              planId: plan.id,
              totalQty: q.totalQty,
              validUntil: endDate,
            },
          });
        } else {
          await tx.planEntitlement.create({
            data: {
              customerId: sub.customerId,
              planId: plan.id,
              serviceName: q.serviceName,
              totalQty: q.totalQty,
              usedQty: 0,
              scheduledQty: 0,
              validUntil: endDate,
            },
          });
        }
      }
    });

    // 7. Auto-generate Schedules & Work Deliverables
    try {
      if (this.scheduleService) {
        await this.scheduleService.generateSchedulesForSubscription(sub.id, { force: true });
      }
      if (this.workService) {
        await this.workService.generatePlanSchedules(sub.customerId, sub.id);
      }
    } catch (err: any) {
      this.logger.warn(`[OFFLINE_APPROVE_SCHEDULE_WARN] ${err?.message}`);
    }

    // 8. Write Audit Log
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'APPROVE_OFFLINE_PAYMENT',
          module: 'PAYMENTS',
          userId: adminUserId,
          customerId: sub.customerId,
          details: {
            paymentId: payment.id,
            subscriptionId: sub.id,
            planName: plan.name,
            totalAmount: fullTotalAmount,
            receiptNo,
            invoiceNo: finalInvoiceNo,
            approvedAt: new Date().toISOString(),
          },
        },
      });
    } catch (_) {}

    return {
      success: true,
      message: isFullyPaid
        ? `Offline payment request approved. Subscription for ${plan.name} is now ACTIVE and invoice ${finalInvoiceNo} generated.`
        : `Offline payment request approved. Receipt ${receiptNo} issued. Subscription is ACTIVE with 50% advance.`,
      receiptNumber: receiptNo,
      invoiceNumber: finalInvoiceNo,
      subscriptionId: sub.id,
      paymentStatus: isFullyPaid ? 'FULLY_PAID' : 'PARTIALLY_PAID',
      subscriptionStatus: 'ACTIVE',
    };
  }

  /**
   * Admin: Reject Offline Payment Request
   * Sets paymentStatus = REJECTED, subscriptionStatus = REJECTED
   */
  async rejectOfflinePaymentRequest(requestIdOrSubId: number | string, adminUserId?: number, reason?: string) {
    const numId = Number(requestIdOrSubId);
    if (!numId || isNaN(numId)) {
      throw new BadRequestException('Valid payment request ID is required');
    }

    const payment = await this.prisma.paymentHistory.findFirst({
      where: {
        OR: [{ id: numId }, { subscriptionId: numId }],
      },
      include: {
        customer: true,
        subscription: { include: { plan: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Offline payment request #${requestIdOrSubId} not found`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentHistory.update({
        where: { id: payment.id },
        data: {
          status: 'REJECTED',
          transactionId: reason ? `REJECTED: ${reason}` : payment.transactionId,
          updatedAt: new Date(),
        },
      });

      if (payment.subscriptionId) {
        await tx.customerSubscription.update({
          where: { id: payment.subscriptionId },
          data: {
            status: SubscriptionStatus.CANCELED,
            updatedAt: new Date(),
          },
        });
      }
    });

    // Write audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'REJECT_OFFLINE_PAYMENT',
          module: 'PAYMENTS',
          userId: adminUserId,
          customerId: payment.customerId,
          details: {
            paymentId: payment.id,
            subscriptionId: payment.subscriptionId,
            reason: reason || 'Offline payment details could not be verified',
            rejectedAt: new Date().toISOString(),
          },
        },
      });
    } catch (_) {}

    return {
      success: true,
      message: 'Offline payment request has been rejected.',
      paymentStatus: 'REJECTED',
      subscriptionStatus: 'REJECTED',
    };
  }
}



