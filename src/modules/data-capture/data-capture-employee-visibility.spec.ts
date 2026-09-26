import { Test, TestingModule } from '@nestjs/testing';
import { DataCaptureService } from './data-capture.service';
import { LeadRepository } from '../lead/lead.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { LeadStatus } from '@prisma/client';

describe('Data Capture Import to Employee Mobile Lead Pipeline End-to-End', () => {
  let dataCaptureService: DataCaptureService;
  let leadRepository: LeadRepository;
  let prisma: any;

  const mockEmployeeA = {
    id: 13,
    userId: 103,
    employeeCode: 'QB-EMP-013',
    firstName: 'Aarav',
    lastName: 'Patel',
    customerId: 1,
    status: 'ACTIVE',
  };

  const mockEmployeeB = {
    id: 14,
    userId: 104,
    employeeCode: 'QB-EMP-014',
    firstName: 'Rohan',
    lastName: 'Shah',
    customerId: 1,
    status: 'ACTIVE',
  };

  const mockAdminUser = {
    id: 1,
    customerId: 1,
    role: 'COMPANY_ADMIN',
  };

  const mockNewStage = {
    id: 16,
    key: 'NEW',
    name: 'New',
    customerId: 1,
    sortOrder: 1,
    isActive: true,
  };

  beforeEach(async () => {
    prisma = {
      dataCapturePlace: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      dataCaptureJob: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      employee: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (where?.userId === mockEmployeeA.userId || where?.id === mockEmployeeA.id) {
            return Promise.resolve(mockEmployeeA);
          }
          if (where?.userId === mockEmployeeB.userId || where?.id === mockEmployeeB.id) {
            return Promise.resolve(mockEmployeeB);
          }
          if (where?.OR) {
            for (const cond of where.OR) {
              if (cond.employeeCode?.equals === 'QB-EMP-013' || cond.id === 13 || cond.userId === 103) {
                return Promise.resolve(mockEmployeeA);
              }
              if (cond.employeeCode?.equals === 'QB-EMP-014' || cond.id === 14 || cond.userId === 104) {
                return Promise.resolve(mockEmployeeB);
              }
            }
          }
          return Promise.resolve(null);
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 103 }),
        findUnique: jest.fn(),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leadStage: {
        findFirst: jest.fn().mockResolvedValue(mockNewStage),
        findMany: jest.fn().mockResolvedValue([mockNewStage]),
      },
      lead: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      leadImage: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leadSocialProfile: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      leadActivityTimeline: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCaptureService,
        LeadRepository,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: IntegrationSettingsService,
          useValue: { getGoogleMapsConfig: jest.fn().mockResolvedValue({ isEnabled: false }) },
        },
      ],
    }).compile();

    dataCaptureService = module.get<DataCaptureService>(DataCaptureService);
    leadRepository = module.get<LeadRepository>(LeadRepository);
  });

  describe('Step 1-6: Data Capture Import & Authoritative Lead Persistence', () => {
    it('creates a Lead in DB with correct employee assignment when imported by Employee A', async () => {
      const mockPlace = {
        id: 1909,
        customerId: 1,
        googlePlaceId: 'ChIJ_BACHAT_BAZAAR_1909',
        businessName: 'Bachat Bazaar 365',
        phone: '+919662090593',
        email: 'info@bachatbazaar365.com',
        website: 'https://bachatbazaar365.com',
        address: 'Near Akota Stadium, Vadodara, Gujarat',
        category: 'Exhibition & Showroom',
        source: 'GOOGLE_PLACES',
        rating: 4.6,
        reviewCount: 289,
        isImported: false,
        rawData: { capturedBy: 'QB-EMP-013', employeeId: 13 },
      };

      prisma.dataCapturePlace.findFirst.mockResolvedValue(mockPlace);
      prisma.lead.findMany.mockResolvedValue([]); // No duplicates

      const createdLeadDb = {
        id: 562,
        customerId: 1,
        companyName: 'Bachat Bazaar 365',
        title: 'Bachat Bazaar 365',
        phone: '+919662090593',
        email: 'info@bachatbazaar365.com',
        website: 'https://bachatbazaar365.com',
        address: 'Near Akota Stadium, Vadodara, Gujarat',
        category: 'Exhibition & Showroom',
        source: 'GOOGLE_PLACES',
        status: LeadStatus.NEW,
        stageId: 16,
        assignedToId: 103, // Employee A userId
        employeeId: 13,   // Employee A id
        createdById: 103,
        googlePlaceId: 'ChIJ_BACHAT_BAZAAR_1909',
        sourceRecordId: '1909',
        deletedAt: null,
      };

      prisma.lead.create.mockResolvedValue(createdLeadDb);

      const result = await dataCaptureService.createLeadFromPlace(
        1,
        103, // Employee A userId
        1909,
        'req-import-1909',
      );

      expect(result.success).toBe(true);
      expect(result.leadId).toBe(562);
      expect(result.lead).toBeDefined();

      // Verify Prisma Lead create payload
      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 1,
            companyName: 'Bachat Bazaar 365',
            phone: '+919662090593',
            email: 'info@bachatbazaar365.com',
            source: 'GOOGLE_PLACES',
            status: 'NEW',
            stageId: 16,
            assignedToId: 103,
            employeeId: 13,
            createdById: 103,
            sourceRecordId: '1909',
          }),
        }),
      );

      // Verify DataCapturePlace was marked as imported
      expect(prisma.dataCapturePlace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1909 },
          data: expect.objectContaining({
            isImported: true,
            importedLeadId: 562,
            status: 'LEAD_CREATED',
          }),
        }),
      );
    });

    it('assigns imported lead to target employee when imported by Admin with assignedToId', async () => {
      const mockPlace = {
        id: 1910,
        customerId: 1,
        businessName: 'Super Mart',
        phone: '+919876543210',
        isImported: false,
      };

      prisma.dataCapturePlace.findFirst.mockResolvedValue(mockPlace);
      prisma.lead.findMany.mockResolvedValue([]);

      prisma.lead.create.mockResolvedValue({
        id: 563,
        customerId: 1,
        companyName: 'Super Mart',
        status: LeadStatus.NEW,
        stageId: 16,
        assignedToId: 103,
        employeeId: 13,
        createdById: 1,
      });

      const result = await dataCaptureService.createLeadFromPlace(
        1,
        1, // Admin userId
        1910,
        'req-admin-assign-1910',
        { assignedToId: 'QB-EMP-013' },
      );

      expect(result.success).toBe(true);
      expect(result.leadId).toBe(563);
      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedToId: 103,
            employeeId: 13,
            createdById: 1,
          }),
        }),
      );
    });
  });

  describe('Step 4, 5, 23: Backend Lead Filter & Employee Isolation in GET /leads (findAll)', () => {
    const lead562 = {
      id: 562,
      companyName: 'Bachat Bazaar 365',
      customerId: 1,
      assignedToId: 103, // Employee A
      employeeId: 13,
      createdById: 103,
      stageId: 16,
      status: LeadStatus.NEW,
      deletedAt: null,
      images: [],
    };

    const lead999 = {
      id: 999,
      companyName: 'Employee B Private Lead',
      customerId: 1,
      assignedToId: 104, // Employee B
      employeeId: 14,
      createdById: 104,
      stageId: 16,
      status: LeadStatus.NEW,
      deletedAt: null,
      images: [],
    };

    it('returns imported Lead 562 to Employee A in GET /leads', async () => {
      const userContextA = {
        id: 103,
        customerId: 1,
        role: 'EMPLOYEE',
        employee: mockEmployeeA,
      };

      prisma.lead.findMany.mockImplementation(({ where }) => {
        // Evaluate where clause against lead562
        const isEmployeeMatch =
          where?.AND?.some((c: any) =>
            c.OR?.some((o: any) => o.assignedToId === 103 || o.employeeId === 13 || o.createdById === 103),
          );
        return isEmployeeMatch ? Promise.resolve([lead562]) : Promise.resolve([]);
      });
      prisma.lead.count.mockResolvedValue(1);

      const res = await leadRepository.findAll(1, {}, userContextA);

      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe(562);
      expect(res.data[0].companyName).toBe('Bachat Bazaar 365');
      expect(res.meta.total).toBe(1);
    });

    it('enforces Employee Isolation: Employee B CANNOT see Lead 562', async () => {
      const userContextB = {
        id: 104,
        customerId: 1,
        role: 'EMPLOYEE',
        employee: mockEmployeeB,
      };

      prisma.lead.findMany.mockImplementation(({ where }) => {
        const isEmployeeMatch =
          where?.AND?.some((c: any) =>
            c.OR?.some((o: any) => o.assignedToId === 104 || o.employeeId === 14 || o.createdById === 104),
          );
        // Employee B only sees lead 999, never lead 562
        return isEmployeeMatch ? Promise.resolve([lead999]) : Promise.resolve([]);
      });
      prisma.lead.count.mockResolvedValue(1);

      const res = await leadRepository.findAll(1, {}, userContextB);

      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe(999);
      expect(res.data.find((l: any) => l.id === 562)).toBeUndefined();
    });

    it('allows Admin to see all company leads including imported Lead 562', async () => {
      const userAdmin = {
        id: 1,
        customerId: 1,
        role: 'COMPANY_ADMIN',
      };

      prisma.lead.findMany.mockResolvedValue([lead562, lead999]);
      prisma.lead.count.mockResolvedValue(2);

      const res = await leadRepository.findAll(1, {}, userAdmin);

      expect(res.data).toHaveLength(2);
      expect(res.data.map((l: any) => l.id)).toEqual([562, 999]);
    });

    it('does not clobber stageId filter when search option is provided', async () => {
      const userContextA = {
        id: 103,
        customerId: 1,
        role: 'EMPLOYEE',
        employee: mockEmployeeA,
      };

      prisma.lead.findMany.mockResolvedValue([lead562]);
      prisma.lead.count.mockResolvedValue(1);

      await leadRepository.findAll(
        1,
        { stageId: 16, search: 'Bachat' },
        userContextA,
      );

      const findManyCall = prisma.lead.findMany.mock.calls[0][0];
      const where = findManyCall.where;

      expect(where.AND).toBeDefined();
      expect(Array.isArray(where.AND)).toBe(true);

      // Verify both stageId, search, and employee isolation conditions are present in where.AND
      const hasEmployeeIsolation = where.AND.some((c: any) =>
        c.OR?.some((o: any) => o.assignedToId === 103),
      );
      const hasSearch = where.AND.some((c: any) =>
        c.OR?.some((o: any) => o.companyName?.contains === 'Bachat'),
      );
      const hasStage = where.AND.some((c: any) =>
        c.OR?.some((o: any) => o.stageId === 16),
      );

      expect(hasEmployeeIsolation).toBe(true);
      expect(hasSearch).toBe(true);
      expect(hasStage).toBe(true);
    });
  });
});
