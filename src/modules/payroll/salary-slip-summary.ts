export interface PayrollAttendanceSummary {
  periodStart: string | null;
  periodEnd: string | null;
  calendarDays: number | null;
  employmentStartDate: string | null;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  extraWorkingDays: number;
  extraWorkingDates?: string[];
  payableDays: number;
  overtimeMinutes: number | null;
  overtimeLabel: string;
  source: 'PAYROLL_SNAPSHOT' | 'PAYROLL_RECORD';
}

export interface SalaryBreakdownLine {
  key: string;
  label: string;
  amount: number;
}

export interface SalaryBreakdown {
  earnings: SalaryBreakdownLine[];
  deductions: SalaryBreakdownLine[];
  grossEarnings: number;
  totalDeductions: number;
  netSalary: number;
  monthlySalary: number;
  attendanceSalary: number;
  extraWorkingPay: number;
  isReconciled: boolean;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

const dayKey = (value: Date | string): string => new Date(value).toISOString().slice(0, 10);

export function formatOvertimeMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '0h 00m';
  const total = Math.max(0, Math.round(Number(minutes)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

export function formatSummaryDays(value: number | null | undefined): string {
  const num = toNumber(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

export function formatSummaryDate(key?: string | null): string {
  if (!key) return '—';
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return `${String(day).padStart(2, '0')} ${MONTH_SHORT[month - 1]} ${year}`;
}

/**
 * Minutes worked beyond the standard daily hours, summed per attendance day.
 * Only days on/after the employee's joining date inside the payroll period count.
 */
export function calculateOvertimeMinutes(
  attendances: Iterable<{ date: Date | string; workingMinutes?: number | null; workingHours?: number | null }>,
  options: { standardDailyMinutes: number; eligible: boolean; employmentStartKey?: string | null },
): number {
  if (!options.eligible || !(options.standardDailyMinutes > 0)) return 0;
  let total = 0;
  for (const row of attendances) {
    if (!row?.date) continue;
    if (options.employmentStartKey && dayKey(row.date) < options.employmentStartKey) continue;
    const minutes = toNumber(row.workingMinutes);
    const worked = minutes > 0 ? minutes : Math.round(toNumber(row.workingHours) * 60);
    if (worked > options.standardDailyMinutes) total += worked - options.standardDailyMinutes;
  }
  return Math.round(total);
}

function periodRange(year?: number | null, month?: number | null) {
  if (!year || !month) return { periodStart: null, periodEnd: null, calendarDays: null };
  const calendarDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return {
    periodStart: `${year}-${mm}-01`,
    periodEnd: `${year}-${mm}-${String(calendarDays).padStart(2, '0')}`,
    calendarDays,
  };
}

/**
 * Attendance summary for a payroll item. Reads the values captured when payroll was
 * calculated; items calculated before the summary existed fall back to the stored
 * payroll columns (overtime was not recorded for those runs).
 */
export function buildPayrollAttendanceSummary(
  item: any,
  period?: { year?: number | null; month?: number | null },
): PayrollAttendanceSummary | null {
  if (!item || typeof item !== 'object') return null;
  const snapshot = item.calculationSnapshot && typeof item.calculationSnapshot === 'object' ? item.calculationSnapshot : null;
  const stored = snapshot?.attendanceSummary && typeof snapshot.attendanceSummary === 'object' ? snapshot.attendanceSummary : null;
  const range = periodRange(period?.year, period?.month);

  if (stored) {
    const overtimeMinutes = stored.overtimeMinutes === null || stored.overtimeMinutes === undefined
      ? (snapshot?.overtimeMinutes !== undefined ? toNumber(snapshot.overtimeMinutes) : 0)
      : toNumber(stored.overtimeMinutes);
    const extraWorkingDates = Array.isArray(stored.extraWorkingDates)
      ? stored.extraWorkingDates
      : (Array.isArray(snapshot?.extraWorkingDates) ? snapshot.extraWorkingDates : []);
    return {
      periodStart: stored.periodStart ?? range.periodStart,
      periodEnd: stored.periodEnd ?? range.periodEnd,
      calendarDays: stored.calendarDays !== null && stored.calendarDays !== undefined ? toNumber(stored.calendarDays) : range.calendarDays,
      employmentStartDate: stored.employmentStartDate ?? null,
      workingDays: toNumber(stored.workingDays),
      presentDays: toNumber(stored.presentDays),
      absentDays: toNumber(stored.absentDays),
      halfDays: toNumber(stored.halfDays),
      paidLeaveDays: toNumber(stored.paidLeaveDays),
      unpaidLeaveDays: toNumber(stored.unpaidLeaveDays),
      weeklyOffDays: toNumber(stored.weeklyOffDays),
      holidayDays: toNumber(stored.holidayDays),
      extraWorkingDays: toNumber(stored.extraWorkingDays ?? snapshot?.extraWorkingDays ?? item.extraWorkingDays ?? 0),
      extraWorkingDates,
      payableDays: stored.payableDays !== undefined && stored.payableDays !== null ? toNumber(stored.payableDays) : toNumber(item.payableDays ?? item.workingDays),
      overtimeMinutes,
      overtimeLabel: formatOvertimeMinutes(overtimeMinutes),
      source: 'PAYROLL_SNAPSHOT',
    };
  }

  if (item.presentDays === undefined && item.workingDays === undefined) return null;

  const paidLeaveDays = snapshot && snapshot.paidLeaveDays !== undefined
    ? toNumber(snapshot.paidLeaveDays) + toNumber(snapshot.halfPaidLeave) * 0.5
    : toNumber(item.paidLeaveDays);
  const unpaidLeaveDays = snapshot && snapshot.unpaidLeaveDays !== undefined
    ? toNumber(snapshot.unpaidLeaveDays)
    : toNumber(item.unpaidLeaveDays);
  const overtimeMinutes = snapshot?.overtimeMinutes !== undefined ? toNumber(snapshot.overtimeMinutes) : 0;
  const extraWorkingDates = Array.isArray(snapshot?.extraWorkingDates) ? snapshot.extraWorkingDates : [];

  return {
    ...range,
    employmentStartDate: null,
    workingDays: toNumber(item.workingDays),
    presentDays: toNumber(item.presentDays),
    absentDays: toNumber(item.absentDays),
    halfDays: toNumber(item.halfDays),
    paidLeaveDays,
    unpaidLeaveDays,
    weeklyOffDays: toNumber(item.weeklyOffDays),
    holidayDays: toNumber(item.holidayDays),
    extraWorkingDays: toNumber(snapshot?.extraWorkingDays ?? item.extraWorkingDays ?? 0),
    extraWorkingDates,
    payableDays: toNumber(item.payableDays ?? item.workingDays),
    overtimeMinutes,
    overtimeLabel: formatOvertimeMinutes(overtimeMinutes),
    source: 'PAYROLL_RECORD',
  };
}

/**
 * Earnings/deduction lines taken from the payroll record amounts. Optional lines are
 * listed only when non-zero so the visible rows add up to the stored totals.
 */
export function buildSalaryBreakdown(source: any): SalaryBreakdown {
  const src = source || {};
  const earnings: SalaryBreakdownLine[] = [];
  const deductions: SalaryBreakdownLine[] = [];
  const add = (list: SalaryBreakdownLine[], key: string, label: string, always: boolean) => {
    const amount = roundMoney(toNumber(src[key]));
    if (always || amount !== 0) list.push({ key, label, amount });
  };

  add(earnings, 'basicSalary', 'Basic Salary', true);
  add(earnings, 'hra', 'HRA', true);
  add(earnings, 'allowances', 'Allowances', true);
  add(earnings, 'specialAllowance', 'Special Allowance', true);
  add(earnings, 'bonus', 'Bonus', false);
  add(earnings, 'overtime', 'Overtime Pay', false);
  add(earnings, 'extraWorkingPay', 'Extra Working Pay', false);

  const isBpo = src.isBpo || /bpo|telecall/i.test(`${src.department || ''} ${src.designation || ''} ${src.employee?.department?.name || ''} ${src.employee?.designation?.name || ''}`);
  const commissionLabel = isBpo ? 'Approved BPO Commission' : 'Commission';
  add(earnings, 'commission', commissionLabel, false);
  add(earnings, 'otherEarnings', 'Other Earnings', false);
  add(earnings, 'reimbursement', 'Expense Reimbursement', false);

  add(deductions, 'pf', 'Provident Fund (PF)', true);
  add(deductions, 'esi', 'ESI Contribution', true);
  add(deductions, 'professionalTax', 'Professional Tax', true);
  add(deductions, 'tds', 'TDS / Income Tax', true);
  add(deductions, 'lopDeduction', 'Loss of Pay (LOP)', false);
  add(deductions, 'otherDeductions', 'Other Deductions', false);
  add(deductions, 'loanDeduction', 'Loan EMI Deduction', false);
  add(deductions, 'advanceDeduction', 'Salary Advance Recovery', false);

  const earningsSum = roundMoney(earnings.reduce((sum, line) => sum + line.amount, 0));
  const deductionsSum = roundMoney(deductions.reduce((sum, line) => sum + line.amount, 0));
  const grossEarnings = src.grossSalary === undefined || src.grossSalary === null ? earningsSum : roundMoney(toNumber(src.grossSalary));
  const totalDeductions = src.totalDeductions === undefined || src.totalDeductions === null ? deductionsSum : roundMoney(toNumber(src.totalDeductions));
  const netSalary = src.netSalary === undefined || src.netSalary === null
    ? roundMoney(Math.max(0, grossEarnings - totalDeductions))
    : roundMoney(toNumber(src.netSalary));

  const monthlySalary = roundMoney(toNumber(src.monthlySalary ?? src.calculationSnapshot?.monthlySalary ?? grossEarnings));
  const attendanceSalary = roundMoney(toNumber(src.attendanceSalary ?? src.calculationSnapshot?.attendanceSalary ?? (grossEarnings - roundMoney(toNumber(src.reimbursement)))));
  const extraWorkingPay = roundMoney(toNumber(src.extraWorkingPay ?? src.calculationSnapshot?.extraWorkingPay ?? 0));

  return {
    earnings,
    deductions,
    grossEarnings,
    totalDeductions,
    netSalary,
    monthlySalary,
    attendanceSalary,
    extraWorkingPay,
    isReconciled: Math.abs(earningsSum - grossEarnings) < 0.01 && Math.abs(deductionsSum - totalDeductions) < 0.01,
  };
}

interface PdfSectionOptions {
  x: number;
  y: number;
  width: number;
  regularFont: string;
  boldFont: string;
}

/** Draws the ATTENDANCE SUMMARY block and returns the Y position below it. */
export function drawAttendanceSummarySection(
  doc: any,
  summary: PayrollAttendanceSummary | null,
  opts: PdfSectionOptions,
): number {
  const { x, y, width, regularFont, boldFont } = opts;
  doc.font(boldFont).fontSize(9.5).fillColor('#1E293B').text('ATTENDANCE SUMMARY', x, y);

  if (summary?.periodStart && summary?.periodEnd) {
    const joined = summary.employmentStartDate ? `  •  Joined ${formatSummaryDate(summary.employmentStartDate)}` : '';
    doc.font(regularFont).fontSize(7.5).fillColor('#64748B').text(
      `Period: ${formatSummaryDate(summary.periodStart)} – ${formatSummaryDate(summary.periodEnd)}${joined}`,
      x + width - 300,
      y + 1.5,
      { width: 300, align: 'right', lineBreak: false, ellipsis: true },
    );
  }

  const gridY = y + 14;
  const s = summary || {
    calendarDays: 30,
    workingDays: 0,
    presentDays: 0,
    absentDays: 0,
    halfDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    weeklyOffDays: 0,
    holidayDays: 0,
    extraWorkingDays: 0,
    extraWorkingDates: [],
    payableDays: 0,
    overtimeLabel: '0h 00m',
  };

  const cells: [string, string][] = [
    ['Total Calendar Days', formatSummaryDays(s.calendarDays)],
    ['Total Working Days', formatSummaryDays(s.workingDays)],
    ['Payable Attendance Days', formatSummaryDays(s.payableDays)],
    ['Present Days', formatSummaryDays(s.presentDays)],
    ['Half Days', formatSummaryDays(s.halfDays)],
    ['Absent Days', formatSummaryDays(s.absentDays)],
    ['Paid Leave Days', formatSummaryDays(s.paidLeaveDays)],
    ['Unpaid Leave Days', formatSummaryDays(s.unpaidLeaveDays)],
    ['Weekly Off Days', formatSummaryDays(s.weeklyOffDays)],
    ['Holidays', formatSummaryDays(s.holidayDays)],
    ['Extra Working Days', formatSummaryDays(s.extraWorkingDays)],
    ['Overtime Hours', s.overtimeLabel || '0h 00m'],
  ];

  const columns = 3;
  const cellW = width / columns;
  const cellH = 19;
  const valueW = 60;
  cells.forEach(([label, value], index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const cx = x + col * cellW;
    const cy = gridY + row * cellH;
    doc.rect(cx, cy, cellW, cellH).fillAndStroke(row % 2 === 0 ? '#FFFFFF' : '#F8FAFC', '#E2E8F0');
    doc.font(regularFont).fontSize(7.5).fillColor('#475569').text(label, cx + 8, cy + 5.5, {
      width: cellW - valueW - 14,
      lineBreak: false,
      ellipsis: true,
    });
    doc.font(boldFont).fontSize(8.5).fillColor('#0F172A').text(value, cx + cellW - valueW - 8, cy + 4.5, {
      width: valueW,
      align: 'right',
      lineBreak: false,
    });
  });

  const baseBottom = gridY + Math.ceil(cells.length / columns) * cellH;
  if (s.extraWorkingDates && s.extraWorkingDates.length > 0) {
    doc.font(regularFont).fontSize(6.8).fillColor('#0F763E').text(
      `Approved Extra Working Dates: ${s.extraWorkingDates.join(', ')}`,
      x + 4,
      baseBottom + 3,
      { width: width - 8, lineBreak: false, ellipsis: true },
    );
    return baseBottom + 14;
  }

  return baseBottom;
}

/** Draws the SALARY BREAKDOWN table and returns the Y position below it. */
export function drawSalaryBreakdownSection(
  doc: any,
  breakdown: SalaryBreakdown,
  opts: PdfSectionOptions & { formatAmount: (value: number) => string },
): number {
  const { x, y, width, regularFont, boldFont, formatAmount } = opts;
  doc.font(boldFont).fontSize(9.5).fillColor('#1E293B').text('SALARY BREAKDOWN', x, y);

  const headerY = y + 14;
  doc.rect(x, headerY, width, 18).fillAndStroke('#F1F5F9', '#CBD5E1');
  doc.font(regularFont).fontSize(7.5).fillColor('#475569').text('Configured Monthly Salary:', x + 8, headerY + 5);
  doc.font(boldFont).fontSize(8).fillColor('#0F172A').text(formatAmount(breakdown.monthlySalary), x + 125, headerY + 4.5);
  doc.font(regularFont).fontSize(7.5).fillColor('#475569').text('Attendance-based Payable Salary:', x + 240, headerY + 5);
  doc.font(boldFont).fontSize(8).fillColor('#0F763E').text(formatAmount(breakdown.attendanceSalary), x + 385, headerY + 4.5);

  const tableY = headerY + 22;
  const col1W = 155;
  const col2W = (width - 310) / 2;
  const col3W = 155;
  const col4W = col2W;

  doc.rect(x, tableY, width, 20).fill('#0F763E');
  doc.font(boldFont).fontSize(8.5).fillColor('#FFFFFF');
  doc.text('EARNINGS', x + 8, tableY + 5);
  doc.text('AMOUNT', x + col1W - 8, tableY + 5, { width: col2W, align: 'right' });
  doc.text('DEDUCTIONS', x + col1W + col2W + 8, tableY + 5);
  doc.text('AMOUNT', x + col1W + col2W + col3W - 8, tableY + 5, { width: col4W, align: 'right' });

  const numRows = Math.max(breakdown.earnings.length, breakdown.deductions.length);
  let rowY = tableY + 20;
  for (let i = 0; i < numRows; i++) {
    const earn = breakdown.earnings[i];
    const ded = breakdown.deductions[i];
    doc.rect(x, rowY, width, 18).fillAndStroke(i % 2 === 0 ? '#FFFFFF' : '#F8FAFC', '#E2E8F0');
    if (earn) {
      doc.font(regularFont).fontSize(8).fillColor('#334155').text(earn.label, x + 8, rowY + 4, { width: col1W - 12, lineBreak: false, ellipsis: true });
      doc.font(boldFont).fontSize(8).fillColor('#0F172A').text(formatAmount(earn.amount), x + col1W - 8, rowY + 4, { width: col2W, align: 'right' });
    }
    if (ded) {
      doc.font(regularFont).fontSize(8).fillColor('#334155').text(ded.label, x + col1W + col2W + 8, rowY + 4, { width: col3W - 12, lineBreak: false, ellipsis: true });
      doc.font(boldFont).fontSize(8).fillColor('#DC2626').text(formatAmount(ded.amount), x + col1W + col2W + col3W - 8, rowY + 4, { width: col4W, align: 'right' });
    }
    rowY += 18;
  }

  doc.rect(x, rowY, width, 22).fillAndStroke('#F1F5F9', '#CBD5E1');
  doc.font(boldFont).fontSize(8.5).fillColor('#0F172A');
  doc.text('Gross Earnings', x + 8, rowY + 6);
  doc.text(formatAmount(breakdown.grossEarnings), x + col1W - 8, rowY + 6, { width: col2W, align: 'right' });
  doc.text('Total Deductions', x + col1W + col2W + 8, rowY + 6);
  doc.fillColor('#DC2626').text(formatAmount(breakdown.totalDeductions), x + col1W + col2W + col3W - 8, rowY + 6, { width: col4W, align: 'right' });

  return rowY + 22;
}
