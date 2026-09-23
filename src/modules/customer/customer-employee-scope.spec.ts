import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';
import { RoleType } from '@prisma/client';

describe('CustomerService — Employee Scoping & CRM Filter Tests (Tests 1–10)', () => {
  let service: CustomerService;
  let prisma: any;

  // Mock employee objects
  const employeeA = { id: 101, firstName: 'Employee', lastName: 'A', customerId: 1, userId: 201 };
  const employeeB = { id: 102, firstName: 'Employee', lastName: 'B', customerId: 1, userId: 202 };

  // Mock user JWT payloads
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

  // Mock Customer Records
  // Customer A: Assigned to Employee A, last call completed, next call scheduled tomorrow
  const customerA = {
    id: 11,
    name: 'Customer A Delhi Branch',
    companyName: 'Delhi Retailers',
    city: 'Delhi',
    isActive: true,
    assignedEmployeeId: 101,
    assignedEmployee: 'Employee A',
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-01'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 501,
        status: 'FOLLOW_UP',
        nextFollowUpDate: new Date(Date.now() + 86400000), // tomorrow
        stage: { id: 3, name: 'Follow-up', key: 'FOLLOW_UP' },
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer B: Created by Employee A, last call completed, NO next call scheduled
  const customerB = {
    id: 12,
    name: 'Customer B Tech',
    companyName: 'B Tech Solutions',
    city: 'Mumbai',
    isActive: true,
    assignedEmployeeId: null,
    assignedEmployee: null,
    createdByEmployeeId: 101,
    createdAt: new Date('2026-09-02'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 502,
        status: 'CONTACTED',
        nextFollowUpDate: null, // NO next call
        stage: { id: 2, name: 'Contacted', key: 'CONTACTED' },
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer C: Assigned to Employee B
  const customerC = {
    id: 13,
    name: 'Customer C Global',
    companyName: 'C Global Corp',
    city: 'Delhi',
    isActive: true,
    assignedEmployeeId: 102,
    assignedEmployee: 'Employee B',
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-03'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 503,
        status: 'NEW',
        nextFollowUpDate: null,
        stage: { id: 1, name: 'New', key: 'NEW' },
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 0, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer D: Assigned to Employee A, Lead WON
  const customerDWon = {
    id: 14,
    name: 'Customer D Won Deal',
    companyName: 'D Industries',
    city: 'Bengaluru',
    isActive: true,
    assignedEmployeeId: 101,
    assignedEmployee: 'Employee A',
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-04'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 504,
        status: 'WON',
        nextFollowUpDate: null,
        stage: { id: 12, name: 'Won', key: 'WON' },
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 1, contacts: 1, tasks: 0, tickets: 0 },
  };

  // Customer E: Assigned to Employee B, Lead WON
  const customerEWon = {
    id: 15,
    name: 'Customer E Won Deal',
    companyName: 'E Enterprises',
    city: 'Kolkata',
    isActive: true,
    assignedEmployeeId: 102,
    assignedEmployee: 'Employee B',
    createdByEmployeeId: null,
    createdAt: new Date('2026-09-05'),
    subscriptions: [],
    works: [],
    tasks: [],
    leads: [
      {
        id: 505,
        status: 'WON',
        nextFollowUpDate: null,
        stage: { id: 12, name: 'Won', key: 'WON' },
        reminders: [],
      },
    ],
    _count: { users: 1, leads: 1, deals: 1, contacts: 1, tasks: 0, tickets: 0 },
  };

  const allMockCustomers = [customerA, customerB, customerC, customerDWon, customerEWon];

  beforeEach(async () => {
    prisma = {
      customer: {
        findMany: jest.fn().mockImplementation((args: any) => {
          let list = [...allMockCustomers];

          // Check if employee scoping applied in where.AND
          if (args?.where?.AND) {
            for (const cond of args.where.AND) {
              if (cond.OR) {
                // Check if this OR condition is the employee scope
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

          // Search filter
          if (args?.where?.AND) {
            for (const cond of args.where.AND) {
              if (cond.OR && cond.OR.some((c: any) => c.name?.contains)) {
                const searchStr = cond.OR.find((c: any) => c.name?.contains).name.contains.toLowerCase();
                list = list.filter((item) =>
                  item.name.toLowerCase().includes(searchStr) ||
                  item.companyName.toLowerCase().includes(searchStr) ||
                  item.city.toLowerCase().includes(searchStr),
                );
              }
            }
          }

          return list;
        }),
        count: jest.fn().mockImplementation((args: any) => {
          return 5;
        }),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        $transaction: jest.fn().mockImplementation(async (cb: any) => cb(prisma)),
      },
      team: { findUnique: jest.fn() },
      employee: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 101) return employeeA;
          if (where.id === 102) return employeeB;
          return null;
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

  // TEST 1 — ADMIN ASSIGNMENT
  it('TEST 1: Admin assigned Customer A to Employee A -> visible to Employee A, hidden from Employee B', async () => {
    const resA = await service.findAll({ status: 'ALL' }, userA);
    const hasCustAforEmpA = resA.items.some((c) => c.id === customerA.id);
    expect(hasCustAforEmpA).toBe(true);

    const resB = await service.findAll({ status: 'ALL' }, userB);
    const hasCustAforEmpB = resB.items.some((c) => c.id === customerA.id);
    expect(hasCustAforEmpB).toBe(false);
  });

  // TEST 2 — EMPLOYEE CREATION
  it('TEST 2: Employee A created Customer B -> visible to Employee A, hidden from Employee B', async () => {
    const resA = await service.findAll({ status: 'ALL' }, userA);
    const hasCustBforEmpA = resA.items.some((c) => c.id === customerB.id);
    expect(hasCustBforEmpA).toBe(true);

    const resB = await service.findAll({ status: 'ALL' }, userB);
    const hasCustBforEmpB = resB.items.some((c) => c.id === customerB.id);
    expect(hasCustBforEmpB).toBe(false);
  });

  // TEST 3 — OTHER EMPLOYEE
  it('TEST 3: Customer C assigned to Employee B -> Customer C is NOT visible to Employee A', async () => {
    const resA = await service.findAll({ status: 'ALL' }, userA);
    const hasCustCforEmpA = resA.items.some((c) => c.id === customerC.id);
    expect(hasCustCforEmpA).toBe(false);
  });

  // TEST 4 — ALL FILTER
  it('TEST 4: Employee A -> All filter returns ONLY Employee A accessible customers (Customer A, B, D), NOT Customer C or E', async () => {
    const resA = await service.findAll({ status: 'ALL' }, userA);
    const ids = resA.items.map((c) => c.id);
    expect(ids).toContain(customerA.id);
    expect(ids).toContain(customerB.id);
    expect(ids).toContain(customerDWon.id);
    expect(ids).not.toContain(customerC.id);
    expect(ids).not.toContain(customerEWon.id);
  });

  // TEST 5 — UPCOMING (NEXT CALL SCHEDULED)
  it('TEST 5: Customer A with next call scheduled tomorrow -> appears under Upcoming for Employee A', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const upcomingIds = res.items.map((c) => c.id);
    expect(upcomingIds).toContain(customerA.id);
  });

  // TEST 6 — NO UPCOMING (PAST CALL ONLY, NO NEXT CALL)
  it('TEST 6: Customer B with completed call and NO next call -> does NOT appear under Upcoming', async () => {
    const res = await service.findAll({ status: 'UPCOMING' }, userA);
    const upcomingIds = res.items.map((c) => c.id);
    expect(upcomingIds).not.toContain(customerB.id);
  });

  // TEST 7 — WON (COMPLETED FILTER)
  it('TEST 7: Lead assigned to Employee A with stage WON -> appears under Completed for Employee A', async () => {
    const res = await service.findAll({ status: 'COMPLETED' }, userA);
    const completedIds = res.items.map((c) => c.id);
    expect(completedIds).toContain(customerDWon.id);
  });

  // TEST 8 — WON OTHER EMPLOYEE
  it('TEST 8: Lead B assigned to Employee B with stage WON -> NOT visible to Employee A under Completed', async () => {
    const res = await service.findAll({ status: 'COMPLETED' }, userA);
    const completedIds = res.items.map((c) => c.id);
    expect(completedIds).not.toContain(customerEWon.id);
  });

  // TEST 9 — SEARCH RESPECTS EMPLOYEE SCOPE
  it('TEST 9: Employee A searches "Delhi" -> only Employee A matching customers returned (Customer A), NOT Employee B Customer C', async () => {
    const res = await service.findAll({ search: 'Delhi', status: 'ALL' }, userA);
    const ids = res.items.map((c) => c.id);
    expect(ids).toContain(customerA.id);
    expect(ids).not.toContain(customerC.id);
  });

  // TEST 10 — LOGOUT / EMPLOYEE SWITCH
  it('TEST 10: Switching between Employee A and Employee B completely isolates customer lists and counts', async () => {
    const resA = await service.findAll({ status: 'ALL' }, userA);
    const resB = await service.findAll({ status: 'ALL' }, userB);

    const idsA = new Set(resA.items.map((c) => c.id));
    const idsB = new Set(resB.items.map((c) => c.id));

    // Intersection must be empty (strict employee isolation)
    const intersection = [...idsA].filter((id) => idsB.has(id));
    expect(intersection).toEqual([]);

    // Counts must be employee-specific
    expect(resA.meta.counts.all).toBe(3); // A, B, D
    expect(resB.meta.counts.all).toBe(2); // C, E
  });
});
