/**
 * Subscription Date & Expiry Utilities
 * Enforces business rules:
 * - When a plan is purchased, startDate is strictly 2 calendar days after purchaseDate (purchaseDate + 2 calendar days).
 * - Expiry / endDate is strictly calculated from startDate (startDate + plan duration).
 * - Safe month-end clamping (e.g. 31 Jan + 1m -> 28/29 Feb, 30 Jan purchase -> 1 Feb start -> 1 Mar end).
 * - Multi-stage lifecycle statuses: ACTIVE, EXPIRING_SOON (<= 10d), EXPIRING_IN_5_DAYS (<= 5d), EXPIRING_TODAY (0d), EXPIRED (< 0d), CANCELLED.
 */

/**
 * Calculates the subscription start date from the purchase date.
 * Rule: Start date is exactly 2 calendar days after purchase date.
 *
 * Examples:
 *   Purchase: 1 Sep -> Start: 3 Sep
 *   Purchase: 15 Sep -> Start: 17 Sep
 *   Purchase: 25 Sep -> Start: 27 Sep
 *   Purchase: 30 Jan -> Start: 1 Feb
 *   Purchase: 31 Jan -> Start: 2 Feb
 *   Purchase: 28 Feb (non-leap) -> Start: 2 Mar
 *   Purchase: 28 Feb (leap) -> Start: 1 Mar
 *   Purchase: 29 Feb (leap) -> Start: 2 Mar
 *   Purchase: 30 Dec 2026 -> Start: 1 Jan 2027
 *   Purchase: 31 Dec 2026 -> Start: 2 Jan 2027
 */
export function calculateSubscriptionStartDate(purchaseDate: Date | string = new Date()): Date {
  const purchase = new Date(purchaseDate);
  const start = new Date(purchase);
  start.setDate(start.getDate() + 2);
  return start;
}

export function calculatePlanExpiry(startDate: Date | string, durationMonths = 1): Date {
  const start = new Date(startDate);
  const startYear = start.getFullYear();
  const startMonth = start.getMonth(); // 0-indexed
  const startDay = start.getDate();

  const targetMonthIndex = startMonth + Number(durationMonths);
  const targetYear = startYear + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;

  // Clamping for month-end overflows (e.g., Jan 31 -> Feb 28/29)
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
 * Calculates start and end dates from a purchase date.
 * Formula:
 *   startDate = purchaseDate + 2 calendar days
 *   endDate = startDate + plan duration (calculated from startDate, NOT purchaseDate)
 */
export function calculateSubscriptionDates(
  purchaseDate: Date | string = new Date(),
  durationMonths = 1,
): { purchaseDate: Date; startDate: Date; endDate: Date; expiryDate: Date } {
  const purchase = new Date(purchaseDate);
  const start = calculateSubscriptionStartDate(purchase);
  const expiry = calculatePlanExpiry(start, durationMonths);
  return {
    purchaseDate: purchase,
    startDate: start,
    endDate: expiry,
    expiryDate: expiry,
  };
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
  | 'UPCOMING'
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
  startDate?: Date | string | null,
): DerivedSubscriptionStatus {
  if (status === 'CANCELED' || status === 'CANCELLED') {
    return 'CANCELLED';
  }

  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (startDate) {
    const start = new Date(startDate);
    const startDateOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    if (startDateOnly > nowDate) {
      return 'UPCOMING';
    }
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
