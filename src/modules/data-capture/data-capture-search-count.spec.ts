import { Test, TestingModule } from '@nestjs/testing';
import { DataCaptureService } from './data-capture.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { LeadService } from '../lead/lead.service';

describe('Data Capture Employee Search Count & Isolation Verification', () => {
  let service: DataCaptureService;
  let mockPrisma: any;

  // In-memory mock tables for testing
  let mockSearches: any[] = [];
  let mockJobs: any[] = [];
  let mockPlaces: any[] = [];
  let nextSearchId = 1;

  beforeEach(async () => {
    mockSearches = [];
    mockJobs = [];
    mockPlaces = [];
    nextSearchId = 1;

    mockPrisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, isActive: true }),
      },
      employee: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.userId === 101) return Promise.resolve({ id: 11, customerId: 1, status: 'ACTIVE' });
          if (where.userId === 102) return Promise.resolve({ id: 12, customerId: 1, status: 'ACTIVE' });
          if (where.userId === 201) return Promise.resolve({ id: 21, customerId: 2, status: 'ACTIVE' });
          return Promise.resolve(null);
        }),
      },
      dataCaptureSearch: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const found = mockSearches.find((s) => {
            if (where.customerId && s.customerId !== where.customerId) return false;
            if (where.employeeId && s.employeeId !== where.employeeId) return false;
            if (where.requestId && s.requestId !== where.requestId) return false;
            return true;
          });
          return Promise.resolve(found || null);
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const record = { id: nextSearchId++, ...data, createdAt: new Date(), searchedAt: new Date() };
          mockSearches.push(record);
          return Promise.resolve(record);
        }),
        count: jest.fn().mockImplementation(({ where }: any) => {
          const filtered = mockSearches.filter((s) => {
            if (where?.customerId && s.customerId !== where.customerId) return false;
            if (where?.employeeId && s.employeeId !== where.employeeId) return false;
            if (where?.userId && s.userId !== where.userId) return false;
            return true;
          });
          return Promise.resolve(filtered.length);
        }),
      },
      dataCaptureJob: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          const job = { id: mockJobs.length + 1, ...data, places: [] };
          mockJobs.push(job);
          return Promise.resolve(job);
        }),
        count: jest.fn().mockImplementation(({ where }: any) => {
          const filtered = mockJobs.filter((j) => {
            if (where?.customerId && j.customerId !== where.customerId) return false;
            return true;
          });
          return Promise.resolve(filtered.length);
        }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { googleApiRequests: 0 } }),
      },
      dataCapturePlace: {
        count: jest.fn().mockImplementation(({ where }: any) => {
          const filtered = mockPlaces.filter((p) => {
            if (where?.customerId && p.customerId !== where.customerId) return false;
            if (where?.status && p.status !== where.status) return false;
            if (where?.isImported !== undefined && p.isImported !== where.isImported) return false;
            return true;
          });
          return Promise.resolve(filtered.length);
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 99 }),
      },
      company: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCaptureService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: IntegrationSettingsService, useValue: { getGoogleMapsConfig: jest.fn().mockResolvedValue({ isEnabled: false }) } },
        { provide: LeadService, useValue: { createLead: jest.fn() } },
      ],
    }).compile();

    service = module.get<DataCaptureService>(DataCaptureService);
  });

  describe('Employee Search Analytics Isolation', () => {
    it('1. Counts searches strictly per authenticated employee and tenant', async () => {
      const userA = { id: 101, customerId: 1, employee: { id: 11 } };
      const userB = { id: 102, customerId: 1, employee: { id: 12 } };
      const userCompany2 = { id: 201, customerId: 2, employee: { id: 21 } };

      // Employee A searches 3 times
      await service.extractPlaces('1', userA, { keyword: 'Hotels', location: 'Vadodara', maxResults: 10 });
      await service.extractPlaces('1', userA, { keyword: 'Restaurants', location: 'Vadodara', maxResults: 10 });
      await service.extractPlaces('1', userA, { keyword: 'Cafes', location: 'Vadodara', maxResults: 10 });

      // Employee B searches 1 time
      await service.extractPlaces('1', userB, { keyword: 'Hospitals', location: 'Surat', maxResults: 10 });

      // User from Company 2 searches 2 times
      await service.extractPlaces('2', userCompany2, { keyword: 'Schools', location: 'Mumbai', maxResults: 10 });
      await service.extractPlaces('2', userCompany2, { keyword: 'Colleges', location: 'Mumbai', maxResults: 10 });

      // Check Employee A's usage summary
      const usageA = await service.getUsageSummary('1', userA);
      expect(usageA.searches).toBe(3);
      expect(usageA.totalSearches).toBe(3);

      // Check Employee B's usage summary
      const usageB = await service.getUsageSummary('1', userB);
      expect(usageB.searches).toBe(1);
      expect(usageB.totalSearches).toBe(1);

      // Check Company 2 Employee's usage summary
      const usageComp2 = await service.getUsageSummary('2', userCompany2);
      expect(usageComp2.searches).toBe(2);
      expect(usageComp2.totalSearches).toBe(2);
    });

    it('2. Prevents double-counting duplicate requests with identical requestId', async () => {
      const userA = { id: 101, customerId: 1, employee: { id: 11 } };
      const requestId = 'req-unique-token-abc-123';

      // First search with requestId
      await service.extractPlaces('1', userA, { keyword: 'Hotels', location: 'Vadodara', requestId });

      // Duplicate search (e.g. double tap or retry) with same requestId
      await service.extractPlaces('1', userA, { keyword: 'Hotels', location: 'Vadodara', requestId });

      const usage = await service.getUsageSummary('1', userA);
      expect(usage.searches).toBe(1);
    });

    it('3. Metrics separation: Total Captured / Extractions are separate from Searches', async () => {
      const userA = { id: 101, customerId: 1, employee: { id: 11 } };

      // Initial state: 0 searches
      let usage = await service.getUsageSummary('1', userA);
      expect(usage.searches).toBe(0);

      // Search 1
      await service.extractPlaces('1', userA, { keyword: 'Dentists', location: 'Pune' });
      usage = await service.getUsageSummary('1', userA);
      expect(usage.searches).toBe(1);

      // Manually simulate lead captured / imported
      mockPlaces.push({ id: 1, customerId: 1, isImported: true, status: 'LEAD_CREATED' });

      // Fetch usage again: searches remains 1, leads count increases
      usage = await service.getUsageSummary('1', userA);
      expect(usage.searches).toBe(1);
      expect(usage.totalLeadsCaptured).toBe(1);
    });
  });
});
