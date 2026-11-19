import { PrismaService } from '../../prisma/prisma.service';
import { DataGovernanceService } from './data-governance.service';
import { MasterService } from '../master/master.service';
import { LeaveService } from '../leave/leave.service';
import { DealService } from '../deal/deal.service';
import { randomUUID } from 'crypto';

describe('DataGovernanceService Comprehensive 11 Categories Real DB Verification', () => {
  let prisma: PrismaService;
  let service: DataGovernanceService;
  let masterService: MasterService;
  let leaveService: LeaveService;
  let dealService: DealService;
  const tenantId = 2; // Tenant in local PostgreSQL DB

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new DataGovernanceService(prisma);
    masterService = new MasterService(prisma);
    leaveService = new LeaveService(prisma);
    dealService = new DealService(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  // Helper seed functions for each of the 11 categories
  const seeders: Record<string, () => Promise<number>> = {
    'expense-categories': async () => {
      await prisma.masterItem.createMany({
        data: [
          { customerId: tenantId, type: 'EXPENSE_CATEGORY', name: 'Travel Test', code: 'EXP-TRV-T', isActive: true },
          { customerId: tenantId, type: 'EXPENSE_CATEGORY', name: 'Meals Test', code: 'EXP-MLS-T', isActive: true },
        ],
      });
      return 2;
    },
    'task-status': async () => {
      await prisma.masterItem.createMany({
        data: [
          { customerId: tenantId, type: 'TASK_STATUS', name: 'Review Test', code: 'TS-REV-T', isActive: true },
          { customerId: tenantId, type: 'TASK_STATUS', name: 'QA Test', code: 'TS-QA-T', isActive: true },
        ],
      });
      return 2;
    },
    'departments': async () => {
      await prisma.department.createMany({
        data: [
          { customerId: tenantId, name: 'Operations Test', code: 'DEP-OPS-T' },
          { customerId: tenantId, name: 'Support Test', code: 'DEP-SUP-T' },
        ],
      });
      return 2;
    },
    'stage-management': async () => {
      await prisma.leadStage.createMany({
        data: [
          { customerId: tenantId, key: 'init-contact-test', name: 'Initial Contact Test', sortOrder: 1 },
          { customerId: tenantId, key: 'negotiate-test', name: 'Negotiation Test', sortOrder: 2 },
        ],
      });
      const p = await prisma.pipeline.create({
        data: { customerId: tenantId, name: 'Sales Pipeline Test' },
      });
      await prisma.pipelineStage.createMany({
        data: [
          { pipelineId: p.id, name: 'Stage 1 Test', order: 1 },
          { pipelineId: p.id, name: 'Stage 2 Test', order: 2 },
        ],
      });
      return 5; // 2 lead stages + 1 pipeline + 2 pipeline stages
    },
    'employee-types': async () => {
      await prisma.masterItem.createMany({
        data: [
          { customerId: tenantId, type: 'EMPLOYEE_TYPE', name: 'Contractor Test', code: 'EMP-CTR-T', isActive: true },
          { customerId: tenantId, type: 'EMPLOYEE_TYPE', name: 'Intern Test', code: 'EMP-INT-T', isActive: true },
        ],
      });
      return 2;
    },
    'leave-types': async () => {
      await prisma.leaveType.createMany({
        data: [
          { customerId: tenantId, name: 'Sick Leave Test', code: 'SL-T', daysAllowedPerYear: 10 },
          { customerId: tenantId, name: 'Casual Leave Test', code: 'CL-T', daysAllowedPerYear: 12 },
        ],
      });
      return 2;
    },
    'leave-policies': async () => {
      await prisma.leavePolicy.createMany({
        data: [
          { customerId: tenantId, name: 'Standard Leave Policy Test' },
          { customerId: tenantId, name: 'Executive Leave Policy Test' },
        ],
      });
      return 2;
    },
    'work-types': async () => {
      await prisma.masterItem.createMany({
        data: [
          { customerId: tenantId, type: 'WORK_TYPE', name: 'Field Work Test', code: 'WT-FLD-T', isActive: true },
          { customerId: tenantId, type: 'WORK_TYPE', name: 'Office Work Test', code: 'WT-OFC-T', isActive: true },
        ],
      });
      return 2;
    },
    'subscription-plans': async () => {
      await prisma.customPlanOrder.create({
        data: {
          customer: { connect: { id: tenantId } },
          orderNumber: `ORD-${Date.now()}-${Math.random()}`,
          selectedFeatures: {},
          subtotal: 1000,
          totalAmount: 1000,
          status: 'PENDING',
        },
      });
      await prisma.customerSubscription.create({
        data: {
          customer: { connect: { id: tenantId } },
          plan: { connect: { id: 1 } },
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
          status: 'ACTIVE',
        },
      });
      return 2;
    },
    'payment-methods': async () => {
      await prisma.masterItem.createMany({
        data: [
          { customerId: tenantId, type: 'PAYMENT_METHOD', name: 'Wire Transfer Test', code: 'PM-WT-T', isActive: true },
          { customerId: tenantId, type: 'PAYMENT_METHOD', name: 'UPI Test', code: 'PM-UPI-T', isActive: true },
        ],
      });
      return 2;
    },
    'loan-types': async () => {
      await prisma.masterItem.createMany({
        data: [
          { customerId: tenantId, type: 'LOAN_TYPE', name: 'Home Loan Test', code: 'LN-HM-T', isActive: true },
          { customerId: tenantId, type: 'LOAN_TYPE', name: 'Education Loan Test', code: 'LN-EDU-T', isActive: true },
        ],
      });
      return 2;
    },
  };

  // Helper count functions for each category directly in PostgreSQL
  const countInDb: Record<string, () => Promise<number>> = {
    'expense-categories': () => prisma.masterItem.count({ where: { customerId: tenantId, type: 'EXPENSE_CATEGORY' } }),
    'task-status': () => prisma.masterItem.count({ where: { customerId: tenantId, type: 'TASK_STATUS' } }),
    'departments': () => prisma.department.count({ where: { customerId: tenantId } }),
    'stage-management': async () => {
      const ls = await prisma.leadStage.count({ where: { customerId: tenantId } });
      const p = await prisma.pipeline.count({ where: { customerId: tenantId } });
      const ps = await prisma.pipelineStage.count({ where: { pipeline: { customerId: tenantId } } });
      return ls + p + ps;
    },
    'employee-types': () => prisma.masterItem.count({ where: { customerId: tenantId, type: 'EMPLOYEE_TYPE' } }),
    'leave-types': () => prisma.leaveType.count({ where: { customerId: tenantId } }),
    'leave-policies': () => prisma.leavePolicy.count({ where: { customerId: tenantId } }),
    'work-types': () => prisma.masterItem.count({ where: { customerId: tenantId, type: 'WORK_TYPE' } }),
    'subscription-plans': async () => {
      const cpo = await prisma.customPlanOrder.count({ where: { customerId: tenantId } });
      const cs = await prisma.customerSubscription.count({ where: { customerId: tenantId } });
      return cpo + cs;
    },
    'payment-methods': () => prisma.masterItem.count({ where: { customerId: tenantId, type: 'PAYMENT_METHOD' } }),
    'loan-types': () => prisma.masterItem.count({ where: { customerId: tenantId, type: 'LOAN_TYPE' } }),
  };

  const categories = [
    { id: 'expense-categories', name: 'Expense Category' },
    { id: 'task-status', name: 'Task Status' },
    { id: 'departments', name: 'Department Type' },
    { id: 'stage-management', name: 'Stage Management' },
    { id: 'employee-types', name: 'Employee Type' },
    { id: 'leave-types', name: 'Leave Type' },
    { id: 'leave-policies', name: 'Leave Policy' },
    { id: 'work-types', name: 'Work Type' },
    { id: 'subscription-plans', name: 'Subscription Plan' },
    { id: 'payment-methods', name: 'Payment Method' },
    { id: 'loan-types', name: 'Loan Type' },
  ];

  describe('Part 1: Individual Category Reset & Anti-Reseed Verification on Real DB', () => {
    for (const cat of categories) {
      it(`seeds, previews, resets to 0, and avoids re-seeding for ${cat.name} (${cat.id})`, async () => {
        // Step 1: Seed records
        await seeders[cat.id]();
        const beforeCount = await countInDb[cat.id]();
        expect(beforeCount).toBeGreaterThan(0);

        // Step 2: Preview Reset
        const preview = await service.previewReset(tenantId, {
          modules: [cat.id],
          scope: 'selected',
        });
        expect(preview.totalEligibleRecords).toBe(beforeCount);

        // Step 3: Execute Reset
        const resetResult = await service.executeReset(
          tenantId,
          1,
          'SUPER_ADMIN',
          {
            modules: [cat.id],
            scope: 'selected',
            previewToken: preview.previewToken,
            confirmation: 'RESET',
            idempotencyKey: randomUUID(),
            reason: `Testing reset for ${cat.name}`,
          },
        );

        expect(resetResult.status).toBe('SUCCESS');
        expect((resetResult as any).verified).toBe(true);
        expect((resetResult as any).failures).toHaveLength(0);
        expect(resetResult.recordsDeleted).toBe(beforeCount);

        // Step 4: Verify directly in PostgreSQL that count is 0
        const afterCount = await countInDb[cat.id]();
        expect(afterCount).toBe(0);

        // Step 5: Test GET / Auto-re-seeding prevention
        if (cat.id === 'work-types') {
          const res = await masterService.getWorkTypes(tenantId);
          expect(res.data).toHaveLength(0);
          expect(await countInDb[cat.id]()).toBe(0);
        } else if (cat.id === 'expense-categories') {
          const res = await masterService.getExpenseCategories(tenantId);
          expect(res.data).toHaveLength(0);
          expect(await countInDb[cat.id]()).toBe(0);
        } else if (cat.id === 'task-status') {
          const res = await masterService.getTaskStatuses(tenantId);
          expect(res.data).toHaveLength(0);
          expect(await countInDb[cat.id]()).toBe(0);
        } else if (cat.id === 'leave-types') {
          const res = await leaveService.getLeaveTypes(tenantId);
          expect((res as any).data).toHaveLength(0);
          expect(await countInDb[cat.id]()).toBe(0);
        } else if (cat.id === 'stage-management') {
          const res = await dealService.listStages(tenantId);
          expect(res.stages).toHaveLength(0);
          expect(await countInDb[cat.id]()).toBe(0);
        }
      });
    }
  });

  describe('Part 2: Multi-Selection Reset of All 11 Categories Simultaneously', () => {
    it('seeds all 11 categories, previews total, resets all in a single transaction, and leaves 0 records', async () => {
      // 1. Seed all 11 categories
      let totalExpectedBefore = 0;
      for (const cat of categories) {
        await seeders[cat.id]();
        const c = await countInDb[cat.id]();
        expect(c).toBeGreaterThan(0);
        totalExpectedBefore += c;
      }

      // 2. Preview reset for all 11 categories
      const allModuleIds = categories.map((c) => c.id);
      const preview = await service.previewReset(tenantId, {
        modules: allModuleIds,
        scope: 'selected',
      });
      expect(preview.totalEligibleRecords).toBe(totalExpectedBefore);

      // 3. Execute reset for all 11 categories
      const resetResult = await service.executeReset(
        tenantId,
        1,
        'SUPER_ADMIN',
        {
          modules: allModuleIds,
          scope: 'selected',
          previewToken: preview.previewToken,
          confirmation: 'RESET',
          idempotencyKey: randomUUID(),
          reason: 'Testing multi-category reset for all 11 configuration sections',
        },
      );

      expect(resetResult.status).toBe('SUCCESS');
      expect((resetResult as any).verified).toBe(true);
      expect((resetResult as any).failures).toHaveLength(0);
      expect(resetResult.recordsDeleted).toBe(totalExpectedBefore);

      // 4. Verify all 11 categories have 0 records in DB
      for (const cat of categories) {
        const remaining = await countInDb[cat.id]();
        expect(remaining).toBe(0);
      }

      // 5. Verify global plans and users are untouched
      const globalPlans = await prisma.plan.count();
      expect(globalPlans).toBeGreaterThan(0);

      const users = await prisma.user.count({ where: { customerId: tenantId } });
      expect(users).toBeGreaterThan(0);
    });
  });
});
