import { AttendanceStatus } from '@prisma/client';
import { getBusinessDayRange, parseTimeToMinutes } from '../../common/utils/timezone.util';

/** Scheduled checkout in the business timezone, including AM/PM and night shifts. */
export function scheduledCheckout(punchIn: Date, now: Date, policy: {
  officeEndTime?: string; workingHoursPerDay?: number;
}, shift?: { startTime?: string; endTime?: string } | null): Date {
  const { start } = getBusinessDayRange(punchIn);
  const endMinutes = parseTimeToMinutes(shift?.endTime || policy.officeEndTime || '18:30');
  let end = new Date(start.getTime() + endMinutes * 60_000);
  if (end <= punchIn) {
    const overnight = shift?.startTime && endMinutes <= parseTimeToMinutes(shift.startTime);
    end = overnight
      ? new Date(end.getTime() + 24 * 60 * 60_000)
      : new Date(punchIn.getTime() + (policy.workingHoursPerDay ?? 8) * 60 * 60_000);
  }
  return end > now ? now : end;
}

export interface PunchOutPolicy {
  minWorkingHours?: number | null;
  earlyCheckoutGraceMinutes?: number | null;
  earlyCheckoutAction?: string | null;
  minWorkingHoursForHalfDay?: number | null;
  workingHoursPerDay?: number | null;
}

/**
 * Day classification at punch-out. Late mark and half day are decided separately:
 * the late mark comes from punch-in and is only carried forward here, while half day
 * depends only on eligible hours actually worked and the configured hours policy.
 * Late minutes must never be credited as working time.
 */
export function classifyPunchOut(input: {
  currentStatus: AttendanceStatus | string;
  isLate?: boolean | null;
  lateMinutes?: number | null;
  lateGraceMinutes?: number | null;
  workedHours: number;
  policy: PunchOutPolicy;
  shift?: {
    durationHours?: number | null;
    breakDurationMinutes?: number | null;
    halfDayThresholdHours?: number | null;
  } | null;
  isHalfDayLeave?: boolean | null;
  halfDaySession?: string | null;
  halfWorkingHours?: number | null;
}): { status: AttendanceStatus; isLate: boolean; isHalfDay: boolean } {
  const current = input.currentStatus as AttendanceStatus;
  const isLate = Boolean(input.isLate || current === AttendanceStatus.LATE);
  // HOLIDAY/WEEKLY_OFF can be supplied by report APIs even though they are not
  // persisted enum values. Do not replace an explicit non-working classification.
  if (['LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'ABSENT'].includes(current)) {
    return { status: current, isLate, isHalfDay: false };
  }

  // Approved half-day leave: employee is only expected to complete their working half
  // without early punch-out penalties for the approved leave half.
  if (input.isHalfDayLeave) {
    return { status: AttendanceStatus.HALF_DAY, isLate, isHalfDay: true };
  }

  const worked = Math.max(0, Number(input.workedHours) || 0);
  const shiftHours = input.shift?.durationHours
    ? Math.max(0, input.shift.durationHours - (input.shift.breakDurationMinutes ?? 0) / 60)
    : Infinity;
  const requiredHours = Math.min(input.policy.minWorkingHours ?? input.policy.workingHoursPerDay ?? 8, shiftHours);
  const halfDayHours = Math.min(input.shift?.halfDayThresholdHours ?? input.policy.minWorkingHoursForHalfDay ?? 4, requiredHours);
  const earlyGraceHours = (input.policy.earlyCheckoutGraceMinutes ?? 15) / 60;

  const shortHours = worked < requiredHours - earlyGraceHours;
  const isHalfDay = worked < requiredHours &&
    (worked <= halfDayHours || (shortHours && input.policy.earlyCheckoutAction === 'HALF_DAY'));

  if (isHalfDay) return { status: AttendanceStatus.HALF_DAY, isLate, isHalfDay };
  // LATE remains a paid present day for existing API consumers; isLate also
  // survives independently when the hours classification is HALF_DAY.
  return { status: isLate ? AttendanceStatus.LATE : current === AttendanceStatus.REMOTE ? current : AttendanceStatus.PRESENT, isLate, isHalfDay };
}
