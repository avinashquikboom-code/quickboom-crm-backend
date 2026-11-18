import { Test, TestingModule } from '@nestjs/testing';
import { DataCaptureService } from './data-capture.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { LeadService } from '../lead/lead.service';

describe('Data Capture Import Duplicate Detection - Fix Verification', () => {
  let dataCaptureService: DataCaptureService;
  let mockPrisma: any;
  let mockLeadService: any;
  let mockIntegrationSettingsService: any;
  let existingLeadsInDb: any[];
  let captures: any[];

  beforeEach(async () => {
    existingLeadsInDb = [];
    captures = [];

    mockPrisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 1, customerId: 1, deletedAt: null }) },
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, name: 'Test Tenant', isActive: true }),
      },
      dataCaptureJob: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          return Promise.resolve({
            id: 1,
            jobId: where?.jobId || 'job-test',
            customerId: where?.customerId || 1,
            places: [],
          });
        }),
      },
      dataCapturePlace: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(captures.find((capture) => {
          if (where?.id != null && capture.id !== Number(where.id)) return false;
          if (where?.customerId != null && capture.customerId !== where.customerId) return false;
          if (where?.googlePlaceId != null && capture.googlePlaceId !== where.googlePlaceId) return false;
          if (where?.sourceRecordId != null && capture.sourceRecordId !== where.sourceRecordId) return false;
          return !capture.deletedAt;
        }) || null)),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const capture = captures.find((item) => item.id === where.id);
          if (capture) Object.assign(capture, data);
          return Promise.resolve(capture);
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      lead: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          const tenantId = where?.customerId;
          const clauses: any[] = where?.OR || [];
          const matches = existingLeadsInDb.filter((lead) => {
            if (lead.customerId !== tenantId) return false;
            for (const c of clauses) {
              if (c.googlePlaceId && lead.googlePlaceId === c.googlePlaceId) return true;
              if (c.sourceRecordId && (lead.sourceRecordId === c.sourceRecordId || lead.googlePlaceId === c.sourceRecordId)) return true;
              if (c.phone && typeof c.phone === 'string' && lead.phone === c.phone) return true;
              if (c.phone?.contains && lead.phone && lead.phone.replace(/\D/g, '').includes(c.phone.contains)) return true;
              if (c.email?.equals && lead.email && lead.email.toLowerCase() === c.email.equals.toLowerCase()) return true;
              if (c.website?.contains && lead.website && lead.website.toLowerCase().includes(c.website.contains.toLowerCase())) return true;
            }
            return false;
          });
          return Promise.resolve(matches);
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const tenantId = where?.customerId;
          const clauses: any[] = where?.OR || [];
          const match = existingLeadsInDb.find((lead) => {
            if (lead.customerId !== tenantId) return false;
            for (const c of clauses) {
              if (c.googlePlaceId && lead.googlePlaceId === c.googlePlaceId) return true;
              if (c.sourceRecordId && (lead.sourceRecordId === c.sourceRecordId || lead.googlePlaceId === c.sourceRecordId)) return true;
              if (c.phone && typeof c.phone === 'string' && lead.phone === c.phone) return true;
              if (c.phone?.contains && lead.phone && lead.phone.replace(/\D/g, '').includes(c.phone.contains)) return true;
              if (c.email?.equals && lead.email && lead.email.toLowerCase() === c.email.equals.toLowerCase()) return true;
              if (c.website?.contains && lead.website && lead.website.toLowerCase().includes(c.website.contains.toLowerCase())) return true;
            }
            return false;
          });
          return Promise.resolve(match || null);
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const newLead = { id: existingLeadsInDb.length + 101, ...data };
          existingLeadsInDb.push(newLead);
          return Promise.resolve(newLead);
        }),
      },
      leadStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          key: 'NEW',
          name: 'New',
          customerId: 1,
          isActive: true,
          emailEnabled: true,
          emailTemplateId: 31,
          emailTemplate: { id: 31, customerId: 1, name: 'lead_welcome', isActive: true },
          whatsappEnabled: true,
          whatsappTemplateId: 41,
          whatsappTemplate: {
            id: 41,
            customerId: 1,
            templateName: 'lead_welcome_meta',
            metaTemplateId: 'meta_approved_41',
            status: 'APPROVED',
            isLocalActive: true,
          },
        }),
      },
      leadNote: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leadActivityTimeline: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leadStageWhatsAppDelivery: { upsert: jest.fn().mockResolvedValue({}) },
      leadStageEmailDelivery: { upsert: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    mockPrisma.$transaction = jest.fn((callback: any) =>
      typeof callback === 'function' ? callback(mockPrisma) : Promise.all(callback),
    );

    mockLeadService = {
      createLead: jest.fn().mockImplementation((customerId: number, userId: number, dto: any) => {
        const newLead = { id: existingLeadsInDb.length + 101, customerId, ...dto };
        existingLeadsInDb.push(newLead);
        return Promise.resolve(newLead);
      }),
    };

    mockIntegrationSettingsService = {
      getGoogleMapsConfig: jest.fn().mockResolvedValue({ isEnabled: false, apiKey: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCaptureService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: IntegrationSettingsService, useValue: mockIntegrationSettingsService },
        { provide: LeadService, useValue: mockLeadService },
      ],
    }).compile();

    dataCaptureService = module.get<DataCaptureService>(DataCaptureService);
  });

  const buildTestPlaces = (count: number, prefix = 'Store', phoneOffset = 10000) => {
    return Array.from({ length: count }, (_, i) => {
      const captureId = captures.length + 1;
      const googlePlaceId = `ChIJ_test_place_${prefix}_${i + 1}`;
      const businessName = `${prefix} Business #${i + 1}`;
      const phone = `+91 98200 ${phoneOffset + i * 100}`;
      const email = `info@${prefix.toLowerCase()}${i + 1}.in`;
      const website = `https://www.${prefix.toLowerCase()}${i + 1}.in`;
      const independentFields = { businessName, phone, email, website, address: `${100 + i * 10} Main St, Vadodara`, category: 'Store' };
      captures.push({ id: captureId, customerId: 1, googlePlaceId, sourceRecordId: googlePlaceId,
        businessName: 'Provider reference', phone, email, website, address: independentFields.address,
        category: 'Store', source: 'GOOGLE_DISCOVERY', status: 'CAPTURED', isImported: false });
      return { id: captureId, googlePlaceId, sourceRecordId: googlePlaceId,
        businessName, category: 'Store', address: independentFields.address, phone, email, website,
        rating: 4.5, reviewCount: 30, source: 'GOOGLE_DISCOVERY', independentFields };
    });
  };

  it('1. First import: 10 new Google Discovery records import cleanly into Leads (10 imported, 0 skipped)', async () => {
    const places = buildTestPlaces(10, 'FirstImport');

    const result = await dataCaptureService.importToLeads(1, 1, {
      places,
    });

    expect(result.success).toBe(true);
    expect(result.totalRequested).toBe(10);
    expect(result.imported).toBe(10);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.duplicateNames).toHaveLength(0);
    expect(result.records).toHaveLength(10);
    expect(result.records?.every((r) => r.imported === true && !r.duplicate)).toBe(true);
    expect(existingLeadsInDb).toHaveLength(10);
    expect(mockPrisma.leadStageWhatsAppDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'QUEUED', metaTemplateId: 41 }),
    }));
    expect(mockPrisma.leadStageEmailDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'QUEUED', emailTemplateId: 31 }),
    }));
  });

  it('2. Second import: Importing the same 10 records again detects duplicates (0 imported, 10 skipped)', async () => {
    const places = buildTestPlaces(10, 'SecondImport');

    // First import
    await dataCaptureService.importToLeads(1, 1, {
      places,
    });
    expect(existingLeadsInDb).toHaveLength(10);

    // Second import with identical places
    const secondResult = await dataCaptureService.importToLeads(1, 1, {
      places,
    });

    expect(secondResult.success).toBe(true);
    expect(secondResult.totalRequested).toBe(10);
    expect(secondResult.imported).toBe(0);
    expect(secondResult.skippedDuplicates).toBe(10);
    expect(secondResult.duplicateNames).toHaveLength(10);
    expect(secondResult.records?.every((r) => r.imported === false && r.duplicate === true)).toBe(true);
    expect(existingLeadsInDb).toHaveLength(10); // No extra leads created
  });

  it('3. Mixed data test: 5 new + 5 already imported records -> 5 imported, 5 skipped', async () => {
    const existing5 = buildTestPlaces(5, 'Existing5', 10000);
    const new5 = buildTestPlaces(5, 'BrandNew5', 20000);

    // Seed the first 5 in DB
    await dataCaptureService.importToLeads(1, 1, {
      places: existing5,
    });
    expect(existingLeadsInDb).toHaveLength(5);

    // Mixed batch of 10
    const mixedBatch = [...existing5, ...new5];
    const result = await dataCaptureService.importToLeads(1, 1, {
      places: mixedBatch,
    });

    expect(result.success).toBe(true);
    expect(result.totalRequested).toBe(10);
    expect(result.imported).toBe(5);
    expect(result.skippedDuplicates).toBe(5);
    expect(existingLeadsInDb).toHaveLength(10); // 5 initial + 5 newly imported
  });

  it('4. Missing phone, email, and website must NOT cause false duplicate matches', async () => {
    const placesWithMissingData = [
      {
        id: captures.length + 1,
        googlePlaceId: 'ChIJ_missing_contact_1',
        businessName: 'No Phone Store 1',
        phone: null,
        email: null,
        website: null,
      },
      {
        id: captures.length + 2,
        googlePlaceId: 'ChIJ_missing_contact_2',
        businessName: 'No Phone Store 2',
        phone: 'N/A',
        email: '',
        website: '',
      },
    ];
    placesWithMissingData.forEach((place: any) => {
      const independentFields = { businessName: place.businessName, phone: place.phone || undefined,
        email: place.email || undefined, website: place.website || undefined };
      captures.push({ ...place, customerId: 1, sourceRecordId: place.googlePlaceId,
        source: 'GOOGLE_DISCOVERY', status: 'CAPTURED', independentFields });
      place.independentFields = independentFields;
    });

    const result = await dataCaptureService.importToLeads(1, 1, {
      places: placesWithMissingData,
    });

    expect(result.imported).toBe(2);
    expect(result.skippedDuplicates).toBe(0);
  });

  it('5. Tenant isolation: Lead in another company does not cause duplicate match for current tenant', async () => {
    // Seed lead in company 2
    existingLeadsInDb.push({
      id: 999,
      customerId: 2, // Different tenant!
      googlePlaceId: 'ChIJ_tenant_iso_place',
      sourceRecordId: 'ChIJ_tenant_iso_place',
      title: 'Company 2 Lead',
      phone: '+919820099999',
    });
    const tenantCapture = {
      id: 1, customerId: 1, googlePlaceId: 'ChIJ_tenant_iso_place',
      sourceRecordId: 'ChIJ_tenant_iso_place', businessName: 'Provider reference',
      phone: '+91 98200 99999', source: 'GOOGLE_DISCOVERY', status: 'CAPTURED',
    };
    captures.push(tenantCapture);

    // Import same googlePlaceId for company 1
    const result = await dataCaptureService.importToLeads(1, 1, {
      places: [
        {
          id: 1,
          googlePlaceId: 'ChIJ_tenant_iso_place',
          businessName: 'Company 1 Store',
          phone: '+919820099999',
          independentFields: { businessName: 'Company 1 Store', phone: '+919820099999' },
        },
      ],
    });

    expect(result.imported).toBe(1);
    expect(result.skippedDuplicates).toBe(0);
  });
});
