import { DataGovernanceService } from './data-governance.service';
import { tablesForModules, whereFor } from './data-governance.catalog';
import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

const resetTestDatabaseUrl = process.env.DATA_MANAGEMENT_RESET_TEST_DATABASE_URL;
let parsedResetTestDatabaseUrl: URL | null = null;
if (resetTestDatabaseUrl) {
  parsedResetTestDatabaseUrl = new URL(resetTestDatabaseUrl);
  const databaseName = decodeURIComponent(parsedResetTestDatabaseUrl.pathname.slice(1));
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (!['postgres:', 'postgresql:'].includes(parsedResetTestDatabaseUrl.protocol)
    || !localHosts.has(parsedResetTestDatabaseUrl.hostname)
    || !databaseName.startsWith('qb_data_management_reset_test')) {
    throw new Error('DATA_MANAGEMENT_RESET_TEST_DATABASE_URL must target a local disposable PostgreSQL database whose name starts with qb_data_management_reset_test.');
  }
}
const describePostgresIntegration = parsedResetTestDatabaseUrl ? describe : describe.skip;

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
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 1 }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      };
    },
  };
  const proxy: any = new Proxy({}, handler);
  return proxy;
}

describe('Data Management Reset – SalarySlip Unit & Architecture Scenarios', () => {
  const tenantId = 12;

  describe('Scenario 1: Exactly 11 eligible Salary Slips deleted cleanly', () => {
    it('deletes exactly 11 eligible records without count mismatch', async () => {
      let slipCount = 11;
      let itemCount = 5;
      let payrollCount = 2;
      const executionOrder: string[] = [];

      const salarySlip = {
        count: jest.fn().mockImplementation(async () => slipCount),
        findMany: jest.fn().mockImplementation(async () =>
          Array.from({ length: slipCount }, (_, i) => ({
            id: i + 1,
            payrollItemId: Math.floor(i / 2) + 1,
            employeeId: 100 + i,
          })),
        ),
        deleteMany: jest.fn().mockImplementation(async () => {
          executionOrder.push('salarySlip');
          const deleted = slipCount;
          slipCount = 0;
          return { count: deleted };
        }),
      };

      const payrollItem = {
        count: jest.fn().mockImplementation(async () => itemCount),
        findMany: jest.fn().mockImplementation(async () =>
          Array.from({ length: itemCount }, (_, i) => ({ id: i + 1 })),
        ),
        deleteMany: jest.fn().mockImplementation(async () => {
          executionOrder.push('payrollItem');
          const deleted = itemCount;
          itemCount = 0;
          return { count: deleted };
        }),
      };

      const payroll = {
        count: jest.fn().mockImplementation(async () => payrollCount),
        findMany: jest.fn().mockImplementation(async () =>
          Array.from({ length: payrollCount }, (_, i) => ({ id: i + 1 })),
        ),
        deleteMany: jest.fn().mockImplementation(async () => {
          executionOrder.push('payroll');
          const deleted = payrollCount;
          payrollCount = 0;
          return { count: deleted };
        }),
      };

      const prisma = createMockPrisma({ salarySlip, payrollItem, payroll });
      const service = new DataGovernanceService(prisma);
      const preview = await service.previewReset(tenantId, { modules: ['payroll'] });
      expect(preview.tables.find((t) => t.model === 'salarySlip')?.records).toBe(11);
      expect(preview.tables.find((t) => t.model === 'payrollItem')?.records).toBe(5);
      expect(preview.tables.find((t) => t.model === 'payroll')?.records).toBe(2);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['payroll'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'salary-slip-scenario-1',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.salarySlip).toBe(11);
      expect(result.tables.payrollItem).toBe(5);
      expect(result.tables.payroll).toBe(2);
      expect(executionOrder.indexOf('salarySlip')).toBeLessThan(executionOrder.indexOf('payrollItem'));
      expect(executionOrder.indexOf('payrollItem')).toBeLessThan(executionOrder.indexOf('payroll'));
    });
  });

  describe('Scenario 2: Child-first deletion order prevents cascade race conditions', () => {
    it('verifies salarySlip is placed before payrollItem and payroll in deletion order', () => {
      const tables = tablesForModules(['payroll', 'employees']);
      const models = tables.map((t) => t.model);
      const slipIndex = models.indexOf('salarySlip');
      const itemIndex = models.indexOf('payrollItem');
      const payrollIndex = models.indexOf('payroll');
      const employeeIndex = models.indexOf('employee');

      expect(slipIndex).toBeGreaterThanOrEqual(0);
      expect(itemIndex).toBeGreaterThanOrEqual(0);
      expect(payrollIndex).toBeGreaterThanOrEqual(0);
      expect(employeeIndex).toBeGreaterThanOrEqual(0);

      expect(slipIndex).toBeLessThan(itemIndex);
      expect(itemIndex).toBeLessThan(payrollIndex);
      expect(payrollIndex).toBeLessThan(employeeIndex);
    });
  });

  describe('Scenario 3: Cross-tenant Employee references in Salary Slips block employee reset', () => {
    it('flags blocking dependency when employee belongs to tenant but salary slip belongs to another tenant', async () => {
      const salarySlip = {
        count: jest.fn().mockImplementation(async ({ where }: { where: any }) => {
          if (where?.customerId?.not) return 1; // cross-tenant
          return 1;
        }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const employee = {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ id: 101 }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };

      const prisma = createMockPrisma({ salarySlip, employee });
      const service = new DataGovernanceService(prisma);
      const warnings = await (service as any).dependencyWarnings(['employees'], tenantId, prisma);
      const slipWarning = warnings.find((w: any) => w.model === 'salarySlip');

      expect(slipWarning).toBeDefined();
      expect(slipWarning.blocking).toBe(true);
      expect(slipWarning.crossTenantRecords).toBe(1);
    });
  });

  describe('Scenario 4: Protected Salary Slips / unreferenced checks accounted accurately in preview', () => {
    it('whereFor scopes salarySlip through customerId and accurately previews 11 records', async () => {
      const where = whereFor('customer', tenantId);
      expect(where).toEqual({ customerId: tenantId });

      const salarySlip = {
        count: jest.fn().mockResolvedValue(11),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const prisma = createMockPrisma({ salarySlip });
      const service = new DataGovernanceService(prisma);
      const preview = await service.previewReset(tenantId, { modules: ['payroll'] });
      const slipTable = preview.tables.find((t) => t.model === 'salarySlip');

      expect(slipTable).toBeDefined();
      expect(slipTable?.records).toBe(11);
    });
  });

  describe('Scenario 5: Salary Slips with financial dependencies handled in child-first order', () => {
    it('ensures employeeDeductions and salarySlips are deleted before payroll items and payroll runs', () => {
      const tables = tablesForModules(['payroll']);
      const models = tables.map((t) => t.model);

      expect(models.indexOf('employeeDeduction')).toBeLessThan(models.indexOf('payrollItem'));
      expect(models.indexOf('salarySlip')).toBeLessThan(models.indexOf('payrollItem'));
      expect(models.indexOf('payrollItem')).toBeLessThan(models.indexOf('payroll'));
    });
  });

  describe('Scenario 6: Already-deleted Salary Slips (0 remaining records)', () => {
    it('executes cleanly when 0 salary slips exist', async () => {
      const prisma = createMockPrisma({});
      const service = new DataGovernanceService(prisma);
      const preview = await service.previewReset(tenantId, { modules: ['payroll'] });
      expect(preview.tables.find((t) => t.model === 'salarySlip')?.records).toBe(0);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['payroll'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'salary-slip-scenario-6',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.salarySlip).toBe(0);
    });
  });

  describe('Scenario 7: Multiple payroll periods deleted across tenant', () => {
    it('deletes salary slips across multiple pay periods matching customerId', async () => {
      const payPeriods = ['2026-01', '2026-02', '2026-03'];
      let slips = payPeriods.flatMap((period, pIdx) =>
        Array.from({ length: 4 }, (_, i) => ({
          id: pIdx * 4 + i + 1,
          customerId: tenantId,
          payPeriod: period,
          payrollItemId: pIdx + 1,
          employeeId: 100 + i,
        })),
      ); // 12 total

      const salarySlip = {
        count: jest.fn().mockImplementation(async () => slips.length),
        findMany: jest.fn().mockImplementation(async () => slips),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = slips.length;
          slips = [];
          return { count };
        }),
      };

      const prisma = createMockPrisma({ salarySlip });
      const service = new DataGovernanceService(prisma);
      const preview = await service.previewReset(tenantId, { modules: ['payroll'] });
      expect(preview.tables.find((t) => t.model === 'salarySlip')?.records).toBe(12);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['payroll'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'salary-slip-scenario-7',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.salarySlip).toBe(12);
    });
  });

  describe('Scenario 8: Preview vs execution count consistency', () => {
    it('ensures preview count 11 matches recount and deleted count exactly', async () => {
      let currentSlips = 11;
      const salarySlip = {
        count: jest.fn().mockImplementation(async () => currentSlips),
        findMany: jest.fn().mockImplementation(async () =>
          Array.from({ length: currentSlips }, (_, i) => ({ id: i + 1, payrollItemId: 1, employeeId: 100 + i })),
        ),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = currentSlips;
          currentSlips = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ salarySlip });
      const service = new DataGovernanceService(prisma);
      const preview = await service.previewReset(tenantId, { modules: ['payroll'] });
      expect(preview.tables.find((t) => t.model === 'salarySlip')?.records).toBe(11);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['payroll'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'salary-slip-scenario-8',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.salarySlip).toBe(11);
    });
  });

  describe('Scenario 9: Transaction rollback on simulated error', () => {
    it('rolls back atomic transaction and keeps salary slips intact on later error', async () => {
      let state = { salarySlipDeleted: false };
      const salarySlip = {
        count: jest.fn().mockResolvedValue(11),
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 11 }, (_, i) => ({ id: i + 1, payrollItemId: 1, employeeId: 100 + i })),
        ),
        deleteMany: jest.fn().mockImplementation(async () => {
          state.salarySlipDeleted = true;
          return { count: 11 };
        }),
      };
      const payrollItem = {
        count: jest.fn().mockResolvedValue(5),
        findMany: jest.fn().mockResolvedValue([{ id: 1 }]),
        deleteMany: jest.fn().mockRejectedValue(new Error('Simulated database deadlock')),
      };

      const prisma = createMockPrisma({
        salarySlip,
        payrollItem,
        $transaction: async (cb: (tx: any) => Promise<any>) => {
          try {
            return await cb(prisma);
          } catch (err) {
            state.salarySlipDeleted = false; // Transaction rollback keeps data intact
            throw err;
          }
        },
      });

      const service = new DataGovernanceService(prisma as any);
      const preview = await service.previewReset(tenantId, { modules: ['payroll'] });

      await expect(
        service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
          modules: ['payroll'],
          previewToken: preview.previewToken,
          confirmation: 'RESET',
          idempotencyKey: 'salary-slip-scenario-9',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(state.salarySlipDeleted).toBe(false);
    });
  });

  describe('Scenario 10: Safe retry after a failed reset', () => {
    it('allows a subsequent preview and execute to succeed after a prior failure', async () => {
      let failFirst = true;
      let slips = 11;

      const salarySlip = {
        count: jest.fn().mockImplementation(async () => slips),
        findMany: jest.fn().mockImplementation(async () =>
          Array.from({ length: slips }, (_, i) => ({ id: i + 1, payrollItemId: 1, employeeId: 100 + i })),
        ),
        deleteMany: jest.fn().mockImplementation(async () => {
          if (failFirst) {
            failFirst = false;
            throw new Error('Temporary failure');
          }
          const count = slips;
          slips = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ salarySlip });
      const service = new DataGovernanceService(prisma);

      // Attempt 1 fails
      const preview1 = await service.previewReset(tenantId, { modules: ['payroll'] });
      await expect(
        service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
          modules: ['payroll'],
          previewToken: preview1.previewToken,
          confirmation: 'RESET',
          idempotencyKey: 'salary-slip-scenario-10-attempt-1',
        }),
      ).rejects.toThrow(BadRequestException);

      // Attempt 2 succeeds
      const preview2 = await service.previewReset(tenantId, { modules: ['payroll'] });
      const result2 = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['payroll'],
        previewToken: preview2.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'salary-slip-scenario-10-attempt-2',
      });

      expect(result2.status).toBe('SUCCESS');
      expect(result2.tables.salarySlip).toBe(11);
    });
  });
});

