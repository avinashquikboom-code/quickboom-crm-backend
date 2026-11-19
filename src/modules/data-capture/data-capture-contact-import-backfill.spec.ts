import { DataCaptureService } from './data-capture.service';

describe('Data Capture Contact Import and Backfill Pipeline', () => {
  let service: DataCaptureService;
  let prisma: any;
  let leads: any[];
  let captures: any[];

  beforeEach(() => {
    leads = [];
    captures = [];

    const matches = (row: any, where: any) =>
      Object.entries(where).every(([key, value]) => {
        if (key === 'deletedAt') return row.deletedAt === null || row.deletedAt === undefined;
        if (key === 'customerId' && typeof value === 'object' && (value as any)?.in) {
          return (value as any).in.includes(row.customerId);
        }
        if (key === 'OR' && Array.isArray(value)) {
          return value.some((clause) => matches(row, clause));
        }
        return row[key] === value;
      });

    prisma = {
      user: {
        findFirst: jest.fn(async ({ where }) => ({ id: where?.id || 9, customerId: where?.customerId || 7 })),
      },
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
      dataCaptureJob: { findFirst: jest.fn().mockResolvedValue({ jobId: 'session-1', customerId: 7 }) },
      dataCapturePlace: {
        findFirst: jest.fn(async ({ where }) => captures.find((row) => matches(row, where)) || null),
        findMany: jest.fn(async ({ where }) => {
          if (!where) return captures;
          return captures.filter((row) => {
            if (where.customerId && row.customerId !== where.customerId) return false;
            if (where.deletedAt === null && row.deletedAt != null) return false;
            if (where.OR && Array.isArray(where.OR)) {
              return where.OR.some((clause: any) => {
                if (clause.isImported !== undefined && row.isImported === clause.isImported) return true;
                if (clause.importedLeadId && clause.importedLeadId.not === null && row.importedLeadId != null) return true;
                return false;
              });
            }
            return true;
          });
        }),
        update: jest.fn(async ({ where, data }) => {
          const row = captures.find((r) => r.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
      },
      lead: {
        findFirst: jest.fn(async ({ where }) => leads.find((row) => matches(row, where)) || null),
        findMany: jest.fn(async ({ where }) => {
          if (!where) return leads;
          return leads.filter((row) => {
            if (where.customerId && row.customerId !== where.customerId) return false;
            if (where.deletedAt === null && row.deletedAt != null) return false;
            if (where.OR && Array.isArray(where.OR)) {
              return where.OR.some((clause: any) =>
                (clause.googlePlaceId && clause.googlePlaceId === row.googlePlaceId) ||
                (clause.sourceRecordId && clause.sourceRecordId === row.sourceRecordId) ||
                (clause.phone && row.phone && clause.phone === row.phone) ||
                (clause.email && row.email && clause.email.toLowerCase() === row.email.toLowerCase()),
              );
            }
            return true;
          });
        }),
        create: jest.fn(async ({ data }) => {
          const row = { id: leads.length + 100, ...data };
          leads.push(row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          let count = 0;
          for (const row of leads) {
            if (row.id === where.id && row.customerId === where.customerId && row.deletedAt === null) {
              if (where.OR && Array.isArray(where.OR)) {
                const matchesOr = where.OR.some((cond: any) => {
                  const field = Object.keys(cond)[0];
                  return row[field] == null || row[field] === '';
                });
                if (!matchesOr) continue;
              }
              Object.assign(row, data);
              count++;
            }
          }
          return { count };
        }),
      },
      leadSocialProfile: { create: jest.fn() },
      leadStage: { findFirst: jest.fn().mockResolvedValue({ id: 10, key: 'NEW' }) },
      leadActivityTimeline: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      leadStageWhatsAppDelivery: { upsert: jest.fn() },
      leadStageEmailDelivery: { upsert: jest.fn() },
    };

    let queue = Promise.resolve();
    prisma.$transaction = jest.fn((callback) => {
      const result = queue.then(() => callback(prisma));
      queue = result.catch(() => undefined);
      return result;
    });

    service = new DataCaptureService({} as any, prisma, {} as any);
  });

  it('1. Imports complete captured business record with phone, email, and website into CRM Lead', async () => {
    captures.push({
      id: 1,
      customerId: 7,
      googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      businessName: 'Apex Dental Clinic',
      phone: '+91 98765 43210',
      email: 'info@apexdental.com',
      website: 'https://apexdental.com',
      address: '123 MG Road, Camp',
      category: 'Dentist',
      source: 'GOOGLE_PLACES',
      status: 'CAPTURED',
      rawData: { city: 'Pune', state: 'Maharashtra', country: 'India', pincode: '411001' },
    });

    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 1 }],
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      customerId: 7,
      title: 'Apex Dental Clinic',
      companyName: 'Apex Dental Clinic',
      phone: '+919876543210',
      email: 'info@apexdental.com',
      website: 'https://apexdental.com/',
      address: '123 MG Road, Camp',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
      pincode: '411001',
      category: 'Dentist',
      source: 'Google Maps',
      status: 'NEW',
    });
  });

  it('2. Imports partial record with only phone number', async () => {
    captures.push({
      id: 2,
      customerId: 7,
      googlePlaceId: 'ChIJ_phone_only',
      businessName: 'Quick Repairs',
      phone: '02026123456',
      email: null,
      website: null,
      source: 'GOOGLE_PLACES',
      status: 'CAPTURED',
    });

    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 2 }],
    });

    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({
      title: 'Quick Repairs',
      phone: '+2026123456',
      email: null,
      website: null,
    });
  });

  it('3. Imports partial record with only email address', async () => {
    captures.push({
      id: 3,
      customerId: 7,
      googlePlaceId: 'ChIJ_email_only',
      businessName: 'Digital Agency',
      phone: null,
      email: 'HELLO@DigitalAgency.co.in',
      website: null,
      source: 'GOOGLE_PLACES',
      status: 'CAPTURED',
    });

    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 3 }],
    });

    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({
      title: 'Digital Agency',
      phone: null,
      email: 'hello@digitalagency.co.in',
      website: null,
    });
  });

  it('4. Imports partial record with only website URL', async () => {
    captures.push({
      id: 4,
      customerId: 7,
      googlePlaceId: 'ChIJ_web_only',
      businessName: 'Global Exporters',
      phone: null,
      email: null,
      website: 'www.globalexporters.com',
      source: 'GOOGLE_PLACES',
      status: 'CAPTURED',
    });

    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 4 }],
    });

    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({
      title: 'Global Exporters',
      phone: null,
      email: null,
      website: 'https://www.globalexporters.com/',
    });
  });

  it('5. Imports record with missing contact information without crashing', async () => {
    captures.push({
      id: 5,
      customerId: 7,
      googlePlaceId: 'ChIJ_no_contact',
      businessName: 'Mystery Shop',
      phone: null,
      email: null,
      website: null,
      source: 'GOOGLE_PLACES',
      status: 'CAPTURED',
    });

    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 5 }],
    });

    expect(result.imported).toBe(1);
    expect(leads[0]).toMatchObject({
      title: 'Mystery Shop',
      phone: null,
      email: null,
      website: null,
    });
  });

  it('6. Importing the same record twice detects duplicate and does not create duplicate Lead', async () => {
    captures.push({
      id: 6,
      customerId: 7,
      googlePlaceId: 'ChIJ_duplicate_test',
      businessName: 'Alpha Logistics',
      phone: '+919876500001',
      email: 'contact@alphalogistics.com',
      website: 'https://alphalogistics.com',
      source: 'GOOGLE_PLACES',
      status: 'CAPTURED',
    });

    // First import
    const firstResult = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 6 }],
    });
    expect(firstResult.imported).toBe(1);
    expect(firstResult.skippedDuplicates).toBe(0);
    expect(leads).toHaveLength(1);
    const existingLeadId = leads[0].id;

    // Second import
    const secondResult = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 6 }],
    });
    expect(secondResult.imported).toBe(0);
    expect(secondResult.skippedDuplicates).toBe(1);
    expect(leads).toHaveLength(1); // No new lead created
    expect(secondResult.records?.[0]?.leadId).toBe(existingLeadId);
  });

  it('7. Duplicate import backfills missing CRM fields without overwriting non-empty fields', async () => {
    captures.push({
      id: 7,
      customerId: 7,
      googlePlaceId: 'ChIJ_backfill_lead',
      businessName: 'Beta Consulting',
      phone: '+919876500002',
      email: 'info@betaconsulting.com',
      website: 'https://betaconsulting.com',
      source: 'GOOGLE_PLACES',
      status: 'CAPTURED',
      importedLeadId: 201,
    });

    // Existing Lead has phone and website, but email is null
    leads.push({
      id: 201,
      customerId: 7,
      deletedAt: null,
      title: 'Beta Consulting',
      companyName: 'Beta Consulting',
      phone: '+919999988888', // Pre-existing custom phone
      email: null, // Empty field to backfill
      website: 'https://existing-site.com', // Pre-existing custom website
    });

    const result = await service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 7 }],
    });

    expect(result.skippedDuplicates).toBe(1);
    expect(leads[0].phone).toBe('+919999988888'); // Preserved original phone!
    expect(leads[0].website).toBe('https://existing-site.com'); // Preserved original website!
    expect(leads[0].email).toBe('info@betaconsulting.com'); // Backfilled missing email!
  });

  it('8. Backfill endpoint supports dry-run mode and execution mode', async () => {
    captures.push(
      {
        id: 10,
        customerId: 7,
        businessName: 'Prior Lead 1',
        phone: '+919876511111',
        email: 'prior1@example.com',
        website: 'https://prior1.com',
        isImported: true,
        importedLeadId: 301,
      },
      {
        id: 11,
        customerId: 7,
        businessName: 'Prior Lead 2',
        phone: '+919876522222',
        email: null,
        website: null,
        isImported: true,
        importedLeadId: 302,
      },
    );

    leads.push(
      {
        id: 301,
        customerId: 7,
        deletedAt: null,
        companyName: 'Prior Lead 1',
        phone: null,
        email: null,
        website: null,
      },
      {
        id: 302,
        customerId: 7,
        deletedAt: null,
        companyName: 'Prior Lead 2',
        phone: '+919876522222', // already has phone
        email: null,
        website: null,
      },
    );

    // Dry-run mode: should report 1 lead to update, but not change DB
    const dryRunReport = await service.backfillImportedLeads(7, true);
    expect(dryRunReport.dryRun).toBe(true);
    expect(dryRunReport.matchedLeadCount).toBe(2);
    expect(dryRunReport.updatedLeadCount).toBe(1);
    expect(dryRunReport.details[0].leadId).toBe(301);
    expect(leads[0].phone).toBeNull(); // Not modified in dry-run!

    // Execution mode: should update lead 301
    const liveReport = await service.backfillImportedLeads(7, false);
    expect(liveReport.dryRun).toBe(false);
    expect(liveReport.updatedLeadCount).toBe(1);
    expect(leads[0].phone).toBe('+919876511111');
    expect(leads[0].email).toBe('prior1@example.com');
    expect(leads[0].website).toBe('https://prior1.com/');
  });

  it('9. Enforces multi-tenant isolation during import and backfill', async () => {
    captures.push({
      id: 99,
      customerId: 8, // Foreign tenant!
      businessName: 'Foreign Biz',
      phone: '+919876599999',
      isImported: true,
      importedLeadId: 999,
    });

    // Attempting to backfill tenant 7 should NOT touch tenant 8
    const report = await service.backfillImportedLeads(7, false);
    expect(report.scannedCaptureCount).toBe(0);

    // Attempting to import foreign capture should fail
    await expect(service.importToLeads(7, { id: 9, customerId: 7 }, {
      places: [{ id: 99 }],
    })).rejects.toThrow('Captured record not found in this tenant');
  });
});
