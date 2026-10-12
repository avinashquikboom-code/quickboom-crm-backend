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
    expect(row).toMatchObject({ editorId: 20, editorName: 'Actual Editor' });
    for (const field of ['assignedToId', 'assignedEmployee', 'assignedToName']) {
      expect(row).not.toHaveProperty(field);
    }
  });

  it('returns null editor fields when there is no editor relation', async () => {
    const row = await response(null, null);
    expect(row).toMatchObject({ editorId: null, editorName: null });
  });
});
