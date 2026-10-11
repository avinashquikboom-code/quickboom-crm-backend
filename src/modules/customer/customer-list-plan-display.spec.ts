import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { LeadService } from '../lead/lead.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';

describe('CUSTOMER LIST — ACTIVE PLAN & BILLING COMES FROM PERSISTED SUBSCRIPTIONS', () => {
  let customerService: CustomerService;

  const mockPrisma: any = {
    customer: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    lead: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    leadStage: { findMany: jest.fn(), findFirst: jest.fn() },
    employee: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
  };

  const adminViewer = {
    id: 101,
    sub: 101,
    role: 'STAFF',
    userRoles: [{ role: { name: 'EMPLOYEE', type: 'STAFF' } }],
    employee: { id: 1, userId: 101, customerId: 10, employeeCode: 'EMP-001' },
    employeeId: 1,
    customerId: 10,
  };

  const DAY = 24 * 60 * 60 * 1000;
  const past = (days: number) => new Date(Date.now() - days * DAY);
  const future = (days: number) => new Date(Date.now() + days * DAY);

  const plan = {
    id: 7,
    name: 'Growth Plan',
    code: 'GROWTH',
    monthlyPrice: 10000,
    yearlyPrice: 100000,
  };

  const accountActiveCustomer = (subscriptions: any[]) => ({
    id: 900,
    name: 'Test Hotel',
    companyName: 'Test Hotel',
    isActive: true,
    assignedEmployeeId: 1,
    createdByEmployeeId: 1,
    subscriptions,
    works: [],
    leads: [],
    tasks: [],
    _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
  });

  const listOne = async (subscriptions: any[]) => {
    mockPrisma.customer.findMany.mockResolvedValue([accountActiveCustomer(subscriptions)]);
    mockPrisma.lead.findMany.mockResolvedValue([]);
    const res = await customerService.findAll({ status: 'ALL' }, adminViewer);
    expect(res.items).toHaveLength(1);
    return res.items[0] as any;
  };

  const expectNoActivePlan = (item: any) => {
    expect(item.plan).toBe('No Active Plan');
    expect(item.planName).toBe('No Active Plan');
    expect(item.subscriptionStatus).toBe('NO_PLAN');
    expect(item.subscriptionStartDate).toBeNull();
    expect(item.subscriptionEndDate).toBeNull();
    expect(item.subscriptionAmount).toBe(0);
    // Account flag alone must not make the customer look subscribed.
    expect(item.customerStatus).toBe('INACTIVE');
    expect(item.status).toBe('INACTIVE');
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

  it('active paid subscription shows plan, billing cycle, amount and validity', async () => {
    const startDate = past(10);
    const endDate = future(355);
    const item = await listOne([
      { id: 1, status: 'ACTIVE', billingCycle: 'YEARLY', startDate, endDate, planId: plan.id, plan },
    ]);

    expect(item.plan).toBe('Growth Plan');
    expect(item.planCode).toBe('GROWTH');
    expect(item.billingCycle).toBe('YEARLY');
    expect(item.subscriptionStatus).toBe('ACTIVE');
    expect(item.subscriptionStartDate).toEqual(startDate);
    expect(item.subscriptionEndDate).toEqual(endDate);
    expect(item.baseAmount).toBe(100000);
    expect(item.subscriptionAmount).toBeGreaterThan(0);
    expect(item.customerStatus).toBe('ACTIVE');
  });

  it('account-active customer without any subscription keeps "No Active Plan"', async () => {
    expectNoActivePlan(await listOne([]));
  });

  it('pending-payment subscription is not shown as an active plan', async () => {
    expectNoActivePlan(
      await listOne([
        { id: 2, status: 'PENDING', billingCycle: 'MONTHLY', startDate: past(1), endDate: future(29), planId: plan.id, plan },
      ]),
    );
  });

  it('expired subscription is not shown as an active plan', async () => {
    expectNoActivePlan(
      await listOne([
        { id: 3, status: 'ACTIVE', billingCycle: 'MONTHLY', startDate: past(40), endDate: past(10), planId: plan.id, plan },
        { id: 4, status: 'EXPIRED', billingCycle: 'MONTHLY', startDate: past(80), endDate: past(50), planId: plan.id, plan },
      ]),
    );
  });

  it('multiple historical subscriptions resolve to the current active one', async () => {
    const startDate = past(5);
    const endDate = future(25);
    const otherPlan = { ...plan, id: 8, name: 'Starter Plan', code: 'STARTER' };
    const item = await listOne([
      { id: 13, status: 'PENDING', billingCycle: 'YEARLY', startDate: future(25), endDate: future(390), planId: otherPlan.id, plan: otherPlan },
      { id: 12, status: 'ACTIVE', billingCycle: 'MONTHLY', startDate, endDate, planId: plan.id, plan },
      { id: 11, status: 'EXPIRED', billingCycle: 'MONTHLY', startDate: past(65), endDate: past(35), planId: otherPlan.id, plan: otherPlan },
      { id: 10, status: 'CANCELED', billingCycle: 'MONTHLY', startDate: past(120), endDate: past(90), planId: otherPlan.id, plan: otherPlan },
    ]);

    expect(item.plan).toBe('Growth Plan');
    expect(item.billingCycle).toBe('MONTHLY');
    expect(item.subscriptionStatus).toBe('ACTIVE');
    expect(item.subscriptionStartDate).toEqual(startDate);
    expect(item.subscriptionEndDate).toEqual(endDate);
    expect(item.baseAmount).toBe(10000);
    expect(item.customerStatus).toBe('ACTIVE');
  });
});
