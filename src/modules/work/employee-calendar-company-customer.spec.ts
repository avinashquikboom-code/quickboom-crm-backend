import { WorkService } from './work.service';

// Evaluate the relevant Prisma relation filters so the test exercises both the
// database query and the service's subsequent assignment/role filtering.
function matches(record: any, where: any): boolean {
  if (record == null) return where == null;
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((clause: any) => matches(record, clause));
    if (key === 'OR') return value.some((clause: any) => matches(record, clause));
    const actual = record[key] ?? null;
    if (value === null) return actual === null;
    if (typeof value !== 'object' || value instanceof Date) return actual === value;
    if ('in' in value) return value.in.includes(actual);
    if ('not' in value) return actual !== value.not;
    if ('some' in value) return Array.isArray(actual) && actual.some(row => matches(row, value.some));
    return matches(actual, value);
  });
}

describe('Employee calendar converted customer company links', () => {
  function setup() {
    const customer = { id: 8, companyName: 'Converted customer', deletedAt: null, assignedTeamId: null, crmCompanyId: 18 };
    const base = {
      workType: 'POST_DESIGN', title: 'Plan creative', status: 'SCHEDULED',
      scheduledDate: new Date('2026-10-19T04:30:00Z'), subscriptionId: null,
      teamId: null, editorId: null, assignedTo: null, editor: null, tasks: [],
    };
    const records = [
      { ...base, id: 1, customerId: 8, customer, companyId: null, company: null, assignedToId: 13 },
      { ...base, id: 2, customerId: null, customer: null, companyId: 18, company: { deletedAt: null, billingCustomer: customer }, assignedToId: 13 },
      { ...base, id: 3, customerId: null, customer: null, companyId: 18, company: { deletedAt: null, billingCustomer: customer }, assignedToId: 99 },
      { ...base, id: 4, customerId: null, customer: null, companyId: 19, company: { deletedAt: null, billingCustomer: { ...customer, id: 9, deletedAt: new Date() } }, assignedToId: 13 },
      { ...base, id: 5, customerId: null, customer: null, companyId: 20, company: { deletedAt: null, billingCustomer: null }, assignedToId: 13 },
      { ...base, id: 6, customerId: null, customer: null, companyId: 21, company: { deletedAt: new Date(), billingCustomer: customer }, assignedToId: 13 },
      { ...base, id: 7, customerId: 9, customer: { ...customer, id: 9 }, companyId: null, company: null, assignedToId: 13 },
      { ...base, id: 8, customerId: 9, customer: { ...customer, id: 9, deletedAt: new Date() }, companyId: 18, company: { deletedAt: null, billingCustomer: customer }, assignedToId: 13 },
    ];
    const findMany = jest.fn().mockImplementation(({ where }) => records.filter(row => matches(row, where)));
    const service = new WorkService({
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 13, userId: 113, status: 'ACTIVE', designation: { name: 'Graphic Designer' } }) },
      teamMember: { findMany: jest.fn().mockResolvedValue([]) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findFirst: jest.fn().mockResolvedValue(customer) },
      work: { findMany },
    } as any);
    return { service, findMany };
  }

  it('returns directly assigned work through either customer link, excluding unrelated or deleted records', async () => {
    const { service } = setup();
    const rows = await service.getEmployeeCalendar(13, {}, { assignedOnly: true });
    expect(rows.map(row => row.id)).toEqual(['1', '2', '7']);
    expect(rows.find(row => row.id === '2')).toMatchObject({ customerId: '8', customerName: 'Converted customer' });
  });

  it('includes company-linked work when filtering the converted customer without overriding employee assignment', async () => {
    const { service } = setup();
    const rows = await service.getEmployeeCalendar(13, { customerId: 8 }, { assignedOnly: true });
    expect(rows.map(row => row.id)).toEqual(['1', '2']);
  });
});
