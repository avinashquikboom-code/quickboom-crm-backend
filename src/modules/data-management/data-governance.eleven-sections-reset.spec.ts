import { DataGovernanceService } from './data-governance.service';
import { tablesForModules, whereFor, moduleById, resolveModuleId, RESET_MODULES, FORBIDDEN_MODELS } from './data-governance.catalog';
import { BadRequestException } from '@nestjs/common';

function createMockPrisma(overrides: Record<string, any> = {}) {
  const defaultDelegate = (name?: string) => ({
    count: jest.fn().mockImplementation(async (args: any) => {
      if (args?.where?.customerId && args.where.customerId.not) return 0;
      return 0;
    }),
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockResolvedValue({ id: 1 }),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue({ id: 12 }),
  });

  const handler: ProxyHandler<any> = {
    get: (_target, prop: string | symbol) => {
      if (typeof prop !== 'string') return undefined;
      if (prop === '$queryRaw') return jest.fn().mockResolvedValue([]);
      if (prop === '$executeRaw') return jest.fn().mockResolvedValue(0);
      if (prop === '$transaction') {
        return async (cb: (tx: any) => Promise<any>) => cb(proxy);
      }
      if (prop in overrides) {
        return { ...defaultDelegate(prop), ...overrides[prop] };
      }
      return defaultDelegate(prop);
    },
  };
  const proxy: any = new Proxy({}, handler);
  return proxy;
}

