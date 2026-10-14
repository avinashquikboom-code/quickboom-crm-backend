/** Dry-run by default. Instantiates no Nest application, timers, schema bootstrap or notifications. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { WorkService } from '../src/modules/work/work.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const value = (key: string) => args[args.indexOf(key) + 1];
  const customerId = Number(args.includes('--customer-id') ? value('--customer-id') : NaN);
  const compareId = args.includes('--compare-customer-id') ? Number(value('--compare-customer-id')) : null;
  if (!Number.isSafeInteger(customerId) || customerId <= 0 ||
    (compareId !== null && (!Number.isSafeInteger(compareId) || compareId <= 0))) {
    throw new Error('Usage: ts-node scripts/repair-production-work-assignments.ts --customer-id ID [--compare-customer-id ID] [--apply]');
  }
  const db = new PrismaClient();
  const snapshot = (tx: any, id: number) => tx.customer.findUnique({
    where: { id },
    select: {
      id: true, leadId: true, assignedTeamId: true,
      assignedTeam: { select: { id: true, customerId: true, name: true, isActive: true } },
      works: { select: { id: true, customerId: true, subscriptionId: true, entitlementId: true, workType: true, status: true, teamId: true,
        assignedToId: true, editorId: true, scheduledDate: true,
        tasks: { select: { id: true, workId: true, title: true, status: true, assignedToId: true } } } },
    },
  });
  try {
    const before = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return { customer: await snapshot(tx, customerId), comparison: compareId ? await snapshot(tx, compareId) : null };
    });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', before }, null, 2));
    if (!apply) return;
    if (!before.customer?.leadId) throw new Error('This repair applies only to Lead-converted customers; registration customers are unchanged.');
    const service = new WorkService(db as PrismaService);
    await db.$transaction(async tx => {
      const teamId = await service.resolveCustomerProductionTeam(customerId, tx);
      if (!teamId) throw new Error('No unique recorded production team. Assign the customer production team before repair.');
      await service.syncCustomerTeamWorkAssignments(customerId, teamId, tx, { onlyMissing: true });
    }, { timeout: 60000 });
    console.log(JSON.stringify({ after: await snapshot(db, customerId) }, null, 2));
  } finally {
    await db.$disconnect();
  }
}
main().catch(error => { console.error(String(error.name).startsWith('Prisma') ? (error.code || error.name) : error.message); process.exitCode = 1; });
