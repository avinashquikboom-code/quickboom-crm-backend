/** Fixed monthly salary. A full month pays the agreed amount in February, April, and May. */
export const SALARY_DAY_DIVISOR = 30;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function agreedMonthlySalary(structure?: { basicSalary?: number; grossSalary?: number } | null) {
  const gross = Number(structure?.grossSalary || 0);
  const basic = Number(structure?.basicSalary || 0);
  if (gross > 0) return gross;
  return basic > 0 ? basic : 0;
}

/** Target met pays the full salary. Anything below the target pays the lower salary. */
export function eligibleTargetSalary(input: {
  achieved: number;
  target: number;
  fullSalary: number;
  belowTargetSalary: number;
}) {
  const achieved = Math.max(0, Number(input.achieved) || 0);
  const target = Math.max(0, Number(input.target) || 0);
  const fullSalary = Math.max(0, Number(input.fullSalary) || 0);
  const belowTargetSalary = Math.max(0, Number(input.belowTargetSalary) || 0);
  const achievedTarget = target > 0 && achieved >= target;
  return {
    achieved,
    target,
    fullSalary,
    belowTargetSalary,
    eligibleSalary: achievedTarget ? fullSalary : belowTargetSalary,
    targetStatus: achievedTarget ? 'ACHIEVED' : 'NOT_ACHIEVED',
    achievementPercent: target > 0 ? Math.round((achieved / target) * 10000) / 100 : 0,
    remainingAmount: Math.max(0, Math.round((target - achieved) * 100) / 100),
  };
}

/** One late mark deducts the configured percent of one salary day. A zero policy adds nothing. */
export function lateMarkDeduction(monthlySalary: number, lateMarks: number, deductionPercent: number) {
  const salary = Math.max(0, Number(monthlySalary) || 0);
  const marks = Math.max(0, Math.round(Number(lateMarks) || 0));
  const percent = Math.max(0, Number(deductionPercent) || 0);
  if (salary <= 0 || marks <= 0 || percent <= 0) return 0;
  return Math.round((salary / SALARY_DAY_DIVISOR) * (percent / 100) * marks);
}

export function lopDeduction(monthlySalary: number, lopDays: number) {
  if (monthlySalary <= 0 || lopDays <= 0) return 0;
  return Math.round((monthlySalary / SALARY_DAY_DIVISOR) * lopDays);
}

