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
      leadSocialProfile: { create: jest.fn() },
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

  it('resolves primitive selected IDs through the tenant-scoped Data Capture primary key', async () => {
    captures[0].source = 'MANUAL';
    captures[0].googlePlaceId = null;
    captures[0].sourceRecordId = '1';
    captures[0].phone = null;
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      jobId: 'session',
      places: ['1'],
    });

    expect(result.imported).toBe(1);
    expect(result.records[0]).toMatchObject({ imported: true, leadId: leads[0].id });
    expect(prisma.dataCapturePlace.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 1, customerId: 7, deletedAt: null }),
    }));
  });

  it('pairs an ID-less places descriptor with the corresponding selected placeIds entry', async () => {
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      jobId: 'session',
      placeIds: ['1'],
      places: [{ independentFields: { businessName: 'Independently supplied name' } }],
    });

    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({ title: 'Independently supplied name', customerId: 7 });
  });

  it('recovers a null places entry from its paired selected ID instead of rejecting the descriptor', async () => {
    await expect(service.importToLeads(7, { id: 9, customerId: 7 }, {
      jobId: 'session',
      placeIds: ['1'],
      places: [null],
    })).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'DATA_CAPTURE_IMPORT_FAILED',
        message: expect.stringContaining('Business name is missing'),
      }),
    });
    expect(prisma.dataCapturePlace.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 1, customerId: 7, deletedAt: null }),
    }));
  });

  it('unwraps a nested capture record descriptor and still resolves it by its database ID', async () => {
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      jobId: 'session',
      places: [{
        place: { id: 1 },
        independentFields: { businessName: 'Wrapped capture record' },
      }],
    });

    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({ title: 'Wrapped capture record', customerId: 7 });
  });

  it('requires independently supplied CRM fields even when a Google capture was reviewed', async () => {
    captures[0].status = 'VALIDATED';
    captures[0].phone = null;
    await expect(service.importToLeads(7, { id: 9, customerId: 7 }, {
      jobId: 'session',
      placeIds: ['1'],
    })).rejects.toMatchObject({ response: expect.objectContaining({ error: 'DATA_CAPTURE_IMPORT_FAILED' }) });
  });

  it('saves user-provided social URLs as unverified profiles with provenance', async () => {
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 1, independentFields: {
        businessName: 'Customer-supplied name',
        socialMedia: { instagram: 'https://instagram.com/example_business' },
      } }],
    });
    expect(result.imported).toBe(1);
    expect(leads[0].socialMedia).toEqual({ instagram: 'https://instagram.com/example_business' });
    expect(prisma.leadSocialProfile.create).toHaveBeenCalledWith({ data: {
      leadId: leads[0].id,
      platform: 'INSTAGRAM',
      url: 'https://instagram.com/example_business',
      source: 'USER_PROVIDED',
      verificationStatus: 'UNVERIFIED',
      lastCheckedAt: null,
    } });
  });

  it('rejects a social URL that does not match its platform', async () => {
    await expect(service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 1, independentFields: {
        businessName: 'Customer-supplied name',
        socialMedia: { instagram: 'https://facebook.com/impersonator' },
      } }],
    })).rejects.toThrow('Invalid instagram profile URL.');
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('does not auto-copy Google Places fields from a reviewed capture to a lead', async () => {
    captures[0].status = 'VALIDATED';
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 1, independentFields: { businessName: 'Verified from our records' } }],
    });
    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({
      title: 'Verified from our records',
      phone: null,
      address: null,
      category: null,
      latitude: null,
      rating: null,
    });
  });

  it('isolates missing and foreign tenant/record context', async () => {
    await expect(service.importToLeads(undefined as any, 9, { places: [{ id: 1 }] })).rejects.toThrow();
    await expect(service.importToLeads(8, 9, { places: [{ id: 1 }] })).rejects.toThrow();
    captures[0].customerId = 8;
    await expect(service.importToLeads(7, 9, { places: [{ id: 1 }] })).rejects.toMatchObject({
      response: expect.objectContaining({
        success: false,
        error: 'DATA_CAPTURE_IMPORT_FAILED',
        message: expect.stringContaining('Record 1:'),
        data: expect.objectContaining({ failed: 1 }),
      }),
    });
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('returns a failure response with per-record reasons when every selected item is invalid', async () => {
    await expect(service.importToLeads(7, 9, { places: [null as any] })).rejects.toMatchObject({
      response: expect.objectContaining({
        success: false,
        error: 'DATA_CAPTURE_IMPORT_FAILED',
        data: expect.objectContaining({
          totalRequested: 1,
          imported: 0,
          failed: 1,
          records: [expect.objectContaining({ failed: true, error: expect.stringContaining('Selected item') })],
        }),
      }),
    });
  });

  it('explains when a Google reference still needs a user-entered CRM business name', async () => {
    await expect(service.importToLeads(7, 9, { places: [{ id: 1 }] })).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'DATA_CAPTURE_IMPORT_FAILED',
        message: expect.stringContaining('Business name is missing.'),
        data: expect.objectContaining({
          failed: 1,
          records: [expect.objectContaining({
            failed: true,
            error: 'Business name is missing. Place details could not be retrieved.',
          })],
        }),
      }),
    });
  });

  it('rejects malformed numeric IDs as per-record not-found failures without Prisma type errors', async () => {
    await expect(service.importToLeads(7, 9, { places: [1.5 as any] })).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'DATA_CAPTURE_IMPORT_FAILED',
        data: expect.objectContaining({
          failed: 1,
          records: [expect.objectContaining({
            failed: true,
            error: 'Captured record not found in this tenant/session.',
          })],
        }),
      }),
    });
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
