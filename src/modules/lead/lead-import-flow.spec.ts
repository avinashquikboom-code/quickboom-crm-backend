import { CrmLeadStatus } from '@prisma/client';
import { LeadService } from './lead.service';

describe('LeadService - Data Capture -> Import Lead Flow', () => {
  let service: LeadService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn((callback) => {
        if (typeof callback === 'function') {
          return callback(mockPrisma);
        }
        return Promise.all(callback);
      }),
      $queryRaw: jest.fn().mockResolvedValue([]),
      dataCapturePlace: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      lead: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      employee: {
        findFirst: jest.fn(),
      },
    };
    service = new LeadService(mockPrisma as any);
  });

  it('imports a validated Data Capture record and creates a Lead in NEW stage', async () => {
    const adminUser = { id: 1, accountType: 'SUPER_ADMIN' };
    const captureRecord = {
      id: 101,
      businessName: 'Apex Solar Energy',
      phone: '+91 9876543210',
      email: 'info@apexsolar.com',
      website: 'https://apexsolar.com',
      address: 'Electronic City, Bengaluru',
      category: 'Solar Equipment',
      googlePlaceId: 'ChIJ_TEST_PLACE_101',
      latitude: 12.9716,
      longitude: 77.5946,
      status: 'VALIDATED',
      isImported: false,
      importedLeadId: null,
      rawData: {
        addressComponents: [
          { longText: 'Bengaluru', types: ['locality'] },
          { longText: 'Karnataka', types: ['administrative_area_level_1'] },
          { longText: 'India', types: ['country'] },
          { longText: '560100', types: ['postal_code'] },
        ],
      },
    };

    mockPrisma.dataCapturePlace.findFirst.mockResolvedValue(captureRecord);
    mockPrisma.lead.findUnique.mockResolvedValue(null);
    mockPrisma.lead.create.mockResolvedValue({
      id: 55,
      companyName: 'Apex Solar Energy',
      phone: '+91 9876543210',
      email: 'info@apexsolar.com',
      googlePlaceId: 'ChIJ_TEST_PLACE_101',
      status: CrmLeadStatus.NEW,
      source: 'DATA_CAPTURE',
      createdFrom: 'ADMIN_PANEL',
      createdById: 1,
      assignedToId: null,
      deletedAt: null,
    });
    mockPrisma.dataCapturePlace.update.mockResolvedValue({
      ...captureRecord,
      importedLeadId: 55,
      isImported: true,
      status: 'LEAD_CREATED',
    });

    const result = await service.importCapture(101, adminUser, 'ADMIN_PANEL' as any);

    expect(result.alreadyImported).toBe(false);
    expect(result.lead.id).toBe(55);
    expect(result.lead.status).toBe(CrmLeadStatus.NEW);
    expect(result.lead.stage).toEqual({
      id: 1,
      key: 'NEW',
      name: 'New',
      isDefault: true,
      sortOrder: 1,
    });
    expect(result.capture.importedLeadId).toBe(55);
    expect(result.capture.isImported).toBe(true);
    expect(result.capture.status).toBe('LEAD_CREATED');
    expect(mockPrisma.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyName: 'Apex Solar Energy',
          status: CrmLeadStatus.NEW,
          source: 'DATA_CAPTURE',
        }),
      }),
    );
  });

  it('prevents duplicate imports and returns existing lead if already imported', async () => {
    const adminUser = { id: 1, accountType: 'SUPER_ADMIN' };
    const captureRecord = {
      id: 101,
      businessName: 'Apex Solar Energy',
      googlePlaceId: 'ChIJ_TEST_PLACE_101',
      status: 'LEAD_CREATED',
      isImported: true,
      importedLeadId: 55,
    };

    mockPrisma.dataCapturePlace.findFirst.mockResolvedValue(captureRecord);
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 55,
      companyName: 'Apex Solar Energy',
      googlePlaceId: 'ChIJ_TEST_PLACE_101',
      status: CrmLeadStatus.NEW,
      createdById: 1,
      assignedToId: null,
      deletedAt: null,
    });

    const result = await service.importCapture(101, adminUser, 'ADMIN_PANEL' as any);

    expect(result.alreadyImported).toBe(true);
    expect(result.lead.id).toBe(55);
    expect(mockPrisma.lead.create).not.toHaveBeenCalled();
  });
});
