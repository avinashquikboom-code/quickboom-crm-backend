import { dueReport, keepLatestAttendance, summarizeLateMarks, weekContaining } from './late-mark-report.logic';

const row = (overrides: Record<string, unknown>) => ({
  id: 1,
  employeeId: 1,
  employeeCode: 'E1',
  employeeName: 'Employee A',
  department: 'Sales',
  shiftName: 'Day',
  shiftStart: '10:00 AM',
  shiftEnd: '07:00 PM',
  punchIn: '10:15',
  date: '2026-11-16',
  status: 'LATE',
  lateMinutes: 15,
  graceMinutes: 0,
  rate: 1,
  deduction: 15,
  ...overrides,
});

describe('late mark report summaries', () => {
  it('sums stored minutes and deductions without using a new rate', () => {
    const summary = summarizeLateMarks([
      row({ id: 1, lateMinutes: 15, rate: 1, deduction: 15 }),
      row({ id: 2, employeeId: 2, employeeCode: 'E2', employeeName: 'Employee B', lateMinutes: 10, rate: 2, deduction: 20, date: '2026-11-16' }),
      row({ id: 3, employeeId: 1, date: '2026-11-17', lateMinutes: 30, rate: 1, deduction: 30 }),
    ] as any);
    expect(summary.totalLateMarks).toBe(3);
    expect(summary.totalLateMinutes).toBe(55);
    expect(summary.totalDeduction).toBe(65);
    expect(summary.employeesAffected).toBe(2);
    expect(summary.byEmployee.find((item) => item.employeeId === 1)?.rateLabel).toBe('₹1/min');
    expect(summary.byEmployee.find((item) => item.employeeId === 2)?.totalDeduction).toBe(20);
  });

  it('keeps the latest attendance row for the same employee and date', () => {
    const kept = keepLatestAttendance([
      row({ id: 4, deduction: 10, lateMinutes: 10 }),
      row({ id: 9, deduction: 15, lateMinutes: 15 }),
    ] as any);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe(9);
    expect(summarizeLateMarks(kept as any).totalDeduction).toBe(15);
  });

  it('ignores rows with no stored late minutes or deduction', () => {
    const summary = summarizeLateMarks([row({ lateMinutes: 0, deduction: 0 })] as any);
    expect(summary.totalLateMarks).toBe(0);
    expect(summary.totalDeduction).toBe(0);
  });

  it('uses Monday-Sunday weeks and the previous period for scheduled mail', () => {
    expect(weekContaining('2026-11-16', 1)).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    const settings = {
      timezone: 'Asia/Kolkata',
      weekStartsOn: 1,
      dailyEnabled: true,
      weeklyEnabled: true,
      monthlyEnabled: true,
      dailySendHour: 23,
      dailySendMinute: 0,
      weeklySendHour: 9,
      weeklySendMinute: 0,
      monthlySendHour: 9,
      monthlySendMinute: 0,
    };
    const mondayMorning = new Date('2026-11-16T03:30:00.000Z');
    expect(dueReport(mondayMorning, settings, 'WEEKLY').label).toBe('2026-11-09 to 2026-11-15');
    expect(dueReport(mondayMorning, settings, 'DAILY').due).toBe(false);
    const lateNight = new Date('2026-11-16T17:30:00.000Z');
    expect(dueReport(lateNight, settings, 'DAILY').periodKey).toBe('2026-11-16');
    const monthOpen = new Date('2026-11-01T03:30:00.000Z');
    expect(dueReport(monthOpen, settings, 'MONTHLY').periodKey).toBe('2026-10');
    expect(dueReport(monthOpen, { ...settings, monthlyEnabled: false }, 'MONTHLY').due).toBe(false);
  });
});
