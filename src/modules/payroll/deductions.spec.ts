import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeductionsService } from './deductions.service';

describe('DeductionsService', () => {
  let service: DeductionsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      employee: { findMany: jest.fn() },
      employeeDeduction: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
        groupBy: jest.fn(),
      },
      salaryStructure: { findFirst: jest.fn() },
      payrollItem: { findUnique: jest.fn() },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    service = new DeductionsService(prisma, undefined);
  });

  const employees = [
    { id: 10, status: 'ACTIVE', firstName: 'A', lastName: 'One', employeeCode: 'E1' },
    { id: 11, status: 'ACTIVE', firstName: 'B', lastName: 'Two', employeeCode: 'E2' },
  ];

  it('creates one deduction per employee with the full amount each', async () => {
    prisma.employee.findMany.mockResolvedValue(employees);
    prisma.employeeDeduction.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: data.employeeId,
      employee: { firstName: 'X', lastName: 'Y', department: null, designation: null },
    }));

    const result = await service.create(3, {
      employeeIds: [10, 11],
      amount: 500,
      reason: 'Uniform damage',
      payrollMonth: 11,
      payrollYear: 2026,
    }, { id: 99 });

    expect(prisma.employeeDeduction.create).toHaveBeenCalledTimes(2);
    for (const call of prisma.employeeDeduction.create.mock.calls) {
      expect(call[0].data.amount).toBe(500); // never divided
      expect(call[0].data.customerId).toBe(3);
      expect(call[0].data.status).toBe('PENDING');
    }
    expect(result.count).toBe(2);
    expect(result.totalAmount).toBe(1000);
  });

  it('rejects employee IDs that do not belong to the tenant', async () => {
    prisma.employee.findMany.mockResolvedValue([employees[0]]);
    await expect(
      service.create(3, { employeeIds: [10, 11], amount: 500, reason: 'x', payrollMonth: 11, payrollYear: 2026 }, {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects missing reason and non-positive amount', async () => {
    prisma.employee.findMany.mockResolvedValue(employees);
    await expect(
      service.create(3, { employeeIds: [10], amount: 500, reason: ' ', payrollMonth: 11, payrollYear: 2026 }, {}),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create(3, { employeeIds: [10], amount: 0, reason: 'x', payrollMonth: 11, payrollYear: 2026 }, {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('approves only pending deductions', async () => {
    prisma.employeeDeduction.findFirst.mockResolvedValue({
      id: 5,
      customerId: 3,
      employeeId: 10,
      amount: 500,
      reason: 'x',
      payrollMonth: 11,
      payrollYear: 2026,
      status: 'APPLIED',
      employee: {},
    });
    await expect(service.approve(3, 5, {})).rejects.toThrow(BadRequestException);
    prisma.employeeDeduction.findFirst.mockResolvedValue(null);
    await expect(service.approve(3, 999, {})).rejects.toThrow(NotFoundException);
  });

  it('blocks reversal when payroll is finalized', async () => {
    prisma.employeeDeduction.findFirst.mockResolvedValue({
      id: 5,
      customerId: 3,
      employeeId: 10,
      amount: 500,
      reason: 'x',
      payrollMonth: 11,
      payrollYear: 2026,
      status: 'APPLIED',
      payrollItemId: 7,
      employee: {},
    });
    prisma.payrollItem.findUnique.mockResolvedValue({ id: 7, payroll: { status: 'PAID' } });
    await expect(service.reverse(3, 5, { reason: 'mistake' }, {})).rejects.toThrow(BadRequestException);
  });

  it('reverses approved deductions and keeps the record', async () => {
    prisma.employeeDeduction.findFirst.mockResolvedValue({
      id: 5,
      customerId: 3,
      employeeId: 10,
      amount: 500,
      reason: 'x',
      payrollMonth: 11,
      payrollYear: 2026,
      status: 'APPROVED',
      employee: {},
    });
    prisma.employeeDeduction.update.mockResolvedValue({ id: 5, status: 'REVERSED', employee: {} });
    const result = await service.reverse(3, 5, { reason: 'duplicate entry' }, { id: 9 });
    expect(result.success).toBe(true);
    expect(prisma.employeeDeduction.delete).not.toHaveBeenCalled();
    expect(prisma.employeeDeduction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVERSED', reversalReason: 'duplicate entry' }) }),
    );
  });
});
