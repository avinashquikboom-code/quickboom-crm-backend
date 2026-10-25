import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== 1. EMPLOYEES & USERS ===');
  const employees = await prisma.employee.findMany({
    include: {
      user: {
        select: {
          id: true,
          email: true,
          userRoles: {
            include: {
              role: true,
            },
          },
          isActive: true,
        },
      },
      department: true,
      designation: true,
      teamMembers: {
        include: {
          team: true,
        },
      },
      ledTeams: true,
    },
  });

  for (const emp of employees) {
    console.log({
      id: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      userId: emp.userId,
      roles: emp.user?.userRoles.map(ur => ur.role.name),
      tenantCustomerId: emp.customerId,
      department: emp.department?.name,
      designation: emp.designation?.name,
      teams: emp.teamMembers.map(tm => ({ teamId: tm.teamId, name: tm.team?.name, isActive: tm.team?.isActive })),
      ledTeams: emp.ledTeams.map(lt => ({ teamId: lt.id, name: lt.name, isActive: lt.isActive })),
    });
  }

  console.log('\n=== 2. TEAMS ===');
  const teams = await prisma.team.findMany({
    include: {
      leader: {
        select: { id: true, firstName: true, lastName: true },
      },
      members: {
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });
  for (const t of teams) {
    console.log({
      id: t.id,
      name: t.name,
      customerId: t.customerId,
      isActive: t.isActive,
      leader: t.leader ? `${t.leader.firstName} ${t.leader.lastName} (${t.leader.id})` : null,
      members: t.members.map(m => `${m.employee?.firstName} ${m.employee?.lastName} (${m.employeeId})`),
    });
  }

  console.log('\n=== 3. CUSTOMERS ===');
  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      name: true,
      companyName: true,
      assignedTeamId: true,
      assignedEmployeeId: true,
      isActive: true,
      deletedAt: true,
    },
  });
  console.log(customers);

  console.log('\n=== 4. WORKS ===');
  const works = await prisma.work.findMany({
    select: {
      id: true,
      customerId: true,
      subscriptionId: true,
      teamId: true,
      assignedToId: true,
      editorId: true,
      workType: true,
      title: true,
      scheduledDate: true,
      status: true,
      tasks: {
        select: {
          id: true,
          title: true,
          assignedToId: true,
          status: true,
        },
      },
    },
  });
  console.log(`Total works: ${works.length}`);
  for (const w of works.slice(0, 30)) {
    console.log({
      id: w.id,
      customerId: w.customerId,
      teamId: w.teamId,
      assignedToId: w.assignedToId,
      editorId: w.editorId,
      workType: w.workType,
      title: w.title,
      scheduledDate: w.scheduledDate,
      status: w.status,
      tasks: w.tasks,
    });
  }

  console.log('\n=== 5. TASKS (Task model) ===');
  const tasks = await prisma.task.findMany({
    select: {
      id: true,
      customerId: true,
      employeeId: true,
      assignedToId: true,
      title: true,
      status: true,
      dueDate: true,
      startDate: true,
      dueAt: true,
      deletedAt: true,
    },
  });
  console.log(`Total tasks: ${tasks.length}`);
  for (const t of tasks.slice(0, 10)) {
    console.log(t);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
