import { overtimeAmount, overtimeWindow, hourlyRateFromSalary } from './overtime.calculator';

describe('overtime calculator', () => {
  it('calculates a two-hour regular overtime amount from the hourly rate and multiplier', () => {
    const hourly = hourlyRateFromSalary(48000, 30, 8);
    expect(hourly).toBe(200);
    expect(overtimeAmount(120, hourly, 1.5)).toBe(600);
  });

  it('treats an end time before the start time as an overnight shift', () => {
    const window = overtimeWindow('2026-11-09', '22:00', '01:00');
    expect(window.totalMinutes).toBe(180);
    expect(window.endAt.getTime()).toBeGreaterThan(window.startAt.getTime());
  });

  it('rejects a start time that is not a clock value', () => {
    expect(() => overtimeWindow('2026-11-09', 'evening', '20:00')).toThrow('HH:mm');
  });
});
