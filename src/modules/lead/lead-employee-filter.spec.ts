import { LeadRepository } from './lead.repository';

function setup() {
  const prisma: any = {
    employee: { findMany: jest.fn().mockResolvedValue([{ id: 7, userId: 50 }, { id: 8, userId: 51 }]), findFirst: jest.fn().mockResolvedValue({ id: 7 }) },
    leadStage: { findFirst: jest.fn().mockResolvedValue({ id: 2, key: 'NEW' }) },
    lead: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
  };
  const repo = new LeadRepository(prisma);
  jest.spyOn(repo, 'isVisitorUser').mockResolvedValue(false);
  return { repo, prisma };
}

describe('lead employee filters and pipeline counts', () => {
  it('uses workspace employee and user IDs in both listing and unpaginated counts', async () => {
    const { repo, prisma } = setup();
    await repo.findAll(4, { employeeIds: '7,8', stageId: '2', search: 'Acme', includeCounts: true, page: 2, limit: 1 }, { id: 2, role: 'ADMIN', customerId: 4 });
    expect(prisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 4, id: { in: [7, 8] } } }));
    const list = prisma.lead.findMany.mock.calls[0][0];
    const grouped = prisma.lead.groupBy.mock.calls[0][0];
    const filter = { OR: [{ employeeId: { in: [7, 8] } }, { AND: [{ employeeId: null }, { assignedToId: { in: [50, 51] } }] }] };
    expect(list.where.AND).toContainEqual(filter);
    expect(grouped.where.AND).toContainEqual(filter);
    expect(list.where.AND).toContainEqual({ OR: [{ stageId: 2 }, { stageId: null, status: 'NEW' }] });
    expect(grouped.where.AND).not.toContainEqual({ OR: [{ stageId: 2 }, { stageId: null, status: 'NEW' }] });
    expect(grouped.where.customerId).toBe(4);
    expect(grouped).not.toHaveProperty('take');
  });
  it('includes genuinely unassigned leads without matching creators', async () => {
    const { repo, prisma } = setup();
    await repo.findAll(4, { employeeIds: 'unassigned', includeCounts: true }, { id: 2, role: 'ADMIN', customerId: 4 });
    expect(prisma.lead.groupBy.mock.calls[0][0].where.AND).toContainEqual({ OR: [{ employeeId: null, assignedToId: null }] });
  });
  it('keeps employee visibility restrictions when filtering another assignee', async () => {
    const { repo, prisma } = setup();
    await repo.findAll(4, { employeeIds: '8', includeCounts: true }, { id: 50, employeeId: 7, role: 'EMPLOYEE', customerId: 4 });
    const conditions = prisma.lead.groupBy.mock.calls[0][0].where.AND;
    expect(conditions).toEqual(expect.arrayContaining([expect.objectContaining({ OR: expect.arrayContaining([{ employeeId: 7 }]) })]));
    expect(prisma.lead.groupBy.mock.calls[0][0].where.customerId).toBe(4);
  });
  it('propagates aggregation errors instead of returning global or incomplete counts', async () => {
    const { repo, prisma } = setup();
    prisma.lead.groupBy.mockRejectedValue(new Error('database unavailable'));
    await expect(repo.findAll(4, { employeeIds: '7', includeCounts: true }, { id: 2, role: 'ADMIN', customerId: 4 })).rejects.toThrow('database unavailable');
  });
});
