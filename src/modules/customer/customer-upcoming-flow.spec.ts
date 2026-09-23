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

  const now = new Date('2026-09-24T10:00:00.000Z');
  const yesterday = new Date('2026-09-23T10:00:00.000Z');
  const tomorrow = new Date('2026-09-25T10:00:00.000Z');
  const dayAfterTomorrow = new Date('2026-09-26T10:00:00.000Z');

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
});
