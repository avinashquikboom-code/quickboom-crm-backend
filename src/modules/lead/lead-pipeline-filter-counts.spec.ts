import { LeadRepository } from './lead.repository';
import { LeadService } from './lead.service';

describe('Lead Pipeline Filter Counts & Employee Isolation (E2E / Unit)', () => {
  let mockPrisma: any;
  let repository: LeadRepository;
  let service: LeadService;

  beforeEach(() => {
    mockPrisma = {
      leadStage: {
        count: jest.fn().mockResolvedValue(12),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      lead: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    repository = new LeadRepository(mockPrisma);
    service = new LeadService(repository, mockPrisma);
  });

  const employeeA = {
    id: 3,
    role: 'EMPLOYEE',
    customerId: 1,
    employee: { id: 2, employeeCode: 'QB-EMP-013' },
  };

  const employeeB = {
    id: 5,
    role: 'EMPLOYEE',
    customerId: 1,
    employee: { id: 6, employeeCode: 'EMP-005' },
  };

  const adminUser = {
    id: 1,
    role: 'ADMIN',
    customerId: 1,
  };

  it('1. Empty Employee: Employee B with zero assigned leads receives 0 counts across all stages', async () => {
    mockPrisma.leadStage.findMany.mockImplementation((args: any) => {
      // leadWhere inside _count.select.leads.where must have strict employeeId isolation
      const leadWhere = args.include._count.select.leads.where;
      expect(leadWhere.employeeId).toBe(employeeB.employee.id);
      expect(leadWhere.OR).toBeUndefined();

      return [
        { id: 16, key: 'NEW', name: 'New', sortOrder: 1, isActive: true, _count: { leads: 0 } },
        { id: 17, key: 'CONTACTED', name: 'Contacted', sortOrder: 2, isActive: true, _count: { leads: 0 } },
      ];
    });

    const stages = await service.getStages(1, true, employeeB);
    const totalCount = stages.reduce((acc, s: any) => acc + (s.leadsCount || 0), 0);

    expect(totalCount).toBe(0);
    expect(stages.find((s: any) => s.key === 'NEW')?.leadsCount).toBe(0);
    expect(stages.find((s: any) => s.key === 'CONTACTED')?.leadsCount).toBe(0);
  });

  it('2. Employee with Leads: Employee A receives exactly their assigned counts (All 23, New 17)', async () => {
    mockPrisma.leadStage.findMany.mockImplementation((args: any) => {
      const leadWhere = args.include._count.select.leads.where;
      expect(leadWhere.employeeId).toBe(employeeA.employee.id);
      expect(leadWhere.OR).toBeUndefined();

      return [
        { id: 16, key: 'NEW', name: 'New', sortOrder: 1, isActive: true, _count: { leads: 17 } },
        { id: 17, key: 'CONTACTED', name: 'Contacted', sortOrder: 2, isActive: true, _count: { leads: 4 } },
        { id: 24, key: 'NEGOTIATION', name: 'Negotiation', sortOrder: 3, isActive: true, _count: { leads: 2 } },
      ];
    });

    const stages = await service.getStages(1, true, employeeA);
    const totalCount = stages.reduce((acc, s: any) => acc + (s.leadsCount || 0), 0);

    expect(totalCount).toBe(23);
    expect(stages.find((s: any) => s.key === 'NEW')?.leadsCount).toBe(17);
    expect(stages.find((s: any) => s.key === 'CONTACTED')?.leadsCount).toBe(4);
    expect(stages.find((s: any) => s.key === 'NEGOTIATION')?.leadsCount).toBe(2);
  });

  it('3. Admin sees company-wide stage counts without employee isolation restriction', async () => {
    mockPrisma.leadStage.findMany.mockImplementation((args: any) => {
      const leadWhere = args.include._count.select.leads.where;
      // Admin should NOT have leadWhere.OR restriction
      expect(leadWhere.OR).toBeUndefined();

      return [
        { id: 16, key: 'NEW', name: 'New', sortOrder: 1, isActive: true, _count: { leads: 50 } },
        { id: 17, key: 'CONTACTED', name: 'Contacted', sortOrder: 2, isActive: true, _count: { leads: 20 } },
      ];
    });

    const stages = await service.getStages(1, true, adminUser);
    expect(stages.find((s: any) => s.key === 'NEW')?.leadsCount).toBe(50);
    expect(stages.find((s: any) => s.key === 'CONTACTED')?.leadsCount).toBe(20);
  });

  it('4. getSummaryMetrics enforces employee RBAC isolation for employees and company-wide for admins', async () => {
    mockPrisma.lead.count.mockResolvedValue(5);

    await repository.getSummaryMetrics(1, employeeA);

    // Verify all count queries used strict employeeId-only filter (not OR)
    expect(mockPrisma.lead.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employeeId: employeeA.employee.id,
        }),
      }),
    );
    // Verify the old broad OR filter is NOT used
    expect(mockPrisma.lead.count).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.anything() }),
      }),
    );

    mockPrisma.lead.count.mockClear();
    await repository.getSummaryMetrics(1, adminUser);

    // Verify admin query did NOT have employee filter
    expect(mockPrisma.lead.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          employeeId: expect.anything(),
        }),
      }),
    );
  });
});
