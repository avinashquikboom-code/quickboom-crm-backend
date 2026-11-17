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
    const tx = { attendanceBreak, attendance };
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
    Object.defineProperty(service, 'assertBackupCovers', { value: jest.fn().mockResolvedValue(undefined) });
    Object.defineProperty(service, 'countProtectedRecords', {
      value: jest.fn().mockResolvedValue({ systemCritical: { records: 0, tables: {} }, organizationAndHrMaster: { records: 0, tables: {} } }),
    });
    const preview = await service.previewReset(12, { modules: ['attendance'] });

    const result = await service.executeReset(12, 7, 'SUPER_ADMIN', {
      modules: ['attendance'],
      previewToken: preview.previewToken,
      backupId: 'verified-backup',
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

describe('DataGovernanceService backup gate', () => {
  it('rejects a missing or unverified backup before any destructive operation', async () => {
    const service = new DataGovernanceService({} as PrismaService);
    Object.defineProperty(service, 'backupMeta', {
      value: jest.fn().mockResolvedValue({ status: 'MISSING', scope: 'tenant', createdAt: new Date().toISOString() }),
    });

    await expect(service.assertBackupCovers(12, 'backup-id-1234', ['attendance']))
      .rejects.toThrow('The selected backup is not verified.');
  });

  it('accepts a recent, verified backup only when it covers the selected module', async () => {
    const service = new DataGovernanceService({} as PrismaService);
    Object.defineProperty(service, 'backupMeta', {
      value: jest.fn().mockResolvedValue({
        status: 'VERIFIED',
        scope: 'tenant',
        createdAt: new Date().toISOString(),
        modules: ['attendance'],
        customerId: 12,
        checksum: 'checksum',
      }),
    });
    Object.defineProperty(service, 'verifyFile', {
      value: jest.fn().mockResolvedValue({ ok: true, reason: '', size: 100 }),
    });

    await expect(service.assertBackupCovers(12, 'backup-id-1234', ['attendance'])).resolves.toBeUndefined();
    await expect(service.assertBackupCovers(12, 'backup-id-1234', ['payroll']))
      .rejects.toThrow('The backup does not include: payroll');
  });
});
