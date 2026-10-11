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

  // 7. Won Lead without a purchased/active plan -> Customer is INACTIVE
  it('Scenario 7: Won Lead without a purchased/active plan has status INACTIVE', async () => {
    const unpurchasedWonCustomer = {
      id: 505,
      name: 'Won Client No Plan',
      companyName: 'Won Client No Plan',
      isActive: false, // Persisted inactive upon conversion
      leadId: 105,
      originLead: {
        id: 105,
        status: LeadStatus.WON,
        stage: { id: 26, key: 'WON', name: 'Won' },
      },
      subscriptions: [], // No plan purchased/activated
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    mockPrisma.customer.findMany.mockResolvedValue([unpurchasedWonCustomer]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    // When querying all, customer status is INACTIVE
    const resultAll = await customerService.findAll({ status: 'ALL' }, adminUser);
    expect(resultAll.items.length).toBe(1);
    expect(resultAll.items[0].id).toBe(505);
    expect(resultAll.items[0].isActive).toBe(false);
    expect(resultAll.items[0].customerStatus).toBe('INACTIVE');
    expect(resultAll.items[0].status).toBe('INACTIVE');

    // When querying ACTIVE, customer is absent
    const resultActive = await customerService.findAll({ status: 'ACTIVE' }, adminUser);
    expect(resultActive.items.length).toBe(0);

    // When querying INACTIVE, customer is present
    const resultInactive = await customerService.findAll({ status: 'INACTIVE' }, adminUser);
    expect(resultInactive.items.length).toBe(1);
    expect(resultInactive.items[0].id).toBe(505);
  });

  // 8. Customer with a successfully activated plan -> Customer is ACTIVE
  it('Scenario 8: Customer with a successfully activated plan has status ACTIVE', async () => {
    const activatedCustomer = {
      id: 506,
      name: 'Won Client Active Plan',
      companyName: 'Won Client Active Plan',
      isActive: true, // Updated to active upon plan activation
      leadId: 106,
      originLead: {
        id: 106,
        status: LeadStatus.WON,
        stage: { id: 26, key: 'WON', name: 'Won' },
      },
      subscriptions: [
        {
          status: 'ACTIVE',
          endDate: new Date('2028-01-01'),
          plan: { id: 2, name: 'Growth Plan', code: 'GROWTH' },
        },
      ],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    mockPrisma.customer.findMany.mockResolvedValue([activatedCustomer]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const resultActive = await customerService.findAll({ status: 'ACTIVE' }, adminUser);
    expect(resultActive.items.length).toBe(1);
    expect(resultActive.items[0].id).toBe(506);
    expect(resultActive.items[0].isActive).toBe(true);
    expect(resultActive.items[0].customerStatus).toBe('ACTIVE');
    expect(resultActive.items[0].status).toBe('ACTIVE');
  });

  // 9. Failed or pending plan purchase -> Customer remains INACTIVE
  it('Scenario 9: Failed or pending plan purchase leaves customer INACTIVE', async () => {
    const pendingCustomer = {
      id: 507,
      name: 'Won Client Pending Purchase',
      companyName: 'Won Client Pending Purchase',
      isActive: false, // Remains inactive while pending
      leadId: 107,
      originLead: {
        id: 107,
        status: LeadStatus.WON,
        stage: { id: 26, key: 'WON', name: 'Won' },
      },
      subscriptions: [
        {
          status: 'PENDING',
          endDate: new Date('2028-01-01'),
          plan: { id: 2, name: 'Growth Plan', code: 'GROWTH' },
        },
      ],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    mockPrisma.customer.findMany.mockResolvedValue([pendingCustomer]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const resultActive = await customerService.findAll({ status: 'ACTIVE' }, adminUser);
    expect(resultActive.items.length).toBe(0);

    const resultInactive = await customerService.findAll({ status: 'INACTIVE' }, adminUser);
    expect(resultInactive.items.length).toBe(1);
    expect(resultInactive.items[0].id).toBe(507);
    expect(resultInactive.items[0].customerStatus).toBe('INACTIVE');
  });

  // 10. Existing customer with a valid active plan remains ACTIVE
  it('Scenario 10: Existing customer with a valid active plan remains ACTIVE', async () => {
    const existingActiveCustomer = {
      id: 508,
      name: 'Existing Active Account',
      companyName: 'Existing Active Account',
      isActive: true,
      leadId: null,
      originLead: null,
      subscriptions: [
        {
          status: 'ACTIVE',
          endDate: new Date('2029-01-01'),
          plan: { id: 1, name: 'Enterprise Plan', code: 'ENTERPRISE' },
        },
      ],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 2, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    mockPrisma.customer.findMany.mockResolvedValue([existingActiveCustomer]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const result = await customerService.findAll({ status: 'ACTIVE' }, adminUser);
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe(508);
    expect(result.items[0].isActive).toBe(true);
    expect(result.items[0].customerStatus).toBe('ACTIVE');
  });
});
