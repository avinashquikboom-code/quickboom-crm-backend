import { Test, TestingModule } from '@nestjs/testing';
import { DataCaptureService } from './data-capture.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';

describe('DataCaptureService', () => {
  let service: DataCaptureService;
  let prisma: any;

  const mockPrisma = {
    dataCapturePlace: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    dataCaptureJob: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    company: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    contact: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: 1, name: 'QuikBoom Enterprise' }),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockIntegrationSettingsService = {
    getGoogleMapsConfig: jest.fn().mockResolvedValue({ isEnabled: false, apiKey: null }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCaptureService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: IntegrationSettingsService, useValue: mockIntegrationSettingsService },
      ],
    }).compile();

    service = module.get<DataCaptureService>(DataCaptureService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('listPlaces with status=ALL and source=ALL (Requirements 8, 9, 17, 25)', () => {
    it('omits customerId from where clause when customerId is undefined (Super Admin context) and filters out ALL', async () => {
      mockPrisma.dataCapturePlace.count.mockResolvedValue(2);
      mockPrisma.dataCapturePlace.findMany.mockResolvedValue([
        {
          id: 1,
          customerId: 1,
          businessName: 'FitPro Gym',
          source: 'GOOGLE_PLACES',
          status: 'CAPTURED',
          createdAt: new Date(),
          updatedAt: new Date(),
          isImported: false,
        },
        {
          id: 2,
          customerId: 2,
          businessName: 'City Dental Clinic',
          source: 'MANUAL',
          status: 'VALIDATED',
          createdAt: new Date(),
          updatedAt: new Date(),
          isImported: false,
        },
      ]);

      const result = await service.listPlaces(undefined, {
        page: 1,
        limit: 20,
        status: 'ALL',
        source: 'ALL',
      });

      expect(mockPrisma.dataCapturePlace.count).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
        },
      });

      expect(mockPrisma.dataCapturePlace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
          },
          skip: 0,
          take: 20,
        }),
      );

      expect(result.statusCode).toBe(200);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('scopes query to customerId when customerId is provided (Tenant context)', async () => {
      mockPrisma.dataCapturePlace.count.mockResolvedValue(1);
      mockPrisma.dataCapturePlace.findMany.mockResolvedValue([
        {
          id: 10,
          customerId: 5,
          businessName: 'Apex Cafe',
          source: 'GOOGLE_PLACES',
          status: 'CAPTURED',
          createdAt: new Date(),
          updatedAt: new Date(),
          isImported: false,
        },
      ]);

      const result = await service.listPlaces('5', {
        page: 2,
        limit: 10,
      });

      expect(mockPrisma.dataCapturePlace.count).toHaveBeenCalledWith({
        where: {
          customerId: 5,
          deletedAt: null,
        },
      });

      expect(mockPrisma.dataCapturePlace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            customerId: 5,
            deletedAt: null,
          },
          skip: 10,
          take: 10,
        }),
      );

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(1);
    });

    it('correctly applies valid status and source filters', async () => {
      mockPrisma.dataCapturePlace.count.mockResolvedValue(1);
      mockPrisma.dataCapturePlace.findMany.mockResolvedValue([]);

      await service.listPlaces(1, {
        page: 1,
        limit: 20,
        status: 'VALIDATED',
        source: 'GOOGLE_PLACES',
      });

      expect(mockPrisma.dataCapturePlace.count).toHaveBeenCalledWith({
        where: {
          customerId: 1,
          deletedAt: null,
          status: 'VALIDATED',
          source: 'GOOGLE_PLACES',
        },
      });
    });
  });

  describe('getUsageSummary', () => {
    it('returns usage summary without crashing when customerId is undefined', async () => {
      mockPrisma.dataCaptureJob.count.mockResolvedValue(5);
      mockPrisma.dataCapturePlace.count.mockResolvedValue(25);
      mockPrisma.dataCaptureJob.aggregate.mockResolvedValue({ _sum: { googleApiRequests: 8 } });

      const result = await service.getUsageSummary(undefined);

      expect(result.totalExtractions).toBe(5);
      expect(result.totalLeadsCaptured).toBe(25);
      expect(result.totalGoogleApiCalls).toBe(8);
      expect(result.quotaRemaining).toBe(975);
    });
  });
});
