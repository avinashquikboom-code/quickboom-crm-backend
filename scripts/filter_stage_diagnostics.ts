import { PrismaClient, WorkStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnoseForEmployee(employeeId: number) {
  console.log(`\n======================================================`);
  console.log(`DIAGNOSTICS FOR EMPLOYEE ID: ${employeeId}`);
  console.log(`======================================================`);

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      designation: true,
      department: true,
      teamMembers: { include: { team: true } },
      ledTeams: true,
      user: { include: { userRoles: { include: { role: true } } } },
    },
  });

  if (!emp) {
    console.log(`Employee ${employeeId} not found!`);
    return;
  }

  const tenantCustomerId = emp.customerId;
  console.log(`Employee Name: ${emp.firstName} ${emp.lastName}`);
  console.log(`User ID: ${emp.userId}`);
  console.log(`Designation: ${emp.designation?.name}`);
  console.log(`Department: ${emp.department?.name}`);
  console.log(`Tenant Customer ID: ${tenantCustomerId}`);
  console.log(`Teams:`, emp.teamMembers.map((tm) => ({ id: tm.teamId, name: tm.team?.name })));

  // Stage 1: Total work records for the correct tenant
  const totalTenantWorks = await prisma.work.count({
    where: { customerId: tenantCustomerId },
  });
  console.log(`Stage 1 - Total work records for tenant (${tenantCustomerId}): ${totalTenantWorks}`);

  // Stage 2: Records remaining after active/deleted customer filters
  const activeCustomerWorks = await prisma.work.count({
    where: {
      customerId: tenantCustomerId,
      customer: { deletedAt: null, NOT: { isActive: false } },
    },
  });
  console.log(`Stage 2 - Records after customer active/deleted filters: ${activeCustomerWorks}`);

  // Stage 3: Direct employee assignments
  const directAssignWorks = await prisma.work.findMany({
    where: {
      customerId: tenantCustomerId,
      OR: [
        { assignedToId: employeeId },
        { editorId: employeeId },
        { tasks: { some: { assignedToId: employeeId } } },
        { customer: { assignedEmployeeId: employeeId } },
      ],
    },
    select: { id: true, title: true, workType: true, assignedToId: true, editorId: true },
  });
  console.log(`Stage 3 - Direct employee assignments: ${directAssignWorks.length}`, directAssignWorks);

  // Direct user-id assignments (if userId differs from employeeId)
  if (emp.userId && emp.userId !== employeeId) {
    const directUserWorks = await prisma.work.findMany({
      where: {
        customerId: tenantCustomerId,
        OR: [
          { assignedToId: emp.userId },
          { editorId: emp.userId },
          { tasks: { some: { assignedToId: emp.userId } } },
          { customer: { assignedEmployeeId: emp.userId } },
        ],
      },
      select: { id: true, title: true, workType: true, assignedToId: true, editorId: true },
    });
    console.log(`Stage 3b - Direct user ID assignments (userId=${emp.userId}): ${directUserWorks.length}`, directUserWorks);
  }

  // Stage 4: Records matching authorized team assignments
  const memberTeamIds = emp.teamMembers.map((tm) => tm.teamId);
  const ledTeamIds = emp.ledTeams.map((lt) => lt.id);
  const allTeamIds = Array.from(new Set([...memberTeamIds, ...ledTeamIds]));

  const teamAssignedWorks = await prisma.work.findMany({
    where: {
      customerId: tenantCustomerId,
      teamId: { in: allTeamIds },
    },
    select: { id: true, title: true, workType: true, teamId: true },
  });
  console.log(`Stage 4 - Records matching authorized team assignments (teams=${allTeamIds.join(',')}): ${teamAssignedWorks.length}`, teamAssignedWorks);

  // Stage 5: Records matching authorized customer-team relationships
  const customerTeamWorks = await prisma.work.findMany({
    where: {
      customerId: tenantCustomerId,
      customer: {
        assignedTeamId: { in: allTeamIds },
      },
    },
    select: { id: true, title: true, workType: true, customerId: true },
  });
  console.log(`Stage 5 - Records matching authorized customer-team relationships: ${customerTeamWorks.length}`, customerTeamWorks);

  // Stage 6: Records matching status and date filters
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startOfMonth = new Date(Date.UTC(year, month - 1, 0, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(year, month, 2, 23, 59, 59, 999));

  const dateFilteredWorks = await prisma.work.findMany({
    where: {
      customerId: tenantCustomerId,
      status: { not: WorkStatus.CANCELLED },
      scheduledDate: { gte: startOfMonth, lte: endOfMonth },
    },
    select: { id: true, title: true, scheduledDate: true, status: true },
  });
  console.log(`Stage 6 - Records matching status and month (${month}/${year}) filters: ${dateFilteredWorks.length}`);
}

async function main() {
  const employees = await prisma.employee.findMany({ select: { id: true } });
  for (const e of employees) {
    await diagnoseForEmployee(e.id);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
