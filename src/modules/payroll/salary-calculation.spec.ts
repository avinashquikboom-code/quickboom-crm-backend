import {
  agreedMonthlySalary,
  countPayableAttendance,
  eligibleTargetSalary,
  lateMarkDeduction,
  calculatePerMinuteLateDeduction,
  evaluateLatePunch,
  lopDeduction,
  settleMonthlySalary,
} from './salary-calculation';

describe('fixed monthly salary', () => {
  const salary = { basicSalary: 15000, grossSalary: 15000 };
  const full = (month: number) => countPayableAttendance({
    year: 2026,
    month,
    joiningDate: '2020-01-01T00:00:00.000Z',
    workingDaysPerWeek: 5,
    attendance: workdays(2026, month).map((date) => ({ date, status: 'PRESENT' })),
  });

  it('pays the full agreed salary in February, April, and May', () => {
    for (const month of [2, 4, 5]) {
      const attendance = full(month);
      expect(attendance.lopDays).toBe(0);
      expect(settleMonthlySalary({ monthlySalary: agreedMonthlySalary(salary), lopDays: attendance.lopDays }).net).toBe(15000);
    }
  });

  it('applies the configured late-mark percent once per late day and ignores a zero policy', () => {
    expect(lateMarkDeduction(18000, 1, 25)).toBe(150);
    expect(lateMarkDeduction(18000, 2, 25)).toBe(300);
    expect(lateMarkDeduction(18000, 4, 0)).toBe(0);
  });

  it('deducts two unpaid days with a 30-day divisor', () => {
    const attendance = countPayableAttendance({
      year: 2026,
      month: 5,
      joiningDate: '2020-01-01T00:00:00.000Z',
      workingDaysPerWeek: 5,
      attendance: workdays(2026, 5).map((date, index) => ({ date, status: index < 2 ? 'ABSENT' : 'PRESENT' })),
    });
    expect(attendance.lopDays).toBe(2);
    expect(lopDeduction(15000, 2)).toBe(1000);
    expect(settleMonthlySalary({ monthlySalary: 15000, lopDays: 2 }).net).toBe(14000);
  });

  it('does not deduct approved paid leave, weekly offs, or holidays', () => {
    const days = workdays(2026, 5);
    const attendance = countPayableAttendance({
      year: 2026,
      month: 5,
      joiningDate: '2020-01-01T00:00:00.000Z',
      workingDaysPerWeek: 5,
      attendance: [
        { date: days[0], status: 'HOLIDAY' },
        ...days.slice(1).map((date) => ({ date, status: 'PRESENT' })),
      ],
      leaves: [{ from: days[1], to: days[1], unpaid: false }],
    });
    expect(attendance.lopDays).toBe(0);
    expect(attendance.paidLeaveDays).toBe(1);
    expect(attendance.holidayDays).toBe(1);
  });

  it('pays the full salary at the target and the lower salary below it', () => {
    expect(eligibleTargetSalary({ achieved: 30000, target: 30000, fullSalary: 18000, belowTargetSalary: 12000 }).eligibleSalary).toBe(18000);
    expect(eligibleTargetSalary({ achieved: 45000, target: 30000, fullSalary: 18000, belowTargetSalary: 12000 }).targetStatus).toBe('ACHIEVED');
    const missed = eligibleTargetSalary({ achieved: 29999, target: 30000, fullSalary: 18000, belowTargetSalary: 12000 });
    expect(missed.eligibleSalary).toBe(12000);
    expect(missed.targetStatus).toBe('NOT_ACHIEVED');
    expect(settleMonthlySalary({ monthlySalary: missed.eligibleSalary, lopDays: 0 }).net).toBe(12000);
    expect(settleMonthlySalary({ monthlySalary: 18000, lopDays: 2 }).net).toBe(16800);
  });

  it('prorates only days before joining and does not shorten February', () => {
    const joined = countPayableAttendance({
      year: 2026,
      month: 5,
      joiningDate: '2026-05-03T00:00:00.000Z',
      workingDaysPerWeek: 7,
      attendance: [],
    });
    expect(joined.nonServiceDays).toBe(2);
    expect(joined.lopDays).toBeGreaterThanOrEqual(2);
    const february = countPayableAttendance({
      year: 2026,
      month: 2,
      joiningDate: '2026-02-01T00:00:00.000Z',
      workingDaysPerWeek: 7,
      attendance: workdays(2026, 2, 7).map((date) => ({ date, status: 'PRESENT' })),
    });
    expect(february.nonServiceDays).toBe(0);
    expect(february.lopDays).toBe(0);
  });

  describe('calculatePerMinuteLateDeduction', () => {
    const shift = {
      startTime: '10:00 AM',
      endTime: '07:00 PM',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    };

    it('uses the IST attendance day when midnight is on the previous UTC day', () => {
      const result = calculatePerMinuteLateDeduction({
        shift, policy: { isEnabled: true, deductionRatePerMin: 1 },
        attendances: [{ id: 1, date: '2026-08-02T18:30:00.000Z',
          punchIn: '2026-08-03T04:45:00.000Z', lateMinutes: 15, lateDeduction: 15, lateRatePerMinute: 1 }],
      });
      expect(result.lateDaysCount).toBe(1);
      expect(result.totalLateDeduction).toBe(15);
      expect(result.breakdown[0].date).toBe('2026-08-03');
    });

    it('calculates default ₹1/minute deduction for late check-in on scheduled workday', () => {
      // 2026-08-03 is a Monday. 10:05 AM check-in (in UTC+05:30: 04:35 UTC)
      const res = calculatePerMinuteLateDeduction({
        shift,
        policy: { isEnabled: true, deductionRatePerMin: 1.0, gracePeriodMinutes: 0 },
        attendances: [
          {
            date: '2026-08-03T00:00:00.000Z',
            punchIn: '2026-08-03T04:35:00.000Z', // 10:05 IST
            isLate: true,
          },
        ],
      });

      expect(res.isEnabled).toBe(true);
      expect(res.lateDaysCount).toBe(1);
      expect(res.totalLateMinutes).toBe(5);
      expect(res.totalLateDeduction).toBe(5);
      expect(res.lateRatePerMinute).toBe(1.0);
    });

    it('applies a configured grace period', () => {
      // 10:08 AM check-in remains 8 minutes late despite old grace settings.
      const res = calculatePerMinuteLateDeduction({
        shift,
        policy: { isEnabled: true, deductionRatePerMin: 1.0, gracePeriodMinutes: 10 },
        attendances: [
          {
            date: '2026-08-03T00:00:00.000Z',
            punchIn: '2026-08-03T04:38:00.000Z', // 10:08 IST
          },
        ],
      });

      expect(res.lateDaysCount).toBe(0);
      expect(res.totalLateMinutes).toBe(0);
      expect(res.totalLateDeduction).toBe(0);
    });

    it('recalculates corrected punch times using the recorded rate', () => {
      const res = calculatePerMinuteLateDeduction({
        shift,
        policy: { isEnabled: true, deductionRatePerMin: 2.0, gracePeriodMinutes: 0 },
        attendances: [
          {
            date: '2026-08-03T00:00:00.000Z',
            punchIn: '2026-08-03T04:35:00.000Z',
            lateMinutes: 15,
            lateDeduction: 15,
            lateRatePerMinute: 1,
          },
        ],
      });

      expect(res.lateDaysCount).toBe(1);
      expect(res.totalLateMinutes).toBe(5);
      expect(res.totalLateDeduction).toBe(5);
      expect(res.breakdown[0]?.ratePerMinute).toBe(1);
    });

    it('deducts minutes after configured grace', () => {
      // 10:25 AM check-in is 25 minutes late.
      const res = calculatePerMinuteLateDeduction({
        shift,
        policy: { isEnabled: true, deductionRatePerMin: 1.0, gracePeriodMinutes: 10 },
        attendances: [
          {
            date: '2026-08-03T00:00:00.000Z',
            punchIn: '2026-08-03T04:55:00.000Z', // 10:25 IST
          },
        ],
      });

      expect(res.lateDaysCount).toBe(1);
      expect(res.totalLateMinutes).toBe(15);
      expect(res.totalLateDeduction).toBe(15);
    });

    it('excludes weekly offs, holidays, and approved leaves', () => {
      // 2026-08-09 is Sunday (weekly off)
      const resWeeklyOff = calculatePerMinuteLateDeduction({
        shift,
        policy: { isEnabled: true, deductionRatePerMin: 1.0 },
        attendances: [
          {
            date: '2026-08-09T00:00:00.000Z',
            punchIn: '2026-08-09T04:45:00.000Z', // 10:15 IST on Sunday
          },
        ],
      });
      expect(resWeeklyOff.totalLateDeduction).toBe(0);

      // Holiday on Monday 2026-08-03
      const resHoliday = calculatePerMinuteLateDeduction({
        shift,
        policy: { isEnabled: true, deductionRatePerMin: 1.0 },
        holidays: [{ date: '2026-08-03' }],
        attendances: [
          {
            date: '2026-08-03T00:00:00.000Z',
            punchIn: '2026-08-03T04:45:00.000Z',
          },
        ],
      });
      expect(resHoliday.totalLateDeduction).toBe(0);

      // Approved leave on Monday 2026-08-03
      const resLeave = calculatePerMinuteLateDeduction({
        shift,
        policy: { isEnabled: true, deductionRatePerMin: 1.0 },
        leaves: [{ from: '2026-08-03T00:00:00.000Z', to: '2026-08-03T23:59:59.000Z' }],
        attendances: [
          {
            date: '2026-08-03T00:00:00.000Z',
            punchIn: '2026-08-03T04:45:00.000Z',
          },
        ],
      });
      expect(resLeave.totalLateDeduction).toBe(0);
    });

    it('uses the shift start date for an after-midnight overnight punch', () => {
      const overnightShift = { startTime: '22:00', endTime: '06:00', isNightShift: true, workingDays: ['Monday'] };
      const attendance = [{ date: '2026-08-04T00:00:00Z', punchIn: '2026-08-03T18:45:00Z' }]; // Tuesday 00:15 IST
      const result = calculatePerMinuteLateDeduction({ shift: overnightShift, attendances: attendance });
      expect(result.totalLateMinutes).toBe(135);
      const holiday = calculatePerMinuteLateDeduction({ shift: overnightShift, attendances: attendance, holidays: [{ date: '2026-08-03' }] });
      expect(holiday.totalLateDeduction).toBe(0);
    });

    it('includes attendance on the date a policy becomes effective', () => {
      const res = calculatePerMinuteLateDeduction({
        shift,
        policy: { isEnabled: true, deductionRatePerMin: 2, effectiveFrom: new Date('2026-08-03T10:00:00Z') },
        attendances: [{ date: '2026-08-03T00:00:00Z', punchIn: '2026-08-03T04:35:00Z' }],
      });
      expect(res.totalLateDeduction).toBe(10);
    });

    it('enforces maxDailyDeduction and maxMonthlyDeduction caps', () => {
      // 120 minutes late on Monday with maxDailyDeduction = ₹50
      const res = calculatePerMinuteLateDeduction({
        shift,
        policy: {
          isEnabled: true,
          deductionRatePerMin: 1.0,
          gracePeriodMinutes: 0,
          maxDailyDeduction: 50,
          maxMonthlyDeduction: 100,
        },
        attendances: [
          {
            date: '2026-08-03T00:00:00.000Z',
            punchIn: '2026-08-03T06:30:00.000Z', // 12:00 IST (120 mins late)
          },
          {
            date: '2026-08-04T00:00:00.000Z',
            punchIn: '2026-08-04T06:30:00.000Z', // 12:00 IST (120 mins late)
          },
          {
            date: '2026-08-05T00:00:00.000Z',
            punchIn: '2026-08-05T06:30:00.000Z', // 12:00 IST (120 mins late)
          },
        ],
      });

      // Day 1 cap: ₹50, Day 2 cap: ₹50, Day 3 cap: ₹50 -> sum 150 -> monthly cap 100
      expect(res.lateDaysCount).toBe(3);
      expect(res.totalLateDeduction).toBe(100);
      expect(res.breakdown[0].deduction).toBe(50);
    });

    it('returns 0 deduction when late mark policy is disabled', () => {
      const res = calculatePerMinuteLateDeduction({
        shift,
        policy: { isEnabled: false, deductionRatePerMin: 2.0 },
        attendances: [
          {
            date: '2026-08-03T00:00:00.000Z',
            punchIn: '2026-08-03T05:00:00.000Z',
          },
        ],
      });
      expect(res.isEnabled).toBe(false);
      expect(res.totalLateDeduction).toBe(0);
    });
  });
});

