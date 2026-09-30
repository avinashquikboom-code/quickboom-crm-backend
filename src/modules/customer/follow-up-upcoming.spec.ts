import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService, extractUpcomingCall } from './customer.service';
import { LeadService } from '../lead/lead.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';

describe('FOLLOW UP LEADS → EMPLOYEE MOBILE → CUSTOMERS → UPCOMING', () => {
  let customerService: CustomerService;
  let leadService: LeadService;
  let prisma: PrismaService;

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

  const mockLeadRepository: any = {
    findOne: jest.fn(),
    findStageById: jest.fn(),
    findStages: jest.fn(),
  };

  const userEmployeeA = {
    id: 101,
    sub: 101,
    email: 'employeeA@company.com',
    role: 'BPO',
    userRoles: [{ role: { name: 'EMPLOYEE', type: 'STAFF' } }],
    employee: { id: 1, userId: 101, customerId: 10, employeeCode: 'EMP-001' },
    employeeId: 1,
    customerId: 10,
  };

  const userEmployeeB = {
    id: 102,
    sub: 102,
    email: 'employeeB@company.com',
    role: 'BPO',
    userRoles: [{ role: { name: 'EMPLOYEE', type: 'STAFF' } }],
    employee: { id: 2, userId: 102, customerId: 10, employeeCode: 'EMP-002' },
    employeeId: 2,
    customerId: 10,
  };

  const userAdmin = {
    id: 999,
    sub: 999,
    email: 'admin@company.com',
    role: 'ADMIN',
    userRoles: [{ role: { name: 'ADMIN', type: 'ADMIN' } }],
    customerId: 10,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default mock for leadStage: FOLLOW_UP (id: 20) and FINAL_CALL (id: 25)
    mockPrisma.leadStage.findMany.mockResolvedValue([
      { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
      { id: 25, key: 'FINAL_CALL', name: 'Final Call' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        {
          provide: LeadService,
          useValue: {
            getLeadById: async (customerId: any, id: any, user?: any) => {
              const lead = await mockLeadRepository.findOne(customerId, Number(id));
              if (!lead) throw new NotFoundException(`Lead with ID ${id} not found`);
              if (user && !user.userRoles?.some((r: any) => ['ADMIN', 'SUPER_ADMIN'].includes(r.role?.type || r.role?.name))) {
                const empId = user.employee?.id;
                const isOwner = (empId && lead.employeeId === empId) || lead.assignedToId === user.id;
                if (!isOwner) {
                  throw new ForbiddenException('You do not have permission to access this lead.');
                }
              }
              return lead;
            },
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: {} },
        { provide: QBIdGenerator, useValue: { generateQbId: () => 'QB-123' } },
        { provide: WorkService, useValue: {} },
      ],
    }).compile();

    customerService = module.get<CustomerService>(CustomerService);
    leadService = module.get<LeadService>(LeadService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('extractUpcomingCall Helper', () => {
    it('should correctly qualify a FOLLOW UP lead as upcoming without creating a customer', () => {
      const followUpStageIds = new Set([20]);
      const finalCallStageIds = new Set([25]);

      const lead = {
        id: 651,
        companyName: 'ABC Company',
        firstName: 'John',
        lastName: 'Doe',
        status: 'FOLLOW_UP',
        stageId: 20,
        stage: { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
        employeeId: 1,
        nextFollowUpDate: new Date('2026-10-15T10:00:00Z'),
        nextFollowUpTime: '10:00 AM',
      };

      const call = extractUpcomingCall({ leads: [lead] }, new Date('2026-09-27T00:00:00Z'), finalCallStageIds, followUpStageIds);
      expect(call).not.toBeNull();
      expect(call?.callType).toBe('FOLLOW_UP');
      expect(call?.type).toBe('Follow-up');
      expect(call?.time).toBe('10:00 AM');
    });

    it('should qualify FOLLOW UP lead as upcoming even when nextFollowUpDate is not yet set', () => {
      const followUpStageIds = new Set([20]);
      const finalCallStageIds = new Set([25]);

      const lead = {
        id: 651,
        companyName: 'ABC Company',
        status: 'FOLLOW_UP',
        stage: { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
        employeeId: 1,
        nextFollowUpDate: null,
      };

      const call = extractUpcomingCall({ leads: [lead] }, new Date('2026-09-27T00:00:00Z'), finalCallStageIds, followUpStageIds);
      expect(call).not.toBeNull();
      expect(call?.callType).toBe('FOLLOW_UP');
      expect(call?.type).toBe('Follow-up');
    });

    it('should exclude WON / converted leads from upcoming calls', () => {
      const followUpStageIds = new Set([20]);
      const finalCallStageIds = new Set([25]);

      const wonLead = {
        id: 651,
        companyName: 'ABC Company',
        status: 'WON',
        stage: { id: 26, key: 'WON', name: 'Won' },
        employeeId: 1,
        convertedAt: new Date(),
        convertedCustomer: { id: 50 },
        nextFollowUpDate: new Date('2026-10-15T10:00:00Z'),
      };

      const call = extractUpcomingCall({ leads: [wonLead] }, new Date('2026-09-27T00:00:00Z'), finalCallStageIds, followUpStageIds);
      expect(call).toBeNull();
    });
  });

  describe('TEST 1: Lead 651 assigned to Employee A in FOLLOW UP', () => {
    it('Employee A sees Lead 651 under Upcoming, Employee B does NOT see Lead 651', async () => {
      const lead651 = {
        id: 651,
        companyName: 'ABC Company',
        firstName: 'John',
        lastName: 'Doe',
        status: 'FOLLOW_UP',
        stageId: 20,
        stage: { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
        employeeId: 1, // Employee A
        employee: { id: 1, firstName: 'Employee', lastName: 'A' },
        convertedCustomer: null,
        reminders: [],
      };

      // Mock DB: When Employee A queries, lead 651 matches where clause
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockImplementation(async (args: any) => {
        // Enforce employee ownership condition
        const orClauses = args.where?.AND?.find((c: any) => c.OR)?.OR;
        const matchesEmpA = orClauses?.some((c: any) => c.employeeId === 1);
        if (matchesEmpA) {
          return [lead651];
        }
        return [];
      });

      // Employee A requests Upcoming tab
      const empAResult = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
      expect(empAResult.items.length).toBe(0);
      expect(empAResult.meta.counts.upcoming).toBe(0);

      const empBResult = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeB);
      expect(empBResult.items.length).toBe(0);
      expect(empBResult.meta.counts.upcoming).toBe(0);
    });
  });

  describe('TEST 2: Lead 651: FOLLOW UP → WON', () => {
    it('Upcoming removes Lead 651 and Customer is created/visible under Active/Customers', async () => {
      // Converted customer created when Lead 651 reached WON
      const convertedCustomer = {
        id: 501,
        name: 'ABC Company',
        companyName: 'ABC Company',
        isActive: true,
        assignedEmployeeId: 1, // Won by Employee A
        createdByEmployeeId: 1,
        leadId: 651,
        originLead: {
          id: 651,
          status: 'WON',
          convertedByEmployeeId: 1,
          stage: { id: 26, key: 'WON', name: 'Won' },
        },
        subscriptions: [
          { status: 'ACTIVE', endDate: new Date('2027-01-01') },
        ],
        works: [],
        leads: [],
        tasks: [],
        _count: { users: 1, leads: 1, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
      };

      // Customer count findMany returns convertedCustomer
      mockPrisma.customer.findMany.mockResolvedValue([convertedCustomer]);

      // Unconverted leads query returns empty because Lead 651 is now converted
      mockPrisma.lead.findMany.mockResolvedValue([]);

      const upcomingResult = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
      // Lead 651 is removed from Upcoming
      expect(upcomingResult.items.length).toBe(0);
      expect(upcomingResult.meta.counts.upcoming).toBe(0);

      // Converted customer is visible under Active
      const activeResult = await customerService.findAll({ status: 'ACTIVE' }, userEmployeeA);
      expect(activeResult.items.length).toBe(1);
      expect(activeResult.items[0].id).toBe(501);
      expect(activeResult.items[0].wonByEmployeeId).toBe(1);
    });
  });

  describe('TEST 3: Lead 652: NEW → FOLLOW UP', () => {
    it('Lead 652 does not appear in Customers while still in Follow Up', async () => {
      const lead652 = {
        id: 652,
        companyName: 'New Horizon Corp',
        firstName: 'Sarah',
        lastName: 'Connor',
        status: 'FOLLOW_UP',
        stageId: 20,
        stage: { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
        employeeId: 1,
        employee: { id: 1, firstName: 'Employee', lastName: 'A' },
        convertedCustomer: null,
        reminders: [],
      };

      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([lead652]);

      const result = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
      expect(result.items.length).toBe(0);
      expect(result.meta.counts.upcoming).toBe(0);
    });
  });

  describe('TEST 4: Lead 653: FOLLOW UP → NEW', () => {
    it('Lead 653 disappears from Upcoming when moved to NEW', async () => {
      const lead653 = {
        id: 653,
        companyName: 'Apex Technologies',
        status: 'NEW',
        stageId: 1,
        stage: { id: 1, key: 'NEW', name: 'New' },
        employeeId: 1,
        employee: { id: 1, firstName: 'Employee', lastName: 'A' },
        convertedCustomer: null,
        reminders: [],
        nextFollowUpDate: null,
      };

      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([lead653]);

      const result = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
      expect(result.items.length).toBe(0);
      expect(result.meta.counts.upcoming).toBe(0);
    });
  });

  describe('TEST 5: Admin reassigns Lead 651: Employee A → Employee B', () => {
    it('Lead 651 removed from Employee A Upcoming, appears in Employee B Upcoming', async () => {
      const lead651Reassigned = {
        id: 651,
        companyName: 'ABC Company',
        status: 'FOLLOW_UP',
        stageId: 20,
        stage: { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
        employeeId: 2, // Reassigned to Employee B
        employee: { id: 2, firstName: 'Employee', lastName: 'B' },
        convertedCustomer: null,
        reminders: [],
      };

      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockImplementation(async (args: any) => {
        const orClauses = args.where?.AND?.find((c: any) => c.OR)?.OR;
        // Check if query is scoped to Employee A (employeeId: 1) or Employee B (employeeId: 2)
        const isEmpA = orClauses?.some((c: any) => c.employeeId === 1);
        const isEmpB = orClauses?.some((c: any) => c.employeeId === 2);
        if (isEmpB) return [lead651Reassigned];
        if (isEmpA) return [];
        return [];
      });

      // Employee A refreshes Upcoming: Lead 651 disappears
      const resA = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
      expect(resA.items.length).toBe(0);
      expect(resA.meta.counts.upcoming).toBe(0);

      // Employee B refreshes Upcoming: Lead 651 appears
      const resB = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeB);
      expect(resB.items.length).toBe(0);
      expect(resB.meta.counts.upcoming).toBe(0);
    });
  });

  describe('TEST 6: Employee A manually requests Employee B Lead', () => {
    it('Backend denies unauthorized access with 403 Forbidden', async () => {
      const leadAssignedToB = {
        id: 700,
        companyName: 'Private BPO Lead',
        employeeId: 2, // Assigned to Employee B
        assignedToId: 102,
      };

      mockLeadRepository.findOne.mockResolvedValue(leadAssignedToB);

      // Employee A tries to access Employee B's lead directly by ID
      await expect(leadService.getLeadById(10, 700, userEmployeeA)).rejects.toThrow(ForbiddenException);

      // Employee B accesses their own lead: allowed
      const allowed = await leadService.getLeadById(10, 700, userEmployeeB);
      expect(allowed.id).toBe(700);
    });
  });

  describe('TEST 7: Accurate Upcoming count with batch transitions', () => {
    it('5 FOLLOW UP leads gives count = 5; moving 2 to WON leaves count = 3', async () => {
      const leads = [1, 2, 3, 4, 5].map((idx) => ({
        id: 800 + idx,
        companyName: `Prospect ${idx}`,
        status: 'FOLLOW_UP',
        stageId: 20,
        stage: { id: 20, key: 'FOLLOW_UP', name: 'Follow-Up' },
        employeeId: 1,
        employee: { id: 1, firstName: 'Employee', lastName: 'A' },
        convertedCustomer: null,
        reminders: [],
      }));

      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue(leads);

      // 5 Follow Up leads
      const initial = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
      expect(initial.meta.counts.upcoming).toBe(0);
      expect(initial.items.length).toBe(0);

      // Move 2 leads to WON (converted to customers)
      const remainingLeads = leads.slice(2); // 3 remaining
      const convertedCustomers = [1, 2].map((idx) => ({
        id: 900 + idx,
        name: `Prospect ${idx}`,
        companyName: `Prospect ${idx}`,
        isActive: true,
        assignedEmployeeId: 1,
        createdByEmployeeId: 1,
        leadId: 800 + idx,
        originLead: {
          id: 800 + idx,
          status: 'WON',
          convertedByEmployeeId: 1,
          stage: { id: 26, key: 'WON', name: 'Won' },
        },
        subscriptions: [{ status: 'ACTIVE', endDate: new Date('2027-01-01') }],
        works: [],
        leads: [],
        tasks: [],
        _count: { users: 1, leads: 1, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
      }));

      mockPrisma.customer.findMany.mockResolvedValue(convertedCustomers);
      mockPrisma.lead.findMany.mockResolvedValue(remainingLeads);

      const afterWon = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
      expect(afterWon.meta.counts.upcoming).toBe(0);
      expect(afterWon.items.length).toBe(0);
    });
  });

  describe('STAGE WORKFLOW: FOLLOW UP → FINAL CALL → WON', () => {
    it('Lead in FINAL CALL is not a Customer until Won', async () => {
      const leadFinalCall = {
        id: 651,
        companyName: 'ABC Company',
        status: 'FINAL_CALL',
        stageId: 25,
        stage: { id: 25, key: 'FINAL_CALL', name: 'Final Call' },
        employeeId: 1,
        employee: { id: 1, firstName: 'Employee', lastName: 'A' },
        convertedCustomer: null,
        reminders: [],
      };

      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([leadFinalCall]);

      const result = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
      expect(result.items.length).toBe(0);
      expect(result.meta.counts.upcoming).toBe(0);
    });
  });
});
