import { parseCalendarMonthYear } from './calendar-query.util';

describe('parseCalendarMonthYear', () => {
  it('parses month=10 and year=2026', () => {
    expect(parseCalendarMonthYear('10', '2026')).toEqual({ month: 10, year: 2026 });
  });

  it('parses month=2026-10', () => {
    expect(parseCalendarMonthYear('2026-10')).toEqual({ month: 10, year: 2026 });
  });

  it('rejects a year-month string parsed as a month number', () => {
    expect(parseCalendarMonthYear('2026-10', undefined).month).toBe(10);
    expect(parseCalendarMonthYear('2026')).toEqual({ month: undefined, year: undefined });
  });
});
