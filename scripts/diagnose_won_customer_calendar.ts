/**
 * Read-only diagnostic: WON lead -> converted customer -> employee calendar.
 *
 * Usage (from quickboom-crm-backend, against the database in DATABASE_URL):
 *   npx ts-node -r tsconfig-paths/register scripts/diagnose_won_customer_calendar.ts \
 *     --lead 123 --customer 456 --subscription 789 --employee 18 --team 4 \
 *     [--working-customer 321] [--from 2026-10-01 --to 2026-10-31]
 *
 * Every Prisma write, raw execute and transaction is rejected. The calendar check
 * calls WorkService.getEmployeeCalendar with team sync and carry-forward disabled.
 * Output contains IDs, statuses, dates and designations only; no names, emails,
 * phones, credentials or tokens.
 */
import { Logger } from '@nestjs/common';
import { PrismaClient, WorkStatus } from '@prisma/client';
import { WorkService } from '../src/modules/work/work.service';
import { WorkPermissionService } from '../src/modules/work/work-permission.service';
import { workTypesForDesignation } from '../src/modules/work/calendar-query.util';

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);
const BLOCKED_CLIENT_METHODS = new Set([
  '$executeRaw',
  '$executeRawUnsafe',
  '$queryRawUnsafe',
  '$transaction',
  '$runCommandRaw',
]);

function readOnlyClient(base: PrismaClient): any {
  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (WRITE_OPERATIONS.has(operation)) {
            throw new Error(`Read-only diagnostic blocked ${model}.${operation}`);
          }
          return query(args);
        },
      },
    },
  });
  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && BLOCKED_CLIENT_METHODS.has(prop)) {
        return () => {
          throw new Error(`Read-only diagnostic blocked ${prop}`);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      out[key.slice(2)] = argv[i + 1];
      i++;
    }
  }
  const id = (name: string, required: boolean): number | null => {
    const raw = out[name];
    if (raw === undefined) {
      if (required) throw new Error(`Missing required --${name} <id>`);
      return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
    return n;
  };
  const date = (name: string): string | null => {
    const raw = out[name];
    if (raw === undefined) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`--${name} must be YYYY-MM-DD`);
    return raw;
  };
  return {
    leadId: id('lead', true)!,
    customerId: id('customer', true)!,
    subscriptionId: id('subscription', true)!,
    employeeId: id('employee', true)!,
    teamId: id('team', true)!,
    workingCustomerId: id('working-customer', false),
    from: date('from'),
    to: date('to'),
  };
}

const dateKey = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const istDateKey = (d: Date | null | undefined) =>
  d ? new Date(new Date(d).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10) : null;
