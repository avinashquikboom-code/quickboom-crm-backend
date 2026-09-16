import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DataManagementService } from '../src/modules/data-management/data-management.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function runRealDbResetVerification() {
  console.log('=== STARTING REAL DATABASE RESET VERIFICATION ===\n');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataManagementService = app.get(DataManagementService);
  const prisma = app.get(PrismaService);

  let custA: any = null;
  let custB: any = null;
  let empX: any = null;
  let empY: any = null;

  try {
    // 1. Create two isolated test customers
    custA = await prisma.customer.create({
      data: {
        name: `Test Cust A ${Date.now()}`,
        companyName: 'Company A Reset',
        isActive: true,
      },
    });

    custB = await prisma.customer.create({
      data: {
        name: `Test Cust B ${Date.now()}`,
        companyName: 'Company B Isolated',
        isActive: true,
      },
    });

    console.log(`[SETUP] Created Test Customers: Cust A (${custA.id}), Cust B (${custB.id})`);

    // 2. Populate Cust A with multi-module transactional data
    await prisma.lead.create({
      data: {
        customerId: custA.id,
        title: 'Cust A Lead Title',
        firstName: 'John',
        lastName: 'LeadA',
        phone: '1111111111',
        status: 'NEW',
        createdById: 1,
      },
    });
    await prisma.contact.create({
      data: {
        customerId: custA.id,
        firstName: 'Contact',
        lastName: 'CustA',
      },
    });
    await prisma.company.create({
      data: {
        customerId: custA.id,
        name: 'Cust A Company Rel',
      },
    });
    await prisma.task.create({
      data: {
        customerId: custA.id,
        title: 'Cust A Task',
        status: 'PENDING',
        createdById: 1,
      },
    });
    await prisma.notification.create({
      data: {
        customerId: custA.id,
        userId: 1,
        title: 'Cust A Notif',
        message: 'Hello A',
        type: 'SYSTEM',
      },
    });

    // 3. Populate Cust B with transactional data (Isolation check)
    const leadB = await prisma.lead.create({
      data: {
        customerId: custB.id,
        title: 'Cust B Preserved Lead',
        firstName: 'Jane',
        lastName: 'LeadB',
        phone: '2222222222',
        status: 'NEW',
        createdById: 1,
      },
    });
    await prisma.task.create({
      data: {
        customerId: custB.id,
        title: 'Cust B Preserved Task',
        status: 'PENDING',
        createdById: 1,
      },
    });

    console.log(`[SETUP] Populated Cust A (5 transactional records) and Cust B (2 records)`);

    // Verify initial summary for Cust A
    const summaryA = await dataManagementService.getSummary(custA.id);
    console.log(`[CHECK] Cust A initial CRM total: ${summaryA.transactional.crm.total}`);
    if (summaryA.transactional.crm.total < 3) {
      throw new Error('Cust A initial data population failed');
    }

    // 4. TEST 1: Customer-Wise Data Reset for Cust A
    console.log('\n--- TEST 1: Executing Customer-Wise Reset on Cust A ---');
    const resetResultA = await dataManagementService.resetAllTransactional(
      custA.id,
      1,
      'SUPER_ADMIN',
      { scope: 'transactional', confirmation: 'RESET ALL DATA', reason: 'Real DB Test' },
    );
    console.log(`[RESULT] Customer Reset Output:`, resetResultA.message);

    // Verify Cust A records are 0
    const afterSummaryA = await dataManagementService.getSummary(custA.id);
    console.log(`[CHECK] Cust A after reset CRM total: ${afterSummaryA.transactional.crm.total}`);
    if (afterSummaryA.transactional.crm.total !== 0) {
      throw new Error(`Expected Cust A CRM records to be 0, got ${afterSummaryA.transactional.crm.total}`);
    }

    // Verify Cust B records remain untouched
    const afterSummaryB = await dataManagementService.getSummary(custB.id);
    console.log(`[CHECK] Cust B after reset CRM total (should be untouched): ${afterSummaryB.transactional.crm.total}`);
    if (afterSummaryB.transactional.crm.total < 2) {
      throw new Error('Tenant isolation violated: Cust B records were deleted during Cust A reset!');
    }
    console.log('✓ TEST 1 PASSED: Customer-wise reset deleted Cust A data and preserved Cust B data.\n');

    // 5. TEST 2: Employee-Wise Data Reset on Cust B
    console.log('--- TEST 2: Executing Employee-Wise Reset on Cust B ---');
    empX = await prisma.employee.create({
      data: {
        customerId: custB.id,
        employeeCode: `EMPX-${Date.now().toString().slice(-4)}`,
        firstName: 'Emp',
        lastName: 'X',
        email: `empx_${Date.now()}@custb.com`,
        status: 'ACTIVE',
      },
    });

    empY = await prisma.employee.create({
      data: {
        customerId: custB.id,
        employeeCode: `EMPY-${Date.now().toString().slice(-4)}`,
        firstName: 'Emp',
        lastName: 'Y',
        email: `empy_${Date.now()}@custb.com`,
        status: 'ACTIVE',
      },
    });

    // Create a team with Emp X as leader
    const testTeam = await prisma.team.create({
      data: {
        customerId: custB.id,
        name: `Test Team ${Date.now().toString().slice(-4)}`,
        leaderId: empX.id,
      },
    });

    // Assign Emp X to Cust B's lead
    await prisma.lead.update({
      where: { id: leadB.id },
      data: { employeeId: empX.id },
    });

    // Create employee-specific records for Emp X
    const attX = await prisma.attendance.create({
      data: {
        customerId: custB.id,
        employeeId: empX.id,
        date: new Date(),
        status: 'PRESENT',
      },
    });
    await prisma.attendanceBreak.create({
      data: {
        attendanceId: attX.id,
        breakStart: new Date(),
      },
    });
    await prisma.employeeLocation.create({
      data: {
        customerId: custB.id,
        employeeId: empX.id,
        latitude: 19.076,
        longitude: 72.8777,
      },
    });
    await prisma.task.create({
      data: {
        customerId: custB.id,
        employeeId: empX.id,
        title: 'Emp X Personal Task',
        status: 'PENDING',
        createdById: 1,
      },
    });
    await prisma.employeeClaim.create({
      data: {
        customerId: custB.id,
        employeeId: empX.id,
        category: 'TRAVEL',
        amount: 250,
        description: 'Emp X Travel Claim',
      },
    });

    // Create employee-specific records for Emp Y (Isolation check)
    await prisma.attendance.create({
      data: {
        customerId: custB.id,
        employeeId: empY.id,
        date: new Date(),
        status: 'PRESENT',
      },
    });

    // Verify Emp X summary before reset
    const empXSummaryBefore = await dataManagementService.getEmployeeSummary(custB.id, empX.id);
    console.log(`[CHECK] Emp X initial total records: ${empXSummaryBefore.counts.total}`);
    if (empXSummaryBefore.counts.total < 4) {
      throw new Error(`Emp X initial records count mismatch, expected >= 4, got ${empXSummaryBefore.counts.total}`);
    }

    // Execute Employee-Wise Reset on Emp X
    const empXResetResult = await dataManagementService.resetEmployeeAllTransactional(
      custB.id,
      1,
      'SUPER_ADMIN',
      empX.id,
      { confirmation: 'RESET ALL DATA FOR EMPLOYEE', reason: 'Real DB Test Emp X' },
    );
    console.log(`[RESULT] Employee Reset Output:`, empXResetResult.message);

    // Verify Emp X counts are 0
    const empXSummaryAfter = await dataManagementService.getEmployeeSummary(custB.id, empX.id);
    console.log(`[CHECK] Emp X after reset total records: ${empXSummaryAfter.counts.total}`);
    if (empXSummaryAfter.counts.total !== 0) {
      throw new Error(`Emp X reset failed! Expected 0 remaining records, got ${empXSummaryAfter.counts.total}`);
    }

    // Verify Shared Lead was unassigned, NOT deleted
    const checkLeadB = await prisma.lead.findUnique({ where: { id: leadB.id } });
    if (!checkLeadB) {
      throw new Error('Lead B was deleted during employee reset!');
    }
    if (checkLeadB.employeeId !== null) {
      throw new Error(`Lead B employeeId was not nullified! Value: ${checkLeadB.employeeId}`);
    }
    console.log(`[CHECK] Shared Lead was preserved and unassigned (employeeId: null).`);

    // Verify Team leader was unassigned, NOT deleted
    const checkTeam = await prisma.team.findUnique({ where: { id: testTeam.id } });
    if (!checkTeam) {
      throw new Error('Team was deleted during employee reset!');
    }
    if (checkTeam.leaderId !== null) {
      throw new Error(`Team leaderId was not nullified! Value: ${checkTeam.leaderId}`);
    }
    console.log(`[CHECK] Team leader was unassigned (leaderId: null).`);

    // Verify Emp Y records remain intact
    const empYSummaryAfter = await dataManagementService.getEmployeeSummary(custB.id, empY.id);
    console.log(`[CHECK] Emp Y after reset total records (should be 1): ${empYSummaryAfter.counts.total}`);
    if (empYSummaryAfter.counts.total !== 1) {
      throw new Error(`Emp Y records were affected by Emp X reset! Got ${empYSummaryAfter.counts.total}`);
    }

    // Verify Emp X master record remains intact
    const checkEmpX = await prisma.employee.findUnique({ where: { id: empX.id } });
    if (!checkEmpX) {
      throw new Error('Employee X master record was deleted during transactional reset!');
    }
    console.log(`[CHECK] Employee X master record remains intact (status: ${checkEmpX.status}).`);

    console.log('✓ TEST 2 PASSED: Employee-wise reset deleted transactional data, unlinked shared entities, and preserved master profile & other employees.\n');

    console.log('=== ALL REAL DATABASE TESTS PASSED SUCCESSFULLY! ===\n');
  } finally {
    // Clean up test data
    console.log('[CLEANUP] Purging test records...');
    try {
      if (empX) {
        await prisma.attendance.deleteMany({ where: { employeeId: { in: [empX.id, empY?.id].filter(Boolean) } } });
        await prisma.employee.deleteMany({ where: { id: { in: [empX.id, empY?.id].filter(Boolean) } } });
      }
      if (custA) {
        await prisma.team.deleteMany({ where: { customerId: { in: [custA.id, custB?.id].filter(Boolean) } } });
        await prisma.lead.deleteMany({ where: { customerId: { in: [custA.id, custB?.id].filter(Boolean) } } });
        await prisma.task.deleteMany({ where: { customerId: { in: [custA.id, custB?.id].filter(Boolean) } } });
        await prisma.auditLog.deleteMany({ where: { customerId: { in: [custA.id, custB?.id].filter(Boolean) } } });
        await prisma.customer.deleteMany({ where: { id: { in: [custA.id, custB?.id].filter(Boolean) } } });
      }
      console.log('[CLEANUP] Done.');
    } catch (cleanErr: any) {
      console.warn('[CLEANUP ERROR]:', cleanErr.message);
    }
    await app.close();
  }
}

runRealDbResetVerification().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
