import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseArgs, dateKey, statusPass, diagnose } from './won-calendar-diagnostic';

const args = parseArgs(['--lead', '10', '--customer', '20', '--subscription', '30', '--employee', '40', '--team', '50', '--tenant', '1', '--working-customer', '21', '--from', '2026-10-01', '--to', '2026-10-31', '--mode', 'calendar']);

test('requires explicit IDs, mode, real dates and a distinct comparison before any connection', () => {
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['--lead', '-10']));
  assert.throws(() => parseArgs(['--database-url', 'secret']));
  assert.equal(args.customer, '20');
  assert.equal(dateKey(new Date('2026-10-11T20:00:00Z')), '2026-10-12');
  assert.equal(statusPass('ASSIGNED', 'PENDING'), true);
  assert.equal(statusPass('CANCELLED'), false);
});

// Synthetic unit fixtures only; they are never used as production evidence.
function fixture() {
  const customer = (id: number) => ({ id, leadId: id === 20 ? 10 : null, source: 'LEAD_CONVERSION', deletedAt: null, isActive: true, assignedTeamId: 50, assignedEmployeeId: null, createdByEmployeeId: null, originLead: { id: 10, customerId: 1, status: 'WON', deletedAt: null }, assignedTeam: { id: 50, customerId: 1, isActive: true, leaderId: null, members: [{ employeeId: 40 }] }, leads: [] });
  const row = (id: number, type: string) => ({ id, customerId: 20, subscriptionId: 30, teamId: 50, assignedToId: null, editorId: null, status: 'SCHEDULED', scheduledDate: new Date('2026-10-12T04:30:00Z'), workType: type, title: type, description: null, tasks: [{ id: id + 100, workId: id, assignedToId: null, status: 'PENDING' }], team: null });
  const works = [row(60, 'EDITING'), row(61, 'SHOOT'), { ...row(62, 'EDITING'), status: 'CANCELLED' }, { ...row(63, 'EDITING'), scheduledDate: new Date('2026-11-12T00:00:00Z') }];
  const employee = { id: 40, userId: 400, customerId: 1, status: 'ACTIVE', designation: { name: 'Video Editor' }, user: { userRoles: [] }, employeeModuleOverrides: [], teamMembers: [{ teamId: 50 }] };
  const subscription = { id: 30, customerId: 20, planId: 2, status: 'ACTIVE', deletedAt: null };
  const tx: any = {
    lead: { findUnique: async () => ({ id: 10, status: 'WON', customerId: 1, convertedCustomer: { id: 20 } }) },
    customer: { findUnique: async ({ where }: any) => customer(where.id) },
    customerSubscription: { findUnique: async () => subscription, findMany: async () => [subscription] },
    employee: { findUnique: async () => employee },
    team: { findUnique: async () => customer(20).assignedTeam, findMany: async () => [] },
    teamMember: { findMany: async () => [{ teamId: 50 }] },
    roleWorkPermission: { findMany: async () => [] }, workAccessRequest: { findMany: async () => [] },
    monthlySchedule: { findMany: async () => [{ id: 70, customerId: 20, subscriptionId: 30 }] },
    work: { findMany: async () => works }, task: { findMany: async () => [] },
  };
  // Any unexpected write-capable delegate call is an immediate test failure.
  for (const key of Object.keys(tx)) tx[key] = new Proxy(tx[key], { get(target, prop) { if (!(prop in target)) throw new Error(`Unexpected delegate operation: ${key}.${String(prop)}`); return target[prop]; } });
  return { tx, employee, works };
}

test('reports stored dates, nested WorkTasks, category/status/date filters without modifying rows', async () => {
  const { tx, works } = fixture();
  const before = JSON.stringify(works);
  const report: any = await diagnose(tx, args);
  assert.equal(report.relationshipChecks.conversionLink, true);
  assert.equal(report.works[0].predictedIncluded, true);
  assert.equal(report.works[0].calendarDate, '2026-10-12');
  assert.equal(report.works[0].workTasks[0].workId, 60);
  assert.equal(report.works[1].predictedIncluded, false);
  assert.equal(report.works[1].filters.designation, false);
  assert.equal(report.works[2].filters.status, false);
  assert.equal(report.works[3].filters.date, false);
  assert.equal(JSON.stringify(works), before);
  assert.equal(report.authenticatedApiVerified, false);
});

test('stops before reading activities when supplied tenant is inconsistent', async () => {
  const { tx, employee } = fixture();
  employee.customerId = 2;
  tx.work.findMany = () => { throw new Error('Must not read activities'); };
  const report: any = await diagnose(tx, args);
  assert.equal(report.blocked, true);
});

test('missing explicit records block rather than selecting substitute customers', async () => {
  const { tx } = fixture();
  tx.customer.findUnique = async () => null;
  const report: any = await diagnose(tx, args);
  assert.equal(report.blocked, true);
  assert.deepEqual(report.missing, ['customer', 'working']);
});

test('recognizes WorkTask assignment without treating it as a standalone calendar row', async () => {
  const { tx, works } = fixture();
  works[1].tasks[0].assignedToId = 40;
  const report: any = await diagnose(tx, args);
  assert.equal(report.works[1].predictedIncluded, true);
  assert.equal(report.works[1].assignmentOverridesCategoryGate, true);
  assert.equal(report.standaloneTasks.length, 0);
});

test('detects subscription Work pointing outside the selected customers without evaluating another customer', async () => {
  const { tx, works } = fixture();
  works[0].customerId = 99;
  const report: any = await diagnose(tx, args);
  assert.equal(report.incorrectlyLinkedWorks[0].id, 60);
  assert.equal(report.works.some((w: any) => w.id === 60), false);
});
