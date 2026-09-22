import { Test, TestingModule } from '@nestjs/testing';
import { DataCaptureService } from './data-capture.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { ContactExtractor } from '../../common/utils/contact-extractor.util';
import { LeadService } from '../lead/lead.service';

describe('Data Capture & Google Discovery Full Pipeline Verification', () => {
  let dataCaptureService: DataCaptureService;
  let mockPrisma: any;
  let mockLeadService: any;
  let mockConfigService: any;
  let mockIntegrationSettingsService: any;

  beforeEach(async () => {
    mockPrisma = {
      dataCapturePlace: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      lead: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      company: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      leadStage: {
        findFirst: jest.fn(),
      },
      leadNote: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leadActivityTimeline: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      dataCaptureUsage: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };

    mockConfigService = {
      get: jest.fn(),
    };

    mockIntegrationSettingsService = {
      getGoogleMapsConfig: jest.fn().mockResolvedValue({ isEnabled: false, apiKey: null }),
    };

    mockLeadService = {
      createLead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCaptureService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: IntegrationSettingsService, useValue: mockIntegrationSettingsService },
        { provide: LeadService, useValue: mockLeadService },
      ],
    }).compile();

    dataCaptureService = module.get<DataCaptureService>(DataCaptureService);
  });

  describe('Sequential Data Capture: Zero Contact Leakage', () => {
    it('Place A has phone & email -> Place B has phone only -> Place C has email only -> Place D has neither', () => {
      // 1. Place A: Both present
      const placeA_raw = {
        name: 'Alpha Dental Care',
        internationalPhoneNumber: '+91 98765 43210',
        website: 'https://alphadental.in',
      };
      const phoneA = ContactExtractor.normalizePhoneNumber(placeA_raw.internationalPhoneNumber);
      const emailA = ContactExtractor.normalizeEmail('contact@alphadental.in');
      expect(phoneA).toBe('+919876543210');
      expect(emailA).toBe('contact@alphadental.in');

      // 2. Place B: Phone only, NO email
      const placeB_raw = {
        name: 'Beta Motors',
        nationalPhoneNumber: '09988776655',
        website: 'https://betamotors.com',
      };
      const phoneB = ContactExtractor.normalizePhoneNumber(placeB_raw.nationalPhoneNumber);
      const emailB = ContactExtractor.normalizeEmail(undefined); // No email in source
      expect(phoneB).toBe('+919988776655');
      expect(emailB).toBeNull(); // MUST be null, NEVER inherit emailA
      expect(emailB).not.toBe(emailA);

      // 3. Place C: Email only, NO phone
      const placeC_raw = {
        name: 'Gamma Tech Labs',
        website: 'https://gammatech.co',
      };
      const phoneC = ContactExtractor.normalizePhoneNumber(undefined); // No phone in source
      const emailC = ContactExtractor.normalizeEmail('info@gammatech.co');
      expect(phoneC).toBeNull(); // MUST be null, NEVER inherit phoneA or phoneB
      expect(phoneC).not.toBe(phoneB);
      expect(emailC).toBe('info@gammatech.co');

      // 4. Place D: Neither phone nor email
      const placeD_raw = {
        name: 'Delta Consulting',
        website: 'https://deltaconsulting.org',
      };
      const phoneD = ContactExtractor.normalizePhoneNumber('');
      const emailD = ContactExtractor.normalizeEmail('N/A');
      expect(phoneD).toBeNull(); // MUST be null
      expect(emailD).toBeNull(); // MUST be null
    });
  });

  describe('createLeadFromPlace Idempotency & Unique Request ID', () => {
    it('should return existing lead when captureRequestId was already imported', async () => {
      const placeRecord = {
        id: 101,
        customerId: 1,
        businessName: 'Apex Logistics',
        phone: '+919123456789',
        email: 'ops@apexlogistics.com',
        isImported: true,
        importedLeadId: 501,
        captureRequestId: 'req-uuid-1234',
        sourceRecordId: 'ChIJ1234567890',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const existingLead = {
        id: 501,
        title: 'Apex Logistics',
        customerId: 1,
      };

      mockPrisma.dataCapturePlace.findFirst.mockResolvedValue(placeRecord);
      mockPrisma.lead.findFirst.mockResolvedValue(existingLead);

      const result = await dataCaptureService.createLeadFromPlace(1, 1, 101, 'req-uuid-1234');

      expect(result.lead.id).toBe(501);
      expect(result.isDuplicate).toBe(true);

      // LeadService.createLead must NOT be called again
      expect(mockLeadService.createLead).not.toHaveBeenCalled();
    });

    it('should pass captureRequestId and sourceRecordId to lead creation and update place record', async () => {
      const placeRecord = {
        id: 102,
        customerId: 1,
        businessName: 'Zenith Retailers',
        phone: '+919876501234',
        email: 'sales@zenith.in',
        isImported: false,
        importedLeadId: null,
        googlePlaceId: 'ChIJ_ZENITH_PLACE_ID',
        sourceRecordId: 'ChIJ_ZENITH_PLACE_ID',
        address: '123 Market Road',
        category: 'Retail Store',
      };

      mockPrisma.dataCapturePlace.findFirst.mockResolvedValue(placeRecord);
      mockPrisma.leadStage.findFirst.mockResolvedValue({ id: 1, key: 'NEW' });

      mockLeadService.createLead.mockResolvedValue({
        id: 502,
        title: 'Zenith Retailers',
        phone: '+919876501234',
        email: 'sales@zenith.in',
        status: 'NEW',
      });

      mockPrisma.dataCapturePlace.update.mockResolvedValue({
        ...placeRecord,
        status: 'LEAD_CREATED',
        isImported: true,
        importedLeadId: 502,
        captureRequestId: 'req-uuid-9999',
      });

      const result = await dataCaptureService.createLeadFromPlace(1, 1, 102, 'req-uuid-9999');

      expect(mockLeadService.createLead).toHaveBeenCalledWith(
        1,
        1,
        expect.objectContaining({
          companyName: 'Zenith Retailers',
          phone: '+919876501234',
          email: 'sales@zenith.in',
          captureRequestId: 'req-uuid-9999',
          sourceRecordId: 'ChIJ_ZENITH_PLACE_ID',
        })
      );

      expect(mockPrisma.dataCapturePlace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 102 },
          data: expect.objectContaining({
            status: 'LEAD_CREATED',
            isImported: true,
            importedLeadId: 502,
            captureRequestId: 'req-uuid-9999',
          }),
        })
      );

      expect(result.lead.id).toBe(502);
    });
  });

  describe('Website URL Normalization & Safe Handling', () => {
    it('normalizes website url and strips tracking parameters', () => {
      const rawUrl = 'https://www.example-store.in/products?utm_source=google&utm_medium=cpc&gclid=12345#header';
      const normalized = ContactExtractor.normalizeWebsiteUrl(rawUrl);
      expect(normalized).toBe('https://www.example-store.in/products');
    });

    it('adds https:// prefix if missing', () => {
      const normalized = ContactExtractor.normalizeWebsiteUrl('mybusiness.co.in');
      expect(normalized).toBe('https://mybusiness.co.in');
    });
  });
});
