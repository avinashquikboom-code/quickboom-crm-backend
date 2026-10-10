import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { WorkService } from '../src/modules/work/work.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function verify() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const workService = app.get(WorkService);
  const prisma = app.get(PrismaService);

  console.log('==================================================');
  console.log('LIVE READ-ONLY DATABASE & API AUDIT VERIFICATION');
  console.log('==================================================');

  // 1. Inspect DB Work & Customer records
  const totalWorks = await prisma.work.count();
  const assignedWorks = await prisma.work.count({
    where: {
      OR: [
        { assignedToId: { not: null } },
        { editorId: { not: null } },
        { teamId: { not: null } },
      ],
    },
  });
  const unassignedWorks = await prisma.work.count({
    where: {
      assignedToId: null,
      editorId: null,
      teamId: null,
    },
  });
  console.log(`\n1. DATABASE WORK COUNTS:`);
  console.log(`- Total Work records: ${totalWorks}`);
  console.log(`- Assigned Work records (assignedToId/editorId/teamId): ${assignedWorks}`);
  console.log(`- Completely Unassigned Work records: ${unassignedWorks}`);

  // 2. Inspect Customer Team Allotment
  const customers = await prisma.customer.findMany({
    select: { id: true, name: true, assignedTeamId: true, assignedEmployeeId: true },
  });
  console.log(`\n2. CUSTOMERS IN DATABASE:`);
  console.log(customers);

  // 3. Inspect Employees & Teams
  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      designation: { select: { name: true } },
      department: { select: { name: true } },
      teamMembers: { select: { team: { select: { id: true, name: true } } } },
    },
  });
  console.log(`\n3. EMPLOYEES IN DATABASE:`);
  console.log(employees);

  // 4. Test Live API via WorkService for each employee
  for (const emp of employees) {
    console.log(`\n4. TESTING API FOR EMPLOYEE ${emp.id} (${emp.firstName} ${emp.lastName} - ${emp.designation?.name}):`);
    const calendarMonth = await workService.getEmployeeCalendar(emp.id, { month: 10, year: 2026 }, { allTenantCustomers: true });
    const metrics = await workService.getProductionMetrics(emp.id, { month: 10, year: 2026 }, { allTenantCustomers: true });
    const filterOptions = await workService.getProductionFilterOptions(emp.id);

    console.log(`- GET /api/v1/works/employee/calendar (month=10, year=2026): count = ${calendarMonth.length}`);
    console.log(`- GET /api/v1/works/production/metrics:`, metrics);
    console.log(`- GET /api/v1/works/production/filter-options:`, {
      customerCount: filterOptions.customers.length,
      employeeCount: filterOptions.employees.length,
      teamCount: filterOptions.teams.length,
    });
  }

  await app.close();
}

verify().catch((err) => {
  console.error('Verification error:', err);
  process.exit(1);
});
