import { BadRequestException } from '@nestjs/common';
import { PayrollService } from './payroll.service';

describe('Payroll recalculation protection', () => {
  function setup(status: string, slip: object | null, paidItem: object | null) {
    const tx: any = {
      payroll: { findFirst: jest.fn().mockResolvedValue({ id: 1, status }) },
      salarySlip: { findFirst: jest.fn().mockResolvedValue(slip) },
      payrollItem: { findFirst: jest.fn().mockResolvedValue(paidItem), deleteMany: jest.fn() },
    };
    const db: any = {
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      payrollPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      salaryPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      attendancePolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      employee: { findMany: jest.fn().mockResolvedValue([{ id: 7, salaryStructures: [] }]) },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    return { service: new PayrollService(db, {} as any), tx };
  }

  it.each([
    ['GENERATED', null, null],
    ['CALCULATED', { id: 3 }, null],
    ['CALCULATED', null, { id: 4 }],
    ['PAID', null, null],
  ])('does not replace payroll items for %s with slip %s and paid item %s', async (status, slip, paidItem) => {
    const { service, tx } = setup(status, slip, paidItem);
    await expect(service.calculatePayroll(5, 10, 2026)).rejects.toThrow(BadRequestException);
    expect(tx.payrollItem.deleteMany).not.toHaveBeenCalled();
  });
});
