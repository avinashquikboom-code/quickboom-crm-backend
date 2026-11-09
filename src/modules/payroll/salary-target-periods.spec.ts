import { SalaryTargetService } from './salary-target.service';

describe('period-specific target salary assignments', () => {
  let service: SalaryTargetService;
  let db: any;
  beforeEach(() => {
    db = {
      $executeRaw: jest.fn(),
      salaryTargetPolicy: { findFirst: jest.fn(), create: jest.fn(async ({ data }) => ({ id: 21, ...data })), update: jest.fn(async ({ data }) => ({ id: 21, ...data })) },
      salaryTargetReview: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      payrollItem: { findFirst: jest.fn().mockResolvedValue(null) },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 3, customerId: 7, status: 'ACTIVE' }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      lead: { findMany: jest.fn().mockResolvedValue([]) },
    };
    db.$transaction = jest.fn((callback) => callback(db));
    service = new SalaryTargetService(db);
  });
  const input = { employeeId: 3, month: 11, year: 2026, monthlyTarget: 50000, fullSalary: 30000, belowTargetSalary: 15000 };

  it('creates by period and reports duplicate employee assignments separately', async () => {
    db.salaryTargetPolicy.create.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce({ id: 22 });
    const result = await service.assign(7, { ...input, employeeIds: [3, 4] }, { id: 9 });
    expect(result).toMatchObject({ assigned: 1, failed: 1 });
    expect(result.results[0].error).toMatch(/already exists/);
    expect(db.salaryTargetPolicy.create).toHaveBeenCalledWith({ data: expect.objectContaining({ customerId: 7, month: 11, year: 2026 }) });
  });

  it('rejects approved review edits and deletion without modifying payroll or policies', async () => {
    db.salaryTargetPolicy.findFirst.mockResolvedValue({ id: 21, employeeId: 3, month: 11, year: 2026 });
    db.salaryTargetReview.findFirst.mockResolvedValue({ reviewStatus: 'APPROVED' });
    await expect(service.changeAssignment(7, 21, input, { id: 9 })).rejects.toThrow(/approved/);
    await expect(service.changeAssignment(7, 21, input, { id: 9 }, true)).rejects.toThrow(/approved/);
    expect(db.salaryTargetPolicy.update).not.toHaveBeenCalled();
  });

  it('uses tenant-scoped assignment IDs and rejects foreign records', async () => {
    db.salaryTargetPolicy.findFirst.mockResolvedValue(null);
    await expect(service.changeAssignment(7, 21, input, { id: 9 }, true)).rejects.toThrow(/not found/);
    expect(db.salaryTargetPolicy.findFirst).toHaveBeenCalledWith({ where: { id: 21, customerId: 7, deletedAt: null } });
  });

  it('deleting a legacy policy month creates a disabled override, retaining the ongoing policy', async () => {
    db.salaryTargetPolicy.findFirst.mockResolvedValue({ id: 21, customerId: 7, employeeId: 3, month: 0, year: 0, monthlyTarget: 1000, belowTargetSalary: 100 });
    await service.changeAssignment(7, 21, input, { id: 9 }, true);
    expect(db.salaryTargetPolicy.create).toHaveBeenCalledWith({ data: expect.objectContaining({ month: 11, year: 2026, enabled: false, deletedAt: expect.any(Date) }) });
    expect(db.salaryTargetPolicy.update).not.toHaveBeenCalled();
  });

  it('does not fall back to a legacy salary policy after period deactivation', async () => {
    db.salaryTargetPolicy.findFirst.mockResolvedValue({ id: 21, month: 11, year: 2026, enabled: false, deletedAt: new Date() });
    expect(await service.resolveForPayroll(db, 7, { id: 3 }, {}, 2026, 11)).toBeNull();
    expect(db.salaryTargetPolicy.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns the approved historical snapshot without recalculation', async () => {
    db.salaryTargetPolicy.findFirst.mockResolvedValue({ id: 21, enabled: true });
    db.salaryTargetReview.findUnique.mockResolvedValue({ id: 5, month: 11, year: 2026, reviewStatus: 'APPROVED', eligibleSalary: 12345 });
    const result = await service.resolveForPayroll(db, 7, { id: 3 }, {}, 2026, 11);
    expect(result.eligibleSalary).toBe(12345);
    expect(db.lead.findMany).not.toHaveBeenCalled();
  });
});
