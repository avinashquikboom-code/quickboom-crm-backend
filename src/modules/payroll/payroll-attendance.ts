import { getBusinessDate } from '../../common/utils/timezone.util';

const BPO_PATTERN = /bpo|telecall|telesales|teleseller|business process/i;
const PRESENT_STATUSES = new Set(['PRESENT', 'LATE', 'REMOTE']);

/** Business (IST) calendar day of a point-in-time or start-of-range timestamp. */
export function businessDayKey(value: Date | string): string {
  return getBusinessDate(new Date(value));
}

/**
 * Calendar day of an end-of-range timestamp. Leave end dates are stored as
 * 23:59:59.999 in the server timezone, which is the next IST day when the
 * server runs in UTC; midnight stamps are start-of-day values.
 */
export function businessRangeEndKey(value: Date | string): string {
  const date = new Date(value);
  const utcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  const istMidnight = date.getUTCHours() === 18 && date.getUTCMinutes() === 30 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  return utcMidnight || istMidnight ? businessDayKey(date) : date.toISOString().slice(0, 10);
}

/** Same designation/department rule the commission engine uses for BPO eligibility. */
export function isBpoPayrollEmployee(employee: any): boolean {
  return BPO_PATTERN.test(`${employee?.designation?.name || ''} ${employee?.department?.name || ''}`);
}

function isUnpaidLeave(leave: any): boolean {
  const code = String(leave?.leaveType?.code || '').toUpperCase();
  const name = String(leave?.leaveType?.name || '').toLowerCase();
  return code === 'UL' || code === 'LOP' || name.includes('unpaid') || name.includes('loss of pay') || name.includes('lop');
}

export interface PayrollDayInput {
  /** One UTC-midnight Date per calendar day of the payroll period. */
  days: Date[];
  joiningKey: string | null;
  isWeeklyOff: (day: Date) => boolean;
  attendances: any[];
  leaves: any[];
  holidayKeys: Set<string>;
  remoteRequests?: any[];
  halfDayDeductionPct: number;
  absenceDeductionPct: number;
}

export interface PayrollDayCounts {
  employedDays: number;
  scheduledWorkingDays: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  missingPunchDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  holidayDays: number;
  weeklyOffDays: number;
  extraWorkingDays: number;
  extraWorkingDates: string[];
  wfhDays: number;
  lopDays: number;
  attendanceByDay: Map<string, any>;
}

export function classifyPayrollDays(input: PayrollDayInput): PayrollDayCounts {
  const absenceLop = Math.max(0, Number(input.absenceDeductionPct)) / 100;
  const halfDayLop = Math.max(0, Number(input.halfDayDeductionPct)) / 100;

  const attendanceByDay = new Map<string, any>();
  for (const row of input.attendances) {
    const key = businessDayKey(row.date);
    const current = attendanceByDay.get(key);
    if (!current || (!current.punchIn && row.punchIn)) attendanceByDay.set(key, row);
  }
  const leaveRanges = input.leaves.map((leave) => ({
    leave,
    from: businessDayKey(leave.fromDate),
    to: businessRangeEndKey(leave.toDate),
  }));

  const counts: PayrollDayCounts = {
    employedDays: 0,
    scheduledWorkingDays: 0,
    presentDays: 0,
    halfDays: 0,
    absentDays: 0,
    missingPunchDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    holidayDays: 0,
    weeklyOffDays: 0,
    extraWorkingDays: 0,
    extraWorkingDates: [],
    wfhDays: 0,
    lopDays: 0,
    attendanceByDay,
  };

  for (const day of input.days) {
    const key = day.toISOString().slice(0, 10);
    if (input.joiningKey && key < input.joiningKey) continue;
    counts.employedDays += 1;

    const isOff = input.isWeeklyOff(day);
    const isHoliday = input.holidayKeys.has(key);
    if (isOff || isHoliday) {
      if (isOff) counts.weeklyOffDays += 1;
      else if (isHoliday) counts.holidayDays += 1;

      // Verify attendance/punch records on weekly off / holiday
      const attendance = attendanceByDay.get(key);
      const punched = Boolean(attendance?.punchIn);
      const hasWorkingStatus = attendance && (PRESENT_STATUSES.has(attendance.status) || attendance.status === 'HALF_DAY');
      const isHalf = attendance?.status === 'HALF_DAY';

      // Check for request on this date
      const req = input.remoteRequests?.find((r) => {
        const from = businessDayKey(r.fromDate);
        const to = businessRangeEndKey(r.toDate);
        return key >= from && key <= to;
      });

      const isPendingOrRejected = req && (req.status === 'PENDING' || req.status === 'REJECTED');
      const isApprovedReq = req && req.status === 'APPROVED';

      const isAttendanceRejected = attendance && (
        attendance.status === 'ABSENT' ||
        attendance.status === 'LEAVE' ||
        attendance.locationStatus === 'REJECTED' ||
        attendance.workMode === 'REJECTED'
      );
      const isAttendancePending = attendance && (
        attendance.locationStatus === 'PENDING' ||
        attendance.workMode === 'PENDING'
      );

      // Pending or rejected requests must NOT be treated as approved payable work.
      // Approved extra work requires attendance/punch and not being rejected/pending.
      if (!isPendingOrRejected && !isAttendanceRejected && !isAttendancePending && ((punched && hasWorkingStatus) || isApprovedReq)) {
        const weight = isHalf ? 0.5 : 1.0;
        counts.extraWorkingDays += weight;
        counts.extraWorkingDates.push(key);
      }
      continue;
    }
    counts.scheduledWorkingDays += 1;

    const attendance = attendanceByDay.get(key);
    const punched = Boolean(attendance?.punchIn);
    const halfWorked = punched && attendance?.status === 'HALF_DAY';
    const leave = leaveRanges.find((range) => key >= range.from && key <= range.to)?.leave;

    if (leave) {
      if (halfWorked) counts.halfDays += 1;
      if (isUnpaidLeave(leave)) {
        const unpaid = halfWorked ? 0.5 : 1;
        counts.unpaidLeaveDays += unpaid;
        counts.lopDays += unpaid;
      } else {
        counts.paidLeaveDays += halfWorked ? 0.5 : 1;
      }
      continue;
    }

    if (punched && (attendance.workMode === 'WFH' || attendance.workMode === 'REMOTE' || attendance.status === 'REMOTE')) {
      counts.wfhDays += 1;
    }
    if (punched && PRESENT_STATUSES.has(attendance.status)) {
      counts.presentDays += 1;
      continue;
    }
    if (halfWorked) {
      counts.halfDays += 1;
      counts.lopDays += halfDayLop;
      continue;
    }
    // A present-type status without a punch-in is not proof of attendance.
    if (attendance && !punched && (PRESENT_STATUSES.has(attendance.status) || attendance.status === 'HALF_DAY')) {
      counts.missingPunchDays += 1;
    }
    counts.absentDays += 1;
    counts.lopDays += absenceLop;
  }

  return counts;
}

/**
 * Fixed-divisor proration: a fully employed month is worth `divisor` days, so
 * full attendance always pays 100% and each unpaid day costs 1/divisor.
 */
export function prorateFixedDivisor(input: { divisor: number; calendarDays: number; employedDays: number; lopDays: number }) {
  const divisor = Math.max(1, Number(input.divisor) || input.calendarDays || 1);
  const baseUnits = input.employedDays >= input.calendarDays ? divisor : Math.min(divisor, input.employedDays);
  const payableUnits = Math.max(0, baseUnits - Math.max(0, input.lopDays));
  return { divisor, baseUnits, payableUnits, factor: payableUnits / divisor };
}
