import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { LeadService } from '../lead/lead.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';
import { LeadStatus } from '@prisma/client';

describe('Admin Panel Only: Add Leads to Customers Only When Stage Is Won', () => {
  let customerService: CustomerService;

  const mockPrisma: any = {
    customer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    lead: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    leadStage: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  };

  const adminUser = {
    id: 1,
    sub: 1,
    email: 'admin@quickboom.com',
    role: 'ADMIN',
    userRoles: [{ role: { name: 'ADMIN', type: 'ADMIN' } }],
    customerId: 1,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.leadStage.findMany.mockResolvedValue([
      { id: 1, key: 'NEW', name: 'New' },
      { id: 2, key: 'CONTACTED', name: 'Contacted' },
      { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
      { id: 25, key: 'FINAL_CALL', name: 'Final Call' },
      { id: 26, key: 'WON', name: 'Won' },
      { id: 27, key: 'LOST', name: 'Lost' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: LeadService, useValue: {} },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: {} },
        { provide: QBIdGenerator, useValue: { generateQbId: () => 'QB-999' } },
        { provide: WorkService, useValue: {} },
      ],
    }).compile();

    customerService = module.get<CustomerService>(CustomerService);
  });

  // 1. A lead in New — absent from Customers.
  it('Scenario 1: A lead in New stage is absent from Customers list', async () => {
    const leadNew = {
      id: 101,
      title: 'Lead New',
      companyName: 'New Corp',
      status: LeadStatus.NEW,
      stageId: 1,
      stage: { id: 1, key: 'NEW', name: 'New' },
      employeeId: null,
      reminders: [],
      convertedCustomer: null,
    };

    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockResolvedValue([leadNew]);

    const result = await customerService.findAll({ status: 'ALL' }, adminUser);
    expect(result.items.length).toBe(0);
    expect(result.meta.counts.all).toBe(0);
  });

  // 2. A lead in Contacted or another non-Won stage — absent from Customers.
  it('Scenario 2: A lead in Contacted stage is absent from Customers list', async () => {
    const leadContacted = {
      id: 102,
      title: 'Lead Contacted',
      companyName: 'Contacted LLC',
      status: LeadStatus.CONTACTED,
      stageId: 2,
      stage: { id: 2, key: 'CONTACTED', name: 'Contacted' },
      employeeId: null,
      reminders: [],
      convertedCustomer: null,
    };

    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockResolvedValue([leadContacted]);

    const result = await customerService.findAll({ status: 'ALL' }, adminUser);
    expect(result.items.length).toBe(0);
    expect(result.meta.counts.all).toBe(0);
  });

  // 3. A lead transitioning to Won — appears in Customers.
  it('Scenario 3: A lead in Won stage (converted customer) appears in Customers list', async () => {
    const wonCustomer = {
      id: 501,
      name: 'Won Client Corp',
      companyName: 'Won Client Corp',
      isActive: true,
      leadId: 103,
      originLead: {
        id: 103,
        status: LeadStatus.WON,
        stage: { id: 26, key: 'WON', name: 'Won' },
      },
      subscriptions: [],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    mockPrisma.customer.findMany.mockResolvedValue([wonCustomer]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const result = await customerService.findAll({ status: 'ALL' }, adminUser);
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe(501);
    expect(result.items[0].leadStatus).toBe('WON');
  });

  // 4. Repeated Won updates — no duplicate customer.
  it('Scenario 4: Repeated Won queries for the same customer return a single customer row without duplicates', async () => {
    const wonCustomer = {
      id: 501,
      name: 'Won Client Corp',
      companyName: 'Won Client Corp',
      isActive: true,
      leadId: 103,
      originLead: {
        id: 103,
        status: LeadStatus.WON,
        stage: { id: 26, key: 'WON', name: 'Won' },
      },
      subscriptions: [],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    // When querying all customers for counts and items
    mockPrisma.customer.findMany.mockResolvedValue([wonCustomer]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const resultFirst = await customerService.findAll({ status: 'ALL' }, adminUser);
    const resultSecond = await customerService.findAll({ status: 'ALL' }, adminUser);

    expect(resultFirst.items.length).toBe(1);
    expect(resultSecond.items.length).toBe(1);
    expect(resultFirst.items[0].id).toBe(501);
    expect(resultSecond.items[0].id).toBe(501);
  });

  // 5. An independently created customer — remains visible under existing rules.
  it('Scenario 5: An independently created customer (no leadId) remains visible', async () => {
    const directCustomer = {
      id: 700,
      name: 'Direct Enterprise Account',
      companyName: 'Direct Enterprise Account',
      isActive: true,
      leadId: null,
      originLead: null,
      subscriptions: [
        {
          status: 'ACTIVE',
          endDate: new Date('2028-01-01'),
          plan: { id: 1, name: 'Enterprise Plan', code: 'ENTERPRISE' },
        },
      ],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 2, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    mockPrisma.customer.findMany.mockResolvedValue([directCustomer]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const result = await customerService.findAll({ status: 'ALL' }, adminUser);
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe(700);
    expect(result.items[0].customerStatus).toBe('ACTIVE');
  });

  // 6. A Won lead changed to another stage — handled according to the established conversion rules (no longer qualifies, absent from Customers).
  it('Scenario 6: A customer whose origin lead moved from Won to Lost is excluded from Customers', async () => {
    const demotedCustomer = {
      id: 502,
      name: 'Former Won Client',
      companyName: 'Former Won Client',
      isActive: true,
      leadId: 104,
      originLead: {
        id: 104,
        status: LeadStatus.LOST,
        stage: { id: 27, key: 'LOST', name: 'Lost' },
      },
      subscriptions: [], // No completed purchase
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    mockPrisma.customer.findMany.mockResolvedValue([demotedCustomer]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const result = await customerService.findAll({ status: 'ALL' }, adminUser);
    expect(result.items.length).toBe(0);
    expect(result.meta.counts.all).toBe(0);
  });
});
