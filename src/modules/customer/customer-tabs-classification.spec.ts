import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { LeadService } from '../lead/lead.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';

describe('CUSTOMER TABS — ACTIVE / INACTIVE / UPCOMING BUSINESS LOGIC', () => {
  let customerService: CustomerService;

  const mockPrisma: any = {
    customer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
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

  const userEmployeeA = {
    id: 101,
    sub: 101,
    email: 'employeeA@company.com',
    role: 'STAFF',
    userRoles: [{ role: { name: 'EMPLOYEE', type: 'STAFF' } }],
    employee: { id: 1, userId: 101, customerId: 10, employeeCode: 'EMP-001' },
    employeeId: 1,
    customerId: 10,
  };

  const userEmployeeB = {
    id: 102,
    sub: 102,
    email: 'employeeB@company.com',
    role: 'STAFF',
    userRoles: [{ role: { name: 'EMPLOYEE', type: 'STAFF' } }],
    employee: { id: 2, userId: 102, customerId: 10, employeeCode: 'EMP-002' },
    employeeId: 2,
    customerId: 10,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.leadStage.findMany.mockResolvedValue([
      { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
      { id: 25, key: 'FINAL_CALL', name: 'Final Call' },
      { id: 26, key: 'WON', name: 'Won' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: LeadService, useValue: {} },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: {} },
        { provide: QBIdGenerator, useValue: { generateQbId: () => 'QB-123' } },
        { provide: WorkService, useValue: {} },
      ],
    }).compile();

    customerService = module.get<CustomerService>(CustomerService);
  });

  // TEST 1: Lead: ABC, Stage: New, Plan: None -> NOT a Customer
  it('TEST 1: Lead ABC in New stage is NOT returned as a Customer', async () => {
    const leadNew = {
      id: 101,
      companyName: 'ABC Company',
      status: 'NEW',
      stageId: 1,
      stage: { id: 1, key: 'NEW', name: 'New' },
      employeeId: 1,
      reminders: [],
    };

    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockResolvedValue([leadNew]);

    const resInactive = await customerService.findAll({ status: 'INACTIVE' }, userEmployeeA);
    expect(resInactive.items.length).toBe(0);

    const resUpcoming = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
    expect(resUpcoming.items.length).toBe(0);

    const resAll = await customerService.findAll({ status: 'ALL' }, userEmployeeA);
    expect(resAll.items.length).toBe(0);
  });

  it('TEST 1b: Lead in Details Sent stage is NOT returned as a Customer', async () => {
    const leadDetailsSent = {
      id: 111,
      companyName: 'Creekyard-Vadodara',
      status: 'DETAILS_SENT',
      stageId: 4,
      stage: { id: 4, key: 'DETAILS_SENT', name: 'Details send' },
      employeeId: 1,
      reminders: [],
    };

    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockResolvedValue([leadDetailsSent]);

    const resAll = await customerService.findAll({ status: 'ALL' }, userEmployeeA);
    expect(resAll.items.length).toBe(0);
    expect(resAll.meta.counts.all).toBe(0);
  });

  // TEST 2: Lead: ABC, Stage: Follow-up, Plan: None -> NOT a Customer
  it('TEST 2: Lead ABC in Follow-up stage is NOT returned as a Customer', async () => {
    const leadFollowUp = {
      id: 102,
      companyName: 'ABC Company',
      status: 'FOLLOW_UP',
      stageId: 20,
      stage: { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
      employeeId: 1,
      reminders: [],
    };

    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockResolvedValue([leadFollowUp]);

    const resUpcoming = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
    expect(resUpcoming.items.length).toBe(0);

    const resActive = await customerService.findAll({ status: 'ACTIVE' }, userEmployeeA);
    expect(resActive.items.length).toBe(0);

    const resInactive = await customerService.findAll({ status: 'INACTIVE' }, userEmployeeA);
    expect(resInactive.items.length).toBe(0);
  });

  // TEST 3: Lead: ABC, Stage: Final Call, Plan: None -> NOT a Customer
  it('TEST 3: Lead ABC in Final Call stage is NOT returned as a Customer', async () => {
    const leadFinalCall = {
      id: 103,
      companyName: 'ABC Company',
      status: 'FINAL_CALL',
      stageId: 25,
      stage: { id: 25, key: 'FINAL_CALL', name: 'Final Call' },
      employeeId: 1,
      reminders: [],
    };

    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockResolvedValue([leadFinalCall]);

    const resUpcoming = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
    expect(resUpcoming.items.length).toBe(0);

    const resActive = await customerService.findAll({ status: 'ACTIVE' }, userEmployeeA);
    expect(resActive.items.length).toBe(0);
  });

  // TEST 4: Lead: ABC, Stage: Won, Plan: Selected but NOT purchased -> Expected: Inactive (MUST NOT be Active)
  it('TEST 4: Customer with unpurchased / pending plan is INACTIVE and MUST NOT be Active', async () => {
    const custPendingPlan = {
      id: 501,
      name: 'ABC Company',
      companyName: 'ABC Company',
      isActive: true, // DB row default true
      assignedEmployeeId: 1,
      createdByEmployeeId: 1,
      subscriptions: [
        {
          status: 'PENDING', // Payment not completed
          endDate: new Date('2027-01-01'),
          plan: { id: 1, name: 'Basic Plan', code: 'BASIC' },
        },
      ],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    mockPrisma.customer.findMany.mockResolvedValue([custPendingPlan]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const resActive = await customerService.findAll({ status: 'ACTIVE' }, userEmployeeA);
    expect(resActive.items.length).toBe(0); // Must NOT be Active

    const resInactive = await customerService.findAll({ status: 'INACTIVE' }, userEmployeeA);
    expect(resInactive.items.length).toBe(1);
    expect(resInactive.items[0].id).toBe(501);
    expect(resInactive.items[0].customerStatus).toBe('INACTIVE');
  });

  // TEST 5: Lead: ABC, Stage: Won, Plan: Purchased + successfully activated -> Expected: Active
  it('TEST 5: Customer with purchased + successfully activated plan is ACTIVE', async () => {
    const custActivePlan = {
      id: 502,
      name: 'ABC Company',
      companyName: 'ABC Company',
      isActive: true,
      assignedEmployeeId: 1,
      createdByEmployeeId: 1,
      subscriptions: [
        {
          status: 'ACTIVE', // Successfully activated
          endDate: new Date('2027-01-01'),
          plan: { id: 1, name: 'Basic Plan', code: 'BASIC' },
        },
      ],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    mockPrisma.customer.findMany.mockResolvedValue([custActivePlan]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const resActive = await customerService.findAll({ status: 'ACTIVE' }, userEmployeeA);
    expect(resActive.items.length).toBe(1);
    expect(resActive.items[0].id).toBe(502);
    expect(resActive.items[0].customerStatus).toBe('ACTIVE');
    expect(resActive.items[0].hasUpcomingCall).toBe(false);

    const resUpcoming = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
    expect(resUpcoming.items.length).toBe(0);
  });

  // TEST 6 & 7: Follow-up / Final Call are not Customers; Won converted customer is.
  it('TEST 6 & 7: Follow-up/Final Call stay off Customers; Won converted customer appears', async () => {
    const leadFollowUp = {
      id: 104,
      companyName: 'Progression Corp',
      status: 'FOLLOW_UP',
      stageId: 20,
      stage: { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
      employeeId: 1,
      reminders: [],
    };
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockResolvedValue([leadFollowUp]);

    const res1 = await customerService.findAll({ status: 'ALL' }, userEmployeeA);
    expect(res1.items.length).toBe(0);

    const leadFinalCall = { ...leadFollowUp, status: 'FINAL_CALL', stageId: 25, stage: { id: 25, key: 'FINAL_CALL', name: 'Final Call' } };
    mockPrisma.lead.findMany.mockResolvedValue([leadFinalCall]);
    const res2 = await customerService.findAll({ status: 'ALL' }, userEmployeeA);
    expect(res2.items.length).toBe(0);

    const convertedCust = {
      id: 601,
      name: 'Progression Corp',
      companyName: 'Progression Corp',
      isActive: true,
      assignedEmployeeId: 1,
      leadId: 104,
      originLead: {
        id: 104,
        status: 'WON',
        stage: { id: 26, key: 'WON', name: 'Won' },
      },
      subscriptions: [],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };
    mockPrisma.customer.findMany.mockResolvedValue([convertedCust]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const res3 = await customerService.findAll({ status: 'ALL' }, userEmployeeA);
    expect(res3.items.length).toBe(1);
    expect(res3.items[0].id).toBe(601);
  });

  // TEST 8: Plan successfully activated -> Active
  it('TEST 8: Adding active plan transitions customer immediately to Active', async () => {
    const customerWithNewActivePlan = {
      id: 601,
      name: 'Progression Corp',
      companyName: 'Progression Corp',
      isActive: true,
      assignedEmployeeId: 1,
      leadId: 104,
      subscriptions: [
        {
          status: 'ACTIVE',
          endDate: new Date('2027-01-01'),
          plan: { id: 2, name: 'Premium Plan', code: 'PREMIUM' },
        },
      ],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };
    mockPrisma.customer.findMany.mockResolvedValue([customerWithNewActivePlan]);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const res = await customerService.findAll({ status: 'ACTIVE' }, userEmployeeA);
    expect(res.items.length).toBe(1);
    expect(res.items[0].id).toBe(601);
    expect(res.items[0].planName).toBe('Premium Plan');
    expect(res.items[0].customerStatus).toBe('ACTIVE');
  });

  // TEST 9: Employee A has Follow-up Lead; Employee B cannot see Employee A Upcoming Lead
  it('TEST 9: Employee A sees their Won Lead as Customer; Employee B cannot', async () => {
    const leadEmpA = {
      id: 201,
      companyName: 'Alpha Lead',
      status: 'WON',
      stageId: 26,
      stage: { id: 26, key: 'WON', name: 'Won' },
      employeeId: 1,
      reminders: [],
      convertedCustomer: null,
    };

    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockImplementation(async (args: any) => {
      const orClauses = args.where?.AND?.find((c: any) => c.OR)?.OR;
      const matchesEmpA = orClauses?.some((c: any) => c.employeeId === 1);
      return matchesEmpA ? [leadEmpA] : [];
    });

    const resA = await customerService.findAll({ status: 'ALL' }, userEmployeeA);
    expect(resA.items.length).toBe(1);
    expect(resA.items[0].leadId).toBe('201');

    const resB = await customerService.findAll({ status: 'ALL' }, userEmployeeB);
    expect(resB.items.length).toBe(0);
  });

  // TEST 10: Two active plans + three Follow-up + one normal no-plan record -> All = 6, Active = 2, Upcoming = 3, Inactive = 1
  it('TEST 10: Two active plans + three Follow-up + one New lead gives All=2, Active=2, Upcoming=0, Inactive=0', async () => {
    // 2 Customers with active plans
    const custActive1 = {
      id: 701,
      name: 'Active Corp 1',
      companyName: 'Active Corp 1',
      isActive: true,
      assignedEmployeeId: 1,
      subscriptions: [{ status: 'ACTIVE', endDate: new Date('2027-01-01'), plan: { id: 1, name: 'Plan 1', code: 'P1' } }],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };
    const custActive2 = {
      id: 702,
      name: 'Active Corp 2',
      companyName: 'Active Corp 2',
      isActive: true,
      assignedEmployeeId: 1,
      subscriptions: [{ status: 'ACTIVE', endDate: new Date('2027-01-01'), plan: { id: 2, name: 'Plan 2', code: 'P2' } }],
      works: [],
      leads: [],
      tasks: [],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
    };

    // 3 Follow-up Leads
    const followUpLeads = [1, 2, 3].map((idx) => ({
      id: 800 + idx,
      companyName: `Follow-up Prospect ${idx}`,
      status: 'FOLLOW_UP',
      stageId: 20,
      stage: { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
      employeeId: 1,
      reminders: [],
    }));

    // 1 Normal no-plan record (Lead in NEW stage)
    const normalNoPlanLead = {
      id: 900,
      companyName: 'New Normal Prospect',
      status: 'NEW',
      stageId: 1,
      stage: { id: 1, key: 'NEW', name: 'New' },
      employeeId: 1,
      reminders: [],
    };

    mockPrisma.customer.findMany.mockResolvedValue([custActive1, custActive2]);
    mockPrisma.lead.findMany.mockResolvedValue([...followUpLeads, normalNoPlanLead]);

    const resultAll = await customerService.findAll({ status: 'ALL' }, userEmployeeA);
    expect(resultAll.meta.counts.all).toBe(2);
    expect(resultAll.meta.counts.active).toBe(2);
    expect(resultAll.meta.counts.upcoming).toBe(0);
    expect(resultAll.meta.counts.inactive).toBe(0);
    expect(resultAll.items.length).toBe(2);

    const resultActive = await customerService.findAll({ status: 'ACTIVE' }, userEmployeeA);
    expect(resultActive.items.length).toBe(2);

    const resultUpcoming = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
    expect(resultUpcoming.items.length).toBe(0);

    const resultInactive = await customerService.findAll({ status: 'INACTIVE' }, userEmployeeA);
    expect(resultInactive.items.length).toBe(0);
  });
});
