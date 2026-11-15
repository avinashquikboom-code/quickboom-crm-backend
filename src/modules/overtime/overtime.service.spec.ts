import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { OvertimeService } from './overtime.service';
import { payableOvertimeMinutes } from './overtime.calculator';
import { PrismaService } from '../../prisma/prisma.service';

describe('OvertimeService', () => {
  let service: OvertimeService;
  const tx = {
    overtimeRequest: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    overtimeApproval: { create: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  let prisma: any;

  beforeEach(async () => {
    tx.overtimeRequest.findFirst.mockReset();
    tx.overtimeRequest.updateMany.mockReset();
    prisma = {
      overtimePolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      salaryPolicy: { findFirst: jest.fn().mockResolvedValue({ overtimeMultiplier: 1.5, workingDaysPerMonth: 30, overtimeCalculationMethod: 'HOURLY_BASE', overtimeEnabled: true }) },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 9, customerId: 3, shiftId: 1, employeeType: 'FULL_TIME', shift: { id: 1, startTime: '10:00', endTime: '18:00' } }) },
      shift: { findFirst: jest.fn().mockResolvedValue({ id: 1, startTime: '10:00', endTime: '18:00' }) },
      attendance: { findFirst: jest.fn() },
      overtimeRequest: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue({ employeeId: 9 }) },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const module = await Test.createTestingModule({
      providers: [OvertimeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(OvertimeService);
  });

  it('pays only the shorter of the worked time and the approved time', () => {
    expect(payableOvertimeMinutes(105, 120)).toBe(105);
    expect(payableOvertimeMinutes(150, 120)).toBe(120);
  });

  it('does not approve a request that is no longer pending', async () => {
    tx.overtimeRequest.findFirst.mockResolvedValue({ id: 4, customerId: 3, status: 'APPROVED', totalMinutes: 120, employeeId: 9 });
    await expect(service.approve({ role: 'ADMIN', id: 1 }, 3, 4, { approvedMinutes: 120 })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.overtimeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a concurrent approval that loses the pending update', async () => {
    tx.overtimeRequest.findFirst.mockResolvedValue({
      id: 4,
      customerId: 3,
      status: 'PENDING',
      totalMinutes: 120,
      employeeId: 9,
      overtimeType: 'REGULAR',
      shift: { durationHours: 8 },
      employee: { salaryStructures: [{ basicSalary: 48000 }] },
    });
    tx.overtimeRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve({ role: 'ADMIN', id: 1, firstName: 'Asha' }, 3, 4, { approvedMinutes: 60 })).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['before the window', '2026-11-15T12:00:00Z', null],
    ['after completion', '2026-11-15T16:30:00Z', '2026-11-15T15:30:00Z'],
  ])('accepts the same-day after-shift example %s', async (_label, now, checkout) => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    try {
      prisma.shift.findFirst.mockResolvedValue({ id: 1, startTime: '10:00', endTime: '19:00' });
      prisma.attendance.findFirst.mockResolvedValue({ id: 8, punchIn: new Date('2026-11-15T04:30:00Z'), punchOut: checkout ? new Date(checkout) : null, breaks: [] });
      tx.overtimeRequest.create.mockImplementation(async ({ data }) => ({ id: 42, ...data }));
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 42, status: 'PENDING' } as any);
      const result = await service.create({ role: 'EMPLOYEE', employee: { id: 9 } }, 3, {
        overtimeDate: '2026-11-15', startTime: '19:00', endTime: '21:00', overtimeType: 'AFTER_SHIFT', reason: 'Production support',
      }, true);
      expect(result).toEqual({ id: 42, status: 'PENDING' });
      expect(tx.overtimeRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attendanceId: 8, status: 'PENDING', actualMinutes: checkout ? 120 : null }) }));
    } finally { jest.useRealTimers(); }
  });

  it('requires attendance for a same-day request', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-15T12:00:00Z'));
    try {
      prisma.attendance.findFirst.mockResolvedValue(null);
      await expect(service.create({ role: 'EMPLOYEE', employee: { id: 9 } }, 3, {
        overtimeDate: '2026-11-15', startTime: '19:00', endTime: '21:00', overtimeType: 'AFTER_SHIFT', reason: 'Coverage',
      }, true)).rejects.toThrow('attendance record');
    } finally { jest.useRealTimers(); }
  });

  it('uses the company active shift when the employee has no assigned shift', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 9, customerId: 3, shiftId: null, employeeType: 'FULL_TIME', shift: null });
    prisma.shift.findFirst.mockResolvedValue({ id: 4, startTime: '10:00', endTime: '18:00' });
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const date = later.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await expect(service.create({ role: 'EMPLOYEE', employee: { id: 9 } }, 3, {
      overtimeDate: date,
      startTime: '11:00',
      endTime: '12:00',
      overtimeType: 'BEFORE_SHIFT',
      reason: 'Coverage',
    }, true)).rejects.toThrow('Before-shift overtime must finish when the shift starts');
  });

  it('rejects before-shift overtime that overlaps the regular shift', async () => {
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const date = later.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await expect(service.create({ role: 'EMPLOYEE', employee: { id: 9 } }, 3, {
      overtimeDate: date,
      startTime: '11:00',
      endTime: '12:00',
      overtimeType: 'BEFORE_SHIFT',
      reason: 'Coverage',
    }, true)).rejects.toBeInstanceOf(BadRequestException);
  });
});
