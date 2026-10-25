import { Test, TestingModule } from '@nestjs/testing';
import { DataCaptureService } from './data-capture.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { BadRequestException } from '@nestjs/common';

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
      findFirst: jest.fn().mockResolvedValue({ id: 1, name: 'QuikBoom Enterprise', isActive: true }),
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

  describe('saved record CRUD integration', () => {
    const record = { id: 42, customerId: 7, businessName: 'Saved business',
      source: 'MANUAL', status: 'CAPTURED', isImported: false,
      createdAt: new Date(), updatedAt: new Date(), photos: [] };

    it('rejects manual creation without a resolved tenant before writing', async () => {
      await expect(service.createPlace(undefined, 9, { businessName: 'Business' }))
        .rejects.toThrow('Select a tenant');
      expect(mockPrisma.dataCapturePlace.create).not.toHaveBeenCalled();
    });

    it('creates a manual record using the authenticated tenant and returns its mapped fields', async () => {
      mockPrisma.dataCapturePlace.create.mockResolvedValue(record);
      const result = await service.createPlace(7, 9, { businessName: ' Saved business ', phone: '123' });
      expect(mockPrisma.dataCapturePlace.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        customerId: 7, businessName: 'Saved business', phone: '123', source: 'MANUAL', status: 'CAPTURED',
      }) });
      expect(result).toEqual(expect.objectContaining({ id: 42, businessName: 'Saved business' }));
    });

    it('updates only supplied fields after a tenant-scoped lookup', async () => {
      mockPrisma.dataCapturePlace.findFirst.mockResolvedValue(record);
      mockPrisma.dataCapturePlace.update.mockResolvedValue({ ...record, notes: 'Reviewed' });
      await service.updatePlace(7, 42, { notes: 'Reviewed' });
      expect(mockPrisma.dataCapturePlace.findFirst).toHaveBeenCalledWith({
        where: { id: 42, customerId: 7, deletedAt: null },
      });
      expect(mockPrisma.dataCapturePlace.update).toHaveBeenCalledWith({
        where: { id: 42 }, data: expect.objectContaining({ notes: 'Reviewed', businessName: undefined, phone: undefined }),
      });
    });

    it('soft deletes after checking tenant ownership', async () => {
      mockPrisma.dataCapturePlace.findFirst.mockResolvedValue(record);
      mockPrisma.dataCapturePlace.update.mockResolvedValue(record);
      await service.deletePlace(7, 42);
      expect(mockPrisma.dataCapturePlace.findFirst).toHaveBeenCalledWith({
        where: { id: 42, customerId: 7, deletedAt: null },
      });
      expect(mockPrisma.dataCapturePlace.update).toHaveBeenCalledWith({
        where: { id: 42 }, data: { deletedAt: expect.any(Date) },
      });
    });

    it('does not update a record absent from the authenticated tenant', async () => {
      mockPrisma.dataCapturePlace.findFirst.mockResolvedValue(null);
      await expect(service.updatePlace(8, 42, { notes: 'Other tenant' })).rejects.toThrow('not found');
      expect(mockPrisma.dataCapturePlace.update).not.toHaveBeenCalled();
    });
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
      }, { role: 'SUPER_ADMIN' });  // SUPER_ADMIN context — no customerId filter

      expect(mockPrisma.dataCapturePlace.count).toHaveBeenCalledWith({
        where: {
          AND: [{ deletedAt: null }],
        },
      });

      expect(mockPrisma.dataCapturePlace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ deletedAt: null }],
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
          AND: [
            { deletedAt: null },
            { customerId: 5 },
          ],
        },
      });

      expect(mockPrisma.dataCapturePlace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { deletedAt: null },
              { customerId: 5 },
            ],
          },
          skip: 10,
          take: 10,
        }),
      );

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(1);
    });

    it('resolves Google Places photo resources stored in rawData when photos has no URL', async () => {
      const photoName = 'places/ChIJexample/photos/ATKogpeExample';
      mockPrisma.dataCapturePlace.count.mockResolvedValue(1);
      mockPrisma.dataCapturePlace.findMany.mockResolvedValue([
        {
          id: 11,
          customerId: 5,
          googlePlaceId: 'ChIJexample',
          businessName: 'Reference-only photo fixture',
          photos: null,
          rawData: { photos: [{ name: photoName, widthPx: 800, heightPx: 600 }] },
          source: 'GOOGLE_PLACES',
          status: 'CAPTURED',
          createdAt: new Date(),
          updatedAt: new Date(),
          isImported: false,
        },
      ]);

      const result = await service.listPlaces('5', { page: 1, limit: 20 });

      expect(result.data[0].googlePhotos).toEqual([
        {
          name: photoName,
          url: `/api/v1/data-capture/photo?ref=${encodeURIComponent(photoName)}`,
          width: undefined,
          height: undefined,
        },
      ]);
    });

    it('correctly applies valid status and source filters', async () => {
      mockPrisma.dataCapturePlace.count.mockResolvedValue(1);
      mockPrisma.dataCapturePlace.findMany.mockResolvedValue([]);

      await service.listPlaces(1, {
        page: 1,
        limit: 20,
        status: 'VALIDATED',
        source: 'GOOGLE_PLACES',
      }, { role: 'CUSTOMER', customerId: 1 });  // normal tenant user

      expect(mockPrisma.dataCapturePlace.count).toHaveBeenCalledWith({
        where: {
          AND: [
            { deletedAt: null },
            { customerId: 1 },
            { status: 'VALIDATED' },
            { source: 'GOOGLE_PLACES' },
          ],
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

  describe('extractPlaces', () => {
    it('extracts places with keyword and location and persists to database', async () => {
      mockPrisma.dataCaptureJob.count.mockResolvedValue(0);
      mockPrisma.dataCapturePlace.count.mockResolvedValue(0);
      mockPrisma.dataCaptureJob.aggregate.mockResolvedValue({ _sum: { googleApiRequests: 0 } });
      mockPrisma.dataCapturePlace.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([]);
      mockPrisma.dataCaptureJob.create.mockImplementation((args: any) => ({
        ...args.data,
        places: args.data.places.create.map((p: any, idx: number) => ({
          ...p,
          id: idx + 1,
          createdAt: new Date(),
        })),
      }));

      const res = await service.extractPlaces(
        '1',
        { id: 1, role: 'SUPER_ADMIN' },
        { keyword: 'Gyms', location: 'Vadodara', maxResults: 20 },
      );

      expect(res.jobId).toBeDefined();
      expect(res.keyword).toBe('Gyms');
      expect(res.location).toBe('Vadodara');
      expect(res.captured).toBeGreaterThan(0);
      expect(mockPrisma.dataCaptureJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 1,
            userId: 1,
            keyword: 'Gyms',
            location: 'Vadodara',
          }),
        }),
      );
    });

    it('normalizes query into keyword and location when query is passed', async () => {
      mockPrisma.dataCaptureJob.count.mockResolvedValue(0);
      mockPrisma.dataCapturePlace.count.mockResolvedValue(0);
      mockPrisma.dataCaptureJob.aggregate.mockResolvedValue({ _sum: { googleApiRequests: 0 } });
      mockPrisma.dataCapturePlace.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([]);
      mockPrisma.dataCaptureJob.create.mockImplementation((args: any) => ({
        ...args.data,
        places: args.data.places.create.map((p: any, idx: number) => ({
          ...p,
          id: idx + 1,
          createdAt: new Date(),
        })),
      }));

      const res = await service.extractPlaces(
        '1',
        { id: 1 },
        { query: 'Clinics in Mumbai', limit: 10 },
      );

      expect(res.keyword).toBe('Clinics');
      expect(res.location).toBe('Mumbai');
      expect(res.requested).toBe(10);
    });

    it('resolves fallback customerId when customerId is undefined for SuperAdmin', async () => {
      mockPrisma.dataCaptureJob.count.mockResolvedValue(0);
      mockPrisma.dataCapturePlace.count.mockResolvedValue(0);
      mockPrisma.dataCaptureJob.aggregate.mockResolvedValue({ _sum: { googleApiRequests: 0 } });
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 2, name: 'Active Customer', isActive: true });
      mockPrisma.dataCapturePlace.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([]);
      mockPrisma.dataCaptureJob.create.mockImplementation((args: any) => ({
        ...args.data,
        places: args.data.places.create.map((p: any, idx: number) => ({
          ...p,
          id: idx + 1,
          createdAt: new Date(),
        })),
      }));

      const res = await service.extractPlaces(
        undefined,
        { id: 1, role: 'SUPER_ADMIN' },
        { keyword: 'Dentists', location: 'Pune' },
      );

      expect(mockPrisma.dataCaptureJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 2,
            userId: 1,
          }),
        }),
      );
    });

    it('throws BadRequestException when quota is exhausted', async () => {
      mockPrisma.dataCaptureJob.count.mockResolvedValue(50);
      mockPrisma.dataCapturePlace.count.mockResolvedValue(1000); // 1000 places = quota reached
      mockPrisma.dataCaptureJob.aggregate.mockResolvedValue({ _sum: { googleApiRequests: 50 } });

      await expect(
        service.extractPlaces(1, 1, { keyword: 'Gyms', location: 'Vadodara' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when both keyword and location are missing', async () => {
      await expect(
        service.extractPlaces(1, 1, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
