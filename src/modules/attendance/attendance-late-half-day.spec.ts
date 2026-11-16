import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { classifyPunchOut } from './attendance-classification';
import { calculatePerMinuteLateDeduction, countPayableAttendance } from '../payroll/salary-calculation';

const policy = {
  minWorkingHours: 8,
  earlyCheckoutGraceMinutes: 15,
  earlyCheckoutAction: 'MARK_EARLY',
  minWorkingHoursForHalfDay: 4,
};
const halfDayOnEarlyCheckout = { ...policy, earlyCheckoutAction: 'HALF_DAY' };

describe('classifyPunchOut (late mark and half day are independent)', () => {
  it('on time with full working hours stays PRESENT', () => {
    expect(classifyPunchOut({ currentStatus: 'PRESENT', workedHours: 8, policy })).toEqual({
      status: 'PRESENT',
      isLate: false,
      isHalfDay: false,
    });
  });

  it('late with full working hours stays LATE', () => {
    expect(
      classifyPunchOut({ currentStatus: 'LATE', isLate: true, lateMinutes: 113, workedHours: 8, policy }),
    ).toEqual({ status: 'LATE', isLate: true, isHalfDay: false });
  });

  it('late arrival that leaves at shift end is not a half day under the early checkout rule', () => {
    // 113 minutes late, left on time: 8h shift minus the late arrival.
    const result = classifyPunchOut({
      currentStatus: 'LATE',
      isLate: true,
      lateMinutes: 113,
      workedHours: 6.12,
      policy: halfDayOnEarlyCheckout,
    });
    expect(result).toEqual({ status: 'LATE', isLate: true, isHalfDay: false });
  });

  it('counts the grace minutes when crediting the late arrival', () => {
    // 20 raw minutes late with 15 grace: 5 eligible late minutes.
    const result = classifyPunchOut({
      currentStatus: 'LATE',
      isLate: true,
      lateMinutes: 5,
      lateGraceMinutes: 15,
      workedHours: 7.45,
      policy: halfDayOnEarlyCheckout,
    });
    expect(result.isHalfDay).toBe(false);
  });

  it('late with half-day working hours keeps both classifications', () => {
    const result = classifyPunchOut({
      currentStatus: 'LATE',
      isLate: true,
      lateMinutes: 113,
      workedHours: 3,
      policy,
    });
    expect(result).toEqual({ status: 'HALF_DAY', isLate: true, isHalfDay: true });
  });

  it('late and also left early is a half day when the policy says so', () => {
    const result = classifyPunchOut({
      currentStatus: 'LATE',
      isLate: true,
      lateMinutes: 60,
      workedHours: 5,
      policy: halfDayOnEarlyCheckout,
    });
    expect(result).toEqual({ status: 'HALF_DAY', isLate: true, isHalfDay: true });
  });

  it('on time with half-day working hours is HALF_DAY without a late mark', () => {
    expect(classifyPunchOut({ currentStatus: 'PRESENT', workedHours: 3.5, policy })).toEqual({
      status: 'HALF_DAY',
      isLate: false,
      isHalfDay: true,
    });
  });

  it('on time early checkout follows the configured early checkout action', () => {
    expect(classifyPunchOut({ currentStatus: 'PRESENT', workedHours: 6, policy }).status).toBe('PRESENT');
    expect(classifyPunchOut({ currentStatus: 'PRESENT', workedHours: 6, policy: halfDayOnEarlyCheckout }).status).toBe(
      'HALF_DAY',
    );
  });

  it('uses the configured half-day hours', () => {
    const strict = { ...policy, minWorkingHoursForHalfDay: 5 };
    expect(classifyPunchOut({ currentStatus: 'PRESENT', workedHours: 4.5, policy: strict }).status).toBe('HALF_DAY');
    expect(classifyPunchOut({ currentStatus: 'PRESENT', workedHours: 4.5, policy }).status).toBe('PRESENT');
  });

  it('clears a half day that was set only because of a late punch-in', () => {
    const result = classifyPunchOut({
      currentStatus: 'HALF_DAY',
      isLate: true,
      lateMinutes: 113,
      workedHours: 8,
      policy,
    });
    expect(result).toEqual({ status: 'LATE', isLate: true, isHalfDay: false });
  });

  it('never overwrites approved leave', () => {
    expect(classifyPunchOut({ currentStatus: 'LEAVE', workedHours: 2, policy }).status).toBe('LEAVE');
  });
});

