export interface StoredLateMark {
  id: number;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  department: string;
  shiftName: string;
  shiftStart: string;
  shiftEnd: string;
  punchIn: string | null;
  date: string;
  status: string;
  lateMinutes: number;
  graceMinutes: number;
  rate: number;
  deduction: number;
}

export interface LateMarkSummary {
  totalLateMarks: number;
  totalLateMinutes: number;
  totalDeduction: number;
  employeesAffected: number;
  averageLateMinutes: number;
  averageDeduction: number;
  rows: StoredLateMark[];
  byEmployee: Array<{
    employeeId: number;
    employeeCode: string;
    employeeName: string;
    department: string;
    lateDays: number;
    totalLateMinutes: number;
    totalDeduction: number;
    rateLabel: string;
  }>;
  byDate: Array<{ date: string; lateMarks: number; totalLateMinutes: number; totalDeduction: number }>;
  byDepartment: Array<{ department: string; employees: number; totalLateMinutes: number; totalDeduction: number }>;
}

export function keepLatestAttendance(rows: StoredLateMark[]): StoredLateMark[] {
  const map = new Map<string, StoredLateMark>();
  for (const row of rows) {
    const key = `${row.employeeId}|${row.date}`;
    const previous = map.get(key);
    if (!previous || row.id > previous.id) map.set(key, row);
  }
  return [...map.values()];
}

export function summarizeLateMarks(rows: StoredLateMark[]): LateMarkSummary {
  const latest = keepLatestAttendance(rows).filter((row) => row.lateMinutes > 0 || row.deduction > 0);
  const employees = new Set(latest.map((row) => row.employeeId));
  const totalLateMinutes = latest.reduce((sum, row) => sum + row.lateMinutes, 0);
  const totalDeduction = roundMoney(latest.reduce((sum, row) => sum + row.deduction, 0));
  const byEmployeeMap = new Map<number, LateMarkSummary['byEmployee'][number] & { rates: Set<string> }>();
  const byDateMap = new Map<string, LateMarkSummary['byDate'][number]>();
  const byDepartmentMap = new Map<string, { department: string; people: Set<number>; totalLateMinutes: number; totalDeduction: number }>();

  for (const row of latest) {
    const employee = byEmployeeMap.get(row.employeeId) || {
      employeeId: row.employeeId,
      employeeCode: row.employeeCode,
      employeeName: row.employeeName,
      department: row.department,
      lateDays: 0,
      totalLateMinutes: 0,
      totalDeduction: 0,
      rateLabel: '',
      rates: new Set<string>(),
    };
    employee.lateDays += 1;
    employee.totalLateMinutes += row.lateMinutes;
    employee.totalDeduction = roundMoney(employee.totalDeduction + row.deduction);
    if (row.rate > 0) employee.rates.add(`₹${trimMoney(row.rate)}/min`);
    byEmployeeMap.set(row.employeeId, employee);

    const day = byDateMap.get(row.date) || { date: row.date, lateMarks: 0, totalLateMinutes: 0, totalDeduction: 0 };
    day.lateMarks += 1;
    day.totalLateMinutes += row.lateMinutes;
    day.totalDeduction = roundMoney(day.totalDeduction + row.deduction);
    byDateMap.set(row.date, day);

    const department = byDepartmentMap.get(row.department) || {
      department: row.department,
      people: new Set<number>(),
      totalLateMinutes: 0,
      totalDeduction: 0,
    };
    department.people.add(row.employeeId);
    department.totalLateMinutes += row.lateMinutes;
    department.totalDeduction = roundMoney(department.totalDeduction + row.deduction);
    byDepartmentMap.set(row.department, department);
  }

  const affected = employees.size;
  return {
    totalLateMarks: latest.length,
    totalLateMinutes,
    totalDeduction,
    employeesAffected: affected,
    averageLateMinutes: affected ? Math.round(totalLateMinutes / affected) : 0,
    averageDeduction: affected ? roundMoney(totalDeduction / affected) : 0,
    rows: latest.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName)),
    byEmployee: [...byEmployeeMap.values()]
      .map((row) => ({ ...row, rateLabel: [...row.rates].join(', ') || '—', totalDeduction: roundMoney(row.totalDeduction) }))
      .sort((a, b) => b.totalLateMinutes - a.totalLateMinutes),
    byDate: [...byDateMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byDepartment: [...byDepartmentMap.values()]
      .map((row) => ({
        department: row.department,
        employees: row.people.size,
        totalLateMinutes: row.totalLateMinutes,
        totalDeduction: row.totalDeduction,
      }))
      .sort((a, b) => b.totalDeduction - a.totalDeduction),
  };
}

