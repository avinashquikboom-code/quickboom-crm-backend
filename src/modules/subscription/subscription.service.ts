import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SubscriptionBillingCycle,
  SubscriptionStatus,
  CreateOrderDto,
  RenewSubscriptionDto,
} from './dto/subscription.dto';

@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService) {}

  static calculateExpiryDate(startDate: Date, cycle: SubscriptionBillingCycle): Date {
    const start = new Date(startDate);
    if (cycle === SubscriptionBillingCycle.MONTHLY) {
      // 1 calendar month
      const year = start.getFullYear();
      const month = start.getMonth();
      const day = start.getDate();

      const targetMonth = month + 1;
      const targetYear = year + Math.floor(targetMonth / 12);
      const normalizedMonth = targetMonth % 12;

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
          description: 'Scale Plan for high-growth enterprises',
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
      isRecommended: p.code === 'STANDARD',
    }));
  }

  async getCurrentSubscription(customerId: number | string) {
    if (!customerId) {
      throw new BadRequestException('customerId is required');
    }
    const numCustomerId = Number(customerId);

    const sub = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!sub) {
      return null;
    }

    const isExpired = sub.status === 'EXPIRED' || (sub.endDate && new Date() > new Date(sub.endDate));

    return {
      id: sub.id,
      customerId: sub.customerId,
      planId: sub.planId,
      planName: sub.plan.name,
      planCode: sub.plan.code,
      status: isExpired ? SubscriptionStatus.EXPIRED : sub.status,
      billingCycle: sub.billingCycle || SubscriptionBillingCycle.MONTHLY,
      startDate: sub.startDate,
      endDate: sub.endDate,
      price: sub.billingCycle === SubscriptionBillingCycle.YEARLY ? Number(sub.plan.yearlyPrice) : Number(sub.plan.monthlyPrice),
      userLimit: sub.plan.userLimit,
      leadLimit: sub.plan.leadLimit,
      features: sub.plan.features,
      isExpired,
    };
  }

  async getCustomerOrders(customerId: number | string) {
    if (!customerId) {
      throw new BadRequestException('customerId is required');
    }
    const numCustomerId = Number(customerId);

    const payments = await this.prisma.paymentHistory.findMany({
      where: { customerId: numCustomerId },
      orderBy: { createdAt: 'desc' },
    });

    const currentSub = await this.prisma.customerSubscription.findFirst({
      where: { customerId: numCustomerId },
      include: { plan: true },
    });

    return payments.map((p) => {
      const isPaid = p.status === 'SUCCESS';
      const billingCycle = (p.billingCycle as SubscriptionBillingCycle) || SubscriptionBillingCycle.MONTHLY;
      const baseAmount = Number(p.amount);
      const taxAmount = Number(p.taxAmount || (baseAmount * 0.18));
      const totalAmount = Number(p.totalAmount || (baseAmount + taxAmount));

      const purchaseDate = p.createdAt;
      const activationDate = p.createdAt;
      const expiryDate = SubscriptionService.calculateExpiryDate(purchaseDate, billingCycle);

      return {
        id: p.id,
        orderNumber: p.orderNumber || `#QB-${p.id.toString().padStart(6, '0')}`,
        planId: p.planId || currentSub?.planId || 1,
        planName: p.planName || currentSub?.plan?.name || 'Standard Package',
        billingCycle,
        amount: baseAmount,
        taxAmount,
        totalAmount,
        paymentStatus: isPaid ? 'PAID' : 'PENDING',
        paymentMethod: p.paymentMethod || 'RAZORPAY',
        transactionId: p.transactionId || `TXN-${p.id.toString().padStart(8, '0')}`,
        purchaseDate,
        activationDate,
        expiryDate,
        features: currentSub?.plan?.features || [],
      };
    });
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
}
