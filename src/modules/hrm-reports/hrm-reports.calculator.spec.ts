import { buildAttendanceReport } from './attendance-report.calculator';
import { isUnpaidLeave, leaveBalanceLine, overlapLeaveDays } from './leave-report.calculator';

describe('HRM attendance report', () => {
  const year = 2026;
  const month = 11;

  it('counts present, absent, half-day, late, holiday, weekly off and approved leave', () => {
    const report = buildAttendanceReport({
      year,
      month,
      joiningDate: new Date(2026, 10, 1),
      workingDaysPerWeek: 5,
      minWorkingHours: 8,
      holidays: [{ date: new Date(2026, 10, 4), name: 'Foundation Day' }],
      approvedLeaveDates: ['2026-11-03'],
      attendance: [
        { date: new Date(2026, 10, 2), punchIn: new Date('2026-11-02T09:00:00'), punchOut: new Date('2026-11-02T18:00:00'), workingHours: 8, status: 'PRESENT' },
        { date: new Date(2026, 10, 5), punchIn: new Date('2026-11-05T10:30:00'), punchOut: new Date('2026-11-05T18:30:00'), workingHours: 8, isLate: true, status: 'LATE' },
        { date: new Date(2026, 10, 6), punchIn: new Date('2026-11-06T09:00:00'), punchOut: new Date('2026-11-06T13:00:00'), workingHours: 4, status: 'HALF_DAY' },
        { date: new Date(2026, 10, 9), punchIn: new Date('2026-11-09T09:00:00'), punchOut: new Date('2026-11-09T16:00:00'), workingHours: 6, status: 'PRESENT' },
      ],
    });
    expect(report.summary.leaveDays).toBeGreaterThan(0);
    expect(report.summary.holidays).toBe(1);
    expect(report.summary.weeklyOffs).toBeGreaterThan(0);
    expect(report.summary.lateArrivals).toBe(1);
    expect(report.summary.halfDays).toBe(1);
    expect(report.summary.earlyDepartures).toBe(1);
    expect(report.days.find((day) => day.date === '2026-11-03')?.status).toBe('LEAVE');
    expect(report.days.find((day) => day.date === '2026-11-04')?.status).toBe('HOLIDAY');
  });

  it('does not mark days before joining as absent', () => {
    const report = buildAttendanceReport({
      year,
      month,
      joiningDate: new Date(2026, 10, 16),
      workingDaysPerWeek: 5,
      minWorkingHours: 8,
      holidays: [],
      approvedLeaveDates: [],
      attendance: [],
    });
    expect(report.days.find((day) => day.date === '2026-11-02')?.status).toBe('NOT_JOINED');
  });

  it('marks a missing punch separately from a full absence', () => {
    const report = buildAttendanceReport({
      year,
      month,
      joiningDate: new Date(2026, 10, 1),
      workingDaysPerWeek: 5,
      minWorkingHours: 8,
      holidays: [],
      approvedLeaveDates: [],
      attendance: [{ date: new Date(2026, 10, 2), punchIn: new Date('2026-11-02T09:00:00'), punchOut: null, workingHours: 0, status: 'PRESENT' }],
    });
    expect(report.days.find((day) => day.date === '2026-11-02')?.status).toBe('MISSING_PUNCH');
  });
});

describe('HRM leave balance', () => {
  it('keeps pending and rejected leave out of the closing balance', () => {
    const line = leaveBalanceLine({
      leaveType: 'Casual',
      allocated: 12,
      usedBeforeMonth: 2,
      credited: 1,
      carryForward: 3,
      carryAlreadyInOpening: true,
      taken: 2,
      adjustments: 0,
      expired: 1,
      unpaid: 4,
    });
    expect(line.carryForward).toBe(0);
    expect(line.opening).toBe(10);
    expect(line.closing).toBe(8);
    expect(line.unpaid).toBe(4);
  });

  it('counts a half-day request once and ignores dates outside the month', () => {
    expect(overlapLeaveDays({ fromDate: new Date(2026, 10, 30), toDate: new Date(2026, 11, 2), days: 0.5 }, new Date(2026, 10, 1), new Date(2026, 10, 30))).toBe(0.5);
    expect(overlapLeaveDays({ fromDate: new Date(2026, 9, 1), toDate: new Date(2026, 9, 2), days: 2 }, new Date(2026, 10, 1), new Date(2026, 10, 30))).toBe(0);
  });

  it('recognises unpaid leave without reducing paid closing balance', () => {
    expect(isUnpaidLeave('UL', 'Unpaid Leave')).toBe(true);
    const line = leaveBalanceLine({ leaveType: 'Unpaid', allocated: 0, usedBeforeMonth: 0, credited: 0, carryForward: 0, carryAlreadyInOpening: true, taken: 0, adjustments: 0, expired: 0, unpaid: 1 });
    expect(line.closing).toBe(0);
    expect(line.unpaid).toBe(1);
  });
});

describe('HRM salary report PDF generation', () => {
  it('renders a valid PDF buffer for monthly salary report', async () => {
    const { renderSalaryReportPdf } = await import('./salary-report.pdf');
    const pdfBuffer = await renderSalaryReportPdf({
      employee: {
        id: 1,
        code: 'EMP001',
        name: 'Avinash Magar',
        department: 'Engineering',
        designation: 'Senior Developer',
      },
      company: {
        name: 'QuickBoom CRM',
      },
      period: {
        year: 2026,
        month: 11,
        monthName: 'November',
        startDate: new Date('2026-11-01'),
        endDate: new Date('2026-11-30'),
        periodLabel: 'November 2026 (01 Nov - 30 Nov 2026)',
      },
      isProvisional: true,
      payrollStatus: 'PROVISIONAL',
      payrollId: null,
      attendance: {
        calendarDays: 30,
        scheduledDays: 22,
        presentDays: 20,
        absentDays: 2,
        halfDays: 0,
        paidLeaveDays: 2,
        unpaidLeaveDays: 0,
        weeklyOffDays: 8,
        holidayDays: 0,
        lateArrivals: 1,
        earlyDepartures: 0,
        totalWorkingHours: 160,
        totalBreakHours: 20,
        approvedOvertimeHours: 5,
      },
      earnings: {
        registeredSalary: 50000,
        basicSalary: 25000,
        hra: 15000,
        allowances: 10000,
        specialAllowance: 0,
        bonus: 0,
        commission: 0,
        overtime: 1500,
        reimbursement: 500,
        otherEarnings: 0,
        grossSalary: 52000,
      },
      deductions: {
        lopDays: 0,
        lopDeduction: 0,
        lateMarks: 1,
        lateDeductions: 0,
        pf: 1800,
        esi: 0,
        professionalTax: 200,
        tds: 0,
        loanDeduction: 0,
        otherDeductions: 0,
        totalDeductions: 2000,
      },
      netPayable: 50000,
      fileName: 'Salary_Summary_EMP001_November_2026.pdf',
      generatedAt: new Date(),
    });
    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.slice(0, 5).toString()).toBe('%PDF-');
  });
});
