import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SubscriptionBillingCycle } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CouponPriceResult {
  couponId: number;
  couponCode: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  originalAmount: number;
  discountAmount: number;
  discountedBase: number;
  taxAmount: number;
  finalAmount: number;
  chargedBase: number;
  chargedTax: number;
  chargedTotal: number;
}

export function normalizeCouponCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  async quote(params: {
    customerId: number;
    planId: number;
    couponCode: string;
    billingCycle: string;
    paymentOption?: string;
  }): Promise<CouponPriceResult> {
    const plan = await this.prisma.plan.findFirst({
      where: { id: params.planId, deletedAt: null, isActive: true },
    });
    if (!plan) {
      throw new NotFoundException('Package not found');
    }
    const cycle =
      String(params.billingCycle || 'MONTHLY').toUpperCase() === 'YEARLY'
        ? SubscriptionBillingCycle.YEARLY
        : SubscriptionBillingCycle.MONTHLY;
    const originalAmount =
      cycle === SubscriptionBillingCycle.YEARLY
        ? Number(plan.yearlyPrice)
        : Number(plan.monthlyPrice);
    const coupon = await this.findApplicableCoupon(params.couponCode);
    await this.assertRedeemable(coupon, params.customerId, plan.id, originalAmount);
    return this.priceCoupon(coupon, originalAmount, params.paymentOption);
  }

  async redeem(
    tx: Prisma.TransactionClient,
    args: {
      couponId: number;
      customerId: number;
      planId: number;
      subscriptionId?: number | null;
      paymentId: number;
      couponCode: string;
      originalAmount: number;
      discountAmount: number;
      finalAmount: number;
    },
  ) {
    const existing = await tx.couponRedemption.findFirst({
      where: { paymentId: args.paymentId },
    });
    if (existing) return existing;

    await tx.$queryRaw`SELECT id FROM "Coupon" WHERE id = ${args.couponId} FOR UPDATE`;
    const coupon = await tx.coupon.findFirst({
      where: { id: args.couponId, deletedAt: null },
      include: { plans: true },
    });
    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('Coupon is not active');
    }
    const now = new Date();
    if (coupon.startsAt && now < new Date(coupon.startsAt)) {
      throw new BadRequestException('Coupon is not active');
    }
    if (coupon.expiresAt && now > new Date(coupon.expiresAt)) {
      throw new BadRequestException('Coupon has expired');
    }
    if (!coupon.appliesToAllPlans && !coupon.plans.some((row) => row.planId === args.planId)) {
      throw new BadRequestException('Coupon is not applicable to this package');
    }
    if (coupon.timesRedeemed >= coupon.maxRedemptions) {
      throw new ConflictException('Coupon usage limit reached');
    }
    const usedByCustomer = await tx.couponRedemption.count({
      where: { couponId: coupon.id, customerId: args.customerId },
    });
    if (usedByCustomer >= coupon.perCustomerLimit) {
      throw new ConflictException('You have already used this coupon');
    }

    await tx.coupon.update({
      where: { id: coupon.id },
      data: { timesRedeemed: { increment: 1 } },
    });

    return tx.couponRedemption.create({
      data: {
        couponId: coupon.id,
        customerId: args.customerId,
        planId: args.planId,
        subscriptionId: args.subscriptionId ?? null,
        paymentId: args.paymentId,
        couponCode: args.couponCode,
        originalAmount: args.originalAmount,
        discountAmount: args.discountAmount,
        finalAmount: args.finalAmount,
      },
    });
  }

  async list(query: {
    search?: string;
    status?: string;
    discountType?: string;
    planId?: string;
  }) {
    const search = String(query.search || '').trim();
    const now = new Date();
    const where: Prisma.CouponWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }
    const status = String(query.status || '').toUpperCase();
    if (status === 'ACTIVE') {
      where.isActive = true;
      where.AND = [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }];
    } else if (status === 'INACTIVE') {
      where.isActive = false;
    } else if (status === 'EXPIRED') {
      where.expiresAt = { lt: now };
    }
    const discountType = String(query.discountType || '').toUpperCase();
    if (discountType === 'PERCENTAGE' || discountType === 'FIXED') {
      where.discountType = discountType;
    }
    const planId = Number(query.planId);
    if (!isNaN(planId) && planId > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { OR: [{ appliesToAllPlans: true }, { plans: { some: { planId } } }] },
      ];
    }
    const rows = await this.prisma.coupon.findMany({
      where,
      include: { plans: { include: { plan: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toAdmin(row));
  }

  async getOne(id: number) {
    const row = await this.prisma.coupon.findFirst({
      where: { id, deletedAt: null },
      include: {
        plans: { include: { plan: true } },
        redemptions: {
          orderBy: { redeemedAt: 'desc' },
          take: 100,
          include: {
            customer: { select: { id: true, name: true, companyName: true } },
            plan: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Coupon not found');
    return {
      ...this.toAdmin(row),
      redemptions: row.redemptions.map((item) => ({
        id: item.id,
        customerId: item.customerId,
        customerName: item.customer.companyName || item.customer.name,
        planId: item.planId,
        planName: item.plan.name,
        originalAmount: item.originalAmount,
        discountAmount: item.discountAmount,
        finalAmount: item.finalAmount,
        redeemedAt: item.redeemedAt,
      })),
    };
  }

  async create(dto: any) {
    const code = normalizeCouponCode(dto.code);
    if (!code) throw new BadRequestException('Coupon code is required');
    await this.assertUniqueCode(code);
    const parsed = this.parseConfig(dto, code);
    const planIds = await this.resolvePlanIds(dto);
    const created = await this.prisma.coupon.create({
      data: {
        ...parsed,
        plans: planIds.length
          ? { create: planIds.map((planId) => ({ planId })) }
          : undefined,
      },
      include: { plans: { include: { plan: true } } },
    });
    return this.toAdmin(created);
  }

  async update(id: number, dto: any) {
    const existing = await this.prisma.coupon.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Coupon not found');
    const code = dto.code != null ? normalizeCouponCode(dto.code) : existing.code;
    if (!code) throw new BadRequestException('Coupon code is required');
    await this.assertUniqueCode(code, id);
    const parsed = this.parseConfig({ ...existing, ...dto, code }, code);
    const planIds = dto.planIds != null || dto.appliesToAllPlans != null
      ? await this.resolvePlanIds({ ...existing, ...dto })
      : null;
    const updated = await this.prisma.coupon.update({
      where: { id },
      data: {
        ...parsed,
        ...(planIds
          ? {
              plans: {
                deleteMany: {},
                create: planIds.map((planId) => ({ planId })),
              },
            }
          : {}),
      },
      include: { plans: { include: { plan: true } } },
    });
    return this.toAdmin(updated);
  }

  async setActive(id: number, isActive: boolean) {
    const existing = await this.prisma.coupon.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Coupon not found');
    const updated = await this.prisma.coupon.update({
      where: { id },
      data: { isActive },
      include: { plans: { include: { plan: true } } },
    });
    return this.toAdmin(updated);
  }

  async remove(id: number) {
    const existing = await this.prisma.coupon.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!existing) throw new NotFoundException('Coupon not found');
    await this.prisma.coupon.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    return {
      success: true,
      softDeleted: true,
      hadRedemptions: existing._count.redemptions > 0,
    };
  }

  private async findApplicableCoupon(rawCode: string) {
    const code = normalizeCouponCode(rawCode);
    if (!code) throw new BadRequestException('Invalid coupon code');
    const coupon = await this.prisma.coupon.findFirst({
      where: { code: { equals: code, mode: 'insensitive' }, deletedAt: null },
      include: { plans: true },
    });
    if (!coupon) throw new NotFoundException('Invalid coupon code');
    return coupon;
  }

  private async assertRedeemable(
    coupon: {
      id: number;
      isActive: boolean;
      startsAt: Date | null;
      expiresAt: Date | null;
      maxRedemptions: number;
      timesRedeemed: number;
      perCustomerLimit: number;
      appliesToAllPlans: boolean;
      minimumAmount: number | null;
      plans: { planId: number }[];
    },
    customerId: number,
    planId: number,
    originalAmount: number,
  ) {
    const now = new Date();
    if (!coupon.isActive || (coupon.startsAt && now < new Date(coupon.startsAt))) {
      throw new BadRequestException('Coupon is not active');
    }
    if (coupon.expiresAt && now > new Date(coupon.expiresAt)) {
      throw new BadRequestException('Coupon has expired');
    }
    if (coupon.timesRedeemed >= coupon.maxRedemptions) {
      throw new ConflictException('Coupon usage limit reached');
    }
    const usedByCustomer = await this.prisma.couponRedemption.count({
      where: { couponId: coupon.id, customerId },
    });
    if (usedByCustomer >= coupon.perCustomerLimit) {
      throw new ConflictException('You have already used this coupon');
    }
    if (!coupon.appliesToAllPlans && !coupon.plans.some((row) => row.planId === planId)) {
      throw new BadRequestException('Coupon is not applicable to this package');
    }
    if (coupon.minimumAmount != null && originalAmount < Number(coupon.minimumAmount)) {
      throw new BadRequestException(
        `Minimum package amount is ₹${Number(coupon.minimumAmount)}`,
      );
    }
  }

  private priceCoupon(
    coupon: {
      id: number;
      code: string;
      discountType: string;
      discountPct: number;
      discountValue: number | null;
      maximumDiscountAmount: number | null;
    },
    originalAmount: number,
    paymentOption?: string,
  ): CouponPriceResult {
    const discountType = String(coupon.discountType || 'PERCENTAGE').toUpperCase() === 'FIXED'
      ? 'FIXED'
      : 'PERCENTAGE';
    const discountValue =
      discountType === 'FIXED'
        ? Number(coupon.discountValue ?? 0)
        : Number(coupon.discountPct ?? coupon.discountValue ?? 0);
    if (discountValue <= 0) {
      throw new BadRequestException('Coupon discount configuration is invalid');
    }
    let discountAmount =
      discountType === 'PERCENTAGE'
        ? roundMoney((originalAmount * discountValue) / 100)
        : roundMoney(discountValue);
    if (
      discountType === 'PERCENTAGE' &&
      coupon.maximumDiscountAmount != null &&
      Number(coupon.maximumDiscountAmount) >= 0
    ) {
      discountAmount = Math.min(discountAmount, roundMoney(Number(coupon.maximumDiscountAmount)));
    }
    discountAmount = roundMoney(Math.min(Math.max(discountAmount, 0), originalAmount));
    const discountedBase = roundMoney(Math.max(originalAmount - discountAmount, 0));
    const taxAmount = Math.round(discountedBase * 0.18);
    const finalAmount = roundMoney(discountedBase + taxAmount);

    let chargedBase = discountedBase;
    let chargedTax = taxAmount;
    let chargedTotal = finalAmount;
    const option = String(paymentOption || 'FULL').toUpperCase();
    if (option === 'ADVANCE' || option === 'HALF') {
      chargedTotal = Math.round(finalAmount * 0.5);
      chargedTax = Math.round(taxAmount * 0.5);
      chargedBase = roundMoney(chargedTotal - chargedTax);
    }

    return {
      couponId: coupon.id,
      couponCode: coupon.code,
      discountType,
      discountValue,
      originalAmount: roundMoney(originalAmount),
      discountAmount,
      discountedBase,
      taxAmount,
      finalAmount,
      chargedBase,
      chargedTax,
      chargedTotal,
    };
  }

  private parseConfig(dto: any, code: string) {
    const discountType = String(dto.discountType || 'PERCENTAGE').toUpperCase() === 'FIXED'
      ? 'FIXED'
      : 'PERCENTAGE';
    const discountValue = Number(dto.discountValue ?? dto.discountPct);
    if (!dto.name || !String(dto.name).trim()) {
      throw new BadRequestException('Coupon name is required');
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throw new BadRequestException('Discount value must be greater than zero');
    }
    if (discountType === 'PERCENTAGE' && discountValue > 100) {
      throw new BadRequestException('Percentage discount cannot exceed 100');
    }
    const usageLimit = Number(dto.usageLimit ?? dto.maxRedemptions ?? 1);
    const perCustomerLimit = Number(dto.perCustomerLimit ?? 1);
    if (!Number.isFinite(usageLimit) || usageLimit < 1) {
      throw new BadRequestException('Usage limit must be at least 1');
    }
    if (!Number.isFinite(perCustomerLimit) || perCustomerLimit < 1) {
      throw new BadRequestException('Per customer limit must be at least 1');
    }
    const appliesToAllPlans = dto.appliesToAllPlans !== false && dto.appliesToAll !== false;
    const startsAt = dto.startsAt || dto.startDate ? new Date(dto.startsAt || dto.startDate) : null;
    const expiresAt = dto.expiresAt || dto.endDate || dto.expiryDate
      ? new Date(dto.expiresAt || dto.endDate || dto.expiryDate)
      : null;
    if (startsAt && expiresAt && startsAt > expiresAt) {
      throw new BadRequestException('Start date must be before expiry date');
    }
    return {
      code,
      name: String(dto.name).trim(),
      description: dto.description ? String(dto.description).trim() : null,
      discountType,
      discountPct: discountType === 'PERCENTAGE' ? discountValue : 0,
      discountValue,
      minimumAmount:
        dto.minimumAmount != null && dto.minimumAmount !== ''
          ? Number(dto.minimumAmount)
          : dto.minimumPackageAmount != null && dto.minimumPackageAmount !== ''
            ? Number(dto.minimumPackageAmount)
            : null,
      maximumDiscountAmount:
        discountType === 'PERCENTAGE' &&
        dto.maximumDiscountAmount != null &&
        dto.maximumDiscountAmount !== ''
          ? Number(dto.maximumDiscountAmount)
          : null,
      startsAt,
      expiresAt,
      maxRedemptions: Math.floor(usageLimit),
      perCustomerLimit: Math.floor(perCustomerLimit),
      appliesToAllPlans,
      isActive: dto.isActive !== false,
    };
  }

  private async resolvePlanIds(dto: any): Promise<number[]> {
    const appliesToAll = dto.appliesToAllPlans !== false && dto.appliesToAll !== false;
    if (appliesToAll) return [];
    const raw = Array.isArray(dto.planIds) ? dto.planIds : [];
    const ids = raw.map((id: unknown) => Number(id)).filter((id: number) => id > 0);
    if (!ids.length) {
      throw new BadRequestException('Select at least one package');
    }
    const plans = await this.prisma.plan.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    if (plans.length !== ids.length) {
      throw new BadRequestException('One or more packages were not found');
    }
    return plans.map((plan) => plan.id);
  }

  private async assertUniqueCode(code: string, ignoreId?: number) {
    const existing = await this.prisma.coupon.findFirst({
      where: {
        code: { equals: code, mode: 'insensitive' },
        deletedAt: null,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
    });
    if (existing) throw new ConflictException('Coupon code already exists');
  }

  private toAdmin(row: any) {
    const now = new Date();
    const expired = Boolean(row.expiresAt && new Date(row.expiresAt) < now);
    const planNames = row.appliesToAllPlans
      ? ['All Packages']
      : (row.plans || []).map((item: any) => item.plan?.name).filter(Boolean);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      discountType: row.discountType,
      discountValue: row.discountType === 'FIXED' ? row.discountValue : row.discountPct,
      discountPct: row.discountPct,
      minimumAmount: row.minimumAmount,
      maximumDiscountAmount: row.maximumDiscountAmount,
      startsAt: row.startsAt,
      expiresAt: row.expiresAt,
      usageLimit: row.maxRedemptions,
      usedCount: row.timesRedeemed,
      remainingUsage: Math.max(0, row.maxRedemptions - row.timesRedeemed),
      perCustomerLimit: row.perCustomerLimit,
      appliesToAllPlans: row.appliesToAllPlans,
      planIds: (row.plans || []).map((item: any) => item.planId),
      planNames,
      isActive: row.isActive,
      status: !row.isActive ? 'INACTIVE' : expired ? 'EXPIRED' : 'ACTIVE',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
