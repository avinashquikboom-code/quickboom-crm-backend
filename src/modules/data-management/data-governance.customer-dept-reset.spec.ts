import { DataGovernanceService } from './data-governance.service';
import { tablesForModules, whereFor, RESET_MODULES, FORBIDDEN_MODELS } from './data-governance.catalog';
import { BadRequestException } from '@nestjs/common';

function createMockPrisma(overrides: Record<string, any> = {}) {
  const handler: ProxyHandler<any> = {
    get: (_target, prop: string | symbol) => {
      if (typeof prop !== 'string') return undefined;
      if (prop in overrides) return overrides[prop];
      if (prop === '$queryRaw') return jest.fn().mockResolvedValue([]);
      if (prop === '$executeRaw') return jest.fn().mockResolvedValue(0);
      if (prop === '$transaction') {
        return async (cb: (tx: any) => Promise<any>) => cb(proxy);
      }
      return {
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
      };
    },
  };
  const proxy: any = new Proxy({}, handler);
  return proxy;
}

describe('Data Management Reset – Customer, Department and Designation Suite', () => {
  const tenantId = 12;

  // Scenario 1: Customer-only reset
  describe('Scenario 1: Customer-only reset', () => {
    it('deletes CRM company, contact and communication records while keeping tenant root Customer intact', async () => {
      let companyCount = 3;
      let contactCount = 5;
      let commCount = 2;

      const company = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId?.not) return 0;
          return companyCount;
        }),
        findMany: jest.fn().mockImplementation(async () => [{ id: 1 }, { id: 2 }, { id: 3 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = companyCount;
          companyCount = 0;
          return { count };
        }),
      };
      const contact = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId?.not) return 0;
          return contactCount;
        }),
        findMany: jest.fn().mockImplementation(async () => [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = contactCount;
          contactCount = 0;
          return { count };
        }),
      };
      const communicationHistory = {
        count: jest.fn().mockImplementation(async () => commCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 101 }, { id: 102 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = commCount;
          commCount = 0;
          return { count };
        }),
      };
      const customer = {
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue({ id: tenantId, name: 'Tenant Organization' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };

      const prisma = createMockPrisma({ company, contact, communicationHistory, customer });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['customers'] });
      expect(preview.tables.find((t) => t.model === 'company')?.records).toBe(3);
      expect(preview.tables.find((t) => t.model === 'contact')?.records).toBe(5);
      expect(preview.tables.find((t) => t.model === 'communicationHistory')?.records).toBe(2);
      expect(preview.customerBreakdown).toBeDefined();
      expect(preview.customerBreakdown.customers.eligible).toBe(10);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['customers'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-1',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.company).toBe(3);
      expect(result.tables.contact).toBe(5);
      expect(result.tables.communicationHistory).toBe(2);
    });
  });

  // Scenario 2: Customer and related subscriptions
  describe('Scenario 2: Customer and related subscriptions', () => {
    it('deletes customer-owned CustomerSubscription, SubscriptionInstallment and CustomPlanOrder', async () => {
      let subCount = 2;
      let installmentCount = 4;
      let orderCount = 1;

      const customerSubscription = {
        count: jest.fn().mockImplementation(async () => subCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 100 }, { id: 101 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = subCount;
          subCount = 0;
          return { count };
        }),
      };
      const subscriptionInstallment = {
        count: jest.fn().mockImplementation(async () => installmentCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 201 }, { id: 202 }, { id: 203 }, { id: 204 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = installmentCount;
          installmentCount = 0;
          return { count };
        }),
      };
      const customPlanOrder = {
        count: jest.fn().mockImplementation(async () => orderCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 301 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = orderCount;
          orderCount = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ customerSubscription, subscriptionInstallment, customPlanOrder });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['customers'] });
      expect(preview.tables.find((t) => t.model === 'customerSubscription')?.records).toBe(2);
      expect(preview.tables.find((t) => t.model === 'subscriptionInstallment')?.records).toBe(4);
      expect(preview.tables.find((t) => t.model === 'customPlanOrder')?.records).toBe(1);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['customers'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-2',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.customerSubscription).toBe(2);
      expect(result.tables.subscriptionInstallment).toBe(4);
      expect(result.tables.customPlanOrder).toBe(1);
    });
  });

  // Scenario 3: Customer and calendar events / schedules
  describe('Scenario 3: Customer and calendar events / schedules', () => {
    it('deletes customer-associated monthly schedules', async () => {
      let scheduleCount = 6;
      const monthlySchedule = {
        count: jest.fn().mockImplementation(async () => scheduleCount),
        findMany: jest.fn().mockImplementation(async () => Array.from({ length: scheduleCount }, (_, i) => ({ id: i + 1, subscriptionId: 100 }))),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = scheduleCount;
          scheduleCount = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ monthlySchedule });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['customers'] });
      expect(preview.tables.find((t) => t.model === 'monthlySchedule')?.records).toBe(6);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['customers'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-3',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.monthlySchedule).toBe(6);
    });
  });

  // Scenario 4: Customer appointments and visits
  describe('Scenario 4: Customer appointments and visits', () => {
    it('deletes visits and visit photos in child-first order', async () => {
      let visitCount = 4;
      let photoCount = 8;
      const order: string[] = [];

      const visitPhoto = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return photoCount;
        }),
        findMany: jest.fn().mockImplementation(async () => Array.from({ length: photoCount }, (_, i) => ({ id: i + 1, visitId: 1 }))),
        deleteMany: jest.fn().mockImplementation(async () => {
          order.push('visitPhoto');
          const count = photoCount;
          photoCount = 0;
          return { count };
        }),
      };
      const visit = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return visitCount;
        }),
        findMany: jest.fn().mockImplementation(async () => Array.from({ length: visitCount }, (_, i) => ({ id: i + 1 }))),
        deleteMany: jest.fn().mockImplementation(async () => {
          order.push('visit');
          const count = visitCount;
          visitCount = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ visitPhoto, visit });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['customers'] });
      expect(preview.tables.find((t) => t.model === 'visitPhoto')?.records).toBe(8);
      expect(preview.tables.find((t) => t.model === 'visit')?.records).toBe(4);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['customers'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-4',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.visitPhoto).toBe(8);
      expect(result.tables.visit).toBe(4);
      expect(order).toEqual(['visitPhoto', 'visit']);
    });
  });

  // Scenario 5: Customer reminders
  describe('Scenario 5: Customer reminders', () => {
    it('calculates reminder category in customer breakdown accurately', async () => {
      const leadReminder = {
        count: jest.fn().mockResolvedValue(7),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const prisma = createMockPrisma({ leadReminder });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['customers'] });
      expect(preview.customerBreakdown.reminders).toBeDefined();
      expect(preview.customerBreakdown.reminders.total).toBe(7);
      expect(preview.customerBreakdown.reminders.eligible).toBe(0);
      expect(preview.customerBreakdown.reminders.preserved).toBe(7);
    });
  });

  // Scenario 6: Customer tasks
  describe('Scenario 6: Customer tasks', () => {
    it('calculates task category in customer breakdown accurately', async () => {
      const task = {
        count: jest.fn().mockResolvedValue(12),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const prisma = createMockPrisma({ task });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['customers'] });
      expect(preview.customerBreakdown.tasks).toBeDefined();
      expect(preview.customerBreakdown.tasks.total).toBe(12);
      expect(preview.customerBreakdown.tasks.eligible).toBe(0);
      expect(preview.customerBreakdown.tasks.preserved).toBe(12);
    });
  });

  // Scenario 7: Customer with unrelated employee calendar events (preserved)
  describe('Scenario 7: Customer with unrelated employee calendar events (preserved)', () => {
    it('preserves employee calendar schedules where subscriptionId is null', async () => {
      const whereFilter = whereFor('customerSchedule', tenantId);
      expect(whereFilter).toEqual({ customerId: tenantId, subscriptionId: { not: null } });

      let customerScheduleCount = 3;
      const monthlySchedule = {
        count: jest.fn().mockImplementation(async (args?: any) => {
          if (args?.where?.subscriptionId === null) {
            return 5; // 5 employee-level schedules
          }
          return customerScheduleCount;
        }),
        findMany: jest.fn().mockImplementation(async () => [
          { id: 1, subscriptionId: 101 },
          { id: 2, subscriptionId: 102 },
          { id: 3, subscriptionId: 103 },
        ]),
        deleteMany: jest.fn().mockImplementation(async (args: any) => {
          expect(args.where.subscriptionId).toEqual({ not: null });
          const count = customerScheduleCount;
          customerScheduleCount = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ monthlySchedule });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['customers'] });
      expect(preview.tables.find((t) => t.model === 'monthlySchedule')?.records).toBe(3);
      expect(preview.customerBreakdown.calendar.eligible).toBe(3);
      expect(preview.customerBreakdown.calendar.preserved).toBe(5);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['customers'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-7',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.monthlySchedule).toBe(3);
    });
  });

  // Scenario 8: Shared subscription plans (preserved)
  describe('Scenario 8: Shared subscription plans (preserved)', () => {
    it('protects shared Plan records from inclusion in reset modules or deletion', () => {
      expect(FORBIDDEN_MODELS).toContain('plan');
      const allCatalogModels = RESET_MODULES.flatMap((m) => m.tables.map((t) => t.model));
      expect(allCatalogModels).not.toContain('plan');
    });
  });

  // Scenario 9: Cross-tenant customer references (blocked/preserved)
  describe('Scenario 9: Cross-tenant customer references (blocked/preserved)', () => {
    it('blocks reset when an external tenant invoice references current tenant contact', async () => {
      const invoice = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) {
            return 2; // 2 cross-tenant invoices
          }
          return 0;
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };

      const prisma = createMockPrisma({ invoice });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['customers'] });
      const warning = preview.dependencyWarnings.find((w) => w.model === 'invoice');
      expect(warning).toBeDefined();
      expect(warning?.blocking).toBe(true);

      await expect(
        service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
          modules: ['customers'],
          previewToken: preview.previewToken,
          confirmation: 'RESET',
          idempotencyKey: 'test-scenario-9',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // Scenario 10: Protected financial records
  describe('Scenario 10: Protected financial records', () => {
    it('blocks reset when protected commission shares exist for employees', async () => {
      const employee = {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([{ id: 101 }, { id: 102 }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      };
      const prisma = createMockPrisma({
        employee,
        $queryRaw: jest.fn().mockResolvedValue([{ records: 3 }]),
      });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['employees'] });
      const blocker = preview.dependencyWarnings.find((w) => w.model === 'commission_shares');
      expect(blocker).toBeDefined();
      expect(blocker?.blocking).toBe(true);

      await expect(
        service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
          modules: ['employees'],
          previewToken: preview.previewToken,
          confirmation: 'RESET',
          idempotencyKey: 'test-scenario-10',
        }),
      ).rejects.toThrow('Deletion is blocked by dependencies');
    });
  });

  // Scenario 11: Department reset (with employee, designation, task references set to null)
  describe('Scenario 11: Department reset (with employee, designation, task references set to null)', () => {
    it('nullifies departmentId on Employee, Designation, Task, and Announcement before deleting Department', async () => {
      let deptCount = 2;
      const department = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return deptCount;
        }),
        findMany: jest.fn().mockImplementation(async () => [{ id: 10 }, { id: 20 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = deptCount;
          deptCount = 0;
          return { count };
        }),
      };
      const employee = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return 5;
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 5 }),
      };
      const designation = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return 4;
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 4 }),
      };
      const task = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return 8;
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 8 }),
      };
      const announcement = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return 1;
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const prisma = createMockPrisma({ department, employee, designation, task, announcement });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['departments'] });
      expect(preview.tables.find((t) => t.model === 'department')?.records).toBe(2);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['departments'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-11',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.department).toBe(2);
      expect(employee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { departmentId: null } }),
      );
      expect(designation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { departmentId: null } }),
      );
      expect(task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { departmentId: null } }),
      );
      expect(announcement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { departmentId: null } }),
      );
    });
  });

  // Scenario 12: Designation reset (with role-linked designations preserved)
  describe('Scenario 12: Designation reset (with role-linked designations preserved)', () => {
    it('preserves designations referenced by Role records and decouples employee & task references for eligible designations', async () => {
      let desigCount = 3;
      const designation = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.id?.in) {
            return 1; // 1 protected designation remains
          }
          if (args?.where?.id?.notIn) {
            return desigCount > 1 ? desigCount - 1 : 0;
          }
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return desigCount;
        }),
        findMany: jest.fn().mockImplementation(async () => [{ id: 10 }, { id: 20 }, { id: 30 }]),
        deleteMany: jest.fn().mockImplementation(async (args: any) => {
          expect(args.where.id.notIn).toContain(10);
          desigCount = 1; // Only protected one remains
          return { count: 2 };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const role = {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, designationId: 10, customerId: null, type: 'SYSTEM', name: 'SUPER_ADMIN' },
        ]),
        count: jest.fn().mockResolvedValue(1),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const employee = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return 4;
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 4 }),
      };
      const task = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return 2;
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      };
      const customer = {
        findUnique: jest.fn().mockResolvedValue({ id: tenantId }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      };

      const prisma = createMockPrisma({ designation, role, employee, task, customer });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['designations'] });
      const desigTable = preview.tables.find((t) => t.model === 'designation');
      expect(desigTable?.records).toBe(3);
      expect(desigTable?.preservedRecords).toBe(1);
      expect(desigTable?.eligibleRecords).toBe(2);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['designations'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-12',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.designation).toBe(2);
      expect(employee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { designationId: null } }),
      );
      expect(task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { designationId: null } }),
      );
    });
  });

  // Scenario 13: All three modules selected together
  describe('Scenario 13: All three modules selected together', () => {
    it('executes Customers, Departments, and Designations reset together cleanly', async () => {
      let companyCount = 2;
      let deptCount = 1;
      let desigCount = 2;

      const company = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return companyCount;
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = companyCount;
          companyCount = 0;
          return { count };
        }),
      };
      const department = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return deptCount;
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 10 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = deptCount;
          deptCount = 0;
          return { count };
        }),
      };
      const designation = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return desigCount;
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 20 }, { id: 30 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = desigCount;
          desigCount = 0;
          return { count };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const employee = {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const task = {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const announcement = {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const role = {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };

      const prisma = createMockPrisma({ company, department, designation, employee, task, announcement, role });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, {
        modules: ['customers', 'departments', 'designations'],
      });
      expect(preview.modules).toHaveLength(3);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['customers', 'departments', 'designations'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-13',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.company).toBe(2);
      expect(result.tables.department).toBe(1);
      expect(result.tables.designation).toBe(2);
    });
  });

  // Scenario 14: Preview vs execution counts matching
  describe('Scenario 14: Preview vs execution counts matching', () => {
    it('ensures preview totalEligibleRecords strictly matches the executed deleted count', async () => {
      let contactCount = 4;
      let docCount = 2;

      const contact = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return contactCount;
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = contactCount;
          contactCount = 0;
          return { count };
        }),
      };
      const sendDetailsDocument = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return docCount;
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 10 }, { id: 20 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = docCount;
          docCount = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ contact, sendDetailsDocument });
      const service = new DataGovernanceService(prisma);

      const preview = await service.previewReset(tenantId, { modules: ['customers'] });
      expect(preview.totalEligibleRecords).toBe(6);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['customers'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-14',
      });

      const totalDeleted = Object.values(result.tables).reduce((sum: number, count: any) => sum + Number(count), 0);
      expect(totalDeleted).toBe(preview.totalEligibleRecords);
    });
  });

  // Scenario 15: Transaction rollback and retry
  describe('Scenario 15: Transaction rollback and retry', () => {
    it('rolls back on transient database failure and succeeds on subsequent retry', async () => {
      let attempt = 0;
      let contactCount = 3;

      const contact = {
        count: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.customerId && args.where.customerId.not) return 0;
          return contactCount;
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          attempt += 1;
          if (attempt === 1) {
            throw new Error('Deadlock detected during customer deletion');
          }
          const count = contactCount;
          contactCount = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ contact });
      const service = new DataGovernanceService(prisma);

      const preview1 = await service.previewReset(tenantId, { modules: ['customers'] });
      await expect(
        service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
          modules: ['customers'],
          previewToken: preview1.previewToken,
          confirmation: 'RESET',
          idempotencyKey: 'test-scenario-15-fail',
        }),
      ).rejects.toThrow('Deadlock detected during customer deletion');

      // Subsequent retry with a fresh preview succeeds
      const preview2 = await service.previewReset(tenantId, { modules: ['customers'] });
      const retryResult = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['customers'],
        previewToken: preview2.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-15-success',
      });

      expect(retryResult.status).toBe('SUCCESS');
      expect(retryResult.tables.contact).toBe(3);
    });
  });
});
