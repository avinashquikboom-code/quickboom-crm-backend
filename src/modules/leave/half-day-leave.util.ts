import { getBusinessDate, getBusinessDayRange, parseTimeToMinutes } from '../../common/utils/timezone.util';

export type LeaveDurationType = 'FULL_DAY' | 'HALF_DAY';
export type HalfDaySession = 'FIRST_HALF' | 'SECOND_HALF';

export interface ShiftInput {
  id?: number | null;
  name?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationHours?: number | null;
  breakDurationMinutes?: number | null;
  halfDayThresholdHours?: number | null;
  isNightShift?: boolean | null;
}

export interface AttendancePolicyInput {
  officeStartTime?: string | null;
  officeEndTime?: string | null;
  workingHoursPerDay?: number | null;
  lateThresholdMinutes?: number | null;
}

export interface LeavePolicyInput {
  allowHalfDay?: boolean | null;
  minNoticePeriodDays?: number | null;
  sameDaySecondHalfCutoffHours?: number | null;
  requireFirstHalfPunchInForSameDaySecondHalf?: boolean | null;
}

export interface ShiftHalfDayBreakdown {
  dateStr: string;
  shiftId: number | null;
  shiftName: string;
  shiftStartTime: string;
  shiftEndTime: string;
  isNightShift: boolean;
  breakDurationMinutes: number;
  totalWorkingHours: number;
  halfWorkingHours: number;
  shiftStartAt: Date;
  shiftEndAt: Date;
  firstHalfStartAt: Date;
  firstHalfEndAt: Date;
  secondHalfStartAt: Date;
  secondHalfEndAt: Date;
  firstHalfStartLabel: string;
  firstHalfEndLabel: string;
  secondHalfStartLabel: string;
  secondHalfEndLabel: string;
}

