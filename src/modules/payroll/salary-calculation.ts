import { getBusinessDate } from '../../common/utils/timezone.util';

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

// Attendance dates are stored at midnight in the business timezone, which is
// the previous UTC day. Other date-only fields use UTC and keep asUtcDay.
function attendanceDay(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : asUtcDay(getBusinessDate(date));
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
  halfDayDeductionPct?: number;
}) {
  const joining = asUtcDay(input.joiningDate);
  const exit = asUtcDay(input.exitDate);
  const start = utcDate(input.year, input.month, 1);
  const end = utcDate(input.year, input.month, daysInMonth(input.year, input.month));
  const marks = new Map<string, string>();
  for (const row of input.attendance || []) {
    const day = attendanceDay(row.date);
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
  const halfDayFraction = Math.max(0, Math.min(100, input.halfDayDeductionPct ?? 50)) / 100;
  const lopDays = unpaidLeaveDays + absentDays + halfDays * halfDayFraction + outsideService;
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

export interface LateMarkPolicyInput {
  isEnabled?: boolean;
  deductionRatePerMin?: number;
  gracePeriodMinutes?: number;
  maxDailyDeduction?: number | null;
  maxMonthlyDeduction?: number | null;
  effectiveFrom?: Date | string | null;
  currency?: string | null;
  applyTo?: string | null;
  applicableRoles?: string[] | null;
  applicableEmpIds?: number[] | null;
}

export interface LatePunchEvaluation {
  applicable: boolean;
  isLate: boolean;
  rawLateMinutes: number;
  lateMinutes: number;
  gracePeriodMinutes: number;
  ratePerMinute: number;
  deduction: number;
  shiftStartTime: string | null;
  actualMinutes: number;
  checkInTime: string | null;
  currency: string;
  reason?: string;
}

/** Late minutes after grace, using the Asia/Kolkata clock and the assigned shift. */
export function evaluateLatePunch(input: {
  punchIn: Date | string;
  shift?: {
    startTime?: string | null;
    endTime?: string | null;
    gracePeriodMinutes?: number | null;
    workingDays?: string[] | null;
    isNightShift?: boolean | null;
  } | null;
  policy?: LateMarkPolicyInput | null;
  officeStartTime?: string | null;
  isHoliday?: boolean;
  isApprovedLeave?: boolean;
  workingDaysPerWeek?: number;
  employeeRole?: string | null;
  employeeId?: number | null;
}): LatePunchEvaluation {
  const policy = input.policy;
  const enabled = policy?.isEnabled !== false;
  const rate = Math.max(0, Number(policy?.deductionRatePerMin ?? 1));
  const grace = 0;
  const startRaw = input.shift?.startTime || null;
  const startMins = parseTimeStringToMinutes(startRaw);
  const endMins = parseTimeStringToMinutes(input.shift?.endTime);
  const blank = (reason: string, applicable = false): LatePunchEvaluation => ({
    applicable,
    isLate: false,
    rawLateMinutes: 0,
    lateMinutes: 0,
    gracePeriodMinutes: grace,
    ratePerMinute: rate,
    deduction: 0,
    shiftStartTime: startRaw,
    actualMinutes: startMins ?? 0,
    checkInTime: null,
    currency: policy?.currency || 'INR',
    reason,
  });

  const ist = dateToMinutesInIST(input.punchIn);
  if (!ist.dateStr || startMins == null) return blank(startMins == null ? 'no_shift' : 'invalid_punch');
  let deductionReason = !enabled ? 'policy_disabled' : undefined;
  if (policy?.applyTo === 'ROLES') {
    const role = (input.employeeRole || '').trim().toLowerCase();
    const allowed = (policy.applicableRoles || []).some((item) => item.toLowerCase() === role);
    if (!allowed) deductionReason = 'role_not_applicable';
  }
  if (policy?.applyTo === 'EMPLOYEES' && (policy.applicableEmpIds || []).length > 0) {
    if (!policy.applicableEmpIds!.includes(Number(input.employeeId))) deductionReason = 'employee_not_applicable';
  }

  const [year, month, day] = ist.dateStr.split('-').map(Number);
  let schedule = new Date(Date.UTC(year, month - 1, day));
  const overnight = Boolean(input.shift?.isNightShift) || (endMins != null && endMins <= startMins);
  if (overnight && endMins != null && ist.minutes < startMins && ist.minutes <= endMins) {
    schedule = new Date(schedule.getTime() - 24 * 60 * 60 * 1000);
  }
  if (policy?.effectiveFrom) {
    const from = asUtcDay(policy.effectiveFrom);
    if (from && schedule < from) deductionReason = 'before_effective_date';
  }
  if (!isScheduledWorkday(schedule, input.shift?.workingDays || undefined, input.workingDaysPerWeek ?? 5)) {
    return blank('weekly_off');
  }
  if (input.isHoliday) return blank('holiday');
  if (input.isApprovedLeave) return blank('approved_leave');

  let raw = 0;
  if (ist.minutes >= startMins) raw = ist.minutes - startMins;
  else if (overnight && endMins != null && ist.minutes <= endMins) raw = ist.minutes + 24 * 60 - startMins;
  if (ist.minutes >= startMins || (overnight && endMins != null && ist.minutes <= endMins)) {
    const timestamp = new Date(input.punchIn).getTime();
    if (timestamp % 60000 !== 0) raw += 1;
  }
  const eligible = Math.max(0, raw - grace);
  let deduction = deductionReason ? 0 : Math.round(eligible * rate * 100) / 100;
  const maxDaily = policy?.maxDailyDeduction;
  if (maxDaily != null && Number(maxDaily) > 0 && deduction > Number(maxDaily)) {
    deduction = Number(maxDaily);
  }
  return {
    applicable: !deductionReason,
    isLate: eligible > 0,
    rawLateMinutes: raw,
    lateMinutes: eligible,
    gracePeriodMinutes: grace,
    ratePerMinute: rate,
    deduction,
    shiftStartTime: startRaw,
    actualMinutes: ist.minutes,
    checkInTime: ist.timeStr,
    currency: policy?.currency || 'INR',
    reason: deductionReason,
  };
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
    id?: number;
    date: Date | string;
    punchIn?: Date | string | null;
    punchOut?: Date | string | null;
    isLate?: boolean | null;
    lateMinutes?: number | null;
    lateDeduction?: number | null;
    lateRatePerMinute?: number | null;
    lateGraceMinutes?: number | null;
    status?: string | null;
  }>;
  shift?: {
    startTime?: string | null;
    endTime?: string | null;
    gracePeriodMinutes?: number | null;
    workingDays?: string[] | null;
    isNightShift?: boolean | null;
  } | null;
  policy?: LateMarkPolicyInput | null;
  leaves?: Array<{ from: Date | string; to: Date | string; unpaid?: boolean }>;
  holidays?: Array<{ date: Date | string }>;
  workingDaysPerWeek?: number;
  employeeId?: number;
  employeeRole?: string | null;
}): CalculatePerMinuteLateDeductionResult {
  const policy = input.policy;
  const isEnabled = policy?.isEnabled !== false;
  const ratePerMinute = Math.max(0, Number(policy?.deductionRatePerMin ?? 1.0));
  const graceMinutes = 0;
  const maxDaily = policy?.maxDailyDeduction != null && policy.maxDailyDeduction > 0 ? Number(policy.maxDailyDeduction) : null;
  const maxMonthly = policy?.maxMonthlyDeduction != null && policy.maxMonthlyDeduction > 0 ? Number(policy.maxMonthlyDeduction) : null;
  const effectiveFrom = policy?.effectiveFrom ? asUtcDay(policy.effectiveFrom) : null;

  const roleApplies = policy?.applyTo !== 'ROLES' ||
    (policy.applicableRoles || []).some((role) => role.toLowerCase() === (input.employeeRole || '').trim().toLowerCase());
  const employeeApplies = policy?.applyTo !== 'EMPLOYEES' || !policy.applicableEmpIds?.length ||
    policy.applicableEmpIds.includes(Number(input.employeeId));
  if (!isEnabled || !roleApplies || !employeeApplies || ratePerMinute <= 0 || !input.shift || !input.shift.startTime) {
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

  // Associate after-midnight punches with the day their overnight shift starts.
  const scheduledDate = (row: (typeof input.attendances)[number]) => {
    const date = attendanceDay(row.date);
    if (!date || !row.punchIn) return date;
    const start = parseTimeStringToMinutes(input.shift?.startTime);
    const end = parseTimeStringToMinutes(input.shift?.endTime);
    const punch = dateToMinutesInIST(row.punchIn);
    if (start != null && end != null && (input.shift?.isNightShift || end <= start) &&
        punch.minutes < start && punch.minutes <= end) {
      return asUtcDay(new Date(new Date(`${punch.dateStr}T00:00:00Z`).getTime() - 86400000));
    }
    return date;
  };

  // Legacy duplicate daily records must not charge the same shift twice.
  const daily = new Map<string, (typeof input.attendances)[number]>();
  for (const row of input.attendances || []) {
    const date = scheduledDate(row);
    if (!date) continue;
    const key = keyOf(date);
    const previous = daily.get(key);
    if (!previous || (row.id ?? 0) >= (previous.id ?? 0)) daily.set(key, row);
  }
  for (const att of daily.values()) {
    const attDate = scheduledDate(att);
    if (!attDate) continue;
    const dateKey = keyOf(attDate);

    // 1. Exclude if before policy effectiveFrom date
    if (effectiveFrom && attDate < effectiveFrom) continue;

    // 2. Scheduled workday check: Exclude weekly offs
    const scheduled = isScheduledWorkday(attDate, input.shift.workingDays || undefined, input.workingDaysPerWeek ?? 5);
    if (!scheduled) continue;

    // 3. Exclude public holidays
    if (holidayKeys.has(dateKey) || ['HOLIDAY', 'WEEKLY_OFF', 'LEAVE'].includes(att.status || '')) continue;

    // 4. Exclude approved full-day leave
    const onLeave = leaves.some((l) => covers(attDate, l.from, l.to));
    if (onLeave) continue;

    // 5. Must have punch-in or stored lateMinutes
    if (!att.punchIn && !att.lateMinutes) continue;

  const storedMinutes = Math.max(0, Number(att.lateMinutes) || 0);
  const storedDeduction = Math.max(0, Number((att as any).lateDeduction) || 0);
  const storedRate = Number((att as any).lateRatePerMinute) || 0;

  // Prefer amounts recorded at punch-in (supports historical rates per day).
  const currentEvaluation = att.punchIn ? evaluateLatePunch({
    punchIn: att.punchIn, shift: input.shift, policy,
    isHoliday: holidayKeys.has(dateKey) || att.status === 'HOLIDAY',
    isApprovedLeave: onLeave, workingDaysPerWeek: input.workingDaysPerWeek,
    employeeId: input.employeeId, employeeRole: input.employeeRole,
  }) : null;
  if ((storedMinutes > 0 || storedDeduction > 0) &&
      (!currentEvaluation || (Number(att.lateGraceMinutes) === 0 && storedMinutes === currentEvaluation.lateMinutes))) {
    const rateUsed = storedRate > 0 ? storedRate : ratePerMinute;
    let dailyDeduction = storedDeduction > 0 ? storedDeduction : Math.round(storedMinutes * rateUsed * 100) / 100;
    if (maxDaily !== null && dailyDeduction > maxDaily) dailyDeduction = maxDaily;
    totalMinutes += storedMinutes;
    totalDeduction += dailyDeduction;
    breakdown.push({
      date: dateKey,
      checkInTime: att.punchIn ? dateToMinutesInIST(att.punchIn).timeStr : null,
      shiftStartTime: input.shift!.startTime,
      scheduledMinutes: shiftStartMins,
      actualMinutes: shiftStartMins + storedMinutes,
      rawLateMinutes: storedMinutes,
      gracePeriodMinutes: Number((att as any).lateGraceMinutes) || graceMinutes,
      eligibleLateMinutes: storedMinutes,
      ratePerMinute: rateUsed,
      deduction: dailyDeduction,
    });
    continue;
  }

    let eligibleLateMinutes = 0;
    let rawLateMins = 0;
    let punchInTimeStr: string | null = null;
    let actualMins = shiftStartMins;

    if (att.punchIn) {
      const evaluated = currentEvaluation!;
      if (!evaluated.applicable || evaluated.lateMinutes <= 0) continue;
      eligibleLateMinutes = evaluated.lateMinutes;
      rawLateMins = evaluated.rawLateMinutes;
      actualMins = evaluated.actualMinutes;
      punchInTimeStr = evaluated.checkInTime;
    } else {
      rawLateMins = Math.max(0, Number(att.lateMinutes) || 0);
      eligibleLateMinutes = rawLateMins;
      if (eligibleLateMinutes <= 0) continue;
      actualMins = shiftStartMins + eligibleLateMinutes;
    }

    const appliedRate = storedRate > 0 ? storedRate : ratePerMinute;
    let dailyDeduction = eligibleLateMinutes * appliedRate;
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
      ratePerMinute: appliedRate,
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
