import { DataGovernanceService } from './data-governance.service';
import { moduleById, tablesForModules } from './data-governance.catalog';
import { PrismaService } from '../../prisma/prisma.service';

const requestedModules = [
  'employees', 'departments', 'designations', 'attendance', 'leave', 'salary-structures', 'payroll-policies', 'visits-tasks', 'commission-configurations',
];

describe('Data Governance HR module physical deletes', () => {
  it.each(requestedModules)('physically deletes and verifies selected %s records', async (moduleId) => {
    const moduleTables = moduleById(moduleId)!.tables;
    const counts = new Map(moduleTables.map((table) => [table.model, 2]));
    const deleteOrder: string[] = [];
    const deleteMany = jest.fn(async (model: string) => {
      deleteOrder.push(model);
      const count = counts.get(model) || 0;
      counts.set(model, 0);
      // VisitPhoto.visit uses ON DELETE CASCADE. Deleting visits first would
      // make the later VisitPhoto.deleteMany report zero despite preview=2.
      if (model === 'visit') counts.set('visitPhoto', 0);
      return { count };
    });
    const delegateFor = (model: string) => ({
      count: jest.fn(async (args?: { where?: Record<string, any> }) => {
        if (model === 'commissionSlab' && args?.where?.configuration?.customerId?.not) return 0;
        return counts.get(model) || 0;
      }),
      findMany: jest.fn(async () => model === 'taskHistory'
        ? Array.from({ length: counts.get(model) || 0 }, (_, index) => ({ id: index + 1, taskId: 1 }))
        : model === 'visitPhoto'
          ? Array.from({ length: counts.get(model) || 0 }, (_, index) => ({ id: index + 1, visitId: index + 10 }))
          : model === 'teamMember'
            ? Array.from({ length: counts.get(model) || 0 }, (_, index) => ({ id: index + 1, teamId: 1, employeeId: index + 1 }))
            : []),
      findFirst: jest.fn(async () => null),
      deleteMany: jest.fn((args: unknown) => deleteMany(model)),
      create: jest.fn(async () => ({})),
    });
    const delegates = new Map<string, ReturnType<typeof delegateFor>>();
    const client = new Proxy({}, {
      get: (_target, key) => {
        const model = String(key);
        if (model === '$transaction') return async (work: (tx: unknown) => Promise<unknown>) => work(client);
        if (model === '$queryRaw') return async () => [];
        if (model === '$executeRaw') return async () => 0;
        if (!delegates.has(model)) delegates.set(model, delegateFor(model));
        return delegates.get(model);
      },
    }) as PrismaService;
    const service = new DataGovernanceService(client);

    const preview = await service.previewReset(42, { modules: [moduleId] });
    const result = await service.executeReset(42, 9, 'SUPER_ADMIN', {
      modules: [moduleId],
      previewToken: preview.previewToken,
      confirmation: 'RESET',
      idempotencyKey: `hr-reset-${moduleId}`,
    });

    expect(result).toMatchObject({ success: true, status: 'SUCCESS', verified: true, modules: [moduleId] });
    expect(result.recordsDeleted).toBe(moduleTables.length * 2);
    for (const table of tablesForModules([moduleId])) {
      expect(delegates.get(table.model)!.deleteMany).toHaveBeenCalledWith({ where: expect.any(Object) });
      expect(result.countsAfter[table.model]).toBe(0);
    }
    if (moduleId === 'visits-tasks') {
      expect(delegates.get('teamMember')!.deleteMany).toHaveBeenCalledWith({ where: { team: { customerId: 42 } } });
      expect(deleteOrder.indexOf('visitPhoto')).toBeLessThan(deleteOrder.indexOf('visit'));
      expect(delegates.get('visitPhoto')!.deleteMany).toHaveBeenCalledWith({ where: { customerId: 42 } });
    }
    if (moduleId === 'commission-configurations') {
      expect(delegates.get('commissionConfig')!.deleteMany).toHaveBeenCalledWith({ where: { customerId: 42 } });
      expect(delegates.get('commissionSlab')!.deleteMany).toHaveBeenCalledWith({ where: { customerId: 42 } });
      expect(deleteOrder.indexOf('commissionSlab')).toBeLessThan(deleteOrder.indexOf('commissionConfig'));
    }
  });

  it('reports cascade history, SET NULL references, and cross-tenant customer dependencies', async () => {
    const warnings: Array<Record<string, unknown>> = [];
    const client = new Proxy({}, {
      get: (_target, key) => {
        const model = String(key);
        if (model === '$queryRaw') return async () => [];
        if (model === '$executeRaw') return async () => 0;
        if (model === 'employee') return { count: async () => 0, findMany: async () => [{ id: 7 }], deleteMany: async () => ({ count: 0 }) };
        return {
          count: async (args: { where?: Record<string, unknown> } = {}) => {
            if (args.where?.customerId && typeof args.where.customerId === 'object') return 0;
            if (model !== 'customer' && args.where?.id && typeof args.where.id === 'object') return 0;
            if (model === 'overtimeNotificationEvent') return 3;
            if (model === 'workAccessRequest') return 2;
            if (model === 'work' || model === 'team' || model === 'monthlySchedule') return 1;
            if (model === 'customer' && args.where?.id && typeof args.where.id === 'object') return 2;
            return 0;
          },
          findMany: async () => [],
          deleteMany: async () => ({ count: 0 }),
        };
      },
    });
    const service = new DataGovernanceService(client as PrismaService);
    const result = await (service as any).dependencyWarnings(['employees'], 42, client);
    warnings.push(...result);

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'overtimeNotificationEvent', records: 3, blocking: true }),
      expect.objectContaining({ model: 'workAccessRequest', records: 2, blocking: true }),
      expect.objectContaining({ model: 'work', label: 'Work assignee references', willSetNull: true }),
      expect.objectContaining({ model: 'work', label: 'Work editor references', willSetNull: true }),
      expect.objectContaining({ model: 'team', willSetNull: true }),
      expect.objectContaining({ model: 'monthlySchedule', willSetNull: true }),
      expect.objectContaining({ model: 'customer', blocking: true, crossTenantRecords: 2 }),
    ]));
  });

  it('preserves a designation referenced by a protected role without blocking the reset', async () => {
    const client = new Proxy({}, {
      get: (_target, key) => {
        const model = String(key);
        if (model === '$queryRaw') return async () => [];
        if (model === '$executeRaw') return async () => 0;
        if (model === 'designation') return { count: async () => 0, findMany: async () => [{ id: 99 }], deleteMany: async () => ({ count: 0 }) };
        if (model === 'role') return { count: async () => 1, findMany: async () => [{ id: 8, designationId: 99, customerId: 42, type: 'CUSTOM', name: 'Protected custom' }], deleteMany: async () => ({ count: 0 }) };
        return { count: async () => 0, findMany: async () => [], deleteMany: async () => ({ count: 0 }) };
      },
    });
    const service = new DataGovernanceService(client as PrismaService);
    const result = await (service as any).dependencyWarnings(['designations'], 42, client);
    expect(result).toContainEqual(expect.objectContaining({
      model: 'role',
      records: 1,
      blocking: false,
      preserved: true,
      preservedRecords: 1,
      label: expect.stringContaining('protected'),
    }));
  });
});