export function formatMinutesTo12h(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalized / 60);
  const m = normalized % 60;
  const amPm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${amPm}`;
}

function toBusinessDateKey(input: Date | string): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim();
  }
  return getBusinessDate(input instanceof Date ? input : new Date(input));
}

export function computeShiftHalfDayBreakdown(
  dateInput: Date | string,
  shift?: ShiftInput | null,
  policy?: AttendancePolicyInput | null,
): ShiftHalfDayBreakdown {
  const dateStr = toBusinessDateKey(dateInput);
  const { start: dayStartUtc } = getBusinessDayRange(dateStr);

  const startStr = shift?.startTime || policy?.officeStartTime || '09:30 AM';
  const endStr = shift?.endTime || policy?.officeEndTime || '06:30 PM';
  const startMinutes = parseTimeToMinutes(startStr);
  let endMinutes = parseTimeToMinutes(endStr);

  const isNightShift = Boolean(shift?.isNightShift) || endMinutes <= startMinutes;
  if (endMinutes <= startMinutes) {
    endMinutes += 1440;
  }

  const grossMinutes = Math.max(120, endMinutes - startMinutes);
  const breakMinutes = Math.max(0, Math.min(grossMinutes - 60, Number(shift?.breakDurationMinutes ?? 0)));
  const netWorkingMinutes = Math.max(60, grossMinutes - breakMinutes);
  const halfWorkingMinutes = Math.round(netWorkingMinutes / 2);

  const shiftStartAt = new Date(dayStartUtc.getTime() + startMinutes * 60_000);
  const shiftEndAt = new Date(dayStartUtc.getTime() + endMinutes * 60_000);
  const firstHalfStartAt = shiftStartAt;
  const firstHalfEndAt = new Date(shiftStartAt.getTime() + halfWorkingMinutes * 60_000);
  const secondHalfStartAt = new Date(firstHalfEndAt.getTime() + breakMinutes * 60_000);
  const secondHalfEndAt = shiftEndAt;

  return {
    dateStr,
    shiftId: shift?.id ?? null,
    shiftName: shift?.name || 'Standard Shift',
    shiftStartTime: formatMinutesTo12h(startMinutes),
    shiftEndTime: formatMinutesTo12h(endMinutes),
    isNightShift,
    breakDurationMinutes: breakMinutes,
    totalWorkingHours: Math.round((netWorkingMinutes / 60) * 100) / 100,
    halfWorkingHours: Math.round((halfWorkingMinutes / 60) * 100) / 100,
    shiftStartAt,
    shiftEndAt,
    firstHalfStartAt,
    firstHalfEndAt,
    secondHalfStartAt,
    secondHalfEndAt,
    firstHalfStartLabel: formatMinutesTo12h(startMinutes),
    firstHalfEndLabel: formatMinutesTo12h(startMinutes + halfWorkingMinutes),
    secondHalfStartLabel: formatMinutesTo12h(startMinutes + halfWorkingMinutes + breakMinutes),
    secondHalfEndLabel: formatMinutesTo12h(endMinutes),
  };
}

export function validateHalfDayLeaveApplication(params: {
  now: Date;
  fromDate: Date | string;
  toDate: Date | string;
  durationType: LeaveDurationType;
  halfDaySession?: HalfDaySession | null;
  breakdown: ShiftHalfDayBreakdown;
  leavePolicy?: LeavePolicyInput | null;
  hasFirstHalfPunchIn: boolean;
  isAdminOverride?: boolean;
  exceptionalReason?: string | null;
}): {
  valid: boolean;
  error?: string;
  applicationDeadline: Date | null;
  expectedPunchIn: string;
  expectedPunchOut: string;
  leaveHours: number;
  workingHours: number;
  halfStartTime: string;
  halfEndTime: string;
} {
  const {
    now,
    fromDate,
    toDate,
    durationType,
    halfDaySession,
    breakdown,
    leavePolicy,
    hasFirstHalfPunchIn,
    isAdminOverride,
    exceptionalReason,
  } = params;

  const fromKey = toBusinessDateKey(fromDate || breakdown.dateStr);
  const toKey = toBusinessDateKey(toDate || fromKey);
  const todayKey = toBusinessDateKey(now);

  if (durationType === 'FULL_DAY') {
    const minNotice = Math.max(0, Number(leavePolicy?.minNoticePeriodDays ?? 1));
    const deadline = new Date(breakdown.shiftStartAt.getTime() - minNotice * 86_400_000);
    return {
      valid: true,
      applicationDeadline: deadline,
      expectedPunchIn: 'On Leave',
      expectedPunchOut: 'On Leave',
      leaveHours: breakdown.totalWorkingHours,
      workingHours: 0,
      halfStartTime: breakdown.shiftStartTime,
      halfEndTime: breakdown.shiftEndTime,
    };
  }

  if (leavePolicy && leavePolicy.allowHalfDay === false) {
    return {
      valid: false,
      error: 'Half-day leave is disabled by the HR leave policy.',
      applicationDeadline: null,
      expectedPunchIn: breakdown.shiftStartTime,
      expectedPunchOut: breakdown.shiftEndTime,
      leaveHours: breakdown.halfWorkingHours,
      workingHours: breakdown.halfWorkingHours,
      halfStartTime: breakdown.firstHalfStartLabel,
      halfEndTime: breakdown.firstHalfEndLabel,
    };
  }

  if (fromKey !== toKey) {
    return {
      valid: false,
      error: 'Half-day leave can only be applied for a single date.',
      applicationDeadline: null,
      expectedPunchIn: breakdown.shiftStartTime,
      expectedPunchOut: breakdown.shiftEndTime,
      leaveHours: breakdown.halfWorkingHours,
      workingHours: breakdown.halfWorkingHours,
      halfStartTime: breakdown.firstHalfStartLabel,
      halfEndTime: breakdown.firstHalfEndLabel,
    };
  }

  if (halfDaySession !== 'FIRST_HALF' && halfDaySession !== 'SECOND_HALF') {
    return {
      valid: false,
      error: 'Select First Half or Second Half for half-day leave.',
      applicationDeadline: null,
      expectedPunchIn: breakdown.shiftStartTime,
      expectedPunchOut: breakdown.shiftEndTime,
      leaveHours: breakdown.halfWorkingHours,
      workingHours: breakdown.halfWorkingHours,
      halfStartTime: breakdown.firstHalfStartLabel,
      halfEndTime: breakdown.firstHalfEndLabel,
    };
  }

  const isFirstHalf = halfDaySession === 'FIRST_HALF';
  const expectedPunchIn = isFirstHalf ? breakdown.secondHalfStartLabel : breakdown.shiftStartTime;
  const expectedPunchOut = isFirstHalf ? breakdown.shiftEndTime : breakdown.firstHalfEndLabel;
  const halfStartTime = isFirstHalf ? breakdown.firstHalfStartLabel : breakdown.secondHalfStartLabel;
  const halfEndTime = isFirstHalf ? breakdown.firstHalfEndLabel : breakdown.secondHalfEndLabel;

  const minNoticeDays = Math.max(1, Number(leavePolicy?.minNoticePeriodDays ?? 1));
  const cutoffHours = Math.max(0.5, Number(leavePolicy?.sameDaySecondHalfCutoffHours ?? 2));
  const requirePunchIn = leavePolicy?.requireFirstHalfPunchInForSameDaySecondHalf !== false;

  const fromUtc = new Date(`${fromKey}T00:00:00.000Z`);
  const todayUtc = new Date(`${todayKey}T00:00:00.000Z`);
  const diffDays = Math.round((fromUtc.getTime() - todayUtc.getTime()) / 86_400_000);

  let applicationDeadline: Date;
  let error: string | undefined;

  if (diffDays < 0) {
    applicationDeadline = breakdown.shiftStartAt;
    error = 'Cannot apply for half-day leave on a past date.';
  } else if (diffDays === 0) {
    if (isFirstHalf) {
      applicationDeadline = new Date(breakdown.shiftStartAt.getTime() - minNoticeDays * 86_400_000);
      error = `First-half leave cannot be applied on the same day. Apply at least ${minNoticeDays} day(s) in advance.`;
    } else {
      applicationDeadline = new Date(breakdown.secondHalfStartAt.getTime() - cutoffHours * 3_600_000);
      if (requirePunchIn && !hasFirstHalfPunchIn) {
        error = 'Same-day second-half leave requires punching in during the first half first.';
      } else if (now.getTime() > applicationDeadline.getTime()) {
        error = `Same-day second-half leave must be submitted at least ${cutoffHours} hour(s) before the second half starts (${breakdown.secondHalfStartLabel}).`;
      }
    }
  } else {
    applicationDeadline = new Date(breakdown.shiftStartAt.getTime() - minNoticeDays * 86_400_000);
    if (diffDays < minNoticeDays) {
      error = `Planned half-day leave must be applied at least ${minNoticeDays} day(s) in advance.`;
    }
  }

  if (error && isAdminOverride) {
    if (!String(exceptionalReason || '').trim()) {
      return {
        valid: false,
        error: 'An exceptional approval reason is required to override the leave deadline.',
        applicationDeadline,
        expectedPunchIn,
        expectedPunchOut,
        leaveHours: breakdown.halfWorkingHours,
        workingHours: breakdown.halfWorkingHours,
        halfStartTime,
        halfEndTime,
      };
    }
    error = undefined;
  }

  return {
    valid: !error,
    error,
    applicationDeadline,
    expectedPunchIn,
    expectedPunchOut,
    leaveHours: breakdown.halfWorkingHours,
    workingHours: breakdown.halfWorkingHours,
    halfStartTime,
    halfEndTime,
  };
}
