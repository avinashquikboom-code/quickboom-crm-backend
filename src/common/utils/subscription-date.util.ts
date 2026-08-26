/**
 * Subscription Date & Expiry Utilities
 * Enforces business rules:
 * - Expiry is strictly calculated from the customer's actual plan purchase/activation date (startDate).
 * - Safe month-end clamping (e.g. 31 Jan + 1m -> 28/29 Feb).
 * - Multi-stage lifecycle statuses: ACTIVE, EXPIRING_SOON (<= 10d), EXPIRING_IN_5_DAYS (<= 5d), EXPIRING_TODAY (0d), EXPIRED (< 0d), CANCELLED.
 */

export function calculatePlanExpiry(startDate: Date | string, durationMonths = 1): Date {
  const start = new Date(startDate);
  const startYear = start.getFullYear();
  const startMonth = start.getMonth(); // 0-indexed
  const startDay = start.getDate();

  const targetMonthIndex = startMonth + Number(durationMonths);
  const targetYear = startYear + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;

  // Clamping for month-end overflows
  const maxDaysInTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const targetDay = Math.min(startDay, maxDaysInTargetMonth);

  return new Date(
    targetYear,
    normalizedMonth,
    targetDay,
    start.getHours(),
    start.getMinutes(),
    start.getSeconds(),
    start.getMilliseconds(),
  );
}

/**
 * Calculates start and end dates for a customer billing cycle
 * e.g. 20 Aug 2026 -> 20 Sep 2026 (or inclusive 19 Sep 23:59:59)
 */
export function calculatePlanBillingPeriod(startDate: Date | string = new Date(), durationMonths = 1) {
  const start = new Date(startDate);
  const expiry = calculatePlanExpiry(start, durationMonths);
  return {
    startDate: start,
    endDate: expiry,
    expiryDate: expiry,
  };
}

export function calculateDaysRemaining(expiryDate: Date | string, now = new Date()): number {
  const exp = new Date(expiryDate);
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expDate = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());

  const diffTime = expDate.getTime() - nowDate.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

export type DerivedSubscriptionStatus =
  | 'ACTIVE'
  | 'EXPIRING_SOON'
  | 'EXPIRING_IN_5_DAYS'
  | 'EXPIRING_TODAY'
  | 'EXPIRED'
  | 'CANCELLED';

export function deriveSubscriptionStatus(
  status: string,
  expiryDate: Date | string,
  now = new Date(),
): DerivedSubscriptionStatus {
  if (status === 'CANCELED' || status === 'CANCELLED') {
    return 'CANCELLED';
  }

  const days = calculateDaysRemaining(expiryDate, now);
  if (days < 0) {
    return 'EXPIRED';
  }
  if (days === 0) {
    return 'EXPIRING_TODAY';
  }
  if (days <= 5) {
    return 'EXPIRING_IN_5_DAYS';
  }
  if (days <= 10) {
    return 'EXPIRING_SOON';
  }
  return 'ACTIVE';
}

export function getExpiryNotificationPayload(
  planName: string,
  daysRemaining: number,
  expiryDate: Date | string,
): { title: string; message: string; type: string } | null {
  const exp = new Date(expiryDate);
  const formattedDate = exp.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  if (daysRemaining === 10) {
    return {
      title: 'Plan Expiring in 10 Days',
      message: `Your subscription for ${planName} expires in 10 days on ${formattedDate}. Renew now to avoid interruption.`,
      type: 'PLAN_EXPIRY_10_DAYS',
    };
  }
  if (daysRemaining === 5) {
    return {
      title: 'Plan Expiring in 5 Days',
      message: `Urgent: Your subscription for ${planName} will expire in 5 days on ${formattedDate}.`,
      type: 'PLAN_EXPIRY_5_DAYS',
    };
  }
  if (daysRemaining === 1) {
    return {
      title: 'Plan Expiring Tomorrow',
      message: `Your subscription for ${planName} expires tomorrow on ${formattedDate}. Please renew immediately.`,
      type: 'PLAN_EXPIRY_1_DAY',
    };
  }
  if (daysRemaining === 0) {
    return {
      title: 'Plan Expiring Today',
      message: `Your subscription for ${planName} expires today (${formattedDate}).`,
      type: 'PLAN_EXPIRY_TODAY',
    };
  }
  if (daysRemaining < 0) {
    return {
      title: 'Plan Expired',
      message: `Your subscription for ${planName} expired on ${formattedDate}. Please renew to reactivate services.`,
      type: 'PLAN_EXPIRED',
    };
  }

  return null;
}

export interface MonthlyScheduleInterval {
  month: number; // 1-12
  year: number;
  startDate: Date;
  endDate: Date;
  title: string;
}

export function generateMonthlyScheduleIntervals(
  startDate: Date | string,
  durationMonths: number,
  planName = 'Plan Schedule',
): MonthlyScheduleInterval[] {
  const totalMonths = Math.max(1, Number(durationMonths) || 1);
  const intervals: MonthlyScheduleInterval[] = [];

  const start = new Date(startDate);

  for (let i = 0; i < totalMonths; i++) {
    const cycleStart = calculatePlanExpiry(start, i);
    const cycleEnd = calculatePlanExpiry(start, i + 1);

    const monthNum = cycleStart.getMonth() + 1;
    const yearNum = cycleStart.getFullYear();
    const monthName = cycleStart.toLocaleString('en-US', { month: 'long' });

    intervals.push({
      month: monthNum,
      year: yearNum,
      startDate: cycleStart,
      endDate: cycleEnd,
      title: `${planName} - Month ${i + 1} (${monthName} ${yearNum})`,
    });
  }

  return intervals;
}
