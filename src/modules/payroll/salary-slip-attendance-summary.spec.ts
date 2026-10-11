import {
  buildPayrollAttendanceSummary,
  buildSalaryBreakdown,
  drawAttendanceSummarySection,
} from './salary-slip-summary';
import { classifyPayrollDays, prorateFixedDivisor } from './payroll-attendance';

describe('Salary Slip Attendance Summary & Extra Working Verification', () => {
  describe('buildPayrollAttendanceSummary extraction', () => {
    it('extracts all 11 attendance fields, extraWorkingDates, and payableDays from calculationSnapshot', () => {
      const item = {
        workingDays: 26,
        presentDays: 22,
        absentDays: 2,
        halfDays: 2,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        weeklyOffDays: 4,
        holidayDays: 1,
        payableDays: 29.5,
        calculationSnapshot: {
          extraWorkingDays: 1.5,
          extraWorkingDates: ['2026-10-11', '2026-10-18'],
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
            extraWorkingDays: 1.5,
            extraWorkingDates: ['2026-10-11', '2026-10-18'],
            payableDays: 29.5,
            overtimeMinutes: 180,
            overtimeLabel: '3h 00m',
          },
        },
      };

      const summary = buildPayrollAttendanceSummary(item, { year: 2026, month: 10 });
      expect(summary).not.toBeNull();
      expect(summary?.calendarDays).toBe(31);
      expect(summary?.workingDays).toBe(26);
      expect(summary?.presentDays).toBe(22);
      expect(summary?.halfDays).toBe(2);
      expect(summary?.absentDays).toBe(2);
      expect(summary?.paidLeaveDays).toBe(0);
      expect(summary?.unpaidLeaveDays).toBe(0);
      expect(summary?.weeklyOffDays).toBe(4);
      expect(summary?.holidayDays).toBe(1);
      expect(summary?.extraWorkingDays).toBe(1.5);
      expect(summary?.extraWorkingDates).toEqual(['2026-10-11', '2026-10-18']);
      expect(summary?.payableDays).toBe(29.5);
      expect(summary?.overtimeMinutes).toBe(180);
      expect(summary?.overtimeLabel).toBe('3h 00m');
      expect(summary?.source).toBe('PAYROLL_SNAPSHOT');
    });

    it('falls back cleanly to stored payroll item fields for legacy records', () => {
      const item = {
        workingDays: 25,
        presentDays: 23,
        absentDays: 2,
        halfDays: 0,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        weeklyOffDays: 4,
        holidayDays: 1,
        payableDays: 28,
      };

      const summary = buildPayrollAttendanceSummary(item, { year: 2026, month: 10 });
      expect(summary).not.toBeNull();
      expect(summary?.calendarDays).toBe(31);
      expect(summary?.workingDays).toBe(25);
      expect(summary?.presentDays).toBe(23);
      expect(summary?.absentDays).toBe(2);
      expect(summary?.weeklyOffDays).toBe(4);
      expect(summary?.holidayDays).toBe(1);
      expect(summary?.extraWorkingDays).toBe(0);
      expect(summary?.payableDays).toBe(28);
      expect(summary?.source).toBe('PAYROLL_RECORD');
    });
  });

  describe('classifyPayrollDays: attendance breakdown & extra working rules', () => {
    // 31 days in October 2026
    const makeDays = () => {
      const days: Date[] = [];
      for (let d = 1; d <= 31; d++) {
        days.push(new Date(Date.UTC(2026, 9, d, 0, 0, 0, 0)));
      }
      return days;
    };

    // Sundays in Oct 2026: Oct 4, 11, 18, 25 (4 weekly offs)
    const isSundayOff = (d: Date) => d.getUTCDay() === 0;

    it('reconciles scheduled working days, absences, and leaves without double counting', () => {
      const days = makeDays();
      // Oct 2 is Gandhi Jayanti (holiday)
      const holidayKeys = new Set(['2026-10-02']);

      // 4 Sundays + 1 Holiday = 5 off days. Scheduled working days = 26.
      // Employee attendances: punched present on 20 days, half day on 2 days, paid leave on 2 days, unpaid leave on 1 day.
      // Remaining = 26 - (20 + 2 + 2 + 1) = 1 absent day.
      const attendances: any[] = [];
      // Present on 20 non-Sunday days
      let presentCount = 0;
      for (let d = 3; d <= 26; d++) {
        const dateStr = `2026-10-${String(d).padStart(2, '0')}`;
        const dayObj = new Date(Date.UTC(2026, 9, d, 0, 0, 0, 0));
        if (dayObj.getUTCDay() === 0) continue;
        if (presentCount < 20) {
          attendances.push({ date: new Date(dateStr), punchIn: new Date(), status: 'PRESENT' });
          presentCount++;
        }
      }
      // Half days on Oct 27, 28
      attendances.push({ date: new Date('2026-10-27T00:00:00Z'), punchIn: new Date(), status: 'HALF_DAY' });
      attendances.push({ date: new Date('2026-10-28T00:00:00Z'), punchIn: new Date(), status: 'HALF_DAY' });

      // Leaves: Paid leave on Oct 29, 30; Unpaid leave on Oct 31
      const leaves = [
        {
          fromDate: new Date('2026-10-29T00:00:00Z'),
          toDate: new Date('2026-10-30T00:00:00Z'),
          leaveType: { code: 'CL', name: 'Casual Leave' },
        },
        {
          fromDate: new Date('2026-10-31T00:00:00Z'),
          toDate: new Date('2026-10-31T00:00:00Z'),
          leaveType: { code: 'LOP', name: 'Loss of Pay' },
        },
      ];

      const counts = classifyPayrollDays({
        days,
        joiningKey: null,
        isWeeklyOff: isSundayOff,
        attendances,
        leaves,
        holidayKeys,
        halfDayDeductionPct: 50,
        absenceDeductionPct: 100,
      });

      expect(counts.employedDays).toBe(31);
      expect(counts.weeklyOffDays).toBe(4);
      expect(counts.holidayDays).toBe(1);
      expect(counts.scheduledWorkingDays).toBe(26);
      expect(counts.presentDays).toBe(20);
      expect(counts.halfDays).toBe(2);
      expect(counts.paidLeaveDays).toBe(2);
      expect(counts.unpaidLeaveDays).toBe(1);
      expect(counts.absentDays).toBe(1);

      // Reconciliation: present + half + absent + paidLeave + unpaidLeave = scheduledWorkingDays
      const workingSum = counts.presentDays + counts.halfDays + counts.absentDays + counts.paidLeaveDays + counts.unpaidLeaveDays;
      expect(workingSum).toBe(counts.scheduledWorkingDays);

      // Calendar days: scheduledWorkingDays + weeklyOffDays + holidayDays = calendarDays (31)
      expect(counts.scheduledWorkingDays + counts.weeklyOffDays + counts.holidayDays).toBe(31);
    });

    it('does not count weekly offs or holidays as absences when there is no punch-in', () => {
      const days = makeDays();
      const holidayKeys = new Set(['2026-10-02']);
      // Zero punches for the entire month
      const counts = classifyPayrollDays({
        days,
        joiningKey: null,
        isWeeklyOff: isSundayOff,
        attendances: [],
        leaves: [],
        holidayKeys,
        halfDayDeductionPct: 50,
        absenceDeductionPct: 100,
      });

      // 4 weekly offs and 1 holiday are counted as weeklyOffDays and holidayDays, NOT absentDays
      expect(counts.weeklyOffDays).toBe(4);
      expect(counts.holidayDays).toBe(1);
      expect(counts.scheduledWorkingDays).toBe(26);
      expect(counts.absentDays).toBe(26); // only the scheduled working days count as absent
    });

    it('counts approved extra working on weekly off and holiday separately without double-counting', () => {
      const days = makeDays();
      const holidayKeys = new Set(['2026-10-02']); // Friday Gandhi Jayanti

      // Employee punches in on Sunday Oct 11 (weekly off) and Friday Oct 2 (holiday)
      const attendances = [
        { date: new Date('2026-10-02T04:30:00Z'), punchIn: new Date(), status: 'PRESENT' },
        { date: new Date('2026-10-11T04:30:00Z'), punchIn: new Date(), status: 'PRESENT' },
      ];

      const counts = classifyPayrollDays({
        days,
        joiningKey: null,
        isWeeklyOff: isSundayOff,
        attendances,
        leaves: [],
        holidayKeys,
        remoteRequests: [
          { fromDate: new Date('2026-10-02'), toDate: new Date('2026-10-02'), status: 'APPROVED' },
          { fromDate: new Date('2026-10-11'), toDate: new Date('2026-10-11'), status: 'APPROVED' },
        ],
        halfDayDeductionPct: 50,
        absenceDeductionPct: 100,
      });

      // Weekly offs and holidays are preserved
      expect(counts.weeklyOffDays).toBe(4);
      expect(counts.holidayDays).toBe(1);
      expect(counts.scheduledWorkingDays).toBe(26);

      // Approved extra working days count separately
      expect(counts.extraWorkingDays).toBe(2.0);
      expect(counts.extraWorkingDates).toEqual(['2026-10-02', '2026-10-11']);
    });

    it('ignores pending or rejected extra working requests and does not count them as payable work', () => {
      const days = makeDays();
      const holidayKeys = new Set(['2026-10-02']);

      // Punches exist on Sunday Oct 11 and Sunday Oct 18, but one is pending and one is rejected
      const attendances = [
        { date: new Date('2026-10-11T04:30:00Z'), punchIn: new Date(), status: 'PRESENT' },
        { date: new Date('2026-10-18T04:30:00Z'), punchIn: new Date(), status: 'PRESENT' },
      ];

      const counts = classifyPayrollDays({
        days,
        joiningKey: null,
        isWeeklyOff: isSundayOff,
        attendances,
        leaves: [],
        holidayKeys,
        remoteRequests: [
          { fromDate: new Date('2026-10-11'), toDate: new Date('2026-10-11'), status: 'PENDING' },
          { fromDate: new Date('2026-10-18'), toDate: new Date('2026-10-18'), status: 'REJECTED' },
        ],
        halfDayDeductionPct: 50,
        absenceDeductionPct: 100,
      });

      // Pending and rejected requests MUST NOT be treated as approved payable work
      expect(counts.extraWorkingDays).toBe(0);
      expect(counts.extraWorkingDates).toEqual([]);
      expect(counts.weeklyOffDays).toBe(4);
    });

    it('properly distinguishes approved half-day extra working (0.5 day weight)', () => {
      const days = makeDays();
      const holidayKeys = new Set<string>();

      // Half-day punch on Sunday Oct 11
      const attendances = [
        { date: new Date('2026-10-11T04:30:00Z'), punchIn: new Date(), status: 'HALF_DAY' },
      ];

      const counts = classifyPayrollDays({
        days,
        joiningKey: null,
        isWeeklyOff: isSundayOff,
        attendances,
        leaves: [],
        holidayKeys,
        halfDayDeductionPct: 50,
        absenceDeductionPct: 100,
      });

      expect(counts.extraWorkingDays).toBe(0.5);
      expect(counts.extraWorkingDates).toEqual(['2026-10-11']);
    });
  });

  describe('buildSalaryBreakdown: display metrics & BPO commission rules', () => {
    it('displays extra-working compensation as a separate earnings component when non-zero', () => {
      const source = {
        basicSalary: 30000,
        hra: 12000,
        allowances: 3000,
        specialAllowance: 2000,
        extraWorkingPay: 2000,
        pf: 3500,
        professionalTax: 200,
        tds: 1300,
        grossSalary: 49000,
        totalDeductions: 5000,
        netSalary: 44000,
        monthlySalary: 47000,
        attendanceSalary: 47000,
      };

      const breakdown = buildSalaryBreakdown(source);
      const extraLine = breakdown.earnings.find((e) => e.key === 'extraWorkingPay');
      expect(extraLine).toBeDefined();
      expect(extraLine?.label).toBe('Extra Working Pay');
      expect(extraLine?.amount).toBe(2000);
      expect(breakdown.extraWorkingPay).toBe(2000);
      expect(breakdown.monthlySalary).toBe(47000);
      expect(breakdown.attendanceSalary).toBe(47000);
      expect(breakdown.isReconciled).toBe(true);
    });

    it('labels commission as "Approved BPO Commission" only for eligible BPO staff', () => {
      const bpoEmployeeSlip = {
        basicSalary: 20000,
        hra: 8000,
        allowances: 2000,
        commission: 5000,
        isBpo: true,
        grossSalary: 35000,
        totalDeductions: 3000,
        netSalary: 32000,
      };

      const bpoBreakdown = buildSalaryBreakdown(bpoEmployeeSlip);
      const bpoComm = bpoBreakdown.earnings.find((e) => e.key === 'commission');
      expect(bpoComm?.label).toBe('Approved BPO Commission');
      expect(bpoComm?.amount).toBe(5000);

      const nonBpoEmployeeSlip = {
        basicSalary: 40000,
        commission: 2000,
        isBpo: false,
        grossSalary: 42000,
        totalDeductions: 4000,
        netSalary: 38000,
      };

      const nonBpoBreakdown = buildSalaryBreakdown(nonBpoEmployeeSlip);
      const nonBpoComm = nonBpoBreakdown.earnings.find((e) => e.key === 'commission');
      expect(nonBpoComm?.label).toBe('Commission');
    });

    it('omits extra-working pay line when no extra work occurred', () => {
      const source = {
        basicSalary: 30000,
        hra: 12000,
        allowances: 3000,
        extraWorkingPay: 0,
        grossSalary: 45000,
        totalDeductions: 4000,
        netSalary: 41000,
      };

      const breakdown = buildSalaryBreakdown(source);
      const extraLine = breakdown.earnings.find((e) => e.key === 'extraWorkingPay');
      expect(extraLine).toBeUndefined();
    });
  });

  describe('prorateFixedDivisor: payroll reconciliation', () => {
    it('reconciles payable days and lop deductions without double-charging', () => {
      // 30 day divisor, 31 calendar days, fully employed, 2 LOP days
      const proration = prorateFixedDivisor({
        divisor: 30,
        calendarDays: 31,
        employedDays: 31,
        lopDays: 2,
      });

      expect(proration.baseUnits).toBe(30);
      expect(proration.payableUnits).toBe(28);
      expect(proration.factor).toBe(28 / 30);
    });
  });
});
