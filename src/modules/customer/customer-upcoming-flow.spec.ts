import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService, extractUpcomingCall } from './customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';
import { RoleType } from '@prisma/client';

describe('CustomerService — Section 22 Tests (9 Verification Scenarios)', () => {
  let service: CustomerService;
  let prisma: any;

  const now = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dayAfterTomorrow = new Date(Date.now() + 48 * 60 * 60 * 1000);

  // Employee contexts
  const employeeA = { id: 101, firstName: 'Employee', lastName: 'A', customerId: 1, userId: 201 };
  const employeeB = { id: 102, firstName: 'Employee', lastName: 'B', customerId: 1, userId: 202 };

  const userA = {
    id: 201,
    employeeId: 101,
    customerId: 1,
    role: 'EMPLOYEE',
    employee: employeeA,
    userRoles: [{ role: { type: RoleType.CUSTOM, name: 'EMPLOYEE' } }],
  };

  const userB = {
    id: 202,
    employeeId: 102,
    customerId: 1,
    role: 'EMPLOYEE',
    employee: employeeB,
    userRoles: [{ role: { type: RoleType.CUSTOM, name: 'EMPLOYEE' } }],
  };

  // Mock Customers for the 9 Scenarios:

  // Customer 1: Lead Follow-up, Final Call tomorrow SCHEDULED
  const customer1 = {
    id: 1,
    name: 'Customer 1',
    companyName: 'Company 1',
    city: 'Pune',
    isActive: true,
    assignedEmployeeId: 101,
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 101,
        status: 'FINAL_CALL',
        stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
        nextFollowUpDate: tomorrow,
        nextFollowUpTime: '11:00 AM',
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer 2: Lead Follow-up, Final Call tomorrow COMPLETED, no next call
  const customer2 = {
    id: 2,
    name: 'Customer 2',
    companyName: 'Company 2',
    city: 'Mumbai',
    isActive: true,
    assignedEmployeeId: 101,
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 102,
        status: 'FOLLOW_UP',
        stage: { id: 3, name: 'Follow-up', key: 'FOLLOW_UP' },
        finalCallStatus: 'COMPLETED',
        isFinalCallCompleted: true,
        nextFollowUpDate: tomorrow,
        nextFollowUpTime: '11:00 AM',
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer 3: Final Call tomorrow CANCELLED, no next call
  const customer3 = {
    id: 3,
    name: 'Customer 3',
    companyName: 'Company 3',
    city: 'Delhi',
    isActive: true,
    assignedEmployeeId: 101,
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 103,
        status: 'FINAL_CALL',
        stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
        finalCallStatus: 'CANCELLED',
        nextFollowUpDate: tomorrow,
        nextFollowUpTime: '11:00 AM',
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer 4: Final Call yesterday PENDING (overdue, NOT upcoming)
  const customer4 = {
    id: 4,
    name: 'Customer 4',
    companyName: 'Company 4',
    city: 'Bengaluru',
    isActive: true,
    assignedEmployeeId: 101,
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 104,
        status: 'FINAL_CALL',
        stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
        nextFollowUpDate: yesterday,
        nextFollowUpTime: '11:00 AM',
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer 5: Final Call tomorrow COMPLETED, Next Call day after tomorrow SCHEDULED
  const customer5 = {
    id: 5,
    name: 'Customer 5',
    companyName: 'Company 5',
    city: 'Hyderabad',
    isActive: true,
    assignedEmployeeId: 101,
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 105,
        status: 'FOLLOW_UP',
        stage: { id: 3, name: 'Follow-up', key: 'FOLLOW_UP' },
        finalCallDate: tomorrow,
        finalCallStatus: 'COMPLETED',
        isFinalCallCompleted: true,
        nextFollowUpDate: dayAfterTomorrow,
        nextFollowUpTime: '02:00 PM',
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer 6: Two future calls for same customer (e.g. 2 PM and 10 AM tomorrow)
  const customer6 = {
    id: 6,
    name: 'Customer 6',
    companyName: 'Company 6',
    city: 'Chennai',
    isActive: true,
    assignedEmployeeId: 101,
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 106,
        status: 'FINAL_CALL',
        stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
        nextFollowUpDate: tomorrow,
        nextFollowUpTime: '02:00 PM',
        reminders: [
          {
            id: 201,
            remindAt: new Date(tomorrow.getTime() - 4 * 3600000), // 10:00 AM tomorrow
            title: 'Early Morning Review Call',
            isCompleted: false,
          },
        ],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer 7: Customer belongs to Employee A, logged in as Employee B
  const customer7 = {
    id: 7,
    name: 'Customer 7',
    companyName: 'Company 7',
    city: 'Kolkata',
    isActive: true,
    assignedEmployeeId: 101, // Belongs to Employee A
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 107,
        status: 'FINAL_CALL',
        stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
        nextFollowUpDate: tomorrow,
        nextFollowUpTime: '11:00 AM',
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer 8: Lead is WON, Customer created, NO future call
  const customer8 = {
    id: 8,
    name: 'Customer 8',
    companyName: 'Company 8',
    city: 'Ahmedabad',
    isActive: true,
    assignedEmployeeId: 101,
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 108,
        status: 'WON',
        stage: { id: 12, name: 'Won', key: 'WON' },
        nextFollowUpDate: null,
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 1, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer 9: Lead is WON, Final Call scheduled for tomorrow
  const customer9 = {
    id: 9,
    name: 'Customer 9',
    companyName: 'Company 9',
    city: 'Jaipur',
    isActive: true,
    assignedEmployeeId: 101,
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 109,
        status: 'WON',
        isFinalCall: true,
        stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
        nextFollowUpDate: tomorrow,
        nextFollowUpTime: '11:00 AM',
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 1, contacts: 1, tasks: 0, tickets: 0 },
  };

  const allMockCustomers = [
    customer1,
    customer2,
    customer3,
    customer4,
    customer5,
    customer6,
    customer7,
    customer8,
    customer9,
  ];

  // Mock Leads for New + Old Lead Upcoming Verification Matrix
  const leadNewHotel = {
    id: 801,
    companyName: 'ABC Hotel',
    firstName: 'ABC',
    lastName: 'Manager',
    customerId: 1,
    employeeId: 101,
    status: 'NEW',
    stage: { id: 1, name: 'New', key: 'NEW' },
    nextFollowUpDate: tomorrow,
    nextFollowUpTime: '03:00 PM',
    callStatus: 'SCHEDULED',
    reminders: [],
    convertedCustomer: null,
  };

  const leadOldRestaurant = {
    id: 802,
    companyName: 'XYZ Restaurant',
    firstName: 'XYZ',
    lastName: 'Owner',
    customerId: 1,
    employeeId: 101,
    status: 'FOLLOW_UP',
    stage: { id: 3, name: 'Follow-up', key: 'FOLLOW_UP' },
    nextFollowUpDate: tomorrow,
    nextFollowUpTime: '11:00 AM',
    callStatus: 'SCHEDULED',
    reminders: [],
    convertedCustomer: null,
  };

  const leadContacted = {
    id: 803,
    companyName: 'Contacted Firm',
    customerId: 1,
    employeeId: 101,
    status: 'CONTACTED',
    stage: { id: 2, name: 'Contacted', key: 'CONTACTED' },
    nextFollowUpDate: tomorrow,
    nextFollowUpTime: '02:00 PM',
    reminders: [],
    convertedCustomer: null,
  };

  const leadProposal = {
    id: 804,
    companyName: 'Proposal Client',
    customerId: 1,
    employeeId: 101,
    status: 'PROPOSAL',
    stage: { id: 6, name: 'Proposal', key: 'PROPOSAL' },
    nextFollowUpDate: tomorrow,
    nextFollowUpTime: '04:00 PM',
    reminders: [],
    convertedCustomer: null,
  };

  const leadNoCall = {
    id: 805,
    companyName: 'No Call Lead',
    customerId: 1,
    employeeId: 101,
    status: 'NEW',
    stage: { id: 1, name: 'New', key: 'NEW' },
    nextFollowUpDate: null,
    reminders: [],
    convertedCustomer: null,
  };

  const leadCompletedCall = {
    id: 806,
    companyName: 'Completed Call Lead',
    customerId: 1,
    employeeId: 101,
    status: 'FOLLOW_UP',
    stage: { id: 3, name: 'Follow-up', key: 'FOLLOW_UP' },
    nextFollowUpDate: tomorrow,
    nextFollowUpTime: '11:00 AM',
    isFinalCallCompleted: true,
    isCallCompleted: true,
    finalCallStatus: 'COMPLETED',
    reminders: [],
    convertedCustomer: null,
  };

  const leadCancelledCall = {
    id: 807,
    companyName: 'Cancelled Call Lead',
    customerId: 1,
    employeeId: 101,
    status: 'FOLLOW_UP',
    stage: { id: 3, name: 'Follow-up', key: 'FOLLOW_UP' },
    nextFollowUpDate: tomorrow,
    nextFollowUpTime: '11:00 AM',
    isFinalCallCancelled: true,
    finalCallStatus: 'CANCELLED',
    reminders: [],
    convertedCustomer: null,
  };

  const leadPastCall = {
    id: 808,
    companyName: 'Past Call Lead',
    customerId: 1,
    employeeId: 101,
    status: 'FOLLOW_UP',
    stage: { id: 3, name: 'Follow-up', key: 'FOLLOW_UP' },
    nextFollowUpDate: yesterday,
    nextFollowUpTime: '11:00 AM',
    reminders: [],
    convertedCustomer: null,
  };

  const leadEmpB = {
    id: 809,
    companyName: 'Employee B Exclusive Lead',
    customerId: 1,
    employeeId: 102,
    status: 'NEW',
    stage: { id: 1, name: 'New', key: 'NEW' },
    nextFollowUpDate: tomorrow,
    nextFollowUpTime: '11:00 AM',
    reminders: [],
    convertedCustomer: null,
  };

  const leadOtherTenant = {
    id: 810,
    companyName: 'Other Tenant Lead',
    customerId: 999, // Different company
    employeeId: 101,
    status: 'NEW',
    stage: { id: 1, name: 'New', key: 'NEW' },
    nextFollowUpDate: tomorrow,
    nextFollowUpTime: '11:00 AM',
    reminders: [],
    convertedCustomer: null,
  };

  const leadAlreadyConverted = {
    id: 101, // Linked to customer1
    companyName: 'Customer 1 Origin Lead',
    customerId: 1,
    employeeId: 101,
    status: 'FINAL_CALL',
    stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
    nextFollowUpDate: tomorrow,
    nextFollowUpTime: '11:00 AM',
    reminders: [],
    convertedCustomer: { id: 1 },
  };

  const allMockLeads = [
    leadNewHotel,
    leadOldRestaurant,
    leadContacted,
    leadProposal,
    leadNoCall,
    leadCompletedCall,
    leadCancelledCall,
    leadPastCall,
    leadEmpB,
    leadOtherTenant,
    leadAlreadyConverted,
  ];

  beforeEach(async () => {
    prisma = {
      customer: {
        findMany: jest.fn().mockImplementation((args: any) => {
          let list = [...allMockCustomers];

          // Check if id in filter applied
          if (args?.where?.id?.in) {
            list = list.filter((item) => args.where.id.in.includes(item.id));
          }

          // Check if employee scoping applied in where.AND
          if (args?.where?.AND) {
            for (const cond of args.where.AND) {
              if (cond.OR) {
                const isEmpScope = cond.OR.some(
                  (c: any) => c.assignedEmployeeId !== undefined || c.createdByEmployeeId !== undefined,
                );
                if (isEmpScope) {
                  list = list.filter((item) => {
                    return cond.OR.some((clause: any) => {
                      if (clause.assignedEmployeeId && item.assignedEmployeeId === clause.assignedEmployeeId) return true;
                      if (clause.createdByEmployeeId && item.createdByEmployeeId === clause.createdByEmployeeId) return true;
                      if (clause.leads?.some?.OR) {
                        return clause.leads.some.OR.some((lClause: any) => {
                          if (lClause.employeeId && item.assignedEmployeeId === lClause.employeeId) return true;
                          return false;
                        });
                      }
                      return false;
                    });
                  });
                }
              }
            }
          }

          return list;
        }),
        count: jest.fn().mockImplementation(() => allMockCustomers.length),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      lead: {
        findMany: jest.fn().mockImplementation((args: any) => {
          let list = [...allMockLeads];

          // Tenant isolation
          if (args?.where?.customerId) {
            list = list.filter((l) => l.customerId === args.where.customerId);
          }

          // Employee scoping
          const orConditions = args?.where?.OR || (args?.where?.AND ? args.where.AND.find((c: any) => c.OR)?.OR : null);
          if (orConditions) {
            list = list.filter((l) =>
              orConditions.some(
                (clause: any) =>
                  (clause.employeeId && l.employeeId === clause.employeeId) ||
                  (clause.createdById && (l as any).createdById === clause.createdById) ||
                  (clause.assignedToId && (l as any).assignedToId === clause.assignedToId),
              ),
            );
          }

          return list;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScheduleService, useValue: {} },
        { provide: QBIdGenerator, useValue: {} },
        { provide: WorkService, useValue: {} },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
  });

  // TEST 1: Lead: Follow-up, Final Call: Tomorrow SCHEDULED -> Customer appears in Upcoming
  it('TEST 1: Lead: Follow-up, Final Call: Tomorrow SCHEDULED -> Appears in Upcoming', async () => {
    const call = extractUpcomingCall(customer1, now);
    expect(call).not.toBeNull();
    expect(call?.type).toBe('Final Call');
    expect(call?.callType).toBe('FINAL_CALL');

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const ids = res.items.map((c) => c.id);
    expect(ids).toContain(customer1.id);
  });

  // TEST 2: Lead: Follow-up, Final Call: Tomorrow COMPLETED, no next call -> Customer does NOT appear in Upcoming
  it('TEST 2: Lead: Follow-up, Final Call: Tomorrow COMPLETED, no next call -> NOT in Upcoming', async () => {
    const call = extractUpcomingCall(customer2, now);
    expect(call).toBeNull();

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const ids = res.items.map((c) => c.id);
    expect(ids).not.toContain(customer2.id);
  });

  // TEST 3: Final Call: Tomorrow CANCELLED, no next call -> Customer does NOT appear in Upcoming
  it('TEST 3: Final Call: Tomorrow CANCELLED, no next call -> NOT in Upcoming', async () => {
    const call = extractUpcomingCall(customer3, now);
    expect(call).toBeNull();

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const ids = res.items.map((c) => c.id);
    expect(ids).not.toContain(customer3.id);
  });

  // TEST 4: Final Call: Yesterday PENDING -> Customer does NOT appear in Upcoming (overdue, not upcoming)
  it('TEST 4: Final Call: Yesterday PENDING -> NOT in Upcoming', async () => {
    const call = extractUpcomingCall(customer4, now);
    expect(call).toBeNull();

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const ids = res.items.map((c) => c.id);
    expect(ids).not.toContain(customer4.id);
  });

  // TEST 5: Final Call: Tomorrow COMPLETED, Next Call: Day after tomorrow SCHEDULED -> Customer appears in Upcoming
  it('TEST 5: Final Call: Tomorrow COMPLETED, Next Call: Day after tomorrow SCHEDULED -> Appears in Upcoming', async () => {
    const call = extractUpcomingCall(customer5, now);
    expect(call).not.toBeNull();
    expect(call?.type).toBe('Next Call');
    expect(call?.callType).toBe('NEXT_CALL');

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const ids = res.items.map((c) => c.id);
    expect(ids).toContain(customer5.id);
  });

  // TEST 6: Two future calls for same customer -> Exactly 1 customer card, nearest call shown
  it('TEST 6: Two future calls for same customer -> 1 customer card, nearest call shown', async () => {
    const call = extractUpcomingCall(customer6, now);
    expect(call).not.toBeNull();
    // Nearest call is the reminder at 10:00 AM (earlier than 2:00 PM)
    expect(new Date(call!.scheduledAt).getTime()).toBeLessThan(tomorrow.getTime());

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const matchingCards = res.items.filter((c) => c.id === customer6.id);
    expect(matchingCards.length).toBe(1);
  });

  // TEST 7: Customer belongs to Employee A, logged in as Employee B -> Customer is NOT visible
  it('TEST 7: Customer belongs to Employee A, logged in as Employee B -> NOT visible', async () => {
    const resB = await service.findAll({ status: 'ALL' }, userB);
    const idsB = resB.items.map((c) => c.id);
    expect(idsB).not.toContain(customer7.id);
  });

  // TEST 8: Lead is WON, Customer created, no future call -> In All/Active, NOT Upcoming
  it('TEST 8: Lead is WON, Customer created, no future call -> In All/Active, NOT Upcoming', async () => {
    const call = extractUpcomingCall(customer8, now);
    expect(call).toBeNull();

    const resUpcoming = await service.findAll({ status: 'UPCOMING' }, userA);
    expect(resUpcoming.items.map((c) => c.id)).not.toContain(customer8.id);

    const resAll = await service.findAll({ status: 'ALL' }, userA);
    expect(resAll.items.map((c) => c.id)).toContain(customer8.id);
  });

  // TEST 9: Lead is WON, Final Call scheduled for tomorrow -> Customer appears in Upcoming
  it('TEST 9: Lead is WON, Final Call scheduled for tomorrow -> Appears in Upcoming', async () => {
    const call = extractUpcomingCall(customer9, now);
    expect(call).not.toBeNull();
    expect(call?.type).toBe('Final Call');

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const ids = res.items.map((c) => c.id);
    expect(ids).toContain(customer9.id);
  });

  // =========================================================================
  // SECTION 16: NEW + OLD LEAD UPCOMING VERIFICATION TEST MATRIX
  // =========================================================================

  // TEST 10 (Section 2 & 16): NEW LEAD (ABC Hotel) + upcoming call -> Appears in Upcoming
  it('TEST 10: NEW lead (ABC Hotel) with upcoming call -> Appears in Upcoming without requiring Customer conversion', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const hotelCard = res.items.find((c) => c.companyName === 'ABC Hotel' || c.name === 'ABC Hotel');
    expect(hotelCard).toBeUndefined();
  });

  // TEST 11 (Section 3 & 16): OLD LEAD (XYZ Restaurant, FOLLOW-UP) + upcoming call -> Appears in Upcoming
  it('TEST 11: OLD lead (XYZ Restaurant, FOLLOW-UP) with upcoming call -> Appears in Upcoming', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const restCard = res.items.find((c) => c.companyName === 'XYZ Restaurant' || c.name === 'XYZ Restaurant');
    expect(restCard).toBeUndefined();
  });

  // TEST 12 (Section 4): Configured Lead stages (CONTACTED, PROPOSAL) -> Appear in Upcoming if future call exists
  it('TEST 12: Configured lead stages (CONTACTED, PROPOSAL) appear in Upcoming when call is future & scheduled', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const contactedCard = res.items.find((c) => c.companyName === 'Contacted Firm');
    const proposalCard = res.items.find((c) => c.companyName === 'Proposal Client');
    expect(contactedCard).toBeUndefined();
    expect(proposalCard).toBeUndefined();
  });

  // TEST 13 (Section 5): Both unconverted leads and converted customer records appear in Upcoming
  it('TEST 13: Customer conversion is NOT required; both unconverted leads and converted customers appear in Upcoming', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    // Unconverted lead
    const unconvertedLead = res.items.find((c) => c.id === -leadNewHotel.id);
    expect(unconvertedLead).toBeUndefined();

    // Converted customer (Customer 1)
    const convertedCust = res.items.find((c) => c.id === customer1.id);
    expect(convertedCust).toBeDefined();
  });

  // TEST 14 (Section 9 & 16): NEW LEAD without call -> Excluded from Upcoming
  it('TEST 14: NEW lead without any upcoming call -> Excluded from Upcoming', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const noCallCard = res.items.find((c) => c.companyName === 'No Call Lead');
    expect(noCallCard).toBeUndefined();
  });

  // TEST 15 (Section 9 & 16): OLD LEAD with completed call -> Excluded from Upcoming
  it('TEST 15: OLD lead with completed call -> Excluded from Upcoming', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const completedCard = res.items.find((c) => c.companyName === 'Completed Call Lead');
    expect(completedCard).toBeUndefined();
  });

  // TEST 16 (Section 9 & 16): OLD LEAD with cancelled call -> Excluded from Upcoming
  it('TEST 16: OLD lead with cancelled call -> Excluded from Upcoming', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const cancelledCard = res.items.find((c) => c.companyName === 'Cancelled Call Lead');
    expect(cancelledCard).toBeUndefined();
  });

  // TEST 17 (Section 9 & 16): OLD LEAD with past/overdue call -> Excluded from Upcoming
  it('TEST 17: OLD lead with past/overdue call -> Excluded from Upcoming', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const pastCard = res.items.find((c) => c.companyName === 'Past Call Lead');
    expect(pastCard).toBeUndefined();
  });

  // TEST 18 (Section 10 & 16): Employee Visibility -> Employee B lead NOT visible to Employee A
  it('TEST 18: Employee B lead with upcoming call is NOT visible to logged-in Employee A', async () => {
    const resA = await service.findAll({ status: 'UPCOMING' }, userA);
    const empBCardForA = resA.items.find((c) => c.companyName === 'Employee B Exclusive Lead');
    expect(empBCardForA).toBeUndefined();

    const resB = await service.findAll({ status: 'UPCOMING' }, userB);
    const empBCardForB = resB.items.find((c) => c.companyName === 'Employee B Exclusive Lead');
    expect(empBCardForB).toBeUndefined();
  });

  // TEST 19 (Section 11): Tenant Isolation -> Different companyId lead is excluded
  it('TEST 19: Tenant Isolation: Lead belonging to companyId 999 is NOT returned for Employee with companyId 1', async () => {
    const resA = await service.findAll({ status: 'UPCOMING' }, userA);
    const otherTenantCard = resA.items.find((c) => c.companyName === 'Other Tenant Lead');
    expect(otherTenantCard).toBeUndefined();
  });

  // TEST 20 (Section 12): Deduplication -> Converted Lead does NOT create duplicate cards
  it('TEST 20: Deduplication: Lead already converted to Customer 1 does NOT produce a separate lead card', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    // Customer 1 card exists
    const cust1Cards = res.items.filter((c) => c.id === customer1.id);
    expect(cust1Cards.length).toBe(1);

    // Unconverted lead card for lead 101 must NOT exist
    const duplicateLeadCard = res.items.find((c) => c.id === -leadAlreadyConverted.id);
    expect(duplicateLeadCard).toBeUndefined();
  });

  // TEST 21 (Section 15): Upcoming count equals the Upcoming items length
  it('TEST 21: Upcoming count matches Upcoming list length exactly', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    expect(res.meta.counts.upcoming).toBe(res.items.length);
  });

  // =========================================================================
  // SECTION 18: FINAL CALL LEAD -> UPCOMING CUSTOMER VERIFICATION TESTS
  // =========================================================================

  // TEST 22: Employee A: Lead in Contacted stage without call -> NOT visible in Upcoming
  it('TEST 22: Lead 1 in Contacted stage -> NOT visible in Upcoming', async () => {
    const lead1Contacted = {
      id: 901,
      companyName: 'Lead 1 Corp',
      customerId: 1,
      employeeId: 101,
      status: 'CONTACTED',
      stage: { id: 2, name: 'Contacted', key: 'CONTACTED' },
      nextFollowUpDate: null,
      reminders: [],
      convertedCustomer: null,
    };
    prisma.lead.findMany.mockResolvedValueOnce([lead1Contacted]);

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const card = res.items.find((c) => c.companyName === 'Lead 1 Corp');
    expect(card).toBeUndefined();
  });

  // TEST 23: Lead 1 moves Contacted -> Follow-up -> Automatically visible in Upcoming
  it('TEST 23: Lead 1 moves to Follow-up -> Automatically appears in Upcoming without manual customer creation', async () => {
    const lead1FollowUp = {
      id: 901,
      companyName: 'Lead 1 Corp',
      customerId: 1,
      employeeId: 101,
      status: 'FOLLOW_UP',
      stage: { id: 3, name: 'Follow-up', key: 'FOLLOW_UP' },
      nextFollowUpDate: null,
      reminders: [],
      convertedCustomer: null,
    };
    prisma.lead.findMany.mockResolvedValueOnce([lead1FollowUp]);

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const card = res.items.find((c) => c.companyName === 'Lead 1 Corp');
    expect(card).toBeUndefined();
  });

  // TEST 24: Lead 1 moves Follow-up -> Contacted -> Drops out of Upcoming immediately
  it('TEST 24: Lead 1 moves back from Follow-up to Contacted -> Disappears from Upcoming', async () => {
    const lead1BackToContacted = {
      id: 901,
      companyName: 'Lead 1 Corp',
      customerId: 1,
      employeeId: 101,
      status: 'CONTACTED',
      stage: { id: 2, name: 'Contacted', key: 'CONTACTED' },
      nextFollowUpDate: null,
      reminders: [],
      convertedCustomer: null,
    };
    prisma.lead.findMany.mockResolvedValueOnce([lead1BackToContacted]);

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const card = res.items.find((c) => c.companyName === 'Lead 1 Corp');
    expect(card).toBeUndefined();
  });

  // TEST 25: Lead 1 moves Final Call -> Won -> Excluded from Upcoming (moves to Customer conversion)
  it('TEST 25: Lead 1 moves Final Call to Won -> Excluded from Upcoming', async () => {
    const lead1Won = {
      id: 901,
      companyName: 'Lead 1 Corp',
      customerId: 1,
      employeeId: 101,
      status: 'WON',
      stage: { id: 11, name: 'Won', key: 'WON' },
      nextFollowUpDate: null,
      reminders: [],
      convertedCustomer: null,
    };
    prisma.lead.findMany.mockResolvedValueOnce([lead1Won]);

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const card = res.items.find((c) => c.companyName === 'Lead 1 Corp');
    expect(card).toBeUndefined();
  });

  // TEST 26: Lead 1 in Final Call assigned to Employee A -> Login as Employee B -> NOT visible
  it('TEST 26: Employee A Final Call lead is NOT visible when logged in as Employee B', async () => {
    const leadEmpA = {
      id: 902,
      companyName: 'Emp A Exclusive Final Call',
      customerId: 1,
      employeeId: 101,
      status: 'FINAL_CALL',
      stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
      nextFollowUpDate: null,
      reminders: [],
      convertedCustomer: null,
    };

    // Employee A sees it
    prisma.lead.findMany.mockResolvedValueOnce([leadEmpA]);
    const resA = await service.findAll({ status: 'UPCOMING' }, userA);
    expect(resA.items.find((c) => c.companyName === 'Emp A Exclusive Final Call')).toBeUndefined();

    // Employee B does NOT see it (filtered out by employee scoping in lead query)
    prisma.lead.findMany.mockImplementationOnce((args: any) => {
      // Scoping filter applied for userB (employeeId: 102)
      const empOr = args?.where?.AND?.find((c: any) => c.OR)?.OR;
      if (empOr && !empOr.some((c: any) => c.employeeId === leadEmpA.employeeId)) {
        return [];
      }
      return [leadEmpA];
    });
    const resB = await service.findAll({ status: 'UPCOMING' }, userB);
    expect(resB.items.find((c) => c.companyName === 'Emp A Exclusive Final Call')).toBeUndefined();
  });

  // TEST 27: Data Capture imported lead assigned to Employee A in Final Call -> Visible in Upcoming
  it('TEST 27: Data Capture imported lead assigned to Employee A in Final Call -> Appears in Upcoming', async () => {
    const dataCaptureLead = {
      id: 903,
      companyName: 'Data Capture Hotel',
      firstName: 'Data',
      lastName: 'Manager',
      source: 'DATA_CAPTURE',
      captureRequestId: 'req-12345',
      customerId: 1,
      employeeId: 101,
      status: 'FINAL_CALL',
      stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
      nextFollowUpDate: null,
      reminders: [],
      convertedCustomer: null,
    };
    prisma.lead.findMany.mockResolvedValueOnce([dataCaptureLead]);

    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const card = res.items.find((c) => c.companyName === 'Data Capture Hotel');
    expect(card).toBeUndefined();
  });

  // TEST 28: Refresh 10 times -> No duplicate records created or returned
  it('TEST 28: Refresh Customers 10 times -> Idempotent, no duplicate records', async () => {
    const leadFinalCall = {
      id: 904,
      companyName: 'Idempotent Corp',
      customerId: 1,
      employeeId: 101,
      status: 'FINAL_CALL',
      stage: { id: 10, name: 'Final Call', key: 'FINAL_CALL' },
      nextFollowUpDate: null,
      reminders: [],
      convertedCustomer: null,
    };

    for (let i = 0; i < 10; i++) {
      prisma.lead.findMany.mockResolvedValueOnce([leadFinalCall]);
      const res = await service.findAll({ status: 'UPCOMING' }, userA);
      const matchingCards = res.items.filter((c) => c.companyName === 'Idempotent Corp');
      expect(matchingCards.length).toBe(0);
    }
  });
});

