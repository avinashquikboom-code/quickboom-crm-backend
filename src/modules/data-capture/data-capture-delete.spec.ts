import { DataCaptureService } from './data-capture.service';

describe('capture-only deletion', () => {
  let db: any;
  let service: DataCaptureService;
  let rows: any[];
  beforeEach(() => {
    rows = [{ id: 1, customerId: 7, isImported: false }, { id: 2, customerId: 7, isImported: true, importedLeadId: 50 }, { id: 3, customerId: 8, isImported: false }, { id: 4, customerId: 7, isImported: false }];
    db = {
      $executeRaw: jest.fn(),
      dataCapturePlace: {
        findFirst: jest.fn(async ({ where }) => rows.find((row) => row.id === where.id && row.customerId === where.customerId && !row.deletedAt)),
        updateMany: jest.fn(async ({ where, data }) => { const row = rows.find((r) => r.id === where.id && r.customerId === where.customerId && !r.isImported && !r.importedLeadId && !r.deletedAt); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
      },
      lead: { delete: jest.fn(), deleteMany: jest.fn(), update: jest.fn() },
    };
    db.$transaction = jest.fn((callback) => callback(db));
    service = new DataCaptureService({} as any, db, {} as any);
  });
  it('deletes only selected tenant captures and returns accurate protected/failed counts', async () => {
    const result = await service.deleteCapturedRecords(7, [1, 2, 3, 1]);
    expect(result).toMatchObject({ totalSelected: 3, deleted: 1, skipped: 1, failed: 1 });
    expect(rows[0].deletedAt).toBeInstanceOf(Date);
    expect(rows.slice(1).every((row) => !row.deletedAt)).toBe(true);
    expect(db.lead.delete).not.toHaveBeenCalled();
    expect(db.lead.deleteMany).not.toHaveBeenCalled();
    expect(db.lead.update).not.toHaveBeenCalled();
  });
  it('validates tenant and IDs before writes', async () => {
    for (const ids of [[], [0], [-1], [1.5], [NaN]]) await expect(service.deleteCapturedRecords(7, ids)).rejects.toThrow();
    await expect(service.deleteCapturedRecords(undefined, [1])).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('single deletion shares protection and repeat deletion is not reported as success', async () => {
    expect(await service.deletePlace(7, 2)).toMatchObject({ skipped: 1, deleted: 0 });
    expect(await service.deletePlace(7, 1)).toMatchObject({ deleted: 1 });
    expect(await service.deletePlace(7, 1)).toMatchObject({ failed: 1, deleted: 0 });
  });
  it('continues after a per-record database failure', async () => {
    db.dataCapturePlace.updateMany.mockRejectedValueOnce(new Error('database unavailable'));
    const result = await service.deleteCapturedRecords(7, [1, 4]);
    expect(result).toMatchObject({ failed: 1, deleted: 1 });
  });
});
