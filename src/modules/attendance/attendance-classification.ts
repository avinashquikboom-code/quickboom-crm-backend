import { AttendanceStatus } from '@prisma/client';

export interface PunchOutPolicy {
  minWorkingHours?: number | null;
  earlyCheckoutGraceMinutes?: number | null;
  earlyCheckoutAction?: string | null;
  minWorkingHoursForHalfDay?: number | null;
}

/**
 * Day classification at punch-out. Late mark and half day are decided separately:
 * the late mark comes from punch-in and is only carried forward here, while half day
 * depends on the hours actually worked. Time lost to the late arrival is already
 * covered by the late mark, so it is not counted again as an early checkout.
 */
export function classifyPunchOut(input: {
  currentStatus: AttendanceStatus | string;
  isLate?: boolean | null;
  lateMinutes?: number | null;
  lateGraceMinutes?: number | null;
  workedHours: number;
  policy: PunchOutPolicy;
}): { status: AttendanceStatus; isLate: boolean; isHalfDay: boolean } {
  const current = input.currentStatus as AttendanceStatus;
  const isLate = Boolean(input.isLate || current === AttendanceStatus.LATE);
  if (current === AttendanceStatus.LEAVE) return { status: current, isLate, isHalfDay: false };

  const worked = Math.max(0, Number(input.workedHours) || 0);
  const halfDayHours = input.policy.minWorkingHoursForHalfDay || 4.0;
  const requiredHours = input.policy.minWorkingHours || 8.0;
  const earlyGraceHours = (input.policy.earlyCheckoutGraceMinutes || 15) / 60;
  const lateArrivalHours = isLate
    ? (Math.max(0, Number(input.lateMinutes) || 0) + Math.max(0, Number(input.lateGraceMinutes) || 0)) / 60
    : 0;

  const leftEarly = worked + lateArrivalHours < requiredHours - earlyGraceHours;
  const isHalfDay = worked < halfDayHours || (leftEarly && input.policy.earlyCheckoutAction === 'HALF_DAY');

  if (isHalfDay) return { status: AttendanceStatus.HALF_DAY, isLate, isHalfDay };
  if (current === AttendanceStatus.HALF_DAY) {
    return { status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT, isLate, isHalfDay };
  }
  return { status: current, isLate, isHalfDay };
}
