import { AttendanceStatus } from '@prisma/client';
import {
  computeShiftHalfDayBreakdown,
  validateHalfDayLeaveApplication,
} from './half-day-leave.util';
import { classifyPunchOut } from '../attendance/attendance-classification';
import {
  calculatePerMinuteLateDeduction,
  countPayableAttendance,
  evaluateLatePunch,
} from '../payroll/salary-calculation';

describe('Half-Day Leave Management System', () => {
  const dayShift = {
    id: 1,
    name: 'General Day Shift',
    startTime: '09:30 AM',
    endTime: '06:30 PM',
    breakDurationMinutes: 60,
    isNightShift: false,
  };

  const nightShift = {
    id: 2,
    name: 'Night Shift',
    startTime: '10:00 PM',
    endTime: '06:00 AM',
    breakDurationMinutes: 60,
    isNightShift: true,
  };

  describe('computeShiftHalfDayBreakdown', () => {
    it('computes dynamic first-half and second-half timings for a day shift with break', () => {
      const breakdown = computeShiftHalfDayBreakdown('2026-12-01', dayShift);

      expect(breakdown.isNightShift).toBe(false);
      expect(breakdown.totalWorkingHours).toBe(8);
      expect(breakdown.halfWorkingHours).toBe(4);
      expect(breakdown.firstHalfStartLabel).toBe('09:30 AM');
      expect(breakdown.firstHalfEndLabel).toBe('01:30 PM');
      expect(breakdown.secondHalfStartLabel).toBe('02:30 PM');
      expect(breakdown.secondHalfEndLabel).toBe('06:30 PM');
    });

    it('computes dynamic first-half and second-half timings for an overnight shift with break', () => {
      const breakdown = computeShiftHalfDayBreakdown('2026-12-01', nightShift);

      expect(breakdown.isNightShift).toBe(true);
      expect(breakdown.totalWorkingHours).toBe(7);
      expect(breakdown.halfWorkingHours).toBe(3.5);
      expect(breakdown.firstHalfStartLabel).toBe('10:00 PM');
      expect(breakdown.firstHalfEndLabel).toBe('01:30 AM');
      expect(breakdown.secondHalfStartLabel).toBe('02:30 AM');
      expect(breakdown.secondHalfEndLabel).toBe('06:00 AM');
      expect(breakdown.secondHalfEndAt.getTime()).toBeGreaterThan(breakdown.firstHalfStartAt.getTime());
    });
  });

  describe('validateHalfDayLeaveApplication', () => {
    const leavePolicy = {
      allowHalfDay: true,
      minNoticePeriodDays: 1,
      sameDaySecondHalfCutoffHours: 2,
      requireFirstHalfPunchInForSameDaySecondHalf: true,
    };

    it('blocks same-day first-half leave for normal employee requests', () => {
      const breakdown = computeShiftHalfDayBreakdown('2026-12-01', dayShift);
      // 08:00 AM IST on 2026-12-01 (02:30 UTC)
      const now = new Date('2026-12-01T02:30:00.000Z');

      const result = validateHalfDayLeaveApplication({
        now,
        fromDate: '2026-12-01',
        toDate: '2026-12-01',
        breakdown,
        durationType: 'HALF_DAY',
        halfDaySession: 'FIRST_HALF',
        leavePolicy,
        hasFirstHalfPunchIn: false,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/first-half/i);
    });

    it('blocks same-day second-half leave when employee has not punched in during first half', () => {
      const breakdown = computeShiftHalfDayBreakdown('2026-12-01', dayShift);
      // 11:00 AM IST (05:30 UTC) -> 3.5h before 02:30 PM IST
      const now = new Date('2026-12-01T05:30:00.000Z');

      const result = validateHalfDayLeaveApplication({
        now,
        fromDate: '2026-12-01',
        toDate: '2026-12-01',
        breakdown,
        durationType: 'HALF_DAY',
        halfDaySession: 'SECOND_HALF',
        leavePolicy,
        hasFirstHalfPunchIn: false,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/punch(ing)? in/i);
    });

    it('blocks same-day second-half leave submitted less than 2 hours before second half starts', () => {
      const breakdown = computeShiftHalfDayBreakdown('2026-12-01', dayShift);
      // 01:00 PM IST (07:30 UTC) -> 1.5h before 02:30 PM IST
      const now = new Date('2026-12-01T07:30:00.000Z');

      const result = validateHalfDayLeaveApplication({
        now,
        fromDate: '2026-12-01',
        toDate: '2026-12-01',
        breakdown,
        durationType: 'HALF_DAY',
        halfDaySession: 'SECOND_HALF',
        leavePolicy,
        hasFirstHalfPunchIn: true,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/2 hour/i);
    });

    it('allows same-day second-half leave when punched in during first half and >= 2 hours before second half', () => {
      const breakdown = computeShiftHalfDayBreakdown('2026-12-01', dayShift);
      // 12:00 PM IST (06:30 UTC) -> 2.5h before 02:30 PM IST
      const now = new Date('2026-12-01T06:30:00.000Z');

      const result = validateHalfDayLeaveApplication({
        now,
        fromDate: '2026-12-01',
        toDate: '2026-12-01',
        breakdown,
        durationType: 'HALF_DAY',
        halfDaySession: 'SECOND_HALF',
        leavePolicy,
        hasFirstHalfPunchIn: true,
      });

      expect(result.valid).toBe(true);
    });

    it('enforces advance notice days for future half-day leave and allows exceptional override with reason', () => {
      const breakdown = computeShiftHalfDayBreakdown('2026-12-02', dayShift);
      // Applied on 2026-12-01T10:00:00Z with minNoticePeriodDays = 2
      const now = new Date('2026-12-01T10:00:00.000Z');

      const rejected = validateHalfDayLeaveApplication({
        now,
        fromDate: '2026-12-02',
        toDate: '2026-12-02',
        breakdown,
        durationType: 'HALF_DAY',
        halfDaySession: 'FIRST_HALF',
        leavePolicy: { ...leavePolicy, minNoticePeriodDays: 2 },
        hasFirstHalfPunchIn: false,
      });
      expect(rejected.valid).toBe(false);

      const override = validateHalfDayLeaveApplication({
        now,
        fromDate: '2026-12-02',
        toDate: '2026-12-02',
        breakdown,
        durationType: 'HALF_DAY',
        halfDaySession: 'FIRST_HALF',
        leavePolicy: { ...leavePolicy, minNoticePeriodDays: 2 },
        hasFirstHalfPunchIn: false,
        isAdminOverride: true,
        exceptionalReason: 'Medical emergency approved by HR',
      });
      expect(override.valid).toBe(true);
    });
  });

  describe('Attendance Punch-In & Punch-Out Rules', () => {
    it('evaluates first-half approved leave lateness from second-half start time only', () => {
      const breakdown = computeShiftHalfDayBreakdown('2026-12-01', dayShift);
      const effectiveShift = {
        ...dayShift,
        startTime: breakdown.secondHalfStartLabel, // 02:30 PM
      };

      // Punch in at 02:30 PM IST (09:00 UTC) -> on time
      const onTimeEval = evaluateLatePunch({
        punchIn: new Date('2026-12-01T09:00:00.000Z'),
        shift: effectiveShift,
        policy: { isEnabled: true, deductionRatePerMin: 2, gracePeriodMinutes: 0 },
        workingDaysPerWeek: 5,
      });
      expect(onTimeEval.isLate).toBe(false);
      expect(onTimeEval.lateMinutes).toBe(0);

      // Punch in at 02:45 PM IST (09:15 UTC) -> 15 min late from second-half start
      const lateEval = evaluateLatePunch({
        punchIn: new Date('2026-12-01T09:15:00.000Z'),
        shift: effectiveShift,
        policy: { isEnabled: true, deductionRatePerMin: 2, gracePeriodMinutes: 0 },
        workingDaysPerWeek: 5,
      });
      expect(lateEval.isLate).toBe(true);
      expect(lateEval.lateMinutes).toBe(15);
      expect(lateEval.deduction).toBe(30);
    });

    it('classifies punch-out for approved half-day leave as HALF_DAY without early checkout penalty', () => {
      const res = classifyPunchOut({
        currentStatus: AttendanceStatus.PRESENT,
        isLate: false,
        workedHours: 4,
        policy: { minWorkingHours: 8, workingHoursPerDay: 8, earlyCheckoutAction: 'HALF_DAY' },
        shift: { durationHours: 9, breakDurationMinutes: 60, halfDayThresholdHours: 4 },
        isHalfDayLeave: true,
        halfDaySession: 'SECOND_HALF',
        halfWorkingHours: 4,
      });

      expect(res.status).toBe(AttendanceStatus.HALF_DAY);
      expect(res.isHalfDay).toBe(true);
      expect(res.isLate).toBe(false);
    });
  });

  describe('Payroll Salary & Late-Mark Deduction', () => {
    it('deducts exactly 50% of daily salary for unpaid half-day leave without double deduction', () => {
      const summary = countPayableAttendance({
        year: 2026,
        month: 12,
        joiningDate: '2026-12-01',
        exitDate: '2026-12-01',
        attendance: [
          { date: '2026-12-01', status: 'HALF_DAY' },
        ],
        leaves: [
          {
            from: '2026-12-01',
            to: '2026-12-01',
            unpaid: true,
            durationType: 'HALF_DAY',
            halfDaySession: 'FIRST_HALF',
            days: 0.5,
          },
        ],
        workingDaysPerWeek: 5,
      });

      expect(summary.unpaidLeaveDays).toBe(0.5);
      expect(summary.halfDays).toBe(0);
      expect(summary.absentDays).toBe(0);
    });

    it('deducts 0% for paid half-day leave without double deduction', () => {
      const summary = countPayableAttendance({
        year: 2026,
        month: 12,
        joiningDate: '2026-12-01',
        exitDate: '2026-12-01',
        attendance: [
          { date: '2026-12-01', status: 'HALF_DAY' },
        ],
        leaves: [
          {
            from: '2026-12-01',
            to: '2026-12-01',
            unpaid: false,
            durationType: 'HALF_DAY',
            halfDaySession: 'SECOND_HALF',
            days: 0.5,
          },
        ],
        workingDaysPerWeek: 5,
      });

      expect(summary.paidLeaveDays).toBe(0.5);
      expect(summary.unpaidLeaveDays).toBe(0);
      expect(summary.halfDays).toBe(0);
      expect(summary.absentDays).toBe(0);
    });

    it('calculates late-mark deduction separately on the worked half of an approved half-day leave', () => {
      const lateResult = calculatePerMinuteLateDeduction({
        attendances: [
          {
            id: 101,
            date: '2026-12-01',
            punchIn: new Date('2026-12-01T09:15:00.000Z'), // 02:45 PM IST
            status: 'HALF_DAY',
            isLate: true,
            lateMinutes: 15,
            lateDeduction: 30,
            lateRatePerMinute: 2,
            lateGraceMinutes: 0,
            isHalfDayLeave: true,
            halfDaySession: 'FIRST_HALF',
          },
        ],
        shift: dayShift,
        policy: { isEnabled: true, deductionRatePerMin: 2, gracePeriodMinutes: 0 },
        leaves: [
          {
            from: '2026-12-01',
            to: '2026-12-01',
            unpaid: false,
            durationType: 'HALF_DAY',
            halfDaySession: 'FIRST_HALF',
            days: 0.5,
          },
        ],
        workingDaysPerWeek: 5,
      });

      expect(lateResult.lateDaysCount).toBe(1);
      expect(lateResult.totalLateMinutes).toBe(15);
      expect(lateResult.totalLateDeduction).toBe(30);
    });
  });
});
