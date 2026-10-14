import { WorkService } from './work.service';

const assignee = { id: 13, firstName: 'Sam', lastName: 'Designer', employeeCode: 'E13' };
const editor = { id: 21, firstName: 'Rahul', lastName: 'Editor', employeeCode: 'E21' };
const cases = [
  ...['REELS_SHOOT', 'POST_DESIGN', 'STORY_DESIGN', 'UPLOADING', 'CREATIVE_POST', 'INFLUENCER_PROMO', 'ADS_MANAGEMENT'].map(workType => [workType, assignee, editor, 13, 'Sam Designer']),
  ['VIDEO_EDITING', assignee, editor, 21, 'Rahul Editor'],
  ['VIDEO_EDITING', assignee, null, 13, 'Sam Designer'],
  ['VIDEO_EDITING', null, null, null, null],
  ['STORY_DESIGN', null, editor, null, null],
  ['POST_DESIGN', { id: 14, firstName: null, lastName: 'Designer' }, undefined, 14, 'Designer'],
  ['VIDEO_EDITING', assignee, { id: 22, firstName: null, lastName: null }, 22, null],
  ['UPLOADING', undefined, undefined, null, null],
] as any[][];

const records = () => cases.map(([workType, assignedTo, editor], index) => ({
  id: index + 1, customerId: 8, workType, assignedTo, editor,
  assignedToId: assignedTo?.id ?? null, editorId: editor?.id ?? null,
  title: 'Deliverable', status: 'ASSIGNED', scheduledDate: new Date('2026-10-14T10:00:00Z'),
  notes: 'Original notes', outputUrl: 'https://example.com/output', revisionCount: 2,
  customer: { id: 8, name: 'Customer' }, tasks: [],
}));

function verify(rows: any[]) {
  expect(rows).toHaveLength(cases.length);
  rows.forEach((row, index) => {
    const [, , editor, id, name] = cases[index];
    expect(row).toMatchObject({
      assignedToId: id, assignedEmployee: name, assignedToName: name,
      editorId: editor?.id ?? null,
      editorName: editor ? `${editor.firstName ?? ''} ${editor.lastName ?? ''}`.trim() || null : null,
      notes: 'Original notes', outputUrl: 'https://example.com/output', revisionCount: 2,
    });
  });
}

describe('Work responsible employee responses', () => {
  it('maps all list records, preserves other fields and leaves original assignments intact', async () => {
    const works = records();
    const original = works.map(work => ({ ...work }));
    const findMany = jest.fn().mockResolvedValue(works);
    const service = new WorkService({ work: { findMany, count: jest.fn().mockResolvedValue(works.length) } } as any);
    const result = await service.findAll(8);
    verify(result.items);
    expect(result.data).toBe(result.items);
    result.items.forEach((row, index) => {
      const { assignedToId, assignedEmployee, assignedToName, editorId, editorName, ...rest } = row;
      const { assignedToId: oldAssignedToId, editorId: oldEditorId, ...originalRest } = original[index];
      expect(rest).toEqual(originalRest);
    });
    expect(works).toEqual(original);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].include).toMatchObject({ assignedTo: true, editor: true });
  });

  it('maps all customer calendar activities with relations fetched in the main query', async () => {
    const findMany = jest.fn().mockResolvedValue(records());
    const service = new WorkService({ work: { findMany } } as any);
    verify(await service.getCalendar(8, { date: '2026-10-14' }));
    expect(findMany).toHaveBeenCalledTimes(1);
    for (const relation of ['assignedTo', 'editor']) {
      expect(findMany.mock.calls[0][0].include[relation].select).toMatchObject({
        id: true, firstName: true, lastName: true, employeeCode: true,
      });
    }
  });
});
