import { WorkService } from './work.service';
import { WorkStatus, WorkType } from '@prisma/client';

describe('Customer calendar editor response', () => {
  async function response(editor: any, editorId: number | null) {
    const findMany = jest.fn().mockResolvedValue([{
      id: 1, customerId: 8, assignedToId: 13, editorId, editor,
      assignedTo: { id: 13, customerId: 8, firstName: 'Primary', lastName: 'Employee' },
      workType: WorkType.EDITING, title: 'Video Editing',
      status: WorkStatus.ASSIGNED,
      scheduledDate: new Date('2026-10-14T10:00:00Z'),
      team: { id: 5, customerId: 8, name: 'Production', members: [{ employeeId: 13 }, { employeeId: 20 }] },
      tasks: [],
    }]);
    const service = new WorkService({ work: { findMany } } as any);
    const rows = await service.getCalendar(8, { date: '2026-10-14' });
    expect(findMany.mock.calls[0][0].where.customerId).toBe(8);
    expect(findMany.mock.calls[0][0].include.editor.select.id).toBe(true);
    return rows[0];
  }

  it('returns the actual editor relation independently of the primary assignee', async () => {
    const row = await response({ id: 20, customerId: 8, firstName: 'Actual', lastName: 'Editor' }, 20);
    expect(row).toMatchObject({ editorName: 'Actual Editor', assignedToId: 13, editorId: 20, assignedEmployee: 'Actual Editor', team: 'Production', assignmentTeamMismatch: false });
  });

  it('returns null editor fields when there is no editor relation', async () => {
    const row = await response(null, null);
    expect(row).toMatchObject({ editorName: null });
    expect(row).toMatchObject({ editorId: null, assignedEmployee: 'Primary Employee', team: 'Production' });
  });

  it('preserves actual assignment and flags an employee outside the recorded team', async () => {
    const findMany = jest.fn().mockResolvedValue(['Reel #1: Post', 'Creative Post #1: Publish'].map((title, index) => ({
      id: index + 1, customerId: 8, title, workType: WorkType.UPLOADING,
      assignedToId: 13, editorId: null,
      assignedTo: { id: 13, customerId: 8, firstName: 'Actual', lastName: 'Assignee' },
      team: { id: 5, customerId: 8, name: 'Recorded team', members: [{ employeeId: 20 }] },
      status: WorkStatus.ASSIGNED, scheduledDate: new Date('2026-10-14T10:00:00Z'),
      tasks: [{ assignedTo: { id: 20, firstName: 'Different', lastName: 'Employee' } }],
    })));
    const rows = await new WorkService({ work: { findMany } } as any).getCalendar(8, { date: '2026-10-14' });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({
      assignedToId: 13, assignedEmployee: 'Actual Assignee', team: null, teamId: null,
      assignedTeam: 'Recorded team', assignedTeamId: 5, assignmentTeamMismatch: true,
    });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('employee calendar displays the actual assigned relation without substituting the viewer', async () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: 1, customerId: 111, assignedToId: 1, editorId: null,
      assignedTo: { id: 1, firstName: 'Super', lastName: 'Admin', designation: null, department: null },
      editor: null,
      workType: WorkType.REELS_SHOOT, title: 'Reel #1: Shoot',
      description: 'Reel #1 Video & Asset Shoot on location',
      status: WorkStatus.SCHEDULED,
      scheduledDate: new Date('2026-10-13T10:00:00Z'),
      team: { id: 5, name: 'PRODUCTION TEAM_A', members: [{ employeeId: 10 }] },
      tasks: [],
      customer: { id: 111, name: 'Client 111' },
    }]);
    const service = new WorkService({
      work: { findMany },
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: 10, designation: { name: 'Videographer' } }),
      },
      teamMember: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
    } as any);

    const rows = await service.getEmployeeCalendar(10, { date: '2026-10-13' }, { allTenantCustomers: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      editorName: null,
      team: 'PRODUCTION TEAM_A',
    });
    for (const field of ['assignedToId', 'assignedEmployee', 'assignedToName', 'editorId']) {
      expect(rows[0]).toHaveProperty(field);
    }
    expect(rows[0]).toMatchObject({ assignedToId: 1, assignedEmployee: 'Super Admin', assignedToName: 'Super Admin' });
    expect(rows[0].assignedEmployees).toEqual(['Super Admin']);
  });
});
