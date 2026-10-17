import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function subscriptionPrice(
  plan: {
    monthlyPrice: number;
    taxRateBps: number;
    yearlyDiscountBps: number;
    billingIntervals: string[];
  },
  cycle: string,
) {
  if (
    !['MONTHLY', 'YEARLY'].includes(cycle) ||
    !plan.billingIntervals.includes(cycle)
  )
    throw new BadRequestException('Billing interval unavailable');
  const monthly = new Prisma.Decimal(String(plan.monthlyPrice)).mul(100);
  if (!monthly.isInteger() || monthly.isNegative())
    throw new BadRequestException('Invalid plan price');
  const base = monthly.mul(cycle === 'YEARLY' ? 12 : 1);
  const discount =
    cycle === 'YEARLY'
      ? base
          .mul(plan.yearlyDiscountBps)
          .div(10000)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      : new Prisma.Decimal(0);
  const taxable = base.sub(discount);
  const gst = taxable
    .mul(plan.taxRateBps)
    .div(10000)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const total = taxable.add(gst);
  if (base.gt(2147483647) || total.gt(2147483647) || total.isNegative())
    throw new BadRequestException('Plan total exceeds supported amount');
  return {
    billingCycle: cycle as 'MONTHLY' | 'YEARLY',
    basePaise: base.toNumber(),
    discountPaise: discount.toNumber(),
    taxablePaise: taxable.toNumber(),
    gstPaise: gst.toNumber(),
    totalPaise: total.toNumber(),
    taxRateBps: plan.taxRateBps,
    yearlyDiscountBps: plan.yearlyDiscountBps,
  };
}
