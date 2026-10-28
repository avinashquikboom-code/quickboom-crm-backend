import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
import { EmployeeService } from '../employee/employee.service';
import { ShiftService } from '../shift/shift.service';
import { WorkService } from '../work/work.service';
import { PlanScheduleGateway } from '../work/plan-schedule.gateway';
import { LeadStatus } from '@prisma/client';

describe('Lead Assignment — Show and Validate ONLY BPO Team Employees', () => {
  let leadService: LeadService;
  let employeeService: EmployeeService;
  let mockPrisma: any;
  let mockLeadRepository: any;

  // Fixtures: Employees
  // 1. BPO Employee via Team Membership
  const bpoEmployeeInTeam = {
    id: 101,
    userId: 201,
    employeeCode: 'EMP-BPO-01',
    firstName: 'Rahul',
    lastName: 'Sharma',
    email: 'rahul.bpo@quickboom.com',
    status: 'ACTIVE',
    customerId: 1,
    department: null,
    designation: null,
    teamMembers: [
      {
        teamId: 10,
        team: { id: 10, name: 'BPO Team', description: 'Telecalling team', isActive: true, customerId: 1 },
      },
    ],
    ledTeams: [],
  };

  // 2. BPO Employee via Team Leader
  const bpoEmployeeLeader = {
    id: 102,
    userId: 202,
    employeeCode: 'EMP-BPO-02',
    firstName: 'Priya',
    lastName: 'Patel',
    email: 'priya.bpo@quickboom.com',
    status: 'ACTIVE',
    customerId: 1,
    department: null,
    designation: null,
    teamMembers: [],
    ledTeams: [
      { id: 10, name: 'BPO Team', description: 'Telecalling team', isActive: true, customerId: 1 },
    ],
  };

  // 3. Non-BPO Employee (e.g. Designer / Developer)
  const nonBpoEmployee = {
    id: 103,
    userId: 203,
    employeeCode: 'EMP-DES-03',
    firstName: 'Ankit',
    lastName: 'Verma',
    email: 'ankit.designer@quickboom.com',
    status: 'ACTIVE',
    customerId: 1,
    department: { id: 2, name: 'Design', code: 'DSGN' },
    designation: { id: 2, name: 'Designer', code: 'DSGNR' },
    teamMembers: [
      {
        teamId: 20,
        team: { id: 20, name: 'Creative Design Team', description: 'Designers', isActive: true, customerId: 1 },
      },
    ],
    ledTeams: [],
  };

  // 4. Inactive BPO Employee
  const inactiveBpoEmployee = {
    id: 104,
    userId: 204,
    employeeCode: 'EMP-BPO-04',
    firstName: 'Neha',
    lastName: 'Gupta',
    email: 'neha.inactive@quickboom.com',
    status: 'INACTIVE',
    customerId: 1,
    department: null,
    designation: null,
    teamMembers: [
      {
        teamId: 10,
        team: { id: 10, name: 'BPO Team', description: 'Telecalling team', isActive: true, customerId: 1 },
      },
    ],
    ledTeams: [],
  };

  // 5. BPO Employee belonging to ANOTHER company/tenant (customerId: 2)
  const otherCompanyBpoEmployee = {
    id: 105,
    userId: 205,
    employeeCode: 'EMP-BPO-05',
    firstName: 'Suresh',
    lastName: 'Rao',
    email: 'suresh@othercompany.com',
    status: 'ACTIVE',
    customerId: 2,
    department: null,
    designation: null,
    teamMembers: [
      {
        teamId: 30,
        team: { id: 30, name: 'BPO Team', description: 'Other Company BPO', isActive: true, customerId: 2 },
      },
    ],
    ledTeams: [],
  };

  const allEmployees = [
    bpoEmployeeInTeam,
    bpoEmployeeLeader,
    nonBpoEmployee,
    inactiveBpoEmployee,
    otherCompanyBpoEmployee,
  ];

  beforeEach(async () => {
    mockPrisma = {
      employee: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          return allEmployees.find((emp) => {
            const matchesCustomer = emp.customerId === where.customerId;
            const matchesIdOrUser = where.OR?.some(
              (cond: any) => cond.userId === emp.userId || cond.id === emp.id,
            );
            return matchesCustomer && matchesIdOrUser;
          }) || null;
        }),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          return allEmployees.filter((emp) => {
            if (where.customerId && emp.customerId !== where.customerId) return false;
            if (where.status && emp.status !== where.status) return false;

            // Handle AND clauses (e.g. BPO filtering, search)
            if (where.AND && Array.isArray(where.AND)) {
              for (const andClause of where.AND) {
                if (andClause.OR) {
                  const matchesOr = andClause.OR.some((cond: any) => {
                    if (cond.teamMembers?.some?.team?.name?.contains) {
                      const pattern = cond.teamMembers.some.team.name.contains.toUpperCase();
                      return emp.teamMembers.some((tm) => tm.team.name.toUpperCase().includes(pattern));
                    }
                    if (cond.ledTeams?.some?.name?.contains) {
                      const pattern = cond.ledTeams.some.name.contains.toUpperCase();
                      return emp.ledTeams.some((t) => t.name.toUpperCase().includes(pattern));
                    }
                    if (cond.department?.name?.contains) {
                      const pattern = cond.department.name.contains.toUpperCase();
                      return (emp.department?.name || '').toUpperCase().includes(pattern);
                    }
                    if (cond.designation?.name?.contains) {
                      const pattern = cond.designation.name.contains.toUpperCase();
                      return (emp.designation?.name || '').toUpperCase().includes(pattern);
                    }
                    if (cond.firstName?.contains) {
                      const term = cond.firstName.contains.toUpperCase();
                      return emp.firstName.toUpperCase().includes(term);
                    }
                    if (cond.lastName?.contains) {
                      const term = cond.lastName.contains.toUpperCase();
                      return emp.lastName.toUpperCase().includes(term);
                    }
                    return false;
                  });
                  if (!matchesOr) return false;
                }
              }
            }
            return true;
          });
        }),
        count: jest.fn().mockResolvedValue(2),
      },
      lead: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, name: 'Test Customer' }),
      },
      user: {
        findFirst: jest.fn(),
      },
      team: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    mockLeadRepository = {
      findStageById: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: 501 }),
      logTimeline: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        EmployeeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LeadRepository, useValue: mockLeadRepository },
        { provide: NotificationService, useValue: { sendPushNotification: jest.fn().mockResolvedValue(null) } },
        { provide: PlanAccessService, useValue: {} },
        { provide: LeadLimitService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: EmailTemplateService, useValue: {} },
        { provide: WhatsappService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: CustomerService, useValue: {} },
        { provide: ShiftService, useValue: {} },
        { provide: WorkService, useValue: {} },
        { provide: PlanScheduleGateway, useValue: {} },
      ],
    }).compile();

    leadService = module.get<LeadService>(LeadService);
    employeeService = module.get<EmployeeService>(EmployeeService);
  });

  // =========================================================================
  // Test 1: Assign Employee dropdown fetches ONLY BPO employees for Customer 1
  // =========================================================================
  it('Test 1: Backend returns ONLY active BPO team employees when bpoOnly=true is requested', async () => {
    const result = await employeeService.findAll({
      customerId: 1,
      bpoOnly: true,
      status: 'ACTIVE',
    });

    expect(result.data.length).toBe(2);
    const names = result.data.map((e: any) => e.firstName);
    expect(names).toContain('Rahul'); // BPO member
    expect(names).toContain('Priya'); // BPO leader
    expect(names).not.toContain('Ankit'); // Designer (non-BPO)
    expect(names).not.toContain('Neha'); // Inactive
    expect(names).not.toContain('Suresh'); // Other company
  });

  // =========================================================================
  // Test 2: Search a BPO employee returns the employee
  // =========================================================================
  it('Test 2: Searching within BPO employees successfully finds a BPO employee', async () => {
    const result = await employeeService.findAll({
      customerId: 1,
      bpoOnly: true,
      status: 'ACTIVE',
      search: 'Rahul',
    });

    expect(result.data.length).toBe(1);
    expect(result.data[0].firstName).toBe('Rahul');
  });

  // =========================================================================
  // Test 3: Search a non-BPO employee does NOT return the employee
  // =========================================================================
  it('Test 3: Searching for a non-BPO employee (Ankit) returns empty list', async () => {
    const result = await employeeService.findAll({
      customerId: 1,
      bpoOnly: true,
      status: 'ACTIVE',
      search: 'Ankit',
    });

    expect(result.data.length).toBe(0);
  });

  // =========================================================================
  // Test 4: Select BPO employee -> Assignment succeeds
  // =========================================================================
  it('Test 4: Assigning a valid active BPO employee succeeds', async () => {
    const existingLead = {
      id: 501,
      customerId: 1,
      assignedToId: null,
      employeeId: null,
      status: LeadStatus.NEW,
    };
    (leadService as any).getLeadById = jest.fn().mockResolvedValue(existingLead);

    await leadService.updateLead(1, 501, { assignedToId: 201 }); // User ID of Rahul (BPO)

    expect(mockLeadRepository.update).toHaveBeenCalledWith(
      1,
      501,
      expect.objectContaining({
        assignedToId: 201,
        employeeId: 101,
      }),
    );
  });

  // =========================================================================
  // Test 5: Try direct API assignment with non-BPO employee ID -> Backend rejects
  // =========================================================================
  it('Test 5: Assigning a non-BPO employee (Ankit - Designer) is rejected by backend with BadRequestException', async () => {
    const existingLead = {
      id: 501,
      customerId: 1,
      assignedToId: null,
      employeeId: null,
      status: LeadStatus.NEW,
    };
    (leadService as any).getLeadById = jest.fn().mockResolvedValue(existingLead);

    await expect(
      leadService.updateLead(1, 501, { assignedToId: 203 }), // User ID of Ankit (Designer)
    ).rejects.toThrow(BadRequestException);

    await expect(
      leadService.updateLead(1, 501, { assignedToId: 203 }),
    ).rejects.toThrow('Lead can only be assigned to an active BPO team employee');
  });

  // =========================================================================
  // Test 6: Inactive BPO employee assignment is rejected
  // =========================================================================
  it('Test 6: Assigning an inactive BPO employee is rejected with BadRequestException', async () => {
    const existingLead = {
      id: 501,
      customerId: 1,
      assignedToId: null,
      employeeId: null,
      status: LeadStatus.NEW,
    };
    (leadService as any).getLeadById = jest.fn().mockResolvedValue(existingLead);

    await expect(
      leadService.updateLead(1, 501, { assignedToId: 204 }), // User ID of Neha (Inactive BPO)
    ).rejects.toThrow('Cannot assign lead to an inactive employee');
  });

  // =========================================================================
  // Test 7: Employee belongs to another company/tenant but BPO -> Must NOT appear / be assigned
  // =========================================================================
  it('Test 7: BPO employee from another tenant/company (customerId: 2) is rejected for Customer 1', async () => {
    const existingLead = {
      id: 501,
      customerId: 1,
      assignedToId: null,
      employeeId: null,
      status: LeadStatus.NEW,
    };
    (leadService as any).getLeadById = jest.fn().mockResolvedValue(existingLead);

    // Suresh belongs to customerId: 2
    await expect(
      leadService.updateLead(1, 501, { assignedToId: 205 }),
    ).rejects.toThrow('Assigned employee does not exist in this workspace');
  });

  // =========================================================================
  // Test 8: Existing Lead assigned to non-BPO employee historically -> Preserved without error
  // =========================================================================
  it('Test 8: Editing other fields of a lead with historical non-BPO assignment preserves the assignment without throwing', async () => {
    const historicalLead = {
      id: 502,
      customerId: 1,
      assignedToId: 203, // Historically assigned to Ankit (Designer)
      employeeId: 103,
      status: LeadStatus.NEW,
      title: 'Old Lead',
    };
    (leadService as any).getLeadById = jest.fn().mockResolvedValue(historicalLead);

    // User updates lead title and keeps the same assignedToId: 203
    await leadService.updateLead(1, 502, {
      title: 'Updated Old Lead',
      assignedToId: 203,
    });

    expect(mockLeadRepository.update).toHaveBeenCalledWith(
      1,
      502,
      expect.objectContaining({
        title: 'Updated Old Lead',
        assignedToId: 203,
        employeeId: 103,
      }),
    );
  });
});
