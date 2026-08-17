import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto, RenewSubscriptionDto, SubscriptionBillingCycle } from './dto/subscription.dto';
import { SubscriptionStatus } from '@prisma/client';

@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService) {}

  private calculateExpiryDate(startDate: Date, billingCycle: SubscriptionBillingCycle): Date {
    const start = new Date(startDate);
    if (billingCycle === SubscriptionBillingCycle.MONTHLY) {
      const year = start.getFullYear();
      const month = start.getMonth();
      const day = start.getDate();
      // Target next month
      const targetMonth = month + 1;
      const targetYear = year + Math.floor(targetMonth / 12);
      const normalizedMonth = targetMonth % 12;
      // Get last day of target month to handle overflow (e.g. Jan 31 -> Feb 28)
      const lastDayOfTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
      const targetDay = Math.min(day, lastDayOfTargetMonth);
      return new Date(targetYear, normalizedMonth, targetDay, start.getHours(), start.getMinutes(), start.getSeconds());
    } else {
      // 12 calendar months (1 year)
      const year = start.getFullYear() + 1;
      const month = start.getMonth();
      const day = start.getDate();
      const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();
      const targetDay = Math.min(day, lastDayOfTargetMonth);
      return new Date(year, month, targetDay, start.getHours(), start.getMinutes(), start.getSeconds());
    }
  }

  async getPlans() {
    let plans = await this.prisma.plan.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { monthlyPrice: 'asc' },
    });

    if (plans.length === 0) {
      // Seed standard QuikBoom subscription plans
      const standardPlans = [
        {
          name: 'Starter',
          code: 'STARTER',
          description: 'Essential CRM tools for small teams & emerging startups',
          monthlyPrice: 999,
          yearlyPrice: 9999,
          userLimit: 5,
          leadLimit: 500,
          storageLimit: BigInt(5368709120), // 5GB
          features: [
            '5 Users Included',
            'Lead Management & Stages',
            'Data Capture Module',
            'Basic Reports & Analytics',
            'Mobile App Access',
            'Standard Email Support',
          ],
        },
        {
          name: 'Professional',
          code: 'PROFESSIONAL',
          description: 'Advanced automation, GPS visits & payroll for scaling teams',
          monthlyPrice: 2499,
          yearlyPrice: 24999,
          userLimit: 25,
          leadLimit: 5000,
          storageLimit: BigInt(26843545600), // 25GB
          features: [
            '25 Users Included',
            'Complete CRM & Pipeline Management',
            'GPS Field Visit & Attendance Tracking',
            'HRM Suite & Payroll Processing',
            'Custom Lead Stages & Follow-ups',
            'Priority Support 24/7',
          ],
        },
        {
          name: 'Enterprise',
          code: 'ENTERPRISE',
          description: 'Maximum limits, unlimited workflows & dedicated infrastructure',
          monthlyPrice: 5999,
          yearlyPrice: 59999,
          userLimit: 100,
          leadLimit: 50000,
          storageLimit: BigInt(107374182400), // 100GB
          features: [
            'Unlimited Users & Workspaces',
            'Full CRM, HRM, Payroll & Geo-Tracking',
            'Dedicated Account Manager',
            'Custom Feature Toggles & Role Permissions',
            'Unlimited Cloud Data & Audit Logs',
            'Custom Integrations & SLA Guarantee',
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
      monthlyPrice: p.monthlyPrice,
      yearlyPrice: p.yearlyPrice,
      userLimit: p.userLimit,
      leadLimit: p.leadLimit,
      storageLimit: p.storageLimit.toString(),
      features: Array.isArray(p.features) ? p.features : [],
      isRecommended: p.code === 'PROFESSIONAL',
      currency: 'INR',
    }));
  }

  async getCurrentSubscription(tenantId: string) {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!subscription) {
      return {
        hasActiveSubscription: false,
        subscription: null,
      };
    }

    const now = new Date();
    const isExpired = subscription.endDate < now || subscription.status === SubscriptionStatus.EXPIRED;
    const effectiveStatus = isExpired ? SubscriptionStatus.EXPIRED : subscription.status;

    return {
      hasActiveSubscription: !isExpired && subscription.status === SubscriptionStatus.ACTIVE,
      subscription: {
        id: subscription.id,
        tenantId: subscription.tenantId,
        planId: subscription.planId,
        planName: subscription.plan.name,
        planCode: subscription.plan.code,
        status: effectiveStatus,
        billingCycle: subscription.billingCycle,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        price: subscription.billingCycle === 'YEARLY' ? subscription.plan.yearlyPrice : subscription.plan.monthlyPrice,
        currency: 'INR',
        autoRenew: subscription.autoRenew,
        features: Array.isArray(subscription.plan.features) ? subscription.plan.features : [],
        userLimit: subscription.plan.userLimit,
        leadLimit: subscription.plan.leadLimit,
      },
    };
  }

  async getTenantOrders(tenantId: string) {
    const payments = await this.prisma.paymentHistory.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    });

    return payments.map((p) => {
      const planName = p.subscription?.plan?.name || 'Standard Package';
      const billingCycle = p.subscription?.billingCycle || 'MONTHLY';
      const purchaseDate = p.createdAt;
      const expiryDate = p.subscription?.endDate || this.calculateExpiryDate(purchaseDate, billingCycle as any);

      return {
        id: p.id,
        orderId: p.orderId || `#QB-${p.id.substring(0, 8).toUpperCase()}`,
        planName,
        billingCycle,
        amount: p.amount,
        currency: p.currency || 'INR',
        paymentStatus: p.status === 'SUCCESS' ? 'PAID' : p.status,
        paymentMethod: p.paymentMethod,
        transactionId: p.paymentId || `TXN-${p.id.substring(0, 10).toUpperCase()}`,
        purchaseDate,
        activationDate: purchaseDate,
        expiryDate,
        features: Array.isArray(p.subscription?.plan?.features) ? p.subscription?.plan?.features : [],
        invoiceUrl: p.invoiceUrl || `/invoices/${p.id}.pdf`,
      };
    });
  }

  async createOrder(tenantId: string, dto: CreateOrderDto) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });

    if (!plan) {
      throw new NotFoundException('Selected subscription plan not found');
    }

    const price = dto.billingCycle === SubscriptionBillingCycle.YEARLY ? plan.yearlyPrice : plan.monthlyPrice;
    const startDate = new Date();
    const expiryDate = this.calculateExpiryDate(startDate, dto.billingCycle);

    return this.prisma.$transaction(async (tx) => {
      // Create TenantSubscription
      const subscription = await tx.tenantSubscription.create({
        data: {
          tenantId,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          billingCycle: dto.billingCycle as any,
          startDate,
          endDate: expiryDate,
          autoRenew: true,
        },
        include: { plan: true },
      });

      // Update Tenant limits based on new plan
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          userLimit: plan.userLimit,
          leadLimit: plan.leadLimit,
          storageLimit: plan.storageLimit,
        },
      });

      const orderNumber = `#QB-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

      // Create PaymentHistory record
      const payment = await tx.paymentHistory.create({
        data: {
          tenantId,
          subscriptionId: subscription.id,
          amount: price,
          currency: 'INR',
          paymentMethod: 'RAZORPAY',
          paymentId: `PAY-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
          orderId: orderNumber,
          status: 'SUCCESS',
        },
      });

      return {
        success: true,
        order: {
          id: payment.id,
          orderId: orderNumber,
          planId: plan.id,
          planName: plan.name,
          billingCycle: dto.billingCycle,
          amount: price,
          currency: 'INR',
          paymentStatus: 'PAID',
          purchaseDate: startDate,
          activationDate: startDate,
          expiryDate,
          features: Array.isArray(plan.features) ? plan.features : [],
        },
        subscription: {
          id: subscription.id,
          status: 'ACTIVE',
          startDate,
          endDate: expiryDate,
          billingCycle: dto.billingCycle,
        },
      };
    });
  }

  async renewSubscription(tenantId: string, dto: RenewSubscriptionDto) {
    const currentSub = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!currentSub) {
      throw new BadRequestException('No prior subscription found to renew');
    }

    const billingCycle = dto.billingCycle || (currentSub.billingCycle as any);
    return this.createOrder(tenantId, {
      planId: currentSub.planId,
      billingCycle,
    });
  }
}
