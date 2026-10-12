import {
  buildPayrollAttendanceSummary,
  buildSalaryBreakdown,
  calculateOvertimeMinutes,
  formatOvertimeMinutes,
  formatSummaryDays,
} from './salary-slip-summary';

describe('Salary Slip Attendance Summary & Calculation Rules', () => {
  describe('formatOvertimeMinutes', () => {
    it('formats null/undefined/0 as "0h 00m"', () => {
      expect(formatOvertimeMinutes(null)).toBe('0h 00m');
      expect(formatOvertimeMinutes(undefined)).toBe('0h 00m');
      expect(formatOvertimeMinutes(0)).toBe('0h 00m');
    });

    it('formats minutes into "Xh Ym" properly', () => {
      expect(formatOvertimeMinutes(330)).toBe('5h 30m');
      expect(formatOvertimeMinutes(90)).toBe('1h 30m');
      expect(formatOvertimeMinutes(45)).toBe('0h 45m');
      expect(formatOvertimeMinutes(60)).toBe('1h 00m');
    });
  });

  describe('formatSummaryDays', () => {
    it('formats integers without decimal places', () => {
      expect(formatSummaryDays(26)).toBe('26');
      expect(formatSummaryDays(0)).toBe('0');
    });

    it('formats half days with 1 decimal place', () => {
      expect(formatSummaryDays(2.5)).toBe('2.5');
      expect(formatSummaryDays(0.5)).toBe('0.5');
    });
  });

  describe('calculateOvertimeMinutes', () => {
    it('calculates overtime beyond daily shift minutes for eligible employees', () => {
      const attendances = [
        { date: '2026-10-01', workingMinutes: 540 }, // 9h -> 1h (60m) overtime over 8h (480m)
        { date: '2026-10-02', workingMinutes: 600 }, // 10h -> 2h (120m) overtime
        { date: '2026-10-03', workingMinutes: 480 }, // 8h -> 0m overtime
      ];

      const ot = calculateOvertimeMinutes(attendances, {
        standardDailyMinutes: 480,
        eligible: true,
      });

      expect(ot).toBe(180); // 3h = 180m
    });

    it('returns 0 if employee is ineligible for overtime', () => {
      const attendances = [{ date: '2026-10-01', workingMinutes: 600 }];
      const ot = calculateOvertimeMinutes(attendances, {
        standardDailyMinutes: 480,
        eligible: false,
      });

      expect(ot).toBe(0);
    });

    it('ignores attendances prior to employee joining date for mid-month joiner', () => {
      const attendances = [
        { date: '2026-10-05', workingMinutes: 600 }, // before joining 2026-10-15
        { date: '2026-10-16', workingMinutes: 540 }, // 60m overtime after joining
      ];

      const ot = calculateOvertimeMinutes(attendances, {
        standardDailyMinutes: 480,
        eligible: true,
        employmentStartKey: '2026-10-15',
      });

      expect(ot).toBe(60);
    });
  });

  describe('buildPayrollAttendanceSummary', () => {
    it('extracts all 9 required attendance metrics from calculationSnapshot', () => {
      const item = {
        workingDays: 26,
        presentDays: 22,
        absentDays: 2,
        halfDays: 2,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        weeklyOffDays: 4,
        holidayDays: 1,
        calculationSnapshot: {
          attendanceSummary: {
            periodStart: '2026-10-01',
            periodEnd: '2026-10-31',
            calendarDays: 31,
            workingDays: 26,
            presentDays: 22,
            absentDays: 2,
            halfDays: 2,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            weeklyOffDays: 4,
            holidayDays: 1,
            overtimeMinutes: 330,
          },
        },
      };

      const summary = buildPayrollAttendanceSummary(item, { year: 2026, month: 10 });
      expect(summary).not.toBeNull();
      expect(summary?.workingDays).toBe(26);
      expect(summary?.presentDays).toBe(22);
      expect(summary?.absentDays).toBe(2);
      expect(summary?.halfDays).toBe(2);
      expect(summary?.paidLeaveDays).toBe(0);
      expect(summary?.unpaidLeaveDays).toBe(0);
      expect(summary?.weeklyOffDays).toBe(4);
      expect(summary?.holidayDays).toBe(1);
      expect(summary?.overtimeMinutes).toBe(330);
      expect(summary?.overtimeLabel).toBe('5h 30m');
      expect(summary?.source).toBe('PAYROLL_SNAPSHOT');
    });

    it('falls back gracefully to stored payroll columns if no snapshot exists', () => {
      const item = {
        workingDays: 24,
        presentDays: 20,
        absentDays: 4,
        halfDays: 0,
        paidLeaveDays: 1,
        unpaidLeaveDays: 1,
        weeklyOffDays: 4,
        holidayDays: 2,
      };

      const summary = buildPayrollAttendanceSummary(item, { year: 2026, month: 10 });
      expect(summary).not.toBeNull();
      expect(summary?.workingDays).toBe(24);
      expect(summary?.presentDays).toBe(20);
      expect(summary?.absentDays).toBe(4);
      expect(summary?.halfDays).toBe(0);
      expect(summary?.paidLeaveDays).toBe(1);
      expect(summary?.unpaidLeaveDays).toBe(1);
      expect(summary?.weeklyOffDays).toBe(4);
      expect(summary?.holidayDays).toBe(2);
      expect(summary?.overtimeLabel).toBe('0h 00m');
      expect(summary?.source).toBe('PAYROLL_RECORD');
    });
  });

  describe('buildSalaryBreakdown', () => {
    it('maintains breakdown reconciliation with gross and net totals', () => {
      const slip = {
        basicSalary: 30000,
        hra: 12000,
        allowances: 3000,
        specialAllowance: 2000,
        pf: 3600,
        esi: 350,
        professionalTax: 200,
        tds: 1500,
        grossSalary: 47000,
        totalDeductions: 5650,
        netSalary: 41350,
      };

      const breakdown = buildSalaryBreakdown(slip);
      expect(breakdown.isReconciled).toBe(true);
      expect(breakdown.grossEarnings).toBe(47000);
      expect(breakdown.totalDeductions).toBe(5650);
      expect(breakdown.netSalary).toBe(41350);
    });
  });
});


describe('Legacy salary-slip snapshot mapping', () => {
  it('uses snapshot payable days instead of a default-zero payroll column', () => {
    expect(buildPayrollAttendanceSummary({ workingDays: 30, presentDays: 20, payableDays: 0, calculationSnapshot: { payableDays: 22 } })?.payableDays).toBe(22);
    expect(buildPayrollAttendanceSummary({ workingDays: 30, payableDays: 0, calculationSnapshot: { payableDays: 22, attendanceSummary: { workingDays: 30 } } })?.payableDays).toBe(22);
  });
  it('preserves an explicit zero in the attendance snapshot', () => {
    expect(buildPayrollAttendanceSummary({ workingDays: 30, payableDays: 22, calculationSnapshot: { payableDays: 22, attendanceSummary: { payableDays: 0 } } })?.payableDays).toBe(0);
  });
  it('does not assume all working days are payable when payable days are missing', () => {
    expect(buildPayrollAttendanceSummary({ workingDays: 30, presentDays: 0 })?.payableDays).toBe(0);
  });
  it('distinguishes unavailable configured salary from a recorded zero', () => {
    expect(buildSalaryBreakdown({ grossSalary: 59000 }).monthlySalaryRecorded).toBe(false);
    expect(buildSalaryBreakdown({ monthlySalary: 0, grossSalary: 59000 }).monthlySalaryRecorded).toBe(true);
  });
});
