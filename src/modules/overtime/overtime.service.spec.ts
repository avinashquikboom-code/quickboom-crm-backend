import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { OvertimeService } from './overtime.service';
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

  beforeEach(async () => {
    tx.overtimeRequest.findFirst.mockReset();
    tx.overtimeRequest.updateMany.mockReset();
    const prisma = {
      overtimePolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      salaryPolicy: { findFirst: jest.fn().mockResolvedValue({ overtimeMultiplier: 1.5, workingDaysPerMonth: 30, overtimeCalculationMethod: 'HOURLY_BASE', overtimeEnabled: true }) },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const module = await Test.createTestingModule({
      providers: [OvertimeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(OvertimeService);
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
});
