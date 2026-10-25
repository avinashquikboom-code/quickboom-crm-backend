import { WorkService } from './work.service';

const roleTypes = [
  ['Content Writer', 'CONTENT_WRITING'], ['Graphic Designer', 'STORY_DESIGN'],
  ['Video Editor', 'VIDEO_EDITING'], ['Social Media Manager', 'UPLOADING'],
];

describe('Existing customer activities filtered for employees', () => {
  it.each(roleTypes)('%s receives only its existing activity in both calendar modes', async (designation, expectedType) => {
    const rows = roleTypes.map(([, workType], index) => ({
      id: 100 + index, customerId: 8, workType, title: `Story #1: ${workType}`,
      scheduledDate: new Date('2026-10-17T04:30:00Z'), scheduledTime: '10:00 AM',
      status: 'SCHEDULED', assignedToId: null, editorId: null, assignedTo: null, editor: null,
      customer: { id: 8, name: 'Home Consultancy', assignedTeamId: 7 },
      subscription: { id: 114, plan: { name: 'Standard Package' } },
      entitlement: { serviceName: 'Stories' }, tasks: [],
    }));
    const unassignedCustomer = { ...rows.find(row => row.workType === expectedType), id: 999, customerId: 9,
      customer: { id: 9, name: 'Other team client', assignedTeamId: 99 } };
    const findMany = jest.fn().mockResolvedValue([...rows, rows[1], unassignedCustomer]);
    const update = jest.fn();
    const prisma: any = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 13, userId: 213, customerId: 1,
        status: 'ACTIVE', designation: { name: designation } }) },
      teamMember: { findMany: jest.fn().mockResolvedValue([{ teamId: 7, team: { id: 7, name: 'Production', customerId: 1, isActive: true } }]) },
      team: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      customer: { findMany: jest.fn().mockResolvedValue([{ id: 8, assignedTeamId: 7 }]) },
      work: { findMany, update }, task: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new WorkService(prisma);
    const sync = jest.spyOn(service, 'syncCustomerTeamWorkAssignments');
    const carry = jest.spyOn(service, 'autoCarryForwardIncompleteWorks');
    const original = JSON.stringify(rows);
    for (const assignedOnly of [false, true]) {
      const result = await service.getEmployeeCalendar(13, { date: '2026-10-17' }, { allTenantCustomers: true, assignedOnly });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ workType: expectedType, customerName: 'Home Consultancy',
        purchaseId: 'PUR-114', scheduledDate: '2026-10-17', scheduledAt: rows[0].scheduledDate,
        scheduledTime: '10:00 AM', productName: 'Stories', planName: 'Standard Package' });
    }
    expect(JSON.stringify(rows)).toBe(original);
    expect(sync).not.toHaveBeenCalled();
    expect(carry).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
