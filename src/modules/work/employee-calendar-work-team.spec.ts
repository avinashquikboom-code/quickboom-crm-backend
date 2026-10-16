import { WorkService } from './work.service';

describe('Employee calendar work-level team visibility', () => {
  it.each([false, true])('keeps every team customer despite role mismatch (assignedOnly=%s)', async assignedOnly => {
    const works = [41, 42, 43, 44].map((customerId, index) => ({
      id: index + 1, customerId, teamId: index === 3 ? 9 : 7,
      assignedToId: index === 0 ? 13 : index === 1 ? 20 : null,
      editorId: null, workType: 'POST_DESIGN', status: 'SCHEDULED', title: 'Design',
      scheduledDate: new Date('2026-10-17T04:30:00Z'), tasks: [],
      customer: { id: customerId, name: `Client ${customerId}` },
    }));
    const service = new WorkService({
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 13, userId: 113,
        customerId: 1, status: 'ACTIVE', designation: { name: 'Videographer' } }) },
      teamMember: { findMany: jest.fn().mockResolvedValue([
        { teamId: 7, team: { customerId: 1, isActive: true } },
      ]) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      work: { findMany: jest.fn().mockResolvedValue(works) },
    } as any, {
      getAllowedActivityTypesForEmployee: jest.fn().mockResolvedValue({
        role: 'VIDEOGRAPHER', allowedTypes: new Set(['REEL_SHOOT']),
        isFullAccess: false, isProductionManager: false,
      }),
    } as any);
    const rows = await service.getEmployeeCalendar(13, { date: '2026-10-17' },
      { allTenantCustomers: true, assignedOnly });
    expect(rows.map(row => Number(row.customerId))).toEqual([41, 42, 43]);
  });
});
