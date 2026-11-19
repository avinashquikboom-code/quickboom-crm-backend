import { DataGovernanceService } from './data-governance.service';
import { PrismaService } from '../../prisma/prisma.service';

function matchesCustomerEmployeeReference(
  row: Record<string, any>,
  where: Record<string, any>,
  employeeTenants: Map<number, number>,
) {
  if (typeof where.id === 'number' && row.id !== where.id) return false;
  if (where.id?.not !== undefined && row.id === where.id.not) return false;
  const alternatives = Array.isArray(where.OR) ? where.OR : [];
  if (!alternatives.length) return true;
  return alternatives.some((condition: Record<string, any>) => {
    for (const [relation, field] of [
      ['assignedEmployeeRel', 'assignedEmployeeId'],
      ['createdByEmployeeRel', 'createdByEmployeeId'],
    ]) {
      if (!(relation in condition)) continue;
      const employeeId = row[field];
      if (employeeId == null) return false;
      const relationFilter = condition[relation] || {};
      return relationFilter.customerId === undefined
        || employeeTenants.get(Number(employeeId)) === relationFilter.customerId;
    }
    return false;
  });
}

describe('DataGovernanceService history', () => {
  const createdAt = new Date('2026-11-17T12:00:00.000Z');

  it('does not present legacy reset rows as verified or use requested record counts', async () => {
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([{
          id: 33028,
          action: 'DATA_RESET',
          status: 'SUCCESS',
          details: { recordCount: 3328, operationId: 'legacy-op' },
          createdAt,
          user: null,
        }]),
      },
    } as unknown as PrismaService;
    const service = new DataGovernanceService(prisma);

    const [entry] = await service.history(12);

    expect(entry).toMatchObject({
      id: 'legacy-op',
      modules: [],
      recordsAffected: null,
      status: 'UNVERIFIED',
      verified: false,
    });
  });

  it('returns success and deleted counts only for reset entries verified after commit', async () => {
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([{
          id: 33029,
          action: 'DATA_RESET',
          status: 'SUCCESS',
          details: {
            operationId: 'verified-op',
            modules: ['attendance'],
            recordsDeleted: 7,
            verified: true,
          },
          createdAt,
          user: null,
        }]),
      },
    } as unknown as PrismaService;
    const service = new DataGovernanceService(prisma);

    const [entry] = await service.history(12);

    expect(entry).toMatchObject({
      id: 'verified-op',
      modules: ['attendance'],
      recordsAffected: 7,
      status: 'SUCCESS',
      verified: true,
    });
  });
});
describe('DataGovernanceService executeReset', () => {
  it('uses physical deletes, then verifies committed table counts before writing SUCCESS', async () => {
    const remaining = { attendanceBreak: 3, attendance: 5 };
    let committed = false;
    const makeDelegate = (model: keyof typeof remaining) => ({
      count: jest.fn(async () => remaining[model]),
      findMany: jest.fn(),
      deleteMany: jest.fn(async () => {
        const count = remaining[model];
        remaining[model] = 0;
        return { count };
      }),
    });
    const attendanceBreak = makeDelegate('attendanceBreak');
    const attendance = makeDelegate('attendance');
    const tx = { attendanceBreak, attendance, $queryRaw: jest.fn().mockResolvedValue([]), $executeRaw: jest.fn().mockResolvedValue(0) };
    const prisma = {
      attendanceBreak,
      attendance,
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async () => {
          expect(committed).toBe(true);
          return {};
        }),
      },
      $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => {
        const result = await work(tx);
        committed = true;
        return result;
      }),
    } as unknown as PrismaService;
    const service = new DataGovernanceService(prisma);
    Object.defineProperty(service, 'countProtectedRecords', {
      value: jest.fn().mockResolvedValue({ systemCritical: { records: 0, tables: {} }, organizationAndHrMaster: { records: 0, tables: {} } }),
    });
    const preview = await service.previewReset(12, { modules: ['attendance'] });

    const result = await service.executeReset(12, 7, 'SUPER_ADMIN', {
      modules: ['attendance'],
      previewToken: preview.previewToken,
      confirmation: ' reset ',
      idempotencyKey: 'reset-test-1',
    });

    expect(attendanceBreak.deleteMany).toHaveBeenCalledWith({ where: { attendance: { customerId: 12 } } });
    expect(attendance.deleteMany).toHaveBeenCalledWith({ where: { customerId: 12 } });
    expect(result).toMatchObject({
      success: true,
      status: 'SUCCESS',
      modules: ['attendance'],
      recordsDeleted: 8,
      verified: true,
      countsAfter: { attendanceBreak: 0, attendance: 0 },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'DATA_RESET',
        status: 'SUCCESS',
        details: expect.objectContaining({ verified: true, recordsDeleted: 8 }),
      }),
    }));
  });

  it('requires a fresh preview when dependency references change without changing selected table counts', async () => {
    const employeeTenants = new Map([[99, 12]]);
    const customerRows: Array<Record<string, any>> = [];
    const employee = {
      count: jest.fn(async ({ where }: { where?: Record<string, any> } = {}) => where?.customerId === 12 ? 1 : 0),
      findMany: jest.fn().mockResolvedValue([{ id: 99 }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const customer = {
      count: jest.fn(async ({ where }: { where: Record<string, any> }) => customerRows.filter((row) =>
        matchesCustomerEmployeeReference(row, where, employeeTenants),
      ).length),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const auditLog = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    };
    let prisma: PrismaService;
    prisma = new Proxy({ employee, customer, auditLog }, {
      get: (target, key: string | symbol) => {
        if (key in target) return target[key as keyof typeof target];
        if (key === '$transaction') return (work: (tx: unknown) => Promise<unknown>) => work(prisma);
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        if (key === '$executeRaw') return jest.fn().mockResolvedValue(0);
        return { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(prisma);
    Object.defineProperty(service, 'countProtectedRecords', { value: jest.fn().mockResolvedValue({}) });

    const preview = await service.previewReset(12, { modules: ['employees'] });
    customerRows.push({ id: 12, assignedEmployeeId: 99, createdByEmployeeId: null });

    await expect(service.executeReset(12, 7, 'SUPER_ADMIN', {
      modules: ['employees'], previewToken: preview.previewToken, confirmation: 'RESET', idempotencyKey: 'stale-dependency-preview',
    })).rejects.toThrow('Dependencies changed after the preview. Run a fresh preview before deleting.');
    expect(employee.deleteMany).not.toHaveBeenCalled();
    expect(customer.updateMany).not.toHaveBeenCalled();
  });
});

describe('DataGovernanceService reset preview', () => {
  it('returns a usable reset preview without querying backup metadata', async () => {
    const client = new Proxy({}, {
      get: (_target, key) => {
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        if (key === '$executeRaw') return jest.fn().mockResolvedValue(0);
        return {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(client);

    const preview = await service.previewReset(12, { modules: ['attendance'] });

    expect(preview).toMatchObject({ scope: 'tenant', estimatedRecords: 0, modules: [{ id: 'attendance' }] });
    expect(preview.previewToken).toBeTruthy();
    expect(preview.expiresAt).toBeTruthy();
    expect(preview).not.toHaveProperty('backupStatus');
  });
});

describe('DataGovernanceService overview', () => {
  it('returns a partial tenant overview when an optional catalog table is unavailable', async () => {
    const prisma = new Proxy({}, {
      get: (_target, key) => {
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([{ name: 'test', bytes: 1n, tables: 10n, estimate: 20n }]);
        if (key === 'auditLog') return { findFirst: jest.fn().mockResolvedValue(null) };
        if (key === 'metaTemplate') return {
          count: jest.fn().mockRejectedValue(new Error('table does not exist')),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        };
        return { count: jest.fn().mockResolvedValue(1), findMany: jest.fn(), deleteMany: jest.fn() };
      },
    }) as PrismaService;
    const service = new DataGovernanceService(prisma);

    const overview = await service.overview(31);

    expect(overview).toMatchObject({ databaseName: 'test', tenantRecordsComplete: false, health: 'Healthy' });
    expect(overview.modules.find((item) => item.id === 'templates')).toMatchObject({ complete: false });
  });

  it('returns an overview for global administrators without a selected tenant', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ name: 'test', bytes: 1n, tables: 10n, estimate: 20n }]),
      auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new DataGovernanceService(prisma);

    const overview = await service.overview(undefined);

    expect(overview).toMatchObject({ databaseName: 'test', tenantRecords: 0, tenantRecordsComplete: true, modules: [] });
  });
});

describe('DataGovernanceService reset advisory locks', () => {
  const rawTemplate = (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values });

  it('uses explicit integer arguments for tenant and global advisory locks', async () => {
    const service = new DataGovernanceService({} as PrismaService);
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const acquire = (service as any).acquireResetAdvisoryLock.bind(service);
    tx.$executeRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => rawTemplate(strings, ...values));

    await acquire(tx, 31);
    const [sharedLock, tenantLock] = tx.$executeRaw.mock.results.map((result) => result.value);
    expect(sharedLock.strings.join('?')).toContain('pg_advisory_xact_lock_shared(?::integer, 0::integer)');
    expect(sharedLock.values).toEqual([1397771313]);
    expect(tenantLock.strings.join('?')).toContain('pg_advisory_xact_lock(?::integer, ?::integer)');
    expect(tenantLock.values).toEqual([1397771313, 31]);

    tx.$executeRaw.mockClear();
    await acquire(tx, null);
    const [globalLock] = tx.$executeRaw.mock.results.map((result) => result.value);
    expect(globalLock.strings.join('?')).toContain('pg_advisory_xact_lock(?::integer, 0::integer)');
    expect(globalLock.values).toEqual([1397771313]);
  });
});

describe('DataGovernanceService TeamMember tenant filters', () => {
  it('counts employee memberships and detects memberships linked to another tenant team', async () => {
    const teamMember = {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const employee = {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([{ id: 101 }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma = new Proxy({ teamMember, employee }, {
      get: (target, key: string | symbol) => {
        if (key in target) return target[key as keyof typeof target];
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        if (key === '$executeRaw') return jest.fn().mockResolvedValue(0);
        return { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(prisma);
    const warnings = await (service as any).dependencyWarnings(['employees'], 12, prisma);
    const teamMembership = warnings.find((item: any) => item.model === 'teamMember');

    expect(teamMember.count).toHaveBeenCalledWith({ where: { employee: { customerId: 12 } } });
    expect(teamMember.count).toHaveBeenCalledWith({ where: { team: { customerId: { not: 12 } }, employee: { customerId: 12 } } });
    expect(teamMembership).toMatchObject({ records: 2, crossTenantRecords: 2, blocking: true });
  });
});

describe('DataGovernanceService employee reset dependencies', () => {
  it('separates safe same-tenant customer references from cross-tenant blockers', async () => {
    const employeeTenants = new Map([[501, 12], [502, 12], [503, 20]]);
    const customerRows = [
      { id: 12, assignedEmployeeId: 501, createdByEmployeeId: 502 },
      ...Array.from({ length: 13 }, (_, index) => ({
        id: 20 + index,
        assignedEmployeeId: null,
        createdByEmployeeId: null,
      })),
    ];
    const customer = {
      count: jest.fn(async ({ where }: { where: Record<string, any> }) => customerRows.filter((row) =>
        matchesCustomerEmployeeReference(row, where, employeeTenants),
      ).length),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const client = new Proxy({ customer }, {
      get: (target, key: string | symbol) => {
        if (key in target) return target[key as keyof typeof target];
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        return { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(client);
    Object.defineProperty(service, 'countProtectedRecords', { value: jest.fn().mockResolvedValue({}) });

    const warnings = await (service as any).dependencyWarnings(['employees'], 12, client);
    const assignment = warnings.find((item: any) => item.model === 'customer');

    expect(customer.count).toHaveBeenCalledWith({ where: { OR: [
      { assignedEmployeeRel: { customerId: 12 } },
      { createdByEmployeeRel: { customerId: 12 } },
    ] } });
    expect(customer.count).toHaveBeenCalledWith({ where: { id: { not: 12 }, OR: [
      { assignedEmployeeRel: { customerId: 12 } },
      { createdByEmployeeRel: { customerId: 12 } },
    ] } });
    expect(assignment).toMatchObject({
      records: 1,
      crossTenantRecords: 0,
      resolvedRecords: 1,
      unresolvedRecords: 0,
      willSetNull: true,
      blocking: false,
    });
  });

  it('keeps genuinely cross-tenant customer employee references blocked', async () => {
    const employeeTenants = new Map([[501, 12], [502, 12]]);
    const customerRows = [
      { id: 12, assignedEmployeeId: 501, createdByEmployeeId: null },
      ...Array.from({ length: 13 }, (_, index) => ({
        id: 20 + index,
        assignedEmployeeId: index % 2 === 0 ? 501 : null,
        createdByEmployeeId: index % 2 === 1 ? 502 : null,
      })),
    ];
    const customer = {
      count: jest.fn(async ({ where }: { where: Record<string, any> }) => customerRows.filter((row) =>
        matchesCustomerEmployeeReference(row, where, employeeTenants),
      ).length),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const employee = {
      count: jest.fn(async ({ where }: { where?: Record<string, any> } = {}) => where?.customerId === 12 ? 2 : 0),
      findMany: jest.fn().mockResolvedValue([{ id: 501 }, { id: 502 }]),
      deleteMany: jest.fn(),
    };
    const auditLog = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    };
    let client: PrismaService;
    client = new Proxy({ customer, employee, auditLog }, {
      get: (target, key: string | symbol) => {
        if (key in target) return target[key as keyof typeof target];
        if (key === '$transaction') return (work: (tx: unknown) => Promise<unknown>) => work(client);
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        if (key === '$executeRaw') return jest.fn().mockResolvedValue(0);
        return { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(client);
    Object.defineProperty(service, 'countProtectedRecords', { value: jest.fn().mockResolvedValue({}) });

    const warnings = await (service as any).dependencyWarnings(['employees'], 12, client);
    const assignment = warnings.find((item: any) => item.model === 'customer');

    expect(assignment).toMatchObject({
      records: 14,
      crossTenantRecords: 13,
      resolvedRecords: 1,
      unresolvedRecords: 13,
      willSetNull: true,
      blocking: true,
    });

    const preview = await service.previewReset(12, { modules: ['employees'] });
    await expect(service.executeReset(12, 7, 'SUPER_ADMIN', {
      modules: ['employees'], previewToken: preview.previewToken, confirmation: 'RESET', idempotencyKey: 'cross-tenant-employee-reset',
    })).rejects.toThrow(/Deletion is blocked by dependencies/);
    expect(customer.updateMany).not.toHaveBeenCalled();
    expect(employee.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps commission references owned by other tenants blocked while resolving same-tenant rows', async () => {
    const employeeTenants = new Map([[501, 12], [502, 20]]);
    const commissionRows = [
      { id: 7101, customerId: 12, employeeId: 501 },
      { id: 7102, customerId: 20, employeeId: 501 },
      { id: 7103, customerId: 21, employeeId: 501 },
      { id: 7104, customerId: 12, employeeId: 502 },
    ];
    const commission = {
      count: jest.fn(async ({ where }: { where: Record<string, any> }) => commissionRows.filter((row) => {
        if (typeof where.customerId === 'number' && row.customerId !== where.customerId) return false;
        if (where.customerId?.not !== undefined && row.customerId === where.customerId.not) return false;
        if (where.employee?.customerId !== undefined && employeeTenants.get(row.employeeId) !== where.employee.customerId) return false;
        return true;
      }).length),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const client = new Proxy({ commission }, {
      get: (target, key: string | symbol) => {
        if (key in target) return target[key as keyof typeof target];
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        return { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(client);

    const warnings = await (service as any).dependencyWarnings(['employees', 'commissions'], 12, client);
    const warning = warnings.find((item: any) => item.model === 'commission');

    expect(commission.count).toHaveBeenCalledWith({ where: { employee: { customerId: 12 } } });
    expect(commission.count).toHaveBeenCalledWith({ where: { customerId: { not: 12 }, employee: { customerId: 12 } } });
    expect(warning).toMatchObject({
      records: 3,
      crossTenantRecords: 2,
      resolvedRecords: 1,
      unresolvedRecords: 2,
      blocking: true,
      includedInSelectedModule: true,
    });
  });

  it('previews commission configurations using only the selected tenant scope', async () => {
    const countCalls: Array<Record<string, unknown>> = [];
    const client = new Proxy({}, {
      get: (_target, key: string | symbol) => {
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        if (key === 'auditLog') return { findFirst: jest.fn().mockResolvedValue(null) };
        if (key === 'commissionConfig') return {
          count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => { countCalls.push(where); return where.customerId === 12 ? 2 : 0; }),
          findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        };
        return { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(client);
    Object.defineProperty(service, 'countProtectedRecords', { value: jest.fn().mockResolvedValue({}) });

    const preview = await service.previewReset(12, { modules: ['commission-configurations'] });

    expect(countCalls).toContainEqual({ customerId: 12 });
    expect(preview.tables.find((table) => table.model === 'commissionConfig')).toMatchObject({ records: 2 });
    expect(preview.modules.find((item) => item.id === 'commission-configurations')?.records).toBe(2);
  });

  it('keeps cross-tenant commission configurations blocking employee deletion', async () => {
    const commissionConfig = {
      count: jest.fn(async ({ where }: { where: Record<string, any> }) => where.customerId?.not === 12 ? 1 : 2),
      findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const client = new Proxy({ commissionConfig }, {
      get: (target, key: string | symbol) => {
        if (key in target) return target[key as keyof typeof target];
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        return { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(client);

    const warnings = await (service as any).dependencyWarnings(['employees', 'commission-configurations'], 12, client);
    const warning = warnings.find((item: any) => item.model === 'commissionConfig');

    expect(warning).toMatchObject({ records: 2, crossTenantRecords: 1, blocking: true, includedInSelectedModule: true });
  });

  it('previews protected roles and linked designations as preserved, not blockers', async () => {
    const roleRows = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1, designationId: index + 1, customerId: index < 8 ? 12 : null,
      type: index < 8 ? 'CUSTOM' : 'SUPER_ADMIN', name: `Role ${index + 1}`,
    }));
    const client = new Proxy({}, {
      get: (_target, key: string | symbol) => {
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        if (key === 'auditLog') return { findFirst: jest.fn().mockResolvedValue(null) };
        if (key === 'role') return { count: jest.fn().mockResolvedValue(11), findMany: jest.fn().mockResolvedValue(roleRows), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
        if (key === 'designation') return {
          count: jest.fn().mockResolvedValue(13),
          findMany: jest.fn().mockResolvedValue(Array.from({ length: 13 }, (_, index) => ({ id: index + 1 }))),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        };
        return { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(client);
    Object.defineProperty(service, 'countProtectedRecords', { value: jest.fn().mockResolvedValue({}) });

    const preview = await service.previewReset(12, { modules: ['designations'] });
    const roleWarning = preview.dependencyWarnings.find((item) => item.model === 'role');

    expect(preview.totalEligibleRecords).toBe(2);
    expect(preview.totalPreservedRecords).toBe(22);
    expect(preview.preservation).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'role', records: 11, roleOwnership: { system: 3, tenant: 8, otherTenant: 0 } }),
      expect.objectContaining({ model: 'designation', records: 11 }),
    ]));
    expect(roleWarning).toMatchObject({ records: 11, blocking: false, preserved: true, preservedRecords: 11 });
    expect(preview.preservation[0].roles).toHaveLength(11);
  });

  it('partially deletes unreferenced designations and verifies all protected role links remain', async () => {
    let designationCount = 13;
    const roles = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1, designationId: index + 1, customerId: 12, type: 'CUSTOM', name: `Tenant Role ${index + 1}`,
    }));
    const makeDelegate = () => ({
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 0 })),
    });
    const designation = makeDelegate();
    designation.count.mockImplementation(async ({ where }: { where?: Record<string, any> } = {}) => {
        if (where?.id?.notIn) return 0;
        if (where?.id?.in) return 11;
        return designationCount;
    });
    designation.findMany.mockImplementation(async () => Array.from({ length: 13 }, (_, index) => ({ id: index + 1 })));
    designation.deleteMany.mockImplementation(async (...args: any[]) => {
      const { where } = args[0] as { where: Record<string, any> };
      expect(where).toEqual({ customerId: 12, id: { notIn: Array.from({ length: 11 }, (_, index) => index + 1) } });
      designationCount = 11;
      return { count: 2 };
    });
    const role = makeDelegate();
    role.findMany.mockImplementation(async () => roles);
    role.count.mockImplementation(async () => 11);
    const auditLog = { ...makeDelegate(), findFirst: jest.fn().mockResolvedValue(null) };
    let prisma: PrismaService;
    const proxy = new Proxy({ designation, role, auditLog }, {
      get: (target, key: string | symbol) => {
        if (key in target) return target[key as keyof typeof target];
        if (key === '$transaction') return (work: (tx: unknown) => Promise<unknown>) => work(prisma);
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        if (key === '$executeRaw') return jest.fn().mockResolvedValue(0);
        return makeDelegate();
      },
    });
    prisma = proxy as unknown as PrismaService;
    const service = new DataGovernanceService(prisma);
    Object.defineProperty(service, 'countProtectedRecords', { value: jest.fn().mockResolvedValue({}) });

    const preview = await service.previewReset(12, { modules: ['designations'] });
    const result = await service.executeReset(12, 7, 'SUPER_ADMIN', {
      modules: ['designations'], previewToken: preview.previewToken, confirmation: 'RESET', idempotencyKey: 'partial-designation-reset',
    });

    expect(result).toMatchObject({
      recordsDeleted: 2,
      recordsPreserved: 22,
      preservedCounts: { role: 11, designation: 11 },
      countsAfter: { designation: 11 },
      verified: true,
    });
    expect(role.deleteMany).not.toHaveBeenCalled();
  });

  it('resolves same-tenant commission dependencies when the Commissions module is selected', async () => {
    const commission = {
      count: jest.fn(async ({ where }: { where: Record<string, any> }) => where.customerId?.not === 12 ? 0 : 4),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const client = new Proxy({ commission }, {
      get: (target, key: string | symbol) => {
        if (key in target) return target[key as keyof typeof target];
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        return { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(client);

    const warnings = await (service as any).dependencyWarnings(['employees', 'commissions'], 12, client);
    const commissions = warnings.find((item: any) => item.model === 'commission');

    expect(commissions).toMatchObject({ records: 4, resolvedRecords: 4, unresolvedRecords: 0, blocking: false, includedInSelectedModule: true });
  });

  it('clears only same-tenant customer employee links during employee reset', async () => {
    let employeeCount = 1;
    const employeeTenants = new Map([[99, 12], [200, 20]]);
    const customerRows = [
      { id: 12, assignedEmployeeId: 99, createdByEmployeeId: 99 },
      { id: 20, assignedEmployeeId: 200, createdByEmployeeId: null },
    ];
    const makeDelegate = (count = 0) => ({
      count: jest.fn(async () => count),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async () => ({})),
    });
    const employee = makeDelegate();
    employee.count.mockImplementation(async ({ where }: { where?: Record<string, any> } = {}) => {
      if (where?.customerId?.not) return 0;
      return where?.customerId === 12 ? employeeCount : 0;
    });
    employee.findMany.mockImplementation(async () => [{ id: 99 }]);
    employee.deleteMany.mockImplementation(async () => { employeeCount = 0; return { count: 1 }; });
    const customer = {
      count: jest.fn(async ({ where }: { where: Record<string, any> }) => customerRows.filter((row) =>
        matchesCustomerEmployeeReference(row, where, employeeTenants),
      ).length),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      let count = 0;
      for (const row of customerRows) {
        if (row.id !== where.id) continue;
        const assignedIds = where.assignedEmployeeId?.in as number[] | undefined;
        const creatorIds = where.createdByEmployeeId?.in as number[] | undefined;
        if (row.assignedEmployeeId != null && assignedIds?.includes(row.assignedEmployeeId)) {
          row.assignedEmployeeId = data.assignedEmployeeId;
          count += 1;
        }
        if (row.createdByEmployeeId != null && creatorIds?.includes(row.createdByEmployeeId)) {
          row.createdByEmployeeId = data.createdByEmployeeId;
          count += 1;
        }
      }
      return { count };
      }),
      create: jest.fn(async () => ({})),
    };
    const auditLog = { ...makeDelegate(), findFirst: jest.fn().mockResolvedValue(null) };
    const prisma = new Proxy({ employee, customer, auditLog }, {
      get: (target, key: string | symbol) => {
        if (key in target) return target[key as keyof typeof target];
        if (key === '$transaction') return (work: (tx: unknown) => Promise<unknown>) => work(prisma);
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        if (key === '$executeRaw') return jest.fn().mockResolvedValue(0);
        return makeDelegate();
      },
    }) as unknown as PrismaService;
    const service = new DataGovernanceService(prisma);
    Object.defineProperty(service, 'countProtectedRecords', { value: jest.fn().mockResolvedValue({}) });

    const preview = await service.previewReset(12, { modules: ['employees'] });
    const customerWarning = preview.dependencyWarnings.find((item: any) => item.model === 'customer');
    expect(customerWarning).toMatchObject({ records: 1, crossTenantRecords: 0, resolvedRecords: 1, unresolvedRecords: 0, blocking: false });

    const result = await service.executeReset(12, 7, 'SUPER_ADMIN', {
      modules: ['employees'], previewToken: preview.previewToken, confirmation: 'RESET', idempotencyKey: 'employee-reset-12',
    });

    expect(result).toMatchObject({ success: true, recordsDeleted: 1, verified: true, countsAfter: { employee: 0 } });
    expect(customer.updateMany).toHaveBeenCalledWith({
      where: { id: 12, assignedEmployeeId: { in: [99] } },
      data: { assignedEmployeeId: null },
    });
    expect(customer.updateMany).toHaveBeenCalledWith({
      where: { id: 12, createdByEmployeeId: { in: [99] } },
      data: { createdByEmployeeId: null },
    });
    expect(customerRows).toEqual([
      { id: 12, assignedEmployeeId: null, createdByEmployeeId: null },
      { id: 20, assignedEmployeeId: 200, createdByEmployeeId: null },
    ]);
  });
});
