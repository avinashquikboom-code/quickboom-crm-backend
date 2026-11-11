import { BadRequestException } from '@nestjs/common';
import { BUSINESS_TIMEZONE } from '../../common/utils/timezone.util';

export function parseClock(value: string): { hours: number; minutes: number } {
  const match = String(value || '').trim().toUpperCase().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/);
  if (!match) throw new BadRequestException('Start and end times must use HH:mm or h:mm AM/PM.');
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (match[3] === 'PM' && hours < 12) hours += 12;
  if (match[3] === 'AM' && hours === 12) hours = 0;
  if (!match[3] && hours > 23) throw new BadRequestException('Start and end times must use HH:mm or h:mm AM/PM.');
  if (minutes > 59 || hours > 23) throw new BadRequestException('Start and end times must use HH:mm or h:mm AM/PM.');
  return { hours, minutes };
}

export function istDateTime(date: string, time: string): Date {
  const clock = parseClock(time);
  const stamp = `${date}T${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}:00`;
  const parsed = new Date(`${stamp}+05:30`);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Overtime date is invalid.');
  return parsed;
}

export function overtimeWindow(dateInput: string, startTime: string, endTime: string) {
  const date = String(dateInput).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Overtime date must be YYYY-MM-DD.');
  const startAt = istDateTime(date, startTime);
  let endAt = istDateTime(date, endTime);
  if (endAt.getTime() <= startAt.getTime()) {
    endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
  }
  const totalMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
  if (totalMinutes <= 0 || totalMinutes > 24 * 60) {
    throw new BadRequestException('Overtime duration must be greater than zero and within 24 hours.');
  }
  return { date, startAt, endAt, totalMinutes, timeZone: BUSINESS_TIMEZONE };
}

export function hourlyRateFromSalary(basicSalary: number, workingDaysPerMonth: number, shiftHours: number) {
  const days = workingDaysPerMonth > 0 ? workingDaysPerMonth : 30;
  const hours = shiftHours > 0 ? shiftHours : 8;
  if (!basicSalary || basicSalary <= 0) return 0;
  return basicSalary / (days * hours);
}

export function overtimeAmount(minutes: number, hourlyRate: number, multiplier: number) {
  const amount = (Number(minutes) / 60) * Number(hourlyRate) * Number(multiplier);
  return Math.round(amount * 100) / 100;
}

/** Payable time cannot exceed the admin-approved duration. */
export function payableOvertimeMinutes(actualMinutes: number, approvedMinutes: number) {
  const actual = Math.max(0, Math.round(Number(actualMinutes) || 0));
  const approved = Math.max(0, Math.round(Number(approvedMinutes) || 0));
  return Math.min(actual, approved);
}

export function rangesOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();
}

export function weekBounds(date: string) {
  const noon = istDateTime(date, '12:00');
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIMEZONE, weekday: 'short' }).format(noon);
  const index = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? 0;
  const mondayOffset = index === 0 ? -6 : 1 - index;
  const monday = new Date(noon.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  const start = istDateTime(monday.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE }), '00:00');
  const end = istDateTime(sunday.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE }), '23:59');
  return { start, end };
}
