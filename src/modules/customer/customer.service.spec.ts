import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';

describe('CustomerService - Resource Consumption', () => {
  let service: CustomerService;
  let prisma: any;

  const mockCustomers = [
    {
      id: 1,
      name: 'Acme Enterprise',
      companyName: 'Acme Corp',
      domain: 'acme.com',
      email: 'admin@acme.com',
      phone: '1234567890',
      isActive: true,
      storageUsed: BigInt(45 * 1024 * 1024), // 45 MB
      userLimit: 50,
      leadLimit: 1000,
      storageLimit: BigInt(5368709120),
      createdAt: new Date('2026-01-01'),
      subscriptions: [
        {
          id: 10,
          status: 'ACTIVE',
          plan: {
            id: 1,
            name: 'Scale Plan',
            code: 'SCALE',
            userLimit: 50,
            leadLimit: 1000,
            storageLimit: BigInt(5368709120),
          },
        },
      ],
      _count: {
        users: 32,
        leads: 850,
        works: 12,
        dataCapturePlaces: 24,
      },
    },
    {
      id: 2,
      name: 'Beta Global',
      companyName: 'Beta Inc',
      domain: 'beta.com',
      email: 'info@beta.com',
      phone: '0987654321',
      isActive: true,
      storageUsed: BigInt(15 * 1024 * 1024), // 15 MB
      userLimit: 20,
      leadLimit: 500,
      storageLimit: BigInt(2147483648),
      createdAt: new Date('2026-02-01'),
      subscriptions: [
        {
          id: 11,
          status: 'ACTIVE',
          plan: {
            id: 2,
            name: 'Growth Plan',
            code: 'GROWTH',
            userLimit: 20,
            leadLimit: 500,
            storageLimit: BigInt(2147483648),
          },
        },
      ],
      _count: {
        users: 10,
        leads: 200,
        works: 5,
        dataCapturePlaces: 8,
      },
    },
  ];

  beforeEach(async () => {
    prisma = {
      customer: {
        count: jest.fn().mockResolvedValue(mockCustomers.length),
        findMany: jest.fn().mockResolvedValue(mockCustomers),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: 'ScheduleService',
          useValue: {},
        },
        {
          provide: ScheduleService,
          useValue: {},
        },
        {
          provide: QBIdGenerator,
          useValue: { generateQbId: jest.fn().mockResolvedValue('QB-1234') },
        },
        {
          provide: WorkService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return aggregated resource consumption and breakdown for all customers', async () => {
    const result = await service.getResourceConsumption({
      page: 1,
      limit: 20,
      status: 'ALL',
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary.totalAllocatedSeats).toBe(42); // 32 + 10
    expect(result.summary.totalMaxSeats).toBe(70); // 50 + 20
    expect(result.summary.overallSeatUtilization).toBe('60.0%'); // 42/70 * 100
    expect(result.summary.totalLeads).toBe(1050); // 850 + 200
    expect(result.summary.totalStorage).toBe('60.0 MB'); // 45MB + 15MB
    expect(result.summary.totalCustomers).toBe(2);
    expect(result.summary.activeCustomers).toBe(2);

    expect(result.items).toHaveLength(2);
    const item1 = result.items[0];
    expect(item1.id).toBe(1);
    expect(item1.name).toBe('Acme Enterprise');
    expect(item1.users).toBe(32);
    expect(item1.maxUsers).toBe(50);
    expect(item1.seatUtilization).toBe(64); // 32/50 * 100 = 64%
    expect(item1.leads).toBe(850);
    expect(item1.maxLeads).toBe(1000);
    expect(item1.leadUtilization).toBe(85);
    expect(item1.storage).toBe('45.0 MB');
    expect(item1.worksCount).toBe(12);
  });

  it('should filter customers by search query and date range', async () => {
    await service.getResourceConsumption({
      search: 'Acme',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });

    expect(prisma.customer.findMany).toHaveBeenCalled();
    const callArgs = prisma.customer.findMany.mock.calls[0][0];
    expect(callArgs.where.deletedAt).toBeNull();
    expect(callArgs.where.OR).toBeDefined();
    expect(callArgs.where.createdAt).toBeDefined();
  });
});
