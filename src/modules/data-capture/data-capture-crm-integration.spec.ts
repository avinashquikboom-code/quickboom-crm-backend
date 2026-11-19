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
        updateMany: jest.fn(async ({ where, data }) => {
          const field = Object.keys(data)[0];
          const row = leads.find((candidate) => candidate.id === where.id &&
            candidate.customerId === where.customerId && candidate.deletedAt === null &&
            (candidate[field] == null || candidate[field] === ''));
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
      leadSocialProfile: { create: jest.fn() },
      leadStage: { findFirst: jest.fn().mockResolvedValue({ id: 12 }) },
      leadActivityTimeline: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      leadStageWhatsAppDelivery: { upsert: jest.fn() },
      leadStageEmailDelivery: { upsert: jest.fn() },
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
    captures[0].businessName = '';
    jest.spyOn(service as any, 'refreshReferencePlaces').mockImplementation(async (rows: any[]) => rows);
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

  it('uses the saved database business name before requiring a Google lookup', async () => {
    captures[0].status = 'VALIDATED';
    captures[0].businessName = 'Saved database name';
    captures[0].phone = null;
    const lookup = jest.spyOn(service as any, 'refreshReferencePlaces');
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      jobId: 'session',
      placeIds: ['1'],
    });
    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({ title: 'Saved database name', phone: null });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('imports saved tenant-owned contact fields into Lead without changing their meaning', async () => {
    captures[0] = {
      ...captures[0],
      source: 'MANUAL',
      googlePlaceId: null,
      sourceRecordId: 'capture-1',
      phone: '+91 98765 43210',
      email: 'Contact@Example.com',
      website: 'https://example.com/contact',
    };
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 1 }],
    });

    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({
      customerId: 7,
      phone: '+919876543210',
      email: 'contact@example.com',
      website: 'https://example.com/contact',
    });
  });

  it('imports Google-linked contact fields only when their saved provenance is user-provided', async () => {
    captures[0] = {
      ...captures[0],
      phone: '+919876543210',
      email: 'contact@example.com',
      website: 'https://example.com',
      rawData: { userProvidedFields: ['phone', 'email', 'website'] },
    };
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 1 }],
    });

    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({
      phone: '+919876543210',
      email: 'contact@example.com',
      website: 'https://example.com/',
    });
  });

  it('backfills only empty contact fields on a same-tenant duplicate Lead', async () => {
    captures[0] = {
      ...captures[0],
      source: 'MANUAL',
      googlePlaceId: null,
      sourceRecordId: 'capture-1',
      importedLeadId: 101,
      phone: '+919876543210',
      email: 'contact@example.com',
      website: 'https://example.com',
    };
    leads.push({
      id: 101,
      customerId: 7,
      deletedAt: null,
      sourceRecordId: 'legacy-source-id',
      phone: null,
      email: '',
      website: 'https://manual.example.org',
    });

    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 1 }],
    });

    expect(result.skippedDuplicates).toBe(1);
    expect(leads[0]).toMatchObject({
      phone: '+919876543210',
      email: 'contact@example.com',
      website: 'https://manual.example.org',
    });
    expect(prisma.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 101, customerId: 7, deletedAt: null }),
    }));
  });

  it('uses Google Places business name when the saved record has only a valid Place ID', async () => {
    captures[0].businessName = '';
    const lookup = jest.spyOn(service as any, 'refreshReferencePlaces').mockImplementation(async (rows: any[]) => {
      rows[0].__googlePreview = { businessName: 'Resolved from Google Places' };
      return rows;
    });
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      placeIds: ['1'],
    });
    expect(lookup).toHaveBeenCalledWith([captures[0]]);
    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({ title: 'Resolved from Google Places', phone: null, address: null });
  });

  it('uses a saved non-Google business name without requiring Google Place details', async () => {
    captures[0] = {
      ...captures[0], googlePlaceId: null, sourceRecordId: '1',
      source: 'MANUAL', businessName: 'Visible Existing Business', status: 'CAPTURED',
    };
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 1 }],
    });
    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({ title: 'Visible Existing Business', companyName: 'Visible Existing Business' });
  });

  it('rejects a record that has no business name and is not a resolvable Google reference', async () => {
    captures[0] = { ...captures[0], googlePlaceId: null, source: 'MANUAL', businessName: '' };
    await expect(service.importToLeads(7, { id: 9, customerId: 7 }, { places: [{ id: 1 }] }))
      .rejects.toMatchObject({ response: expect.objectContaining({ message: expect.stringContaining('Business name is missing') }) });
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('does not call Google Places with a custom or invalid Place ID', async () => {
    captures[0] = { ...captures[0], googlePlaceId: 'custom_1', source: 'GOOGLE_PLACES', businessName: '' };
    const lookup = jest.spyOn(service as any, 'refreshReferencePlaces');
    await expect(service.importToLeads(7, 9, { placeIds: ['1'] })).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('no valid Google Place ID for lookup'),
      }),
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(prisma.lead.create).not.toHaveBeenCalled();
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

  it('returns a per-record business-name failure without aborting valid records in the same request', async () => {
    captures[0] = { ...captures[0], googlePlaceId: null, source: 'MANUAL', businessName: '' };
    captures[1] = { ...captures[1], googlePlaceId: null, source: 'MANUAL', businessName: 'Importable record' };
    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 1 }, { id: 2 }],
    });
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRecordId: '1', failed: true, error: expect.stringContaining('Business name is missing') }),
      expect.objectContaining({ sourceRecordId: '2', imported: true }),
    ]));
  });

  it('isolates missing and foreign tenant/record context', async () => {
    await expect(service.importToLeads(undefined as any, 9, { places: [{ id: 1 }] })).rejects.toThrow();
    await expect(service.importToLeads(8, 9, { places: [{ id: 1 }] })).rejects.toThrow();
    captures[0].customerId = 8;
    await expect(service.importToLeads(7, 9, { places: [{ id: 1 }] })).rejects.toMatchObject({
      response: expect.objectContaining({
        success: false,
        error: 'DATA_CAPTURE_IMPORT_FAILED',
        message: expect.stringContaining('Record ID 1:'),
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

  it('returns a per-record reason when Google lookup cannot resolve a missing name', async () => {
    captures[0].businessName = '';
    jest.spyOn(service as any, 'refreshReferencePlaces').mockImplementation(async (rows: any[]) => rows);
    await expect(service.importToLeads(7, 9, { places: [{ id: 1 }] })).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'DATA_CAPTURE_IMPORT_FAILED',
        message: expect.stringContaining('Business name is missing: Google Places details could not be retrieved'),
        data: expect.objectContaining({
          failed: 1,
          records: [expect.objectContaining({
            captureId: 1,
            failed: true,
            error: 'Business name is missing: Google Places details could not be retrieved for the saved Place ID.',
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

  it('keeps partial counts accurate using saved Google names and validating supplied fields', async () => {
    const result = await service.importToLeads(7, 9, { places: [{ id: 1 },
      { id: 2, independentFields: { businessName: 'Good record' } },
      { id: 3, independentFields: { businessName: 'Invalid record', email: 'invalid' } }] });
    expect(result).toMatchObject({ totalRequested: 3, imported: 2, failed: 1, skippedDuplicates: 0 });
    expect(result.records).toHaveLength(3);
    expect(captures.map((row) => row.status)).toEqual(['LEAD_CREATED', 'LEAD_CREATED', 'IMPORT_FAILED']);
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
