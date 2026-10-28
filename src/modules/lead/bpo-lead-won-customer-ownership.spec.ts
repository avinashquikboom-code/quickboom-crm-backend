import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService } from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { S3Service } from '../s3/s3.service';
import { CustomerService } from '../customer/customer.service';
import { LeadStatus } from '@prisma/client';

describe('WON By BPO Employee -> Customer Ownership + Mobile Visibility', () => {
  let leadService: LeadService;
  let customerService: CustomerService;
  let mockPrisma: any;
  let mockLeadRepository: any;

  // Mock employee fixtures
  const employeeA = {
    id: 101,
    userId: 201,
    firstName: 'Rahul',
    lastName: 'Sharma',
    email: 'rahul.sharma@bpo.com',
    status: 'ACTIVE',
    customerId: 1,
  };

  const employeeB = {
    id: 102,
    userId: 202,
    firstName: 'Priya',
    lastName: 'Patel',
    email: 'priya.patel@bpo.com',
    status: 'ACTIVE',
    customerId: 1,
  };

  const userEmployeeA = {
    id: 201,
    employeeId: 101,
    employee: { id: 101, firstName: 'Rahul', lastName: 'Sharma' },
    role: 'STAFF',
    customerId: 1,
  };

  const userEmployeeB = {
    id: 202,
    employeeId: 102,
    employee: { id: 102, firstName: 'Priya', lastName: 'Patel' },
    role: 'STAFF',
    customerId: 1,
  };

  const userAdmin = {
    id: 1,
    role: 'ADMIN',
    customerId: 1,
  };

  beforeEach(async () => {
    mockPrisma = {
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 501, ...data })),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 501, ...data })),
      },
      employee: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.id === 101 || where?.userId === 201) return Promise.resolve(employeeA);
          if (where?.id === 102 || where?.userId === 202) return Promise.resolve(employeeB);
          if (where?.OR) {
            const hasA = where.OR.some((c: any) => c.id === 101 || c.userId === 201);
            if (hasA) return Promise.resolve(employeeA);
            const hasB = where.OR.some((c: any) => c.id === 102 || c.userId === 202);
            if (hasB) return Promise.resolve(employeeB);
          }
          return Promise.resolve(null);
        }),
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.id === 101) return Promise.resolve(employeeA);
          if (where?.id === 102) return Promise.resolve(employeeB);
          return Promise.resolve(null);
        }),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: 9, name: 'CUSTOMER' }),
      },
      userRole: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      lead: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ id: 651 }),
      },
      customerSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockLeadRepository = {
      findOne: jest.fn(),
      findStageById: jest.fn(),
      findStages: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      logTimeline: jest.fn().mockResolvedValue({ id: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        CustomerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LeadRepository, useValue: mockLeadRepository },
        { provide: NotificationService, useValue: { sendPushNotification: jest.fn().mockResolvedValue(true) } },
        { provide: PlanAccessService, useValue: { checkFeatureAccess: jest.fn().mockResolvedValue(true) } },
        { provide: LeadLimitService, useValue: { checkLeadLimit: jest.fn().mockResolvedValue(true) } },
        { provide: EmailService, useValue: { sendEmail: jest.fn().mockResolvedValue({ success: true }) } },
        { provide: EmailTemplateService, useValue: { renderTemplate: jest.fn().mockResolvedValue('template') } },
        { provide: WhatsappService, useValue: { sendMessage: jest.fn().mockResolvedValue({ success: true }) } },
        { provide: S3Service, useValue: { uploadFile: jest.fn().mockResolvedValue('s3-url') } },
        { provide: 'ScheduleService', useValue: {} },
        { provide: require('../schedule/schedule.service').ScheduleService, useValue: {} },
        { provide: require('../auth/qb-id.generator').QBIdGenerator, useValue: { generateCustomerId: () => 'CUST-0001' } },
        { provide: require('../work/work.service').WorkService, useValue: {} },
      ],
    }).compile();

    leadService = module.get<LeadService>(LeadService);
    customerService = module.get<CustomerService>(CustomerService);
  });

  // =========================================================================
  // TEST 1: Employee A is assigned Lead 651 -> Wins Lead -> Customer ownership = Employee A
  // =========================================================================
  it('TEST 1: Employee A is assigned Lead 651 and changes FINAL CALL -> WON -> wonByEmployeeId = Employee A & Customer ownership = Employee A', async () => {
    const lead651 = {
      id: 651,
      title: 'ABC Company Lead',
      companyName: 'ABC Company',
      email: 'abc@company.com',
      phone: '9876543210',
      employeeId: 101, // Assigned to Employee A
      assignedToId: 201,
      status: 'IN_PROGRESS',
      stage: { id: 3, name: 'FINAL CALL', key: 'FINAL_CALL' },
    };

    mockPrisma.customer.findFirst.mockResolvedValueOnce(null); // Not existing yet
    mockPrisma.customer.create.mockImplementation(async ({ data }: any) => ({
      id: 123,
      ...data,
      originLead: { id: 651, employeeId: 101, convertedByEmployeeId: 101 },
    }));

    const result = await leadService.handleLeadWonCustomerConversion(
      1,
      lead651,
      201, // User ID of Employee A
      'FINAL CALL',
      'WON',
      userEmployeeA, // Authenticated Employee A
    );

    expect(result.success).toBe(true);
    expect(result.assignedEmployeeId).toBe(101); // Employee A
    expect(result.wonByEmployeeId).toBe(101); // Won By Employee A
    expect(result.customer?.wonByName).toContain('Rahul');

    // Verify lead was updated with convertedByEmployeeId = 101
    expect(mockPrisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 651 },
        data: expect.objectContaining({
          convertedByEmployeeId: 101,
          status: LeadStatus.WON,
        }),
      }),
    );
  });

  // =========================================================================
  // TEST 2: Employee B wins Lead 652 -> wonByEmployeeId = Employee B
  // =========================================================================
  it('TEST 2: Employee B wins Lead 652 -> wonByEmployeeId = Employee B & Customer owned by Employee B', async () => {
    const lead652 = {
      id: 652,
      title: 'XYZ Tech Lead',
      companyName: 'XYZ Tech',
      email: 'xyz@tech.com',
      phone: '9123456780',
      employeeId: 102, // Assigned to Employee B
      assignedToId: 202,
      status: 'IN_PROGRESS',
      stage: { id: 3, name: 'FINAL CALL', key: 'FINAL_CALL' },
    };

    mockPrisma.customer.findFirst.mockResolvedValueOnce(null);
    mockPrisma.customer.create.mockImplementation(async ({ data }: any) => ({
      id: 124,
      ...data,
      originLead: { id: 652, employeeId: 102, convertedByEmployeeId: 102 },
    }));

    const result = await leadService.handleLeadWonCustomerConversion(
      1,
      lead652,
      202,
      'FINAL CALL',
      'WON',
      userEmployeeB, // Authenticated Employee B
    );

    expect(result.success).toBe(true);
    expect(result.assignedEmployeeId).toBe(102); // Employee B
    expect(result.wonByEmployeeId).toBe(102); // Won By Employee B
    expect(result.customer?.wonByName).toContain('Priya');

    expect(mockPrisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 652 },
        data: expect.objectContaining({
          convertedByEmployeeId: 102,
          status: LeadStatus.WON,
        }),
      }),
    );
  });

  // =========================================================================
  // TEST 3: Admin reassigns Lead to Employee B after it was WON by Employee A -> Won By preserved!
  // =========================================================================
  it('TEST 3: Employee A wins Lead 651. Admin later changes Assigned To -> Employee B. Won By is NOT overwritten!', async () => {
    const alreadyWonLead = {
      id: 651,
      companyName: 'ABC Company',
      email: 'abc@company.com',
      employeeId: 101, // originally Employee A
      convertedByEmployeeId: 101, // Employee A won it!
      convertedAt: new Date('2026-09-26T10:00:00Z'),
      status: LeadStatus.WON,
    };

    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 123,
      leadId: 651,
      name: 'ABC Company',
      assignedEmployeeId: 101,
    });
    mockLeadRepository.findOne.mockResolvedValue(alreadyWonLead);
    mockLeadRepository.update.mockResolvedValue({
      ...alreadyWonLead,
      employeeId: 102, // Admin reassigns to Employee B
      assignedToId: 202,
    });

    // Admin updates lead assignment
    const updated = await leadService.updateLead(
      1,
      651,
      { employeeId: 102 as any } as any,
      userAdmin.id,
      userAdmin,
    );

    // Lead update repository received the reassignment
    expect(mockLeadRepository.update).toHaveBeenCalledWith(
      1,
      651,
      expect.objectContaining({ employeeId: 102 }),
    );

    // Verify convertedByEmployeeId remained Employee A (101)
    expect(alreadyWonLead.convertedByEmployeeId).toBe(101);
  });

  // =========================================================================
  // TEST 4 & 5: FINAL CALL appears in Upcoming for assigned employee; once WON, removed from Upcoming
  // =========================================================================
  describe('TEST 4 & 5: Upcoming Visibility & Transition to WON', () => {
    it('TEST 4: Lead in FINAL CALL appears in Upcoming for assigned Employee A, but not for Employee B', async () => {
      // Mock findAll database calls
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      // Lead in FINAL CALL assigned to Employee A
      mockPrisma.lead.findMany.mockImplementation(async ({ where }: any) => {
        // If query is for Employee A, return the lead
        const isForEmpA = where?.AND?.some((c: any) =>
          c.OR?.some((o: any) => o.employeeId === 101 || o.assignedToId === 201),
        );
        if (isForEmpA) {
          return [
            {
              id: 651,
              title: 'ABC Company Lead',
              companyName: 'ABC Company',
              employeeId: 101,
              assignedToId: 201,
              stage: { id: 3, name: 'FINAL CALL', key: 'FINAL_CALL' },
              reminders: [],
              convertedCustomer: null,
            },
          ];
        }
        return [];
      });

      // Employee A queries Upcoming
      const resA = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeA);
      expect(resA.items.length).toBe(1);
      expect(resA.items[0].name).toContain('ABC Company');

      // Employee B queries Upcoming
      const resB = await customerService.findAll({ status: 'UPCOMING' }, userEmployeeB);
      expect(resB.items.length).toBe(0);
    });

    it('TEST 5: When Lead transitions FINAL CALL -> WON, it is removed from Upcoming and creates Customer for Employee A', async () => {
      // Customer now exists for lead 651
      const convertedCustomer = {
        id: 123,
        name: 'ABC Company',
        leadId: 651,
        assignedEmployeeId: 101, // Employee A
        originLead: { id: 651, convertedByEmployeeId: 101, stage: { name: 'WON' } },
        subscriptions: [],
        users: [],
        leads: [],
        _count: { users: 1 },
      };

      mockPrisma.customer.findMany.mockResolvedValue([convertedCustomer]);
      mockPrisma.customer.count.mockResolvedValue(1);

      // Unconverted lead query returns empty because lead has convertedCustomer
      mockPrisma.lead.findMany.mockResolvedValue([]);

      const res = await customerService.findAll({ status: 'ALL' }, userEmployeeA);
      expect(res.items.length).toBe(1);
      expect(res.items[0].id).toBe(123);
      expect(res.items[0].wonByEmployeeId).toBe(101);
    });
  });

  // =========================================================================
  // TEST 6: Employee A attempts to access Employee B's Customer directly -> 403 Forbidden
  // =========================================================================
  it('TEST 6: Employee A attempts to access Employee B customer directly -> Backend throws ForbiddenException', async () => {
    // Customer 124 belongs to Employee B
    const customerOwnedByB = {
      id: 124,
      name: 'XYZ Tech',
      assignedEmployeeId: 102, // Employee B
      createdByEmployeeId: 102,
      originLead: {
        id: 652,
        convertedByEmployeeId: 102,
        stage: { name: 'WON' },
      },
      assignedTeam: null,
      subscriptions: [],
      users: [],
      leads: [{ id: 652, employeeId: 102, assignedToId: 202 }],
      works: [],
      _count: { users: 0, leads: 1, deals: 0, contacts: 0, tasks: 0, tickets: 0, companies: 0 },
      commissions: [],
    };

    mockPrisma.customer.findUnique.mockResolvedValue(customerOwnedByB);

    // Employee A (ID 101) tries to access Customer 124
    await expect(customerService.findOne(124, userEmployeeA)).rejects.toThrow(
      ForbiddenException,
    );
  });

  // =========================================================================
  // TEST 7: Admin views Customer -> Won By employee is displayed
  // =========================================================================
  it('TEST 7: Admin views Customer -> Won By employee name and Won Date are displayed', async () => {
    const customer = {
      id: 123,
      name: 'ABC Company',
      leadId: 651,
      assignedEmployeeId: 101,
      assignedEmployee: 'Rahul Sharma',
      createdByEmployeeId: 101,
      createdAt: new Date('2026-09-26T15:30:00Z'),
      originLead: {
        id: 651,
        convertedByEmployeeId: 101,
        convertedAt: new Date('2026-09-26T15:30:00Z'),
        convertedByEmployee: {
          id: 101,
          firstName: 'Rahul',
          lastName: 'Sharma',
        },
        stage: { id: 4, name: 'WON', key: 'WON' },
        reminders: [],
      },
      createdByEmployeeRel: {
        id: 101,
        firstName: 'Rahul',
        lastName: 'Sharma',
      },
      assignedEmployeeRel: {
        id: 101,
        firstName: 'Rahul',
        lastName: 'Sharma',
      },
      assignedTeam: null,
      subscriptions: [],
      users: [],
      leads: [],
      works: [],
      _count: { users: 1, leads: 1, deals: 0, contacts: 0, tasks: 0, tickets: 0, companies: 0 },
      commissions: [],
    };

    mockPrisma.customer.findUnique.mockResolvedValue(customer);

    const details = await customerService.findOne(123, userAdmin);

    expect(details.id).toBe(123);
    expect(details.wonByEmployeeId).toBe(101);
    expect(details.wonBy?.name).toBe('Rahul Sharma');
    expect(details.wonByName).toBe('Rahul Sharma');
    expect(details.wonAt).toBeDefined();
  });
});
