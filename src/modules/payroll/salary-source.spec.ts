import { PayrollService } from './payroll.service';

function setup() {
  const current = { id: 4, employeeId: 7, customerId: 2, status: 'ACTIVE', basicSalary: 1000, hra: 200, pf: 50, bonus: 100 };
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
    salaryStructure: {
      findFirst: jest.fn().mockResolvedValue(current),
      update: jest.fn(async ({ data }) => ({ ...current, ...data })),
      create: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    employee: { findFirst: jest.fn().mockResolvedValue({ id: 7, bankDetails: { bankName: 'Bank' } }), update: jest.fn() },
    payroll: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    payrollItem: { update: jest.fn() }, salarySlip: { update: jest.fn() },
  };
  const prisma: any = { $transaction: jest.fn(async (fn) => fn(tx)) };
  return { service: new PayrollService(prisma), tx };
}

describe('Canonical salary updates', () => {
  it('preserves omitted components, derives totals, and invalidates only calculated batches', async () => {
    const { service, tx } = setup();
    const saved = await service.saveSalaryStructure(2, { employeeId: 7, basicSalary: 2000 });
    expect(saved).toMatchObject({ basicSalary: 2000, hra: 200, bonus: 100, pf: 50, grossSalary: 2300, netSalary: 2250 });
    expect(tx.employee.update.mock.calls[0][0].data.bankDetails).toMatchObject({ bankName: 'Bank', basicSalary: 2000, monthlySalary: 2300 });
    expect(tx.payroll.updateMany.mock.calls[0][0].where).toMatchObject({ customerId: 2, status: 'CALCULATED' });
    expect(tx.salaryStructure.create).not.toHaveBeenCalled();
    expect(tx.salarySlip.update).not.toHaveBeenCalled();
    expect(tx.payrollItem.update).not.toHaveBeenCalled();
  });

  it('rejects a structure outside the tenant before writing', async () => {
    const { service, tx } = setup();
    tx.salaryStructure.findFirst.mockResolvedValue(null);
    await expect(service.saveSalaryStructure(2, { id: 99, employeeId: 7, basicSalary: 2000 })).rejects.toThrow('Salary structure not found');
    expect(tx.salaryStructure.update).not.toHaveBeenCalled();
  });

  it('rejects invalid amounts', async () => {
    const { service, tx } = setup();
    await expect(service.saveSalaryStructure(2, { employeeId: 7, basicSalary: -1 })).rejects.toThrow('Invalid basicSalary');
    expect(tx.employee.update).not.toHaveBeenCalled();
  });
});
