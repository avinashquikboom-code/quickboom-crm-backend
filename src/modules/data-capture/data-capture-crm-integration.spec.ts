import { DataCaptureService } from './data-capture.service';

// In-memory persistence here is a test double only; no provider or CRM calls are made.
describe('Data Capture CRM reference imports', () => {
  let service: DataCaptureService;
  let prisma: any;
  let leads: any[];
  let captures: any[];
  beforeEach(() => {
    leads = [];
    captures = [1, 2, 3].map((id) => ({ id, customerId: 7, googlePlaceId: `place-${id}`, jobId: 'session',
      businessName: 'Google-only name', phone: '+919999999999', source: 'GOOGLE_PLACES', status: 'CAPTURED' }));
    const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => key === 'deletedAt' || row[key] === value);
    prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 9, customerId: 7 }) },
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
      dataCaptureJob: { findFirst: jest.fn().mockResolvedValue({ jobId: 'session', customerId: 7 }) },
      dataCapturePlace: {
        findFirst: jest.fn(async ({ where }) => captures.find((row) => matches(row, where)) || null),
        update: jest.fn(async ({ where, data }) => Object.assign(captures.find((row) => row.id === where.id), data)),
      },
      lead: {
        findFirst: jest.fn(async ({ where }) => leads.find((row) => matches(row, where)) || null),
        findMany: jest.fn(async ({ where }) => leads.filter((row) => row.customerId === where.customerId && where.OR.some((clause: any) =>
          (clause.googlePlaceId && clause.googlePlaceId === row.googlePlaceId) || (clause.sourceRecordId && clause.sourceRecordId === row.sourceRecordId)))),
        create: jest.fn(async ({ data }) => { const row = { id: leads.length + 100, ...data }; leads.push(row); return row; }),
        update: jest.fn(),
      },
      leadStage: { findFirst: jest.fn().mockResolvedValue({ id: 12 }) },
      leadActivityTimeline: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    let queue = Promise.resolve();
    prisma.$transaction = jest.fn((callback) => { const result = queue.then(() => callback(prisma)); queue = result.catch(() => undefined); return result; });
    service = new DataCaptureService({} as any, prisma, {} as any);
  });

  it('creates real leads using only independent fields, with tenant/user/defaults and capture link', async () => {
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, { places: [{ id: 1,
      independentFields: { businessName: 'Customer-supplied name', city: 'Pune', country: 'India', category: 'Supplier', id: 999, customerId: 99 } }] });
    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({ customerId: 7, createdById: 9, title: 'Customer-supplied name',
      phone: null, city: 'Pune', country: 'India', category: 'Supplier', source: 'Google Maps', status: 'NEW', priority: 'MEDIUM', assignedToId: null });
    expect(captures[0]).toMatchObject({ importedLeadId: leads[0].id, status: 'LEAD_CREATED' });
  });

  it('isolates missing and foreign tenant/record context', async () => {
    await expect(service.importToLeads(undefined as any, 9, { places: [{ id: 1 }] })).rejects.toThrow();
    await expect(service.importToLeads(8, 9, { places: [{ id: 1 }] })).rejects.toThrow();
    captures[0].customerId = 8;
    const result = await service.importToLeads(7, 9, { places: [{ id: 1 }] });
    expect(result.failed).toBe(1);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('keeps partial counts accurate and never copies provider content when independent data is absent', async () => {
    const result = await service.importToLeads(7, 9, { places: [{ id: 1 },
      { id: 2, independentFields: { businessName: 'Good record' } },
      { id: 3, independentFields: { businessName: 'Invalid record', email: 'invalid' } }] });
    expect(result).toMatchObject({ totalRequested: 3, imported: 1, failed: 2, skippedDuplicates: 0 });
    expect(result.records).toHaveLength(3);
    expect(captures.map((row) => row.status)).toEqual(['IMPORT_FAILED', 'LEAD_CREATED', 'IMPORT_FAILED']);
  });

  it('serializes concurrent retries, preserves history and never reassigns an existing lead', async () => {
    const dto = { places: [{ id: 1, independentFields: { businessName: 'Independent name' } }] };
    const results = await Promise.all([service.importToLeads(7, 9, dto), service.importToLeads(7, 9, dto)]);
    expect(results.reduce((count, result) => count + result.imported, 0)).toBe(1);
    expect(results.reduce((count, result) => count + result.skippedDuplicates, 0)).toBe(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(captures[0].status).toBe('LEAD_CREATED');
  });
});
