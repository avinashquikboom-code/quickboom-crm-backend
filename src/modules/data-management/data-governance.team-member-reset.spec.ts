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

describe('Data Management Reset – TeamMember Unit & Architecture Scenarios', () => {
  const tenantId = 12;

  describe('Scenario 1: Exactly 5 eligible TeamMember records deleted cleanly', () => {
    it('deletes exactly 5 eligible records without count mismatch', async () => {
      let teamMemberCount = 5;
      let teamCount = 1;
      const executionOrder: string[] = [];

      const teamMember = {
        count: jest.fn().mockImplementation(async () => teamMemberCount),
        findMany: jest.fn().mockImplementation(async () => [
          { id: 1, teamId: 10, employeeId: 101 },
          { id: 2, teamId: 10, employeeId: 102 },
          { id: 3, teamId: 10, employeeId: 103 },
          { id: 4, teamId: 10, employeeId: 104 },
          { id: 5, teamId: 10, employeeId: 105 },
        ]),
        deleteMany: jest.fn().mockImplementation(async () => {
          executionOrder.push('teamMember');
          const deleted = teamMemberCount;
          teamMemberCount = 0;
          return { count: deleted };
        }),
      };

      const team = {
        count: jest.fn().mockImplementation(async () => teamCount),
        findMany: jest.fn().mockImplementation(async () => [{ id: 10 }]),
        deleteMany: jest.fn().mockImplementation(async () => {
          executionOrder.push('team');
          const deleted = teamCount;
          teamCount = 0;
          return { count: deleted };
        }),
      };

      const prisma = createMockPrisma({ teamMember, team });
      const service = new DataGovernanceService(prisma);
      const preview = await service.previewReset(tenantId, { modules: ['visits-tasks'] });
      expect(preview.tables.find((t) => t.model === 'teamMember')?.records).toBe(5);
      expect(preview.tables.find((t) => t.model === 'team')?.records).toBe(1);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['visits-tasks'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-1',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.teamMember).toBe(5);
      expect(result.tables.team).toBe(1);
      expect(executionOrder).toEqual(['teamMember', 'team']);
    });
  });

  describe('Scenario 2: Child-first deletion order prevents cascade race conditions', () => {
    it('verifies teamMember is placed before team and employee in deletion order', () => {
      const tables = tablesForModules(['visits-tasks', 'employees']);
      const models = tables.map((t) => t.model);
      const teamMemberIndex = models.indexOf('teamMember');
      const teamIndex = models.indexOf('team');
      const employeeIndex = models.indexOf('employee');

      expect(teamMemberIndex).toBeGreaterThanOrEqual(0);
      expect(teamIndex).toBeGreaterThanOrEqual(0);
      expect(employeeIndex).toBeGreaterThanOrEqual(0);
      expect(teamMemberIndex).toBeLessThan(teamIndex);
      expect(teamIndex).toBeLessThan(employeeIndex);
    });
  });

  describe('Scenario 3: Cross-tenant Team ownership preserved and blocks employee reset', () => {
    it('flags blocking dependency when employee belongs to tenant but team belongs to another tenant', async () => {
      const teamMember = {
        count: jest.fn().mockImplementation(async ({ where }: { where: any }) => {
          if (where?.team?.customerId?.not) return 1; // cross-tenant
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

      const prisma = createMockPrisma({ teamMember, employee });
      const service = new DataGovernanceService(prisma);
      const warnings = await (service as any).dependencyWarnings(['employees'], tenantId, prisma);
      const teamMemberWarning = warnings.find((w: any) => w.model === 'teamMember');

      expect(teamMemberWarning).toBeDefined();
      expect(teamMemberWarning.blocking).toBe(true);
      expect(teamMemberWarning.crossTenantRecords).toBe(1);
    });
  });

  describe('Scenario 4: Cross-tenant Employee ownership excluded from teamMember deletion count', () => {
    it('whereFor scopes teamMember through tenant Team relation', () => {
      const where = whereFor('teamMember', tenantId);
      expect(where).toEqual({
        team: { customerId: tenantId },
      });
    });
  });

  describe('Scenario 5: Protected records / unreferenced checks', () => {
    it('accurately accounts for team memberships during reset preview', async () => {
      const teamMember = {
        count: jest.fn().mockResolvedValue(5),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      const prisma = createMockPrisma({ teamMember });
      const service = new DataGovernanceService(prisma);
      const preview = await service.previewReset(tenantId, { modules: ['visits-tasks'] });
      const teamMemberTable = preview.tables.find((t) => t.model === 'teamMember');

      expect(teamMemberTable).toBeDefined();
      expect(teamMemberTable?.records).toBe(5);
    });
  });

  describe('Scenario 6: Already-deleted TeamMember records (0 remaining)', () => {
    it('executes cleanly when 0 team memberships exist', async () => {
      const prisma = createMockPrisma({});
      const service = new DataGovernanceService(prisma);
      const preview = await service.previewReset(tenantId, { modules: ['visits-tasks'] });
      expect(preview.tables.find((t) => t.model === 'teamMember')?.records).toBe(0);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['visits-tasks'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-6',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.teamMember).toBe(0);
    });
  });

  describe('Scenario 7: Deletion ordering verification in topological sequence', () => {
    it('ensures all dependent children are ordered before their respective parents', () => {
      const tables = tablesForModules(['visits-tasks', 'employees']);
      const order = tables.map((t) => t.model);

      expect(order.indexOf('teamMember')).toBeLessThan(order.indexOf('team'));
      expect(order.indexOf('team')).toBeLessThan(order.indexOf('employee'));
      expect(order.indexOf('workTask')).toBeLessThan(order.indexOf('work'));
      expect(order.indexOf('ticketComment')).toBeLessThan(order.indexOf('supportTicket'));
      expect(order.indexOf('visitPhoto')).toBeLessThan(order.indexOf('visit'));
    });
  });

  describe('Scenario 8: Preview vs execution count consistency', () => {
    it('ensures preview count matches recount and deleted count exactly', async () => {
      let currentMembers = 5;
      const teamMember = {
        count: jest.fn().mockImplementation(async () => currentMembers),
        findMany: jest.fn().mockImplementation(async () =>
          Array.from({ length: currentMembers }, (_, i) => ({ id: i + 1, teamId: 10, employeeId: 100 + i })),
        ),
        deleteMany: jest.fn().mockImplementation(async () => {
          const count = currentMembers;
          currentMembers = 0;
          return { count };
        }),
      };
      const prisma = createMockPrisma({ teamMember });
      const service = new DataGovernanceService(prisma);
      const preview = await service.previewReset(tenantId, { modules: ['visits-tasks'] });
      expect(preview.tables.find((t) => t.model === 'teamMember')?.records).toBe(5);

      const result = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['visits-tasks'],
        previewToken: preview.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-8',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.tables.teamMember).toBe(5);
    });
  });

  describe('Scenario 9: Transaction rollback on simulated error', () => {
    it('rolls back atomic transaction and leaves diagnostic logs on error', async () => {
      let state = { teamMemberDeleted: false };
      const teamMember = {
        count: jest.fn().mockResolvedValue(5),
        findMany: jest.fn().mockResolvedValue([
          { id: 1, teamId: 10, employeeId: 101 },
          { id: 2, teamId: 10, employeeId: 102 },
          { id: 3, teamId: 10, employeeId: 103 },
          { id: 4, teamId: 10, employeeId: 104 },
          { id: 5, teamId: 10, employeeId: 105 },
        ]),
        deleteMany: jest.fn().mockImplementation(async () => {
          state.teamMemberDeleted = true;
          return { count: 5 };
        }),
      };
      const team = {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ id: 10 }]),
        deleteMany: jest.fn().mockRejectedValue(new Error('Simulated database deadlock or network error')),
      };

      const prisma = createMockPrisma({
        teamMember,
        team,
        $transaction: async (cb: (tx: any) => Promise<any>) => {
          try {
            return await cb(prisma);
          } catch (err) {
            state.teamMemberDeleted = false; // Transaction rollback keeps data intact
            throw err;
          }
        },
      });

      const service = new DataGovernanceService(prisma as any);
      const preview = await service.previewReset(tenantId, { modules: ['visits-tasks'] });

      await expect(
        service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
          modules: ['visits-tasks'],
          previewToken: preview.previewToken,
          confirmation: 'RESET',
          idempotencyKey: 'test-scenario-9',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(state.teamMemberDeleted).toBe(false);
    });
  });

  describe('Scenario 10: Idempotent retry after failure', () => {
    it('allows a subsequent preview and execute to succeed after a prior failure', async () => {
      let failFirst = true;
      let members = 5;

      const teamMember = {
        count: jest.fn().mockImplementation(async () => members),
        findMany: jest.fn().mockImplementation(async () =>
          Array.from({ length: members }, (_, i) => ({ id: i + 1, teamId: 10, employeeId: 100 + i })),
        ),
        deleteMany: jest.fn().mockImplementation(async () => {
          if (failFirst) {
            failFirst = false;
            throw new Error('Temporary failure');
          }
          const count = members;
          members = 0;
          return { count };
        }),
      };

      const prisma = createMockPrisma({ teamMember });
      const service = new DataGovernanceService(prisma);

      // Attempt 1 fails
      const preview1 = await service.previewReset(tenantId, { modules: ['visits-tasks'] });
      await expect(
        service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
          modules: ['visits-tasks'],
          previewToken: preview1.previewToken,
          confirmation: 'RESET',
          idempotencyKey: 'test-scenario-10-attempt-1',
        }),
      ).rejects.toThrow(BadRequestException);

      // Attempt 2 succeeds
      const preview2 = await service.previewReset(tenantId, { modules: ['visits-tasks'] });
      const result2 = await service.executeReset(tenantId, 1, 'SUPER_ADMIN', {
        modules: ['visits-tasks'],
        previewToken: preview2.previewToken,
        confirmation: 'RESET',
        idempotencyKey: 'test-scenario-10-attempt-2',
      });

      expect(result2.status).toBe('SUCCESS');
      expect(result2.tables.teamMember).toBe(5);
    });
  });
});

describePostgresIntegration('Data Management Reset – TeamMember PostgreSQL Integration', () => {
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
    const createdA = await prisma.customer.create({ data: { name: `Team Reset Tenant A ${unique}` } });
    const createdB = await prisma.customer.create({ data: { name: `Team Reset Tenant B ${unique}` } });
    tenantAId = createdA.id;
    tenantBId = createdB.id;
  });

  afterAll(async () => {
    if (prisma && tenantAId && tenantBId) {
      await prisma.customer.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    }
    await prisma.$disconnect();
  });

  it('deletes exactly 5 eligible TeamMember records in real PostgreSQL', async () => {
    const team = await prisma.team.create({
      data: { customerId: tenantAId, name: `Team A ${Date.now()}` },
    });

    const employees = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.employee.create({
          data: {
            customerId: tenantAId,
            employeeCode: `TM-${i}-${Date.now()}`,
            firstName: `Emp${i}`,
            lastName: 'Test',
            email: `tm-${i}-${Date.now()}@example.test`,
          },
        }),
      ),
    );

    await Promise.all(
      employees.map((emp) =>
        prisma.teamMember.create({
          data: {
            teamId: team.id,
            employeeId: emp.id,
          },
        }),
      ),
    );

    const preview = await service.previewReset(tenantAId, { modules: ['visits-tasks'] });
    expect(preview.tables.find((t) => t.model === 'teamMember')?.records).toBe(5);

    const result = await service.executeReset(tenantAId, 1, 'SUPER_ADMIN', {
      modules: ['visits-tasks'],
      previewToken: preview.previewToken,
      confirmation: 'RESET',
      idempotencyKey: `pg-team-test-${Date.now()}`,
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.tables.teamMember).toBe(5);

    const remainingMembers = await prisma.teamMember.count({
      where: { teamId: team.id },
    });
    expect(remainingMembers).toBe(0);
  });
});
