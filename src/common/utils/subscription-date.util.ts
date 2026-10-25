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
import { BUSINESS_TIMEZONE } from './timezone.util';

export function utcCalendarDateKey(date: Date | string): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Calculates activation date exactly 2 calendar days after purchase date
 * based on the configured business timezone (default Asia/Kolkata, UTC+05:30).
 *
 * Purchase date timestamp is the backend source of truth.
 * Consistent activation time is the purchase time on the activation date.
 * Timestamps are stored in UTC.
 *
 * Examples:
 *   Purchase: 1 July 14:30 IST -> Activation: 3 July 14:30 IST
 *   Purchase: 30 Jan -> Activation: 1 Feb
 *   Purchase: 31 Jan -> Activation: 2 Feb
 *   Purchase: 28 Feb (non-leap 2025) -> Activation: 2 Mar
 *   Purchase: 28 Feb (leap 2024) -> Activation: 1 Mar
 *   Purchase: 29 Feb (leap 2024) -> Activation: 2 Mar
 *   Purchase: 30 Dec 2026 -> Activation: 1 Jan 2027
 *   Purchase: 31 Dec 2026 -> Activation: 2 Jan 2027
 */
export function calculateActivationDate(
  purchaseDate: Date | string = new Date(),
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  const purchase = new Date(purchaseDate);
  if (isNaN(purchase.getTime())) {
    throw new Error('Invalid purchase date');
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    fractionalSecondDigits: 3,
    hour12: false,
  });

  const parts = formatter.formatToParts(purchase);
  let y = 0, m = 0, d = 0, hr = 0, min = 0, sec = 0, ms = 0;
  for (const part of parts) {
    if (part.type === 'year') y = parseInt(part.value, 10);
    if (part.type === 'month') m = parseInt(part.value, 10);
    if (part.type === 'day') d = parseInt(part.value, 10);
    if (part.type === 'hour') hr = parseInt(part.value, 10) % 24;
    if (part.type === 'minute') min = parseInt(part.value, 10);
    if (part.type === 'second') sec = parseInt(part.value, 10);
    if (part.type === 'fractionalSecond') ms = parseInt(part.value.padEnd(3, '0').slice(0, 3), 10);
  }

  // Exactly 2 calendar days after purchase in business timezone
  const targetCalendarDate = new Date(Date.UTC(y, m - 1, d + 2));
  const targetYear = targetCalendarDate.getUTCFullYear();
  const targetMonth = targetCalendarDate.getUTCMonth();
  const targetDay = targetCalendarDate.getUTCDate();

  // Find corresponding UTC date preserving activation time (hour, minute, second, ms)
  const approxUtc = new Date(Date.UTC(targetYear, targetMonth, targetDay, hr, min, sec, ms));
  const tzParts = formatter.formatToParts(approxUtc);
  let tzHr = 0, tzMin = 0, tzDay = 0;
  for (const p of tzParts) {
    if (p.type === 'hour') tzHr = parseInt(p.value, 10) % 24;
    if (p.type === 'minute') tzMin = parseInt(p.value, 10);
    if (p.type === 'day') tzDay = parseInt(p.value, 10);
  }

  const dayDiff = tzDay - targetDay;
  const hourDiff = tzHr - hr + (dayDiff > 1 ? 1 : dayDiff < -1 ? -1 : dayDiff) * 24;
  const minDiff = tzMin - min;
  const offsetMs = (hourDiff * 60 + minDiff) * 60 * 1000;

  return new Date(approxUtc.getTime() - offsetMs);
}

export function calculateSubscriptionStartDate(
  purchaseDate: Date | string = new Date(),
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  return calculateActivationDate(purchaseDate, timeZone);
}

/** Parse YYYY-MM-DD (or ISO) as UTC calendar date (no timezone day shift). */
export function parseCalendarDateInput(value?: string | null): Date | null {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]) - 1;
    const d = Number(ymd[3]);
    if (y > 0 && m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    }
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 0, 0, 0, 0),
  );
}

/**
 * Purchase date = payment time; activation = calendar-selected date when provided,
 * otherwise default purchase + 2 calendar days.
 */
export function resolvePlanSubscriptionDates(
  purchaseDate: Date | string,
  durationMonths = 1,
  requestedActivationDate?: string | null,
): { purchaseDate: Date; startDate: Date; endDate: Date } {
  const purchase = new Date(purchaseDate);
  const parsedActivation = parseCalendarDateInput(requestedActivationDate);
  let startDate: Date;
  if (parsedActivation) {
    const purchaseDay = utcCalendarDateKey(purchase);
    const activationDay = utcCalendarDateKey(parsedActivation);
    // Home calendar defaults to "today"; same-day selection still means purchase + 2 calendar days.
    startDate =
      activationDay > purchaseDay
        ? parsedActivation
        : calculateSubscriptionStartDate(purchase);
  } else {
    startDate = calculateSubscriptionStartDate(purchase);
  }
  const endDate = calculatePlanExpiry(startDate, durationMonths);
  return { purchaseDate: purchase, startDate, endDate };
}

/**
 * Display/API activation date from purchase + stored subscription start.
 * Future calendar start (after purchase day) is used as-is.
 * Same calendar day as purchase → existing rule: purchase + 2 calendar days.
 */
export function resolveSubscriptionActivationDate(
  purchaseDate: Date | string,
  storedStartDate?: Date | string | null,
): Date {
  if (storedStartDate) {
    const purchaseDay = utcCalendarDateKey(purchaseDate);
    const storedDay = utcCalendarDateKey(storedStartDate);
    if (storedDay > purchaseDay) {
      const parsed = parseCalendarDateInput(storedDay);
      if (parsed) {
        return parsed;
      }
    }
  }
  return calculateSubscriptionStartDate(purchaseDate);
}

export function resolveSubscriptionExpiryDate(
  activationDate: Date | string,
  durationMonths = 1,
  storedEndDate?: Date | string | null,
): Date {
  const calculated = calculatePlanExpiry(activationDate, durationMonths);
  if (!storedEndDate) {
    return calculated;
  }
  return new Date(storedEndDate);
}

export function calculatePlanExpiry(startDate: Date | string, durationMonths = 1): Date {
  const start = new Date(startDate);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth(); // 0-indexed
  const startDay = start.getUTCDate();

  const targetMonthIndex = startMonth + Number(durationMonths);
  const targetYear = startYear + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;

  // Clamping for month-end overflows (e.g., Jan 31 -> Feb 28/29)
  const maxDaysInTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(startDay, maxDaysInTargetMonth);

  return new Date(Date.UTC(targetYear, normalizedMonth, targetDay, 23, 59, 59, 999));
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
  | 'PENDING_ACTIVATION'
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

  if (status === 'EXPIRED') {
    return 'EXPIRED';
  }

  if (status === 'PENDING_ACTIVATION') {
    return 'PENDING_ACTIVATION';
  }

  // Non-active statuses must never be promoted to ACTIVE by date logic.
  // PENDING, PAYMENT_PENDING, CREATED, INITIATED, PROCESSING, FAILED must NEVER appear as ACTIVE.
  if (status !== 'ACTIVE') {
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
