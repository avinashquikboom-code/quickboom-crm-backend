import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { WorkService } from '../work/work.service';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCustomerDto } from './dto/customer.dto';

describe('CustomerService - Resource Consumption', () => {
  let service: CustomerService;
  let prisma: any;

  const mockCustomers = [
    {
      id: 1,
      name: 'Acme Enterprise',
      companyName: 'Acme Corp',
      domain: 'acme.com',
      email: 'admin@acme.com',
      phone: '1234567890',
      isActive: true,
      storageUsed: BigInt(45 * 1024 * 1024), // 45 MB
      userLimit: 50,
      leadLimit: 1000,
      storageLimit: BigInt(5368709120),
      createdAt: new Date('2026-01-01'),
      subscriptions: [
        {
          id: 10,
          status: 'ACTIVE',
          plan: {
            id: 1,
            name: 'Scale Plan',
            code: 'SCALE',
            userLimit: 50,
            leadLimit: 1000,
            storageLimit: BigInt(5368709120),
          },
        },
      ],
      _count: {
        users: 32,
        leads: 850,
        works: 12,
        dataCapturePlaces: 24,
      },
    },
    {
      id: 2,
      name: 'Beta Global',
      companyName: 'Beta Inc',
      domain: 'beta.com',
      email: 'info@beta.com',
      phone: '0987654321',
      isActive: true,
      storageUsed: BigInt(15 * 1024 * 1024), // 15 MB
      userLimit: 20,
      leadLimit: 500,
      storageLimit: BigInt(2147483648),
      createdAt: new Date('2026-02-01'),
      subscriptions: [
        {
          id: 11,
          status: 'ACTIVE',
          plan: {
            id: 2,
            name: 'Growth Plan',
            code: 'GROWTH',
            userLimit: 20,
            leadLimit: 500,
            storageLimit: BigInt(2147483648),
          },
        },
      ],
      _count: {
        users: 10,
        leads: 200,
        works: 5,
        dataCapturePlaces: 8,
      },
    },
  ];

  beforeEach(async () => {
    prisma = {
      customer: {
        count: jest.fn().mockResolvedValue(mockCustomers.length),
        findMany: jest.fn().mockResolvedValue(mockCustomers),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      team: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: 'ScheduleService',
          useValue: {},
        },
        {
          provide: ScheduleService,
          useValue: {},
        },
        {
          provide: QBIdGenerator,
          useValue: { generateQbId: jest.fn().mockResolvedValue('QB-1234') },
        },
        {
          provide: WorkService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return aggregated resource consumption and breakdown for all customers', async () => {
    const result = await service.getResourceConsumption({
      page: 1,
      limit: 20,
      status: 'ALL',
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary.totalAllocatedSeats).toBe(42); // 32 + 10
    expect(result.summary.totalMaxSeats).toBe(70); // 50 + 20
    expect(result.summary.overallSeatUtilization).toBe('60.0%'); // 42/70 * 100
    expect(result.summary.totalLeads).toBe(1050); // 850 + 200
    expect(result.summary.totalStorage).toBe('60.0 MB'); // 45MB + 15MB
    expect(result.summary.totalCustomers).toBe(2);
    expect(result.summary.activeCustomers).toBe(2);

    expect(result.items).toHaveLength(2);
    const item1 = result.items[0];
    expect(item1.id).toBe(1);
    expect(item1.name).toBe('Acme Enterprise');
    expect(item1.users).toBe(32);
    expect(item1.maxUsers).toBe(50);
    expect(item1.seatUtilization).toBe(64); // 32/50 * 100 = 64%
    expect(item1.leads).toBe(850);
    expect(item1.maxLeads).toBe(1000);
    expect(item1.leadUtilization).toBe(85);
    expect(item1.storage).toBe('45.0 MB');
    expect(item1.worksCount).toBe(12);
  });

  it('should filter customers by search query and date range', async () => {
    await service.getResourceConsumption({
      search: 'Acme',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });

    expect(prisma.customer.findMany).toHaveBeenCalled();
    const callArgs = prisma.customer.findMany.mock.calls[0][0];
    expect(callArgs.where.deletedAt).toBeNull();
    expect(callArgs.where.OR).toBeDefined();
    expect(callArgs.where.createdAt).toBeDefined();
  });

  describe('findOne Authorization & Access Control', () => {
    const mockCustomer23 = {
      id: 23,
      name: 'demo pvt ltd',
      companyName: 'demo pvt ltd',
      email: 'demo@gmail.com',
      isActive: true,
      deletedAt: null,
      assignedEmployeeId: 10,
      subscriptions: [],
      users: [{ id: 2, email: 'demo@gmail.com' }],
      _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0, companies: 0 },
    };

    beforeEach(() => {
      prisma.customer.findUnique.mockReset();
    });

    it('allows Super Admin to access customer 23 (200 OK)', async () => {
      prisma.customer.findUnique.mockResolvedValue(mockCustomer23);

      const superAdminUser = { id: 1, role: 'SUPER_ADMIN', roles: ['SUPER_ADMIN'] };
      const result = await service.findOne(23, superAdminUser);

      expect(result).toBeDefined();
      expect(result.id).toBe(23);
      expect(result.name).toBe('demo pvt ltd');
    });

    it('allows customer 23 user to access their own customer record (200 OK)', async () => {
      prisma.customer.findUnique.mockResolvedValue(mockCustomer23);

      const customerUser = { id: 2, customerId: 23, role: 'CUSTOMER', roles: ['CUSTOMER'] };
      const result = await service.findOne(23, customerUser);

      expect(result).toBeDefined();
      expect(result.id).toBe(23);
    });

    it('blocks cross-tenant customer (customerId=21) with ForbiddenException (403)', async () => {
      prisma.customer.findUnique.mockResolvedValue(mockCustomer23);

      const crossTenantUser = { id: 12, customerId: 21, role: 'CUSTOMER', roles: ['CUSTOMER'] };
      await expect(service.findOne(23, crossTenantUser)).rejects.toThrow(
        'You do not have permission to access details for this customer.',
      );
    });

    it('allows assigned employee to access customer 23 (200 OK)', async () => {
      prisma.customer.findUnique.mockResolvedValue(mockCustomer23);

      const assignedEmployeeUser = {
        id: 5,
        role: 'EMPLOYEE',
        employee: { id: 10 },
      };
      const result = await service.findOne(23, assignedEmployeeUser);
      expect(result).toBeDefined();
      expect(result.id).toBe(23);
    });

    it('throws NotFoundException when customer does not exist (404)', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      const superAdminUser = { id: 1, role: 'SUPER_ADMIN', roles: ['SUPER_ADMIN'] };
      await expect(service.findOne(999, superAdminUser)).rejects.toThrow('Customer #999 not found.');
    });
  });

  describe('Team Assignment Flow', () => {
    it('assignTeam assigns customer to team and returns team details', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 23,
        name: 'Customer A',
        deletedAt: null,
      });

      prisma.team.findUnique.mockResolvedValue({
        id: 2,
        name: 'Social Media Team',
      });

      prisma.customer.update.mockResolvedValue({
        id: 23,
        name: 'Customer A',
        assignedTeamId: 2,
        assignedTeam: {
          id: 2,
          name: 'Social Media Team',
          description: 'Team for marketing',
          leader: { id: 1, firstName: 'Alice', lastName: 'Smith' },
          _count: { members: 3 },
          members: [],
        },
      });

      const res = await service.assignTeam(23, 2);
      expect(res.success).toBe(true);
      expect(res.data.teamId).toBe(2);
      expect(res.data.team).toEqual({
        id: 2,
        name: 'Social Media Team',
        description: 'Team for marketing',
        leader: 'Alice Smith',
        memberCount: 3,
        members: [],
      });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 23 },
        data: { assignedTeamId: 2 },
        include: expect.any(Object),
      });
    });

    it('assignTeam throws ForbiddenException if user lacks permission', async () => {
      const normalCustomerUser = {
        id: 99,
        role: 'CUSTOMER',
        customerId: 23,
      };

      await expect(service.assignTeam(23, 2, normalCustomerUser)).rejects.toThrow(
        'You do not have permission to assign teams to customers.',
      );
    });

    it('assignTeam throws NotFoundException if team does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 23,
        name: 'Customer A',
        deletedAt: null,
      });

      prisma.team.findUnique.mockResolvedValue(null);

      await expect(service.assignTeam(23, 999)).rejects.toThrow('Team #999 not found.');
    });

    it('getAssignedTeam returns assigned team data with leader and members', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 23,
        name: 'Customer A',
        deletedAt: null,
        assignedTeamId: 2,
        assignedTeam: {
          id: 2,
          name: 'Social Media Team',
          description: 'Team for marketing',
          leader: { id: 1, firstName: 'Alice', lastName: 'Smith', email: 'alice@team.com', phone: '123' },
          _count: { members: 1 },
          members: [
            {
              id: 10,
              role: 'MEMBER',
              employee: { id: 5, firstName: 'Bob', lastName: 'Jones', email: 'bob@team.com', phone: '456' },
            },
          ],
        },
        users: [],
      });

      const res = await service.getAssignedTeam(23);
      expect(res.success).toBe(true);
      expect(res.data.customerId).toBe(23);
      expect(res.data.teamId).toBe(2);
      expect(res.data.team.name).toBe('Social Media Team');
      expect(res.data.team.leader).toBe('Alice Smith');
      expect(res.data.team.memberCount).toBe(1);
      expect(res.data.team.members[0].name).toBe('Bob Jones');
    });

    it('getAssignedTeam throws NotFoundException if customer does not exist', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.getAssignedTeam(999)).rejects.toThrow('Customer #999 not found.');
    });

    it('findAll filters by teamId', async () => {
      prisma.customer.findMany.mockResolvedValue([
        {
          id: 23,
          name: 'Customer A',
          assignedTeamId: 2,
          assignedTeam: {
            id: 2,
            name: 'Social Media Team',
            leader: { id: 1, firstName: 'Alice', lastName: 'Smith' },
            _count: { members: 3 },
            members: [],
          },
          subscriptions: [],
          _count: { users: 1, leads: 0, deals: 0, contacts: 0, tasks: 0, tickets: 0 },
        },
      ]);
      prisma.customer.count.mockResolvedValue(1);

      const res = await service.findAll({ teamId: 2 });
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ assignedTeamId: 2 }),
        }),
      );
      expect(res.data[0].teamId).toBe(2);
      expect(res.data[0].team.name).toBe('Social Media Team');
    });

    it('findAll excludes Super Admin and Admin accounts by default at database query level', async () => {
      prisma.customer.findMany.mockResolvedValue([
        {
          id: 10,
          name: 'BK Fireworks',
          companyName: 'BK Fireworks Pvt Ltd',
          customerType: 'ENTERPRISE',
          subscriptions: [],
          users: [{ id: 101, firstName: 'Priya', lastName: 'Bajaj', email: 'priya@bkfireworks.com' }],
          _count: { users: 1, leads: 5, deals: 2, contacts: 3, tasks: 1, tickets: 0 },
        },
        {
          id: 11,
          name: 'Bajaj Textiles',
          companyName: 'Bajaj Textiles Ltd',
          customerType: 'ENTERPRISE',
          subscriptions: [],
          users: [{ id: 102, firstName: 'Nitesh', lastName: 'Bajaj', email: 'nitesh@bajajtextiles.com' }],
          _count: { users: 1, leads: 2, deals: 1, contacts: 1, tasks: 0, tickets: 0 },
        },
      ]);
      prisma.customer.count.mockResolvedValue(2);

      const res = await service.findAll({});
      expect(prisma.customer.findMany).toHaveBeenCalled();
      const findManyCall = prisma.customer.findMany.mock.calls[prisma.customer.findMany.mock.calls.length - 1][0];

      // Must include NOT filter excluding Super Admin role and non-customer types
      expect(findManyCall.where.NOT).toBeDefined();
      expect(findManyCall.where.deletedAt).toBeNull();
      expect(res.data).toHaveLength(2);
      expect(res.data.map((c: any) => c.name)).toEqual(['BK Fireworks', 'Bajaj Textiles']);
    });

    it('findAll search filters out Super Admin and Admin users when searching', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customer.count.mockResolvedValue(0);

      await service.findAll({ search: 'Super Admin' });
      const findManyCall = prisma.customer.findMany.mock.calls[prisma.customer.findMany.mock.calls.length - 1][0];

      expect(findManyCall.where.NOT).toBeDefined();
      expect(findManyCall.where.AND).toBeDefined();
      // Verify the search condition includes NOT for userRoles with SUPER_ADMIN
      const searchClause = findManyCall.where.AND[0];
      expect(searchClause.OR).toBeDefined();
      const userSearchClause = searchClause.OR.find((cond: any) => cond.users);
      expect(userSearchClause.users.some.AND).toBeDefined();
      const notRoleClause = userSearchClause.users.some.AND.find((c: any) => c.NOT);
      expect(notRoleClause.NOT.userRoles).toBeDefined();
    });

    it('getMetrics excludes Super Admin from KPI counts', async () => {
      prisma.customer.count.mockResolvedValue(15);

      const metrics = await service.getMetrics();
      expect(prisma.customer.count).toHaveBeenCalled();
      const countCall = prisma.customer.count.mock.calls[prisma.customer.count.mock.calls.length - 1][0];
      expect(countCall.where.NOT).toBeDefined();
      expect(metrics.totalCustomers).toBe(15);
    });

    it('update updates customer assignedTeamId and status properly', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: 23, name: 'Little Laugh' });
      prisma.team.findUnique.mockResolvedValue({ id: 3, name: 'Production Team' });
      prisma.customer.update.mockResolvedValue({
        id: 23,
        name: 'Little Laugh',
        assignedTeamId: 3,
        isActive: true,
        assignedTeam: {
          id: 3,
          name: 'Production Team',
          description: 'Handles production tasks',
          leader: { firstName: 'Jane', lastName: 'Doe' },
          _count: { members: 5 },
        },
      });

      const res = await service.update(23, {
        name: 'Little Laugh',
        status: 'ACTIVE',
        assignedTeamId: 3,
      });

      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 23 },
          data: expect.objectContaining({
            assignedTeamId: 3,
            isActive: true,
          }),
        }),
      );
      expect(res.teamId).toBe(3);
      expect(res.team.name).toBe('Production Team');
    });

    it('UpdateCustomerDto allows status, assignedTeamId, teamId and rejects non-whitelisted properties', async () => {
      const validDto = plainToInstance(UpdateCustomerDto, {
        name: 'Little Laugh',
        status: 'ACTIVE',
        assignedTeamId: 3,
        teamId: 3,
      });
      const validErrors = await validate(validDto, { whitelist: true, forbidNonWhitelisted: true });
      expect(validErrors.length).toBe(0);

      const invalidDto = plainToInstance(UpdateCustomerDto, {
        name: 'Little Laugh',
        nonExistentProp: 'bad_value',
      });
      const invalidErrors = await validate(invalidDto, { whitelist: true, forbidNonWhitelisted: true });
      expect(invalidErrors.length).toBeGreaterThan(0);
      expect(invalidErrors[0].property).toBe('nonExistentProp');
    });
  });
});



