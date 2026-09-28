import { Test, TestingModule } from '@nestjs/testing';
import { DataCaptureService } from './data-capture.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { LeadService } from '../lead/lead.service';

describe('Data Capture Timing & Performance Verification', () => {
  let dataCaptureService: DataCaptureService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      dataCapturePlace: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      dataCaptureUsage: {
        findUnique: jest.fn().mockResolvedValue({
          monthlyQuotaLimit: 1000,
          placesCapturedThisMonth: 10,
        }),
        upsert: jest.fn().mockResolvedValue({
          monthlyQuotaLimit: 1000,
          placesCapturedThisMonth: 10,
        }),
      },
      dataCaptureJob: {
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { googleApiRequests: 1 } }),
        create: jest.fn().mockImplementation(({ data }) => ({
          ...data,
          id: 1,
          createdAt: new Date(),
          places: (data.places?.create || []).map((p: any, i: number) => ({
            ...p,
            id: `p-${i + 1}`,
            createdAt: new Date(),
          })),
        })),
      },
      dataCaptureSearch: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCaptureService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: IntegrationSettingsService,
          useValue: {
            getGoogleMapsConfig: jest.fn().mockResolvedValue({
              isEnabled: false,
              apiKey: null,
            }),
          },
        },
        { provide: LeadService, useValue: { createLead: jest.fn() } },
      ],
    }).compile();

    dataCaptureService = module.get<DataCaptureService>(DataCaptureService);
  });

  it('Restaurant + Vadodara + 10 completes in under 2 seconds', async () => {
    const start = Date.now();
    const result = await dataCaptureService.extractPlaces(
      100,
      { customerId: 100, id: 10 },
      {
        keyword: 'Restaurant',
        location: 'Vadodara',
        maxResults: 10,
      },
    );
    const duration = Date.now() - start;

    expect(result).toBeDefined();
    expect(result.places.length).toBe(10);
    expect(duration).toBeLessThan(2000);
  });

  it('Restaurant + Vadodara + 20 completes in under 2 seconds', async () => {
    const start = Date.now();
    const result = await dataCaptureService.extractPlaces(
      100,
      { customerId: 100, id: 10 },
      {
        keyword: 'Restaurant',
        location: 'Vadodara',
        maxResults: 20,
      },
    );
    const duration = Date.now() - start;

    expect(result).toBeDefined();
    expect(result.places.length).toBe(20);
    expect(duration).toBeLessThan(2000);
  });
});