describe('evaluateLatePunch', () => {
  const policy = { isEnabled: true, deductionRatePerMin: 2, gracePeriodMinutes: 0, currency: 'INR' };
  const shift = { startTime: '10:00 AM', endTime: '07:00 PM', workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] };

  it('applies the zero-grace ₹1/minute rule for exact, one-minute, two-minute, and fifteen-minute punches', () => {
    const oneRupeePolicy = { isEnabled: true, deductionRatePerMin: 1, gracePeriodMinutes: 0, currency: 'INR' };
    const cases = [
      ['2026-08-03T04:30:00.000Z', 0, 0], // 10:00 IST
      ['2026-08-03T04:31:00.000Z', 1, 1], // 10:01 IST
      ['2026-08-03T04:32:00.000Z', 2, 2], // 10:02 IST
      ['2026-08-03T04:45:00.000Z', 15, 15], // 10:15 IST
    ] as const;
    for (const [punchIn, minutes, rupees] of cases) {
      const result = evaluateLatePunch({ punchIn, shift, policy: oneRupeePolicy });
      expect(result.lateMinutes).toBe(minutes);
      expect(result.deduction).toBe(rupees);
      expect(result.ratePerMinute).toBe(1);
    }
  });

  it('calculates against a different assigned shift and skips missing assignments', () => {
    const oneRupeePolicy = { isEnabled: true, deductionRatePerMin: 1, currency: 'INR' };
    const otherShift = evaluateLatePunch({
      punchIn: '2026-08-03T04:15:00.000Z', // 09:45 IST
      shift: { ...shift, startTime: '09:30 AM' },
      policy: oneRupeePolicy,
    });
    expect(otherShift.lateMinutes).toBe(15); // Punch is 09:45, assigned start is 09:30.
    expect(otherShift.deduction).toBe(15);

    const noShift = evaluateLatePunch({ punchIn: '2026-08-03T04:45:00.000Z', shift: null, policy: oneRupeePolicy });
    expect(noShift.applicable).toBe(false);
    expect(noShift.lateMinutes).toBe(0);
    expect(noShift.deduction).toBe(0);
  });

  it('does not deduct an on-time punch or a punch within grace', () => {
    const onTime = evaluateLatePunch({
      punchIn: '2026-08-03T04:30:00.000Z',
      shift,
      policy,
    });
    expect(onTime.lateMinutes).toBe(0);
    expect(onTime.deduction).toBe(0);
    expect(onTime.isLate).toBe(false);

    const withinGrace = evaluateLatePunch({
      punchIn: '2026-08-03T04:35:00.000Z',
      shift,
      policy: { ...policy, gracePeriodMinutes: 10 },
    });
    expect(withinGrace.lateMinutes).toBe(0);
    expect(withinGrace.deduction).toBe(0);
  });

  it('uses the configured rate for 5, 15 and 30 late minutes', () => {
    for (const [iso, minutes] of [
      ['2026-08-03T04:31:00.000Z', 1],
      ['2026-08-03T04:35:00.000Z', 5],
      ['2026-08-03T04:45:00.000Z', 15],
      ['2026-08-03T05:00:00.000Z', 30],
    ] as const) {
      const result = evaluateLatePunch({ punchIn: iso, shift, policy });
      expect(result.lateMinutes).toBe(minutes);
      expect(result.deduction).toBe(minutes * 2);
      expect(result.ratePerMinute).toBe(2);
    }
  });

  it('applies shift grace', () => {
    const configuredShift = { ...shift, gracePeriodMinutes: 15 };
    const exact = evaluateLatePunch({ punchIn: '2026-08-03T04:45:00Z', shift: configuredShift });
    const after = evaluateLatePunch({ punchIn: '2026-08-03T04:46:00Z', shift: configuredShift });
    expect(exact.lateMinutes).toBe(0);
    expect(after.lateMinutes).toBe(1);
  });

  it('tracks lateness even when the monetary deduction is disabled', () => {
    const result = evaluateLatePunch({
      punchIn: '2026-08-03T04:45:00Z', shift, policy: { ...policy, isEnabled: false },
    });
    expect(result.isLate).toBe(true);
    expect(result.lateMinutes).toBe(15);
    expect(result.deduction).toBe(0);
  });

  it('ignores weekly offs, holidays, approved leave, and a disabled policy', () => {
    const sunday = evaluateLatePunch({ punchIn: '2026-08-09T04:45:00.000Z', shift, policy });
    expect(sunday.reason).toBe('weekly_off');
    expect(sunday.deduction).toBe(0);
    const holiday = evaluateLatePunch({ punchIn: '2026-08-03T04:45:00.000Z', shift, policy, isHoliday: true });
    expect(holiday.deduction).toBe(0);
    const leave = evaluateLatePunch({ punchIn: '2026-08-03T04:45:00.000Z', shift, policy, isApprovedLeave: true });
    expect(leave.deduction).toBe(0);
    const disabled = evaluateLatePunch({
      punchIn: '2026-08-03T04:45:00.000Z',
      shift,
      policy: { ...policy, isEnabled: false },
    });
    expect(disabled.applicable).toBe(false);
    expect(disabled.deduction).toBe(0);
  });

  it('uses the employee assigned shift and handles an overnight shift', () => {
    const otherShift = evaluateLatePunch({
      punchIn: '2026-08-03T03:50:00.000Z',
      shift: { ...shift, startTime: '09:00', endTime: '18:00' },
      policy: { ...policy, deductionRatePerMin: 1 },
    });
    expect(otherShift.lateMinutes).toBe(20);
    expect(otherShift.deduction).toBe(20);

    const overnight = evaluateLatePunch({
      punchIn: '2026-08-03T16:45:00.000Z',
      shift: { startTime: '22:00', endTime: '06:00', isNightShift: true, workingDays: shift.workingDays },
      policy: { ...policy, deductionRatePerMin: 1 },
    });
    expect(overnight.lateMinutes).toBe(15);
    expect(overnight.deduction).toBe(15);
  });

  it('does not deduct when no shift is assigned', () => {
    const result = evaluateLatePunch({ punchIn: '2026-08-03T04:45:00.000Z', shift: null, policy });
    expect(result.applicable).toBe(false);
    expect(result.deduction).toBe(0);
  });
});

function workdays(year: number, month: number, perWeek = 5) {
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates: Date[] = [];
  for (let day = 1; day <= total; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekDay = date.getUTCDay();
    const scheduled = perWeek >= 7 || (perWeek === 6 ? weekDay >= 1 && weekDay <= 6 : weekDay >= 1 && weekDay <= 5);
    if (scheduled) dates.push(date);
  }
  return dates;
}