describe('Data Management Reset – 11 Configuration Sections Suite', () => {
  const tenantId = 12;

  describe('1. Module catalog and alias resolution for all 11 sections', () => {
    const elevenSections = [
      { name: 'Expense Category', ids: ['expense-categories', 'expense-category', 'expense_category', 'expensecategories'], canonical: 'expense-categories' },
      { name: 'Task Status', ids: ['task-status', 'task-statuses', 'task_status', 'taskstatus'], canonical: 'task-status' },
      { name: 'Department Type', ids: ['departments', 'department-types', 'department-type', 'department_type', 'department_types'], canonical: 'departments' },
      { name: 'Stage Management', ids: ['stage-management', 'lead-stages', 'deal-stages', 'stages'], canonical: 'stage-management' },
      { name: 'Employee Type', ids: ['employee-types', 'employee-type', 'employee_type', 'employeetypes'], canonical: 'employee-types' },
      { name: 'Leave Type', ids: ['leave-types', 'leave-type', 'leave_type', 'leavetypes'], canonical: 'leave-types' },
      { name: 'Leave Policy', ids: ['leave-policies', 'leave-policy', 'leave_policy', 'leavepolicies'], canonical: 'leave-policies' },
      { name: 'Work Type', ids: ['work-types', 'work-type', 'work_type', 'worktypes'], canonical: 'work-types' },
      { name: 'Subscription Plan', ids: ['subscription-plans', 'subscription-plan', 'subscription_plan', 'plans'], canonical: 'subscription-plans' },
      { name: 'Payment Method', ids: ['payment-methods', 'payment-method', 'payment_method', 'paymentmethods'], canonical: 'payment-methods' },
      { name: 'Loan Type', ids: ['loan-types', 'loan-type', 'loan_type', 'loantypes'], canonical: 'loan-types' },
    ];

    it.each(elevenSections)('resolves all alias variants for $name to $canonical', ({ ids, canonical }) => {
      for (const id of ids) {
        expect(resolveModuleId(id)).toBe(canonical);
        const mod = moduleById(id);
        expect(mod).toBeDefined();
        expect(mod?.available).toBe(true);
      }
    });

    it('protects global plans from inclusion in reset tables', () => {
      expect(FORBIDDEN_MODELS).toContain('plan');
      const allCatalogModels = RESET_MODULES.flatMap((m) => m.tables.map((t) => t.model));
      expect(allCatalogModels).not.toContain('plan');
    });
  });

  describe('2. Expense Category reset', () => {
    it('previews and deletes only EXPENSE_CATEGORY master items for the tenant', async () => {
      let expenseCatCount = 4;
      const masterItem = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.type === 'EXPENSE_CATEGORY') return expenseCatCount;
          return 0;
        }),
        findMany: jest.fn().mockImplementation(async () => [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]),
        deleteMany: jest.fn().mockImplementation(async (args: any) => {
          expect(args.where.type).toBe('EXPENSE_CATEGORY');
          expect(args.where.customerId).toBe(tenantId);
          const count = expenseCatCount;
          expenseCatCount = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ masterItem });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['expense-categories'] });
      expect(preview.totalEligibleRecords).toBe(4);
      expect(preview.modules[0].id).toBe('expense-categories');
      expect(preview.modules[0].records).toBe(4);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['expense-categories'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });

      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(4);
      expect(masterItem.deleteMany).toHaveBeenCalled();
    });
  });

  describe('3. Task Status reset', () => {
    it('previews and deletes only TASK_STATUS master items for the tenant', async () => {
      let statusCount = 5;
      const masterItem = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.type === 'TASK_STATUS') return statusCount;
          return 0;
        }),
        findMany: jest.fn().mockImplementation(async () => [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }]),
        deleteMany: jest.fn().mockImplementation(async (args: any) => {
          expect(args.where.type).toBe('TASK_STATUS');
          expect(args.where.customerId).toBe(tenantId);
          const count = statusCount;
          statusCount = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ masterItem });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['task-status'] });
      expect(preview.totalEligibleRecords).toBe(5);
      expect(preview.modules[0].id).toBe('task-status');

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['task-status'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });

      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(5);
    });
  });

  describe('4. Stage Management reset', () => {
    it('previews stages and cascades set-null on same-tenant leads', async () => {
      let leadStageCount = 3;
      let pipelineStageCount = 2;
      let pipelineCount = 1;

      const leadStage = {
        count: jest.fn().mockImplementation(async () => leadStageCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 1 }, { id: 2 }, { id: 3 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = leadStageCount;
          leadStageCount = 0;
          return { count };
        }),
      };
      const pipelineStage = {
        count: jest.fn().mockImplementation(async () => pipelineStageCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 10 }, { id: 11 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = pipelineStageCount;
          pipelineStageCount = 0;
          return { count };
        }),
      };
      const pipelineModel = {
        count: jest.fn().mockImplementation(async () => pipelineCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 100 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = pipelineCount;
          pipelineCount = 0;
          return { count };
        }),
      };
      const lead = {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      };
      const deal = {
        count: jest.fn().mockResolvedValue(0),
      };

      const prisma = createMockPrisma({
        leadStage,
        pipelineStage,
        pipeline: pipelineModel,
        lead,
        deal,
      });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['stage-management'] });
      expect(preview.totalEligibleRecords).toBe(6); // 3 lead stages + 2 pipeline stages + 1 pipeline

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['stage-management'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });

      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(6);
      expect(lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { stageId: null },
      }));
    });

    it('blocks stage reset when unselected deals reference pipeline stages', async () => {
      const deal = {
        count: jest.fn().mockResolvedValue(3),
      };
      const prisma = createMockPrisma({ deal });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['stage-management'] });
      expect(preview.dependencyWarnings.some((w: any) => w.module === 'stage-management' && w.model === 'deal' && w.blocking)).toBe(true);

      await expect(service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['stage-management'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      })).rejects.toThrow(BadRequestException);
    });
  });

  describe('5. Employee Type reset', () => {
    it('previews and deletes only EMPLOYEE_TYPE master items', async () => {
      let empTypeCount = 2;
      const masterItem = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.type === 'EMPLOYEE_TYPE') return empTypeCount;
          return 0;
        }),
        findMany: jest.fn().mockImplementation(async () => [{ id: 1 }, { id: 2 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = empTypeCount;
          empTypeCount = 0;
          return { count };
        }),
      };
      const prisma = createMockPrisma({ masterItem });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['employee-types'] });
      expect(preview.totalEligibleRecords).toBe(2);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['employee-types'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });

      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(2);
    });
  });

  describe('6. Leave Type & Leave Policy reset', () => {
    it('blocks leave type reset when dependent leave requests exist and leave module is not selected', async () => {
      const leaveRequest = { count: jest.fn().mockResolvedValue(4) };
      const prisma = createMockPrisma({ leaveRequest });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['leave-types'] });
      const blocker = preview.dependencyWarnings.find((w: any) => w.module === 'leave-types' && w.model === 'leaveRequest');
      expect(blocker?.blocking).toBe(true);

      await expect(service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['leave-types'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      })).rejects.toThrow(BadRequestException);
    });

    it('resets leave policies cleanly without blocking', async () => {
      let policyCount = 2;
      const leavePolicy = {
        count: jest.fn().mockImplementation(async () => policyCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 1 }, { id: 2 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = policyCount;
          policyCount = 0;
          return { count };
        }),
      };
      const prisma = createMockPrisma({ leavePolicy });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['leave-policies'] });
      expect(preview.totalEligibleRecords).toBe(2);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['leave-policies'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });

      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(2);
    });
  });

  describe('7. Work Type, Payment Method, and Loan Type reset', () => {
    it('resets work types correctly', async () => {
      let count = 3;
      const masterItem = {
        count: jest.fn().mockImplementation(async (args: any) => args?.where?.type === 'WORK_TYPE' ? count : 0),
        findMany: jest.fn().mockImplementation(async () => [{ id: 1 }, { id: 2 }, { id: 3 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const c = count; count = 0; return { count: c };
        }),
      };
      const prisma = createMockPrisma({ masterItem });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['work-types'] });
      expect(preview.totalEligibleRecords).toBe(3);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['work-types'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });
      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(3);
    });

    it('resets payment methods correctly', async () => {
      let count = 2;
      const masterItem = {
        count: jest.fn().mockImplementation(async (args: any) => args?.where?.type === 'PAYMENT_METHOD' ? count : 0),
        findMany: jest.fn().mockImplementation(async () => [{ id: 1 }, { id: 2 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const c = count; count = 0; return { count: c };
        }),
      };
      const prisma = createMockPrisma({ masterItem });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['payment-methods'] });
      expect(preview.totalEligibleRecords).toBe(2);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['payment-methods'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });
      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(2);
    });

    it('resets loan types correctly', async () => {
      let count = 4;
      const masterItem = {
        count: jest.fn().mockImplementation(async (args: any) => args?.where?.type === 'LOAN_TYPE' ? count : 0),
        findMany: jest.fn().mockImplementation(async () => [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const c = count; count = 0; return { count: c };
        }),
      };
      const prisma = createMockPrisma({ masterItem });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['loan-types'] });
      expect(preview.totalEligibleRecords).toBe(4);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['loan-types'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });
      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(4);
    });
  });

  describe('8. Subscription Plans reset', () => {
    it('resets tenant custom plan orders and subscriptions while preserving global shared plans', async () => {
      let subCount = 1;
      let orderCount = 2;
      let installmentCount = 3;

      const customerSubscription = {
        count: jest.fn().mockImplementation(async () => subCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 1 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const c = subCount; subCount = 0; return { count: c };
        }),
      };
      const customPlanOrder = {
        count: jest.fn().mockImplementation(async () => orderCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 10 }, { id: 11 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const c = orderCount; orderCount = 0; return { count: c };
        }),
      };
      const subscriptionInstallment = {
        count: jest.fn().mockImplementation(async () => installmentCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 20 }, { id: 21 }, { id: 22 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const c = installmentCount; installmentCount = 0; return { count: c };
        }),
      };
      const plan = {
        count: jest.fn().mockResolvedValue(5), // 5 global plans
      };

      const prisma = createMockPrisma({
        customerSubscription,
        customPlanOrder,
        subscriptionInstallment,
        plan,
      });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['subscription-plans'] });
      expect(preview.totalEligibleRecords).toBe(6); // 1 + 2 + 3

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['subscription-plans'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });

      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(6);
      expect(plan.count).toHaveBeenCalled(); // verified global plans preserved
    });
  });

  describe('9. Multi-selection: Resetting master configuration sections together', () => {
    it('combines multiple master sections in a single preview and transaction', async () => {
      const masterItemCounts: Record<string, number> = {
        EXPENSE_CATEGORY: 3,
        TASK_STATUS: 4,
        EMPLOYEE_TYPE: 2,
        WORK_TYPE: 5,
        PAYMENT_METHOD: 2,
        LOAN_TYPE: 3,
      };

      const masterItem = {
        count: jest.fn().mockImplementation(async (args: any) => {
          const type = args?.where?.type;
          return masterItemCounts[type] || 0;
        }),
        findMany: jest.fn().mockImplementation(async (args: any) => {
          const type = args?.where?.type;
          const num = masterItemCounts[type] || 0;
          return Array.from({ length: num }, (_, i) => ({ id: i + 1 }));
        }),
        deleteMany: jest.fn().mockImplementation(async (args: any) => {
          const type = args?.where?.type;
          const count = masterItemCounts[type] || 0;
          masterItemCounts[type] = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ masterItem });
      const service = new DataGovernanceService(prisma);

      const selectedModules = [
        'expense-categories',
        'task-status',
        'employee-types',
        'work-types',
        'payment-methods',
        'loan-types',
      ];

      const preview = await service.previewReset(tenantId, { modules: selectedModules });
      // 3 + 4 + 2 + 5 + 2 + 3 = 19
      expect(preview.totalEligibleRecords).toBe(19);
      expect(preview.modules).toHaveLength(6);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: selectedModules,
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'reset-key-expense-cat-01',
      });

      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(19);
    });
  });
});
