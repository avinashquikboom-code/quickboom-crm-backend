import { agreedMonthlySalary, countPayableAttendance, eligibleTargetSalary, lopDeduction, settleMonthlySalary } from './salary-calculation';

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
