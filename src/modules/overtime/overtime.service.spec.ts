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
      overtimeRequest: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('rejects an employee overtime request submitted less than 24 hours ahead', async () => {
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const date = soon.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await expect(service.create({ role: 'EMPLOYEE', employee: { id: 9 } }, 3, {
      overtimeDate: date,
      startTime: '08:00',
      endTime: '10:00',
      overtimeType: 'BEFORE_SHIFT',
      reason: 'Coverage',
    }, true)).rejects.toBeInstanceOf(BadRequestException);
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