describe('AttendanceService late mark vs half day', () => {
  let service: AttendanceService;
  let prisma: any;

  const office = {
    id: 1,
    customerId: 1,
    name: 'Head Office',
    city: 'Navi Mumbai',
    latitude: 19.033,
    longitude: 73.0297,
    radiusMeters: 200.0,
    isActive: true,
  };
  const employee = {
    id: 10,
    customerId: 1,
    userId: 5,
    employeeCode: 'QB-EMP-010',
    firstName: 'John',
    lastName: 'Doe',
    status: 'ACTIVE',
    officeId: 1,
    office,
    shift: { id: 3, startTime: '09:30', endTime: '18:30', workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
  };
  const user = { id: 5, customerId: 1, role: 'EMPLOYEE' };
  const gps = { latitude: 19.033, longitude: 73.0297, accuracy: 5 };
  // Tuesday 17 Nov 2026, Asia/Kolkata.
  const ist = (time: string) => new Date(`2026-11-17T${time}:00+05:30`);

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    prisma = {
      employee: { findFirst: jest.fn().mockResolvedValue(employee), update: jest.fn() },
      branchGeofence: {
        findMany: jest.fn().mockResolvedValue([office]),
        findUnique: jest.fn().mockResolvedValue(office),
        findFirst: jest.fn().mockResolvedValue(office),
      },
      attendancePolicy: { findFirst: jest.fn() },
      remoteRequest: { findFirst: jest.fn().mockResolvedValue(null) },
      attendance: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 101, ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => ({ id: 101, ...data })),
      },
      attendanceBreak: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [AttendanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<AttendanceService>(AttendanceService);
  });

  afterEach(() => jest.useRealTimers());

  const savedPunchIn = () => prisma.attendance.create.mock.calls[0][0].data;
  const savedPunchOut = () => prisma.attendance.update.mock.calls[0][0].data;

  it('a late punch-in is saved as LATE even when the policy late action is HALF_DAY', async () => {
    prisma.attendancePolicy.findFirst.mockResolvedValue({
      ...policy,
      lateArrivalThresholdMins: 30,
      lateRuleAction: 'HALF_DAY',
    });
    jest.setSystemTime(ist('11:23'));

    const result = await service.checkIn(user, 1, gps);

    expect(savedPunchIn()).toMatchObject({ status: 'LATE', isLate: true, lateMinutes: 113 });
    expect(result.data.status).toBe('LATE');
  });

  it('an on-time punch-in is saved as PRESENT', async () => {
    prisma.attendancePolicy.findFirst.mockResolvedValue(policy);
    jest.setSystemTime(ist('09:25'));

    await service.checkIn(user, 1, gps);

    expect(savedPunchIn()).toMatchObject({ status: 'PRESENT', isLate: false, lateMinutes: 0 });
  });

  it('a late employee who works until shift end stays LATE at punch-out', async () => {
    prisma.attendancePolicy.findFirst.mockResolvedValue(halfDayOnEarlyCheckout);
    prisma.attendance.findFirst.mockResolvedValue({
      id: 101,
      employeeId: 10,
      punchIn: ist('11:23'),
      punchOut: null,
      status: 'LATE',
      isLate: true,
      lateMinutes: 113,
      lateGraceMinutes: 0,
      breaks: [],
    });
    jest.setSystemTime(ist('18:30'));

    await service.checkOut(user, 1, gps);

    expect(savedPunchOut()).toMatchObject({ status: 'LATE', isLate: true, lateMinutes: 113 });
  });

  it('a late employee with half-day working hours is HALF_DAY and keeps the late mark', async () => {
    prisma.attendancePolicy.findFirst.mockResolvedValue(policy);
    prisma.attendance.findFirst.mockResolvedValue({
      id: 101,
      employeeId: 10,
      punchIn: ist('11:23'),
      punchOut: null,
      status: 'LATE',
      isLate: true,
      lateMinutes: 113,
      lateGraceMinutes: 0,
      breaks: [],
    });
    jest.setSystemTime(ist('14:00'));

    await service.checkOut(user, 1, gps);

    expect(savedPunchOut()).toMatchObject({ status: 'HALF_DAY', isLate: true, lateMinutes: 113 });
  });

  it('an on-time employee with half-day working hours is HALF_DAY without a late mark', async () => {
    prisma.attendancePolicy.findFirst.mockResolvedValue(policy);
    prisma.attendance.findFirst.mockResolvedValue({
      id: 101,
      employeeId: 10,
      punchIn: ist('09:30'),
      punchOut: null,
      status: 'PRESENT',
      isLate: false,
      lateMinutes: 0,
      breaks: [],
    });
    jest.setSystemTime(ist('13:00'));

    await service.checkOut(user, 1, gps);

    expect(savedPunchOut()).toMatchObject({ status: 'HALF_DAY', isLate: false, lateMinutes: 0 });
  });
});

