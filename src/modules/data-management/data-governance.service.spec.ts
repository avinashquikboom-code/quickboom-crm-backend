import { DataGovernanceService } from './data-governance.service';
import { PrismaService } from '../../prisma/prisma.service';

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
    const tx = { attendanceBreak, attendance, $queryRaw: jest.fn().mockResolvedValue([]) };
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
      confirmation: 'RESET',
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
});

describe('DataGovernanceService reset preview', () => {
  it('returns a usable reset preview without querying backup metadata', async () => {
    const client = new Proxy({}, {
      get: (_target, key) => {
        if (key === '$queryRaw') return jest.fn().mockResolvedValue([]);
        return {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        };
      },
    }) as PrismaService;
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