describePostgresIntegration('Data Management Reset – SalarySlip PostgreSQL Integration', () => {
  let prisma: PrismaClient;
  let service: DataGovernanceService;
  let tenantAId: number;
  let tenantBId: number;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: resetTestDatabaseUrl! } },
    });
    await prisma.$connect();
    service = new DataGovernanceService(prisma as any);

    const unique = Date.now();
    const createdA = await prisma.customer.create({ data: { name: `Salary Reset Tenant A ${unique}` } });
    const createdB = await prisma.customer.create({ data: { name: `Salary Reset Tenant B ${unique}` } });
    tenantAId = createdA.id;
    tenantBId = createdB.id;
  });

  afterAll(async () => {
    if (prisma && tenantAId && tenantBId) {
      await prisma.customer.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    }
    await prisma.$disconnect();
  });

  it('deletes exactly 11 eligible SalarySlip records in real PostgreSQL', async () => {
    const payroll = await prisma.payroll.create({
      data: {
        customerId: tenantAId,
        month: 11,
        year: 2026,
        status: 'DRAFT',
      },
    });

    const employees = await Promise.all(
      Array.from({ length: 11 }, (_, i) =>
        prisma.employee.create({
          data: {
            customerId: tenantAId,
            employeeCode: `SLIP-EMP-${i}-${Date.now()}`,
            firstName: `Emp${i}`,
            lastName: 'PayrollTest',
            email: `slip-${i}-${Date.now()}@example.test`,
          },
        }),
      ),
    );

    const payrollItems = await Promise.all(
      employees.map((emp) =>
        prisma.payrollItem.create({
          data: {
            customerId: tenantAId,
            payrollId: payroll.id,
            employeeId: emp.id,
            basicSalary: 50000,
            grossSalary: 50000,
            totalDeductions: 5000,
            netSalary: 45000,
          },
        }),
      ),
    );

    await Promise.all(
      payrollItems.map((item, idx) =>
        prisma.salarySlip.create({
          data: {
            customerId: tenantAId,
            payrollItemId: item.id,
            employeeId: item.employeeId,
            slipNumber: `SLIP-${idx}-${Date.now()}`,
            payPeriod: '2026-11',
            grossSalary: 50000,
            totalDeductions: 5000,
            netSalary: 45000,
          },
        }),
      ),
    );

    const preview = await service.previewReset(tenantAId, { modules: ['payroll'] });
    expect(preview.tables.find((t) => t.model === 'salarySlip')?.records).toBe(11);
    expect(preview.tables.find((t) => t.model === 'payrollItem')?.records).toBe(11);
    expect(preview.tables.find((t) => t.model === 'payroll')?.records).toBe(1);

    const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
      modules: ['payroll'],
      previewToken: preview.previewToken,
      confirmation: 'RESET',
      idempotencyKey: `pg-salary-slip-test-${Date.now()}`,
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.tables.salarySlip).toBe(11);
    expect(result.tables.payrollItem).toBe(11);
    expect(result.tables.payroll).toBe(1);

    const remainingSlips = await prisma.salarySlip.count({
      where: { customerId: tenantAId },
    });
    expect(remainingSlips).toBe(0);
  });
});
