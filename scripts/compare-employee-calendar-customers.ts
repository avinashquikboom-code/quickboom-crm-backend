/** Read-only: npx ts-node scripts/compare-employee-calendar-customers.ts 114 116 113
 * Pass actual Customer.id values from the affected database (not display-code suffixes).
 * The first customer is the working reference. No writes or calendar side effects.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function main() {
  const ids = process.argv.slice(2).map(Number);
  if (!ids.length || ids.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Supply actual positive Customer.id values, working reference first');
  }
  const prisma = new PrismaClient();
  try {
    for (const id of ids) {
      const customer = await prisma.customer.findUnique({ where: { id },
        select: { id: true, name: true, isActive: true, assignedTeamId: true,
          assignedEmployeeId: true, leadId: true, source: true, deletedAt: true } });
      if (!customer) { console.log(JSON.stringify({ customerId: id, found: false })); continue; }
      const [plans, schedules, works, taskCount] = await Promise.all([
        prisma.customerSubscription.findMany({ where: { customerId: id },
          select: { id: true, planId: true, status: true, startDate: true, endDate: true,
            createdAt: true, deletedAt: true, customFeatures: true,
            plan: { select: { name: true, features: true } } } }),
        prisma.monthlySchedule.findMany({ where: { customerId: id },
          select: { id: true, subscriptionId: true, planId: true, status: true,
            startDate: true, endDate: true, assignedEmployeeId: true, deletedAt: true } }),
        prisma.work.findMany({ where: { customerId: id }, orderBy: { scheduledDate: 'asc' },
          select: { id: true, subscriptionId: true, planId: true, entitlementId: true,
            title: true, workType: true, scheduledDate: true, scheduledTime: true,
            teamId: true, assignedToId: true, editorId: true, status: true,
            assignedTo: { select: { departmentId: true } },
            tasks: { select: { id: true, assignedToId: true, status: true, title: true } } } }),
        prisma.task.count({ where: { customerId: id, deletedAt: null } }),
      ]);
      console.log(JSON.stringify({ reference: id === ids[0], customer, plans,
        scheduleCount: schedules.length, workCount: works.length,
        workTaskCount: works.reduce((n, work) => n + work.tasks.length, 0),
        generalTaskCount: taskCount, workTeamIds: [...new Set(works.map(work => work.teamId))],
        schedules, works }, null, 2));
    }
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Comparison failed; check database access and customer IDs.'); process.exitCode = 1; });
