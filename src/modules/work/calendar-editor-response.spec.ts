import { WorkService } from './work.service';
import { WorkStatus, WorkType } from '@prisma/client';

describe('Customer calendar editor response', () => {
  async function response(editor: any, editorId: number | null) {
    const findMany = jest.fn().mockResolvedValue([{
      id: 1, customerId: 8, assignedToId: 13, editorId, editor,
      assignedTo: { id: 13, firstName: 'Primary', lastName: 'Employee' },
      workType: WorkType.EDITING, title: 'Video Editing',
      status: WorkStatus.ASSIGNED,
      scheduledDate: new Date('2026-10-14T10:00:00Z'),
      team: { name: 'Production', members: [{ employeeId: 13 }, { employeeId: 20 }] },
      tasks: [],
    }]);
    const service = new WorkService({ work: { findMany } } as any);
    const rows = await service.getCalendar(8, { date: '2026-10-14' });
    expect(findMany.mock.calls[0][0].where.customerId).toBe(8);
    expect(findMany.mock.calls[0][0].include.editor.select.id).toBe(true);
    return rows[0];
  }

  it('returns the actual editor relation independently of the primary assignee', async () => {
    const row = await response({ id: 20, firstName: 'Actual', lastName: 'Editor' }, 20);
    expect(row).toMatchObject({ editorName: 'Actual Editor' });
    for (const field of ['assignedToId', 'assignedEmployee', 'assignedToName', 'editorId']) {
      expect(row).not.toHaveProperty(field);
    }
  });

  it('returns null editor fields when there is no editor relation', async () => {
    const row = await response(null, null);
    expect(row).toMatchObject({ editorName: null });
    expect(row).not.toHaveProperty('editorId');
  });

  it('employee calendar never substitutes Super Admin or BPO employee as production assignee', async () => {
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
      expect(rows[0]).not.toHaveProperty(field);
    }
    expect(rows[0].assignedEmployees).toEqual([]);
  });
});