export function settleMonthlySalary(input: {
  monthlySalary: number;
  lopDays: number;
  otherDeductions?: number;
  extraEarnings?: number;
}) {
  const monthlySalary = Math.max(0, Number(input.monthlySalary) || 0);
  const deduction = lopDeduction(monthlySalary, input.lopDays);
  const extra = Math.max(0, Number(input.extraEarnings) || 0);
  const other = Math.max(0, Number(input.otherDeductions) || 0);
  const gross = monthlySalary + extra;
  const totalDeductions = deduction + other;
  return {
    monthlySalary,
    lopDays: input.lopDays,
    lopDeduction: deduction,
    gross,
    otherDeductions: other,
    totalDeductions,
    net: Math.max(0, gross - totalDeductions),
    attendanceSalary: Math.max(0, monthlySalary - deduction),
  };
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function keyOf(date: Date) {
  return date.toISOString().slice(0, 10);
}

function asUtcDay(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function isScheduledWorkday(date: Date, shiftDays?: string[], workingDaysPerWeek = 5) {
  const name = DAY_NAMES[date.getUTCDay()];
  if (shiftDays && shiftDays.length > 0) {
    return shiftDays.some((day) => day.toLowerCase() === name.toLowerCase());
  }
  const day = date.getUTCDay();
  if (workingDaysPerWeek >= 7) return true;
  if (workingDaysPerWeek === 6) return day >= 1 && day <= 6;
  return day >= 1 && day <= 5;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar days before joining or after exit. A short month is not treated as missing days. */
export function nonServiceDays(year: number, month: number, joiningDate?: Date | string | null, exitDate?: Date | string | null) {
  const total = daysInMonth(year, month);
  const start = utcDate(year, month, 1);
  const end = utcDate(year, month, total);
  const joining = asUtcDay(joiningDate);
  const exit = asUtcDay(exitDate);
  if (joining && joining > end) return total;
  if (exit && exit < start) return total;
  let days = 0;
  if (joining && joining > start) days += joining.getUTCDate() - 1;
  if (exit && exit < end) days += total - exit.getUTCDate();
  return Math.min(total, days);
}

type AttendanceMark = { date: Date | string; status?: string | null };
type LeaveMark = { from: Date | string; to: Date | string; unpaid: boolean };

function covers(day: Date, from?: Date | null, to?: Date | null) {
  if (!from || !to) return false;
  const key = keyOf(day);
  return key >= keyOf(from) && key <= keyOf(to);
}

export function countPayableAttendance(input: {
  year: number;
  month: number;
  joiningDate?: Date | string | null;
  exitDate?: Date | string | null;
  shiftDays?: string[];
  workingDaysPerWeek?: number;
  attendance?: AttendanceMark[];
  leaves?: LeaveMark[];
}) {
  const joining = asUtcDay(input.joiningDate);
  const exit = asUtcDay(input.exitDate);
  const start = utcDate(input.year, input.month, 1);
  const end = utcDate(input.year, input.month, daysInMonth(input.year, input.month));
  const marks = new Map<string, string>();
  for (const row of input.attendance || []) {
    const day = asUtcDay(row.date);
    if (day) marks.set(keyOf(day), String(row.status || '').toUpperCase());
  }
  const leaves = (input.leaves || []).map((leave) => ({
    from: asUtcDay(leave.from),
    to: asUtcDay(leave.to),
    unpaid: leave.unpaid,
  }));

  let workingDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let halfDays = 0;
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let weeklyOffDays = 0;
  let holidayDays = 0;

  for (let day = 1; day <= daysInMonth(input.year, input.month); day += 1) {
    const date = utcDate(input.year, input.month, day);
    if ((joining && date < joining) || (exit && date > exit)) continue;
    const scheduled = isScheduledWorkday(date, input.shiftDays, input.workingDaysPerWeek ?? 5);
    const status = marks.get(keyOf(date)) || '';
    const paidLeave = leaves.some((leave) => !leave.unpaid && covers(date, leave.from, leave.to));
    const unpaidLeave = leaves.some((leave) => leave.unpaid && covers(date, leave.from, leave.to));
    if (!scheduled) {
      weeklyOffDays += 1;
      continue;
    }
    workingDays += 1;
    if (status === 'HOLIDAY') {
      holidayDays += 1;
      continue;
    }
    if (paidLeave) {
      paidLeaveDays += 1;
      continue;
    }
    if (unpaidLeave || status === 'ABSENT') {
      if (unpaidLeave) unpaidLeaveDays += 1;
      else absentDays += 1;
      continue;
    }
    if (status === 'HALF_DAY') {
      halfDays += 1;
      continue;
    }
    if (status === 'PRESENT' || status === 'LATE' || status === 'REMOTE' || status === 'WFH') {
      presentDays += 1;
      continue;
    }
    absentDays += 1;
  }

  const outsideService = nonServiceDays(input.year, input.month, joining && joining > start ? joining : null, exit && exit < end ? exit : null);
  const lopDays = unpaidLeaveDays + absentDays + halfDays * 0.5 + outsideService;
  return {
    workingDays,
    presentDays,
    absentDays,
    halfDays,
    paidLeaveDays,
    unpaidLeaveDays,
    weeklyOffDays,
    holidayDays,
    nonServiceDays: outsideService,
    lopDays,
    calendarDays: daysInMonth(input.year, input.month),
  };
}

export function parseTimeStringToMinutes(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  const clean = timeStr.trim().toUpperCase();
  const match = clean.match(/(\d+):(\d+)(?::(\d+))?\s*(AM|PM)?/);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridian = match[4];
  if (meridian === 'PM' && hours < 12) hours += 12;
  if (meridian === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function dateToMinutesInIST(date: Date | string): { dateStr: string; minutes: number; timeStr: string } {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return { dateStr: '', minutes: 0, timeStr: '' };
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    let year = '', month = '', day = '', hour = 0, minute = 0;
    for (const part of parts) {
      if (part.type === 'year') year = part.value;
      if (part.type === 'month') month = part.value;
      if (part.type === 'day') day = part.value;
      if (part.type === 'hour') hour = parseInt(part.value, 10);
      if (part.type === 'minute') minute = parseInt(part.value, 10);
    }
    const dateStr = `${year}-${month}-${day}`;
    const minutes = hour * 60 + minute;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return { dateStr, minutes, timeStr };
  } catch {
    const dateStr = d.toISOString().slice(0, 10);
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    return { dateStr, minutes, timeStr: d.toISOString().slice(11, 16) };
  }
}

export interface LateMarkDeductionBreakdownItem {
  date: string;
  checkInTime: string | null;
  shiftStartTime: string | null;
  scheduledMinutes: number;
  actualMinutes: number;
  rawLateMinutes: number;
  gracePeriodMinutes: number;
  eligibleLateMinutes: number;
  ratePerMinute: number;
  deduction: number;
  reason?: string;
}

export interface CalculatePerMinuteLateDeductionResult {
  isEnabled: boolean;
  lateDaysCount: number;
  totalLateMinutes: number;
  lateRatePerMinute: number;
  totalLateDeduction: number;
  breakdown: LateMarkDeductionBreakdownItem[];
}

export function calculatePerMinuteLateDeduction(input: {
  attendances: Array<{
    date: Date | string;
    punchIn?: Date | string | null;
    punchOut?: Date | string | null;
    isLate?: boolean | null;
    lateMinutes?: number | null;
    status?: string | null;
  }>;
  shift?: {
    startTime?: string | null;
    endTime?: string | null;
    gracePeriodMinutes?: number | null;
    workingDays?: string[] | null;
    isNightShift?: boolean | null;
  } | null;
  policy?: {
    isEnabled?: boolean;
    deductionRatePerMin?: number;
    gracePeriodMinutes?: number;
    maxDailyDeduction?: number | null;
    maxMonthlyDeduction?: number | null;
    effectiveFrom?: Date | string | null;
  } | null;
  leaves?: Array<{ from: Date | string; to: Date | string; unpaid?: boolean }>;
  holidays?: Array<{ date: Date | string }>;
  workingDaysPerWeek?: number;
}): CalculatePerMinuteLateDeductionResult {
  const policy = input.policy;
  const isEnabled = policy?.isEnabled !== false;
  const ratePerMinute = Math.max(0, Number(policy?.deductionRatePerMin ?? 1.0));
  const graceMinutes = Math.max(0, Number(policy?.gracePeriodMinutes ?? 0));
  const maxDaily = policy?.maxDailyDeduction != null && policy.maxDailyDeduction > 0 ? Number(policy.maxDailyDeduction) : null;
  const maxMonthly = policy?.maxMonthlyDeduction != null && policy.maxMonthlyDeduction > 0 ? Number(policy.maxMonthlyDeduction) : null;
  const effectiveFrom = policy?.effectiveFrom ? new Date(policy.effectiveFrom) : null;

  if (!isEnabled || ratePerMinute <= 0 || !input.shift || !input.shift.startTime) {
    return {
      isEnabled,
      lateDaysCount: 0,
      totalLateMinutes: 0,
      lateRatePerMinute: ratePerMinute,
      totalLateDeduction: 0,
      breakdown: [],
    };
  }

  const shiftStartMins = parseTimeStringToMinutes(input.shift.startTime);
  if (shiftStartMins === null) {
    return {
      isEnabled,
      lateDaysCount: 0,
      totalLateMinutes: 0,
      lateRatePerMinute: ratePerMinute,
      totalLateDeduction: 0,
      breakdown: [],
    };
  }

  const leaves = (input.leaves || []).map((l) => ({
    from: asUtcDay(l.from),
    to: asUtcDay(l.to),
  }));

  const holidayKeys = new Set(
    (input.holidays || []).map((h) => {
      const d = asUtcDay(h.date);
      return d ? keyOf(d) : '';
    }),
  );

  const breakdown: LateMarkDeductionBreakdownItem[] = [];
  let totalMinutes = 0;
  let totalDeduction = 0;

  for (const att of input.attendances || []) {
    const attDate = asUtcDay(att.date);
    if (!attDate) continue;
    const dateKey = keyOf(attDate);

    // 1. Exclude if before policy effectiveFrom date
    if (effectiveFrom && attDate < effectiveFrom) continue;

    // 2. Scheduled workday check: Exclude weekly offs
    const scheduled = isScheduledWorkday(attDate, input.shift.workingDays || undefined, input.workingDaysPerWeek ?? 5);
    if (!scheduled) continue;

    // 3. Exclude public holidays
    if (holidayKeys.has(dateKey) || att.status === 'HOLIDAY') continue;

    // 4. Exclude approved full-day leave
    const onLeave = leaves.some((l) => covers(attDate, l.from, l.to));
    if (onLeave) continue;

    // 5. Must have punch-in or stored lateMinutes
    if (!att.punchIn && !att.lateMinutes) continue;

    let actualMins = shiftStartMins;
    let punchInTimeStr: string | null = null;

    if (att.punchIn) {
      const ist = dateToMinutesInIST(att.punchIn);
      actualMins = ist.minutes;
      punchInTimeStr = ist.timeStr;
    } else if (att.lateMinutes) {
      actualMins = shiftStartMins + att.lateMinutes;
    }

    const rawLateMins = Math.max(0, actualMins - shiftStartMins);

    // If check-in is earlier than shift start, no late minutes
    if (rawLateMins <= 0) continue;

    // Formula: Late Minutes = Actual Check-in Time - Scheduled Shift Start Time - Grace Period
    const eligibleLateMinutes = Math.max(0, rawLateMins - graceMinutes);
    if (eligibleLateMinutes <= 0) continue;

    let dailyDeduction = eligibleLateMinutes * ratePerMinute;
    if (maxDaily !== null && dailyDeduction > maxDaily) {
      dailyDeduction = maxDaily;
    }
    dailyDeduction = Math.round(dailyDeduction * 100) / 100;

    totalMinutes += eligibleLateMinutes;
    totalDeduction += dailyDeduction;

    breakdown.push({
      date: dateKey,
      checkInTime: punchInTimeStr,
      shiftStartTime: input.shift.startTime,
      scheduledMinutes: shiftStartMins,
      actualMinutes: actualMins,
      rawLateMinutes: rawLateMins,
      gracePeriodMinutes: graceMinutes,
      eligibleLateMinutes,
      ratePerMinute,
      deduction: dailyDeduction,
    });
  }

  if (maxMonthly !== null && totalDeduction > maxMonthly) {
    totalDeduction = maxMonthly;
  }
  totalDeduction = Math.round(totalDeduction * 100) / 100;

  return {
    isEnabled,
    lateDaysCount: breakdown.length,
    totalLateMinutes: totalMinutes,
    lateRatePerMinute: ratePerMinute,
    totalLateDeduction: totalDeduction,
    breakdown,
  };
}
