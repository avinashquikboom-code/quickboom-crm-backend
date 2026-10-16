/** Read-only production snapshot; never instantiate application services. */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

async function main() {
  const args = process.argv.slice(2);
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--employee-name', '--customers', '--from', '--to'].includes(args[i]) ||
        !args[i + 1] || values[args[i]]) throw new Error('Invalid or duplicate argument');
    values[args[i]] = args[i + 1];
  }
  const name = (values['--employee-name'] || '').trim().split(/\s+/);
  const rawIds = (values['--customers'] || '').split(',');
  const customerIds = rawIds.map(Number);
  const from = values['--from'];
  const to = values['--to'];
  if (name.length < 2 || !rawIds.every(id => /^[1-9]\d*$/.test(id)) ||
      !customerIds.every(Number.isSafeInteger) || customerIds.length > 20 ||
      ![from, to].every(date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') &&
        !isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date) || from > to) {
    throw new Error('Provide --employee-name "First Last" --customers ID,ID --from YYYY-MM-DD --to YYYY-MM-DD');
  }
  const prisma = new PrismaClient({ log: [] });
  try {
    const report = await prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '15000ms'`);
      const employees = await tx.employee.findMany({
        where: { firstName: { equals: name[0], mode: 'insensitive' },
          lastName: { equals: name.slice(1).join(' '), mode: 'insensitive' } },
        select: { id: true, userId: true, customerId: true, status: true,
          designation: { select: { name: true } }, department: { select: { name: true } } },
      });
      if (employees.length !== 1) return { blocked: 'Employee name must identify exactly one account', candidates: employees };
      const employee = employees[0];
      const teams = await tx.team.findMany({
        where: { OR: [{ leaderId: employee.id }, { members: { some: { employeeId: employee.id } } }] },
        select: { id: true, customerId: true, isActive: true, leaderId: true },
      });
      const activeTeamIds = teams.filter(t => t.isActive && t.customerId === employee.customerId).map(t => t.id);
      const customers = await tx.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, leadId: true, isActive: true, deletedAt: true,
          assignedTeamId: true, assignedEmployeeId: true,
          assignedTeam: { select: { id: true, customerId: true, isActive: true } },
          originLead: { select: { id: true, customerId: true } },
          subscriptions: { where: { deletedAt: null }, select: {
            id: true, planId: true, status: true, startDate: true, endDate: true,
            _count: { select: { monthlySchedules: true, works: true } },
          } },
          works: { select: { id: true, subscriptionId: true, customerId: true, teamId: true,
            assignedToId: true, editorId: true, workType: true, status: true, scheduledDate: true,
            tasks: { select: { id: true, assignedToId: true, status: true } },
          } },
        },
      });
      const day = (date: Date) => new Date(date.getTime() + 19800000).toISOString().slice(0, 10);
      return {
        readOnly: true, authenticatedApiVerified: false, employee, teams, activeTeamIds,
        range: { from, to, timezone: 'Asia/Kolkata' },
        missingCustomerIds: customerIds.filter(id => !customers.some(c => c.id === id)),
        customers: customers.map(({ works, ...customer }) => {
          const inRange = works.filter(w => w.status !== 'CANCELLED' && day(w.scheduledDate) >= from && day(w.scheduledDate) <= to);
          const direct = (w: typeof works[number]) => [w.assignedToId, w.editorId, ...w.tasks.map(t => t.assignedToId)].includes(employee.id);
          const team = (w: typeof works[number]) => activeTeamIds.includes(w.teamId) || activeTeamIds.includes(customer.assignedTeamId);
          return { ...customer,
            workCount: works.length, rangeWorkCount: inRange.length,
            directlyAssignedRangeCount: inRange.filter(direct).length,
            teamRelatedRangeCount: inRange.filter(team).length,
            unassignedRangeCount: inRange.filter(w => w.assignedToId == null && w.editorId == null).length,
            activeSubscriptionWithoutWorks: customer.subscriptions.filter(s => s.status === 'ACTIVE' && s._count.works === 0).map(s => s.id),
            works: inRange.map(w => ({ ...w, calendarDay: day(w.scheduledDate),
              assignedToEmployee: direct(w), relatedToEmployeeTeam: team(w) })),
          };
        }),
        caveat: 'Stored records only. Team/direct flags are diagnostic evidence, not permission grants or predictions of the authenticated API response.',
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000, maxWait: 5000 });
    console.log(JSON.stringify(report, null, 2));
  } catch (error: any) {
    // Do not print connection strings, query arguments or raw database errors.
    console.error(JSON.stringify({ diagnosticFailed: true, code: error.code || error.errorCode || 'UNKNOWN' }));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Invalid arguments. Expected --employee-name "First Last" --customers ID,ID --from YYYY-MM-DD --to YYYY-MM-DD');
  process.exitCode = 2;
});
