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
