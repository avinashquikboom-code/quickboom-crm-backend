import { WorkService } from './work.service';

describe('Employee Calendar direct assignment', () => {
  it.each([false, true])('uses Employee IDs regardless of designation (assignedOnly=%s)', async (assignedOnly) => {
    const records = [
      { id: 1, workType: 'STORY_DESIGN', assignedToId: 13, editorId: null },
      { id: 2, workType: 'VIDEO_EDITING', assignedToId: 20, editorId: 13 },
      { id: 3, workType: 'POST_DESIGN', assignedToId: 20, editorId: null },
      // User 113 is linked to Employee 13, but is not Employee 113.
      { id: 4, workType: 'STORY_DESIGN', assignedToId: 113, editorId: null },
      { id: 5, workType: 'STORY_DESIGN', assignedToId: null, editorId: null },
    ].map(work => ({ ...work, customerId: 8, status: 'ASSIGNED', title: work.workType,
      scheduledDate: new Date('2026-10-17T04:30:00Z'), scheduledTime: '10:00 AM',
      customer: { id: 8, name: 'Client', assignedTeamId: 7 },
      assignedTo: null, editor: null, tasks: [],
    }));
    const original = JSON.stringify(records);
    const findMany = jest.fn().mockResolvedValue(records);
    const update = jest.fn();
    const service = new WorkService({
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 13, userId: 113, customerId: 1,
        status: 'ACTIVE', designation: { name: 'Videographer' } }) },
      teamMember: { findMany: jest.fn().mockResolvedValue([]) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      work: { findMany, update },
    } as any);
    const rows = await service.getEmployeeCalendar(13, { customerId: 8, date: '2026-10-17', status: 'ASSIGNED' },
      { allTenantCustomers: true, assignedOnly });
    expect(rows.map(row => row.id)).toEqual(['1', '2']);
    expect(rows[0]).toMatchObject({ assignedToId: 13, editorId: null, scheduledTime: '10:00 AM' });
    expect(rows[1]).toMatchObject({ assignedToId: 20, editorId: 13 });
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      customerId: 8, status: 'ASSIGNED', scheduledDate: { gte: expect.any(Date), lte: expect.any(Date) },
      OR: expect.arrayContaining([{ assignedToId: 13 }, { editorId: 13 }]),
    });
    expect(JSON.stringify(records)).toBe(original);
    expect(update).not.toHaveBeenCalled();
  });

  it('resolves the authenticated User ID to Employee ID before assignment filtering', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 13 });
    const service = new WorkService({ employee: { findFirst } } as any);
    expect(await service.resolveEmployeeIdForUser({ id: 113 })).toBe(13);
    expect(findFirst).toHaveBeenCalledWith({ where: { userId: 113 }, select: { id: true } });
  });
});