export function toCsv(rows: StoredLateMark[]): string {
  const header = ['Date', 'Employee ID', 'Employee', 'Department', 'Shift', 'Shift start', 'Punch in', 'Late minutes', 'Rate', 'Deduction', 'Status'];
  const lines = rows.map((row) => [
    row.date,
    row.employeeCode,
    row.employeeName,
    row.department,
    row.shiftName,
    row.shiftStart,
    row.punchIn || '',
    row.lateMinutes,
    row.rate,
    row.deduction,
    row.status,
  ].map(csvCell).join(','));
  return [header.join(','), ...lines].join('\n');
}

export function reportHtml(title: string, summary: LateMarkSummary, extra: string[] = []): string {
  const cards = [
    ['Late marks', String(summary.totalLateMarks)],
    ['Late minutes', String(summary.totalLateMinutes)],
    ['Deduction', `₹${trimMoney(summary.totalDeduction)}`],
    ['Employees', String(summary.employeesAffected)],
  ].map(([label, value]) => `<td style="padding:12px;border:1px solid #d9f0e3;border-radius:12px;background:#f4fbf7"><div style="color:#5f7468;font-size:12px">${label}</div><div style="font-size:20px;font-weight:700;color:#14532d">${value}</div></td>`).join('');
  const people = summary.byEmployee.slice(0, 50).map((row) => `<tr><td style="padding:8px;border-bottom:1px solid #e5efe9">${escapeHtml(row.employeeName)}<div style="color:#64748b;font-size:12px">${escapeHtml(row.employeeCode)} · ${escapeHtml(row.department)}</div></td><td style="padding:8px;border-bottom:1px solid #e5efe9">${row.lateDays}</td><td style="padding:8px;border-bottom:1px solid #e5efe9">${row.totalLateMinutes}</td><td style="padding:8px;border-bottom:1px solid #e5efe9">₹${trimMoney(row.totalDeduction)}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#143028"><h2 style="margin:0 0 8px">${escapeHtml(title)}</h2>${extra.map((line) => `<p style="margin:4px 0;color:#3f5348">${escapeHtml(line)}</p>`).join('')}<table style="border-collapse:separate;border-spacing:8px 0;margin:12px 0"><tr>${cards}</tr></table><table style="width:100%;border-collapse:collapse"><tr><th align="left">Employee</th><th align="left">Late days</th><th align="left">Minutes</th><th align="left">Deduction</th></tr>${people || '<tr><td colspan="4">No eligible late marks.</td></tr>'}</table></div>`;
}

export function zonedClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || '';
  let hour = Number(read('hour'));
  if (hour === 24) hour = 0;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    hour,
    minute: Number(read('minute')),
    weekday: weekdays.indexOf(read('weekday')),
  };
}

export function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function weekContaining(iso: string, weekStartsOn: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const diff = (date.getUTCDay() - weekStartsOn + 7) % 7;
  const start = addDays(iso, -diff);
  return { start, end: addDays(start, 6) };
}

export function previousMonth(iso: string) {
  const [year, month] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  const start = date.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { start, end, key: start.slice(0, 7), label: date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}

export function dueReport(now: Date, settings: {
  timezone: string;
  weekStartsOn: number;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
  dailySendHour: number;
  dailySendMinute: number;
  weeklySendHour: number;
  weeklySendMinute: number;
  monthlySendHour: number;
  monthlySendMinute: number;
}, kind: 'DAILY' | 'WEEKLY' | 'MONTHLY') {
  const clock = zonedClock(now, settings.timezone || 'Asia/Kolkata');
  const minutes = clock.hour * 60 + clock.minute;
  if (kind === 'DAILY' && settings.dailyEnabled && minutes >= settings.dailySendHour * 60 + settings.dailySendMinute) {
    return { due: true, periodKey: clock.date, start: clock.date, end: clock.date, label: clock.date };
  }
  if (kind === 'WEEKLY' && settings.weeklyEnabled && clock.weekday === settings.weekStartsOn && minutes >= settings.weeklySendHour * 60 + settings.weeklySendMinute) {
    const range = weekContaining(addDays(clock.date, -1), settings.weekStartsOn);
    return { due: true, periodKey: range.start, start: range.start, end: range.end, label: `${range.start} to ${range.end}` };
  }
  if (kind === 'MONTHLY' && settings.monthlyEnabled && clock.date.endsWith('-01') && minutes >= settings.monthlySendHour * 60 + settings.monthlySendMinute) {
    const month = previousMonth(clock.date);
    return { due: true, periodKey: month.key, start: month.start, end: month.end, label: month.label };
  }
  return { due: false, periodKey: '', start: '', end: '', label: '' };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function trimMoney(value: number) {
  const rounded = roundMoney(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char));
}