const check = (label: string, ok: boolean, detail = '') =>
  console.log(`  [${ok ? 'OK' : 'BROKEN'}] ${label}${detail ? ` — ${detail}` : ''}`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  Logger.overrideLogger(false);

  const base = new PrismaClient();
  const prisma = readOnlyClient(base);

  try {
    // 1. Lead
    const lead = await prisma.lead.findUnique({
      where: { id: args.leadId },
      select: {
        id: true, customerId: true, status: true, stageId: true, employeeId: true, assignedToId: true,
        assignedTeam: true, convertedByEmployeeId: true, convertedAt: true, deletedAt: true,
      },
    });
    console.log('\n1. LEAD');
    console.log(lead ? { ...lead, convertedAt: dateKey(lead.convertedAt), deleted: !!lead.deletedAt, deletedAt: undefined } : 'not found');
    const convertedFromLead = await prisma.customer.findMany({
      where: { leadId: args.leadId },
      select: { id: true },
    });
    console.log('  customers linked by Customer.leadId:', convertedFromLead.map((c: any) => c.id));

    // 2. Customer
    const customerSelect = {
      id: true, leadId: true, isActive: true, deletedAt: true, source: true,
      assignedTeamId: true, assignedEmployeeId: true, createdByEmployeeId: true,
      assignedTeam: { select: { id: true, customerId: true, isActive: true, name: true, description: true } },
      assignedEmployeeRel: { select: { id: true, customerId: true, status: true, designation: { select: { name: true } } } },
      originLead: { select: { id: true, customerId: true, status: true } },
    };
    const customer = await prisma.customer.findUnique({ where: { id: args.customerId }, select: customerSelect });
    console.log('\n2. CUSTOMER (affected)');
    console.log(customer ? { ...customer, deletedAt: undefined, deleted: !!customer.deletedAt } : 'not found');

    // 3. Subscription
    const subscription = await prisma.customerSubscription.findUnique({
      where: { id: args.subscriptionId },
      select: { id: true, customerId: true, planId: true, status: true, startDate: true, endDate: true, deletedAt: true },
    });
    console.log('\n3. SUBSCRIPTION');
    console.log(subscription
      ? { ...subscription, startDate: dateKey(subscription.startDate), endDate: dateKey(subscription.endDate), deleted: !!subscription.deletedAt, deletedAt: undefined }
      : 'not found');

    // 4. MonthlySchedule
    const schedules = await prisma.monthlySchedule.findMany({
      where: { customerId: args.customerId },
      select: { id: true, subscriptionId: true, planId: true, month: true, year: true, startDate: true, endDate: true, status: true, deletedAt: true },
      orderBy: { startDate: 'asc' },
    });
    console.log(`\n4. MONTHLY SCHEDULES for customer ${args.customerId}: ${schedules.length}`);
    for (const s of schedules) {
      console.log({ ...s, startDate: dateKey(s.startDate), endDate: dateKey(s.endDate), deleted: !!s.deletedAt, deletedAt: undefined });
    }

    // 5/6. Work and WorkTask
    const workSelect = {
      id: true, customerId: true, subscriptionId: true, planId: true, teamId: true, assignedToId: true, editorId: true,
      workType: true, status: true, scheduledDate: true,
      team: { select: { id: true, customerId: true, isActive: true } },
      assignedTo: { select: { id: true, customerId: true, designation: { select: { name: true } } } },
      tasks: { select: { id: true, workId: true, assignedToId: true, status: true, stepOrder: true } },
    };
    const works = await prisma.work.findMany({
      where: { customerId: args.customerId },
      select: workSelect,
      orderBy: { scheduledDate: 'asc' },
    });
    console.log(`\n5. WORK rows for customer ${args.customerId}: ${works.length}`);
    for (const w of works) {
      console.log({
        id: w.id, customerId: w.customerId, subscriptionId: w.subscriptionId, teamId: w.teamId,
        teamTenant: w.team?.customerId ?? null, assignedToId: w.assignedToId,
        assigneeDesignation: w.assignedTo?.designation?.name ?? null, editorId: w.editorId,
        workType: w.workType, status: w.status, scheduledDate: istDateKey(w.scheduledDate),
      });
    }
    const workTasks = works.flatMap((w: any) => w.tasks);
    console.log(`\n6. WORKTASK rows: ${workTasks.length}`);
    for (const t of workTasks) console.log(t);
    const generalTaskCount = await prisma.task.count({ where: { customerId: args.customerId, deletedAt: null } });
    console.log(`  general Task rows for customer (separate model): ${generalTaskCount}`);

    // 7. Employee
    const employee = await prisma.employee.findUnique({
      where: { id: args.employeeId },
      select: {
        id: true, userId: true, customerId: true, status: true,
        designation: { select: { name: true } }, department: { select: { name: true } },
        teamMembers: { select: { teamId: true, team: { select: { customerId: true, isActive: true, name: true, description: true } } } },
        ledTeams: { select: { id: true, customerId: true, isActive: true } },
      },
    });
    console.log('\n7. EMPLOYEE');
    console.log(employee
      ? {
          id: employee.id, userId: employee.userId, tenant: employee.customerId, status: employee.status,
          designation: employee.designation?.name ?? null, department: employee.department?.name ?? null,
          teams: employee.teamMembers.map((m: any) => ({ teamId: m.teamId, tenant: m.team?.customerId, active: m.team?.isActive, name: m.team?.name })),
          ledTeams: employee.ledTeams,
        }
      : 'not found');
    const team = await prisma.team.findUnique({
      where: { id: args.teamId },
      select: {
        id: true, customerId: true, isActive: true, name: true, description: true, leaderId: true,
        members: { select: { employeeId: true, employee: { select: { status: true, designation: { select: { name: true } } } } } },
      },
    });
    console.log('  PRODUCTION TEAM');
    console.log(team
      ? { ...team, members: team.members.map((m: any) => ({ employeeId: m.employeeId, status: m.employee?.status, designation: m.employee?.designation?.name ?? null })) }
      : 'not found');

    // Relationship checks, in flow order
    console.log('\nRELATIONSHIP CHECKS (first BROKEN line is the first broken link)');
    const tenant = employee?.customerId ?? null;
    const employeeTeamIds = new Set<number>([
      ...(employee?.teamMembers || []).map((m: any) => Number(m.teamId)),
      ...(employee?.ledTeams || []).map((t: any) => Number(t.id)),
    ]);
    check('lead exists and is WON/CONVERTED/WORK_STARTED', !!lead && ['WON', 'CONVERTED', 'WORK_STARTED'].includes(String(lead.status)), String(lead?.status));
    check('customer.leadId points to the lead', customer?.leadId === args.leadId, `customer.leadId=${customer?.leadId ?? null}`);
    check('lead tenant equals employee tenant', !!lead && lead.customerId === tenant, `lead=${lead?.customerId ?? null} employee=${tenant}`);
    check('customer not deleted and isActive', !!customer && !customer.deletedAt && customer.isActive !== false, `isActive=${customer?.isActive}`);
    check('subscription belongs to customer', subscription?.customerId === args.customerId, `subscription.customerId=${subscription?.customerId ?? null}`);
    check('subscription ACTIVE and not deleted', subscription?.status === 'ACTIVE' && !subscription?.deletedAt, String(subscription?.status));
    check('MonthlySchedule rows exist for subscription', schedules.some((s: any) => s.subscriptionId === args.subscriptionId && !s.deletedAt), `${schedules.length} total`);
    const subWorks = works.filter((w: any) => w.subscriptionId === args.subscriptionId);
    check('Work rows exist for subscription', subWorks.length > 0, `${subWorks.length} of ${works.length}`);
    check('customer.assignedTeamId equals the production team', customer?.assignedTeamId === args.teamId, `assignedTeamId=${customer?.assignedTeamId ?? null}`);
    check('production team tenant equals employee tenant', team?.customerId === tenant, `team=${team?.customerId ?? null}`);
    check('production team active', !!team?.isActive);
    check('employee is a member/leader of the production team', employeeTeamIds.has(args.teamId));
    check('subscription Work rows carry the production teamId', subWorks.length > 0 && subWorks.every((w: any) => w.teamId === args.teamId),
      `teamIds=${[...new Set(subWorks.map((w: any) => w.teamId))].join(',') || 'none'}`);
    const otherAssignees = [...new Set(subWorks.map((w: any) => w.assignedToId).filter((x: any) => x && x !== args.employeeId))];
    check('subscription Work rows not assigned to non-team employees',
      otherAssignees.every((id: any) => (team?.members || []).some((m: any) => m.employeeId === id)),
      `other assignees=${otherAssignees.join(',') || 'none'}`);

    // 8. Calendar evaluation
    const service = new WorkService(prisma as any, new WorkPermissionService(prisma as any));
    (service as any).syncCustomerTeamWorkAssignments = async () => 0;
    (service as any).autoCarryForwardIncompleteWorks = async () => undefined;

    const from = args.from || dateKey(subscription?.startDate) || undefined;
    const to = args.to || dateKey(subscription?.endDate) || undefined;
    const query = from || to ? { dateFrom: from, dateTo: to } : {};
    const targetCustomers = new Set([args.customerId, ...(args.workingCustomerId ? [args.workingCustomerId] : [])]);
    const runMode = async (label: string, options: any) => {
      try {
        const rows: any[] = await service.getEmployeeCalendar(args.employeeId, query, options);
        const scoped = rows.filter((r) => targetCustomers.has(Number(r.customerId)));
        return { label, total: rows.length, ids: new Set(scoped.map((r) => `${r.activityType === 'TASK' ? 'TASK' : 'WORK'}:${r.id}`)), scoped };
      } catch (err: any) {
        return { label, total: -1, ids: new Set<string>(), scoped: [], error: err?.message };
      }
    };
    const assignedOnlyRun = await runMode('assignedOnly (no CALENDAR:VIEW)', { assignedOnly: true });
    const fullRun = await runMode('allTenantCustomers (CALENDAR:VIEW)', { allTenantCustomers: true });

    console.log(`\n8. CALENDAR EVALUATION employee=${args.employeeId} window=${from || 'none'}..${to || 'none'}`);
    for (const run of [assignedOnlyRun, fullRun]) {
      console.log(`  ${run.label}: ${(run as any).error ? `ERROR ${(run as any).error}` : `${run.total} rows total, ${run.scoped.length} for the compared customers`}`);
      for (const r of run.scoped) {
        console.log(`    ${r.activityType === 'TASK' ? 'TASK' : 'WORK'}:${r.id} customer=${r.customerId} ${r.activityType || r.workType} ${r.scheduledDate} ${r.status}`);
      }
    }

    const designation = employee?.designation?.name ?? null;
    const designationTypes = new Set(workTypesForDesignation(designation));
    const viewerIds = new Set<number>([args.employeeId, ...(employee?.userId ? [Number(employee.userId)] : [])]);
    console.log('\n  Per-work filter breakdown (affected customer):');
    for (const w of works) {
      const key = istDateKey(w.scheduledDate);
      const inWindow = (!from || (key && key >= from)) && (!to || (key && key <= to));
      const direct =
        viewerIds.has(Number(w.assignedToId)) || viewerIds.has(Number(w.editorId)) ||
        w.tasks.some((t: any) => viewerIds.has(Number(t.assignedToId))) ||
        viewerIds.has(Number(customer?.assignedEmployeeId)) || viewerIds.has(Number(customer?.createdByEmployeeId));
      const teamMatch =
        employeeTeamIds.has(Number(w.teamId)) || employeeTeamIds.has(Number(customer?.assignedTeamId));
      const unassigned = !w.assignedToId && !w.editorId;
      const assignedToOther = !!w.assignedToId && !viewerIds.has(Number(w.assignedToId));
      const designationMatch = designationTypes.has(String(w.workType));
      console.log({
        work: w.id,
        workType: w.workType,
        date: key,
        statusOk: w.status !== WorkStatus.CANCELLED,
        customerActive: !!customer && !customer.deletedAt && customer.isActive !== false,
        inWindow,
        direct,
        teamMatch,
        designationMatch,
        unassigned,
        assignedToOther,
        returnedAssignedOnly: assignedOnlyRun.ids.has(`WORK:${w.id}`),
        returnedFullMode: fullRun.ids.has(`WORK:${w.id}`),
      });
    }

    if (args.workingCustomerId) {
      const working = await prisma.customer.findUnique({ where: { id: args.workingCustomerId }, select: customerSelect });
      const workingWorks = await prisma.work.findMany({
        where: { customerId: args.workingCustomerId },
        select: { id: true, subscriptionId: true, teamId: true, assignedToId: true, editorId: true, workType: true, status: true },
      });
      console.log(`\nCOMPARISON customer ${args.workingCustomerId} (working)`);
      console.log(working ? { ...working, deletedAt: undefined, deleted: !!working.deletedAt } : 'not found');
      const summarize = (rows: any[]) => ({
        works: rows.length,
        teamIds: [...new Set(rows.map((w) => w.teamId))],
        assignees: [...new Set(rows.map((w) => w.assignedToId))],
        unassigned: rows.filter((w) => !w.assignedToId && !w.editorId).length,
      });
      console.log('  affected:', summarize(works));
      console.log('  working: ', summarize(workingWorks));
    }
  } finally {
    await base.$disconnect();
  }
}

main().catch((err) => {
  console.error(`Diagnostic failed: ${err?.message || err}`);
  process.exit(1);
});
