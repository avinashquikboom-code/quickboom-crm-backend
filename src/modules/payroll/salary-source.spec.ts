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
  it('returns an existing current-month paid slip without overlaying current salary', async () => {
    const now = new Date();
    const snapshot = { id: 9, month: now.getMonth() + 1, year: now.getFullYear(), basicSalary: 1000, grossSalary: 1000, status: 'PAID' };
    const prisma: any = {
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 7, salaryStructures: [{ basicSalary: 2000, grossSalary: 2000 }] }) },
      salarySlip: { findMany: jest.fn().mockResolvedValue([snapshot]), count: jest.fn().mockResolvedValue(1) },
    };
    const service = new PayrollService(prisma);
    jest.spyOn(service as any, 'formatSalarySlip').mockImplementation((slip) => slip);
    const result = await service.getSalarySlips(2, { user: { id: 10, email: 'employee@example.test', role: 'EMPLOYEE' } });
    expect(result.items).toEqual([snapshot]);
    expect(prisma.employee.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: 2 }) }));
  });

  it('requires recalculation before approving an invalidated draft', async () => {
    const prisma: any = { payroll: { findFirst: jest.fn().mockResolvedValue({ id: 9, status: 'DRAFT' }), update: jest.fn() } };
    await expect(new PayrollService(prisma).approvePayroll(2, 9)).rejects.toThrow('recalculate draft payroll');
    expect(prisma.payroll.update).not.toHaveBeenCalled();
  });

});
