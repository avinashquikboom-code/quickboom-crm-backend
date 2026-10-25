import { WorkService } from './work.service';

describe('Production team propagation and visibility', () => {
  const team = { id: 7, customerId: 1, name: 'Production', isActive: true };
  it.each([null, 55])('uses the same stored team for direct/converted customers (leadId=%s)', async leadId => {
    const update = jest.fn().mockResolvedValue({ count: 1 });
    const service = new WorkService({ customer: {
      findUnique: jest.fn().mockResolvedValue({ id: 8, leadId, assignedTeamId: 7, assignedTeam: team }), updateMany: update,
    } } as any);
    expect(await service.resolveCustomerProductionTeam(8)).toBe(7);
    expect(update).not.toHaveBeenCalled();
  });
  it('recovers a missing customer team only from one recorded production team', async () => {
    const update = jest.fn().mockResolvedValue({ count: 1 });
    const service = new WorkService({ customer: {
      findUnique: jest.fn().mockResolvedValue({ id: 8, leadId: 55, assignedTeamId: null, originLead: { customerId: 1 } }), updateMany: update,
    }, work: { findMany: jest.fn().mockResolvedValue([{ team }]) } } as any);
    expect(await service.resolveCustomerProductionTeam(8)).toBe(7);
    expect(update).toHaveBeenCalledWith({ where: { id: 8, assignedTeamId: null }, data: { assignedTeamId: 7 } });
  });
  it('flags missing production teams instead of selecting an unrelated team', async () => {
    const update = jest.fn().mockResolvedValue({ count: 1 });
    const service = new WorkService({ customer: {
      findUnique: jest.fn().mockResolvedValue({ id: 8, leadId: 55, assignedTeamId: null }), updateMany: update,
    }, work: { findMany: jest.fn().mockResolvedValue([]) } } as any);
    expect(await service.resolveCustomerProductionTeam(8)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
  it('fills only missing team/task links and preserves existing Work owners', async () => {
    const update = jest.fn().mockResolvedValue({ count: 1 });
    const updateMany = jest.fn();
    const work = { id: 42, teamId: null, assignedToId: 20, editorId: 30, workType: 'REELS_SHOOT',
      status: 'ASSIGNED', tasks: [
        { id: 1, title: 'Video Editing', status: 'PENDING', assignedToId: null },
        { id: 2, title: 'Social Media Upload', status: 'PENDING', assignedToId: null },
        { id: 3, title: 'Video Editing', status: 'PENDING', assignedToId: 99 },
      ] };
    const service = new WorkService({ team: { findUnique: jest.fn().mockResolvedValue({ ...team, members: [] }) },
      work: { findMany: jest.fn().mockResolvedValue([work]), updateMany: update }, workTask: { updateMany } } as any);
    jest.spyOn(service as any, 'eligibleProductionMemberIds').mockImplementation(async (activity: any) =>
      activity.workType === 'UPLOADING' ? [40] : activity.workType === 'EDITING' ? [30] : [20]);
    await service.syncCustomerTeamWorkAssignments(8, 7, undefined, { onlyMissing: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 42, teamId: null }, data: { teamId: 7 } });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 1, assignedToId: null, status: 'PENDING' }, data: { assignedToId: 30 } });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 2, assignedToId: null, status: 'PENDING' }, data: { assignedToId: 40 } });
  });
  it('shows both direct and converted team-customer works even when another member owns them', async () => {
    const records = [
      { id: 41, customerId: 8, customer: { id: 8, leadId: null, assignedTeamId: 7, name: 'Direct' } },
      { id: 42, customerId: 9, customer: { id: 9, leadId: 55, assignedTeamId: 7, name: 'Converted' } },
      { id: 43, customerId: 10, customer: { id: 10, leadId: 56, assignedTeamId: 99, name: 'Other' } },
    ].map(row => ({ ...row, workType: 'STORY_DESIGN', assignedToId: 20, editorId: null,
      assignedTo: { id: 20, firstName: 'Designer', lastName: '', designation: { name: 'Graphic Designer' } },
      scheduledDate: new Date('2026-10-17T04:30:00Z'), scheduledTime: '10:00 AM', status: 'ASSIGNED', tasks: [] }));
    const service = new WorkService({
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 11, userId: 111, customerId: 1, status: 'ACTIVE', designation: { name: 'Video Editor' } }) },
      teamMember: { findMany: jest.fn().mockResolvedValue([{ teamId: 7, team }]) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([{ id: 8 }, { id: 9 }]) },
      work: { findMany: jest.fn().mockResolvedValue(records) },
    } as any);
    const sync = jest.spyOn(service, 'syncCustomerTeamWorkAssignments');
    const rows = await service.getEmployeeCalendar(11, { date: '2026-10-17' }, { allTenantCustomers: true });
    expect(rows.map(row => row.id)).toEqual(['41', '42']);
    expect(sync).not.toHaveBeenCalled();
  });

});