describe('payroll treats late mark and half day separately', () => {
  const shift = { startTime: '09:30', endTime: '18:30', workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
  const latePolicy = { isEnabled: true, deductionRatePerMin: 2, gracePeriodMinutes: 0 };
  const day = (d: number) => new Date(Date.UTC(2026, 10, d));
  const lateRow = { date: day(17), punchIn: new Date('2026-11-17T11:23:00+05:30'), isLate: true, lateMinutes: 113, lateDeduction: 226, lateRatePerMinute: 2 };

  it('a late day is a paid present day with only the per-minute late deduction', () => {
    const attendance = countPayableAttendance({
      year: 2026,
      month: 11,
      shiftDays: shift.workingDays,
      attendance: [{ date: day(17), status: 'LATE' }],
    });
    expect(attendance.halfDays).toBe(0);
    expect(attendance.presentDays).toBe(1);

    const late = calculatePerMinuteLateDeduction({ attendances: [{ ...lateRow, status: 'LATE' }], shift, policy: latePolicy });
    expect(late.lateDaysCount).toBe(1);
    expect(late.totalLateMinutes).toBe(113);
    expect(late.totalLateDeduction).toBe(226);
  });

  it('a half day costs half a day and adds no late deduction when the employee was on time', () => {
    const attendance = countPayableAttendance({
      year: 2026,
      month: 11,
      shiftDays: shift.workingDays,
      attendance: [{ date: day(17), status: 'HALF_DAY' }, { date: day(18), status: 'PRESENT' }],
    });
    expect(attendance.halfDays).toBe(1);

    const late = calculatePerMinuteLateDeduction({
      attendances: [{ date: day(17), punchIn: new Date('2026-11-17T09:30:00+05:30'), isLate: false, lateMinutes: 0, status: 'HALF_DAY' }],
      shift,
      policy: latePolicy,
    });
    expect(late.lateDaysCount).toBe(0);
    expect(late.totalLateDeduction).toBe(0);
  });

  it('a late half day is charged each rule exactly once', () => {
    const attendance = countPayableAttendance({
      year: 2026,
      month: 11,
      shiftDays: shift.workingDays,
      attendance: [{ date: day(17), status: 'HALF_DAY' }],
    });
    expect(attendance.halfDays).toBe(1);

    const late = calculatePerMinuteLateDeduction({ attendances: [{ ...lateRow, status: 'HALF_DAY' }], shift, policy: latePolicy });
    expect(late.lateDaysCount).toBe(1);
    expect(late.totalLateDeduction).toBe(226);
  });
});
