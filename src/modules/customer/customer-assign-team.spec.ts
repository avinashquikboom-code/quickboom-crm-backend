import { Test, TestingModule } from '@nestjs/testing';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { WorkService } from '../work/work.service';
import { AiCreditService } from '../ai-studio/ai-credit.service';
import { CustomerMobilePermissionService } from './customer-mobile-permission.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QBIdGenerator } from '../auth/qb-id.generator';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

describe('Customer Assign Team API - Unit & Integration Tests', () => {
  let controller: CustomerController;
  let service: CustomerService;
  let prisma: any;

  const mockPrisma = {
    customer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    team: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    teamMember: {
      findMany: jest.fn(),
    },
    lead: {
      findFirst: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const mockWorkService = {
    syncCustomerTeamWorkAssignments: jest.fn().mockResolvedValue(true),
  };

  const mockAiCreditService = {
    getCreditBalance: jest.fn(),
  };

  const mockCustomerMobilePermissionService = {
    getPermissions: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomerController],
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: {} },
        { provide: QBIdGenerator, useValue: { generateQbId: jest.fn().mockResolvedValue('QB-1234') } },
        { provide: WorkService, useValue: mockWorkService },
        { provide: AiCreditService, useValue: mockAiCreditService },
        { provide: CustomerMobilePermissionService, useValue: mockCustomerMobilePermissionService },
      ],
    }).compile();

    controller = module.get<CustomerController>(CustomerController);
    service = module.get<CustomerService>(CustomerService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('Route and Controller Method Verification', () => {
    it('controller exposes getAssignedTeam and assignTeam methods', () => {
      expect(typeof controller.getAssignedTeam).toBe('function');
      expect(typeof controller.assignTeam).toBe('function');
    });

    it('getAssignedTeam delegates to customerService.getAssignedTeam with param and user', async () => {
      const spy = jest.spyOn(service, 'getAssignedTeam').mockResolvedValue({
        statusCode: 200,
        success: true,
        message: 'Assigned team retrieved successfully.',
        data: { customerId: 10, teamId: 2, team: null },
        customerId: 10,
        teamId: 2,
        team: null,
      });

      const user = { id: 1, role: 'SUPER_ADMIN' };
      const result = await controller.getAssignedTeam('10', user);

      expect(spy).toHaveBeenCalledWith('10', user);
      expect(result.success).toBe(true);
      expect(result.customerId).toBe(10);
    });

    it('assignTeam delegates to customerService.assignTeam with resolved teamId', async () => {
      const spy = jest.spyOn(service, 'assignTeam').mockResolvedValue({
        statusCode: 200,
        success: true,
        message: 'Customer successfully assigned to team.',
        data: { customerId: 10, teamId: 5, team: null },
        customerId: 10,
        teamId: 5,
        team: null,
      });

      const user = { id: 1, role: 'SUPER_ADMIN' };
      const result = await controller.assignTeam('10', { teamId: 5 }, user);

      expect(spy).toHaveBeenCalledWith('10', 5, user);
      expect(result.success).toBe(true);
      expect(result.teamId).toBe(5);
    });

    it('assignTeam accepts assignedTeamId alias in DTO', async () => {
      const spy = jest.spyOn(service, 'assignTeam').mockResolvedValue({
        statusCode: 200,
        success: true,
        message: 'Customer successfully assigned to team.',
        data: { customerId: 10, teamId: 7, team: null },
        customerId: 10,
        teamId: 7,
        team: null,
      });

      const user = { id: 1, role: 'SUPER_ADMIN' };
      const result = await controller.assignTeam('10', { assignedTeamId: 7 }, user);

      expect(spy).toHaveBeenCalledWith('10', 7, user);
      expect(result.teamId).toBe(7);
    });
  });

  describe('Validation of Customer IDs (Negative, Non-Positive, Malformed)', () => {
    it('rejects negative customer ID "-889" in GET with BadRequestException (400)', async () => {
      const user = { id: 1, role: 'SUPER_ADMIN' };
      await expect(service.getAssignedTeam('-889', user)).rejects.toThrow(BadRequestException);
      await expect(service.getAssignedTeam('-889', user)).rejects.toThrow(
        'Invalid customer ID: negative ID "-889" is not supported.',
      );
      // Ensure no database queries are made for negative IDs
      expect(mockPrisma.customer.findUnique).not.toHaveBeenCalled();
    });

    it('rejects negative customer ID "-889" in PATCH with BadRequestException (400)', async () => {
      const user = { id: 1, role: 'SUPER_ADMIN' };
      await expect(service.assignTeam('-889', 2, user)).rejects.toThrow(BadRequestException);
      await expect(service.assignTeam('-889', 2, user)).rejects.toThrow(
        'Invalid customer ID: negative ID "-889" is not supported.',
      );
      expect(mockPrisma.customer.findUnique).not.toHaveBeenCalled();
    });

    it('rejects non-positive customer ID "0" with BadRequestException (400)', async () => {
      const user = { id: 1, role: 'SUPER_ADMIN' };
      await expect(service.getAssignedTeam('0', user)).rejects.toThrow(BadRequestException);
      await expect(service.assignTeam(0, 2, user)).rejects.toThrow(BadRequestException);
    });

    it('rejects non-numeric customer ID "abc" with BadRequestException (400)', async () => {
      const user = { id: 1, role: 'SUPER_ADMIN' };
      await expect(service.getAssignedTeam('abc', user)).rejects.toThrow(BadRequestException);
      await expect(service.assignTeam('abc', 2, user)).rejects.toThrow(BadRequestException);
    });
  });

  describe('Existing Valid Persisted Customer ID', () => {
    const mockCustomer10 = {
      id: 10,
      name: 'Acme Corp',
      deletedAt: null,
      assignedTeamId: 3,
      assignedTeam: {
        id: 3,
        name: 'Growth Squad',
        description: 'Squad responsible for outbound growth',
        leader: { id: 1, firstName: 'John', lastName: 'Doe', email: 'john@acme.com', phone: '1234567890' },
        _count: { members: 2 },
        members: [
          {
            id: 101,
            role: 'LEAD',
            employee: { id: 1, firstName: 'John', lastName: 'Doe', email: 'john@acme.com', phone: '1234567890' },
          },
          {
            id: 102,
            role: 'MEMBER',
            employee: { id: 2, firstName: 'Jane', lastName: 'Smith', email: 'jane@acme.com', phone: '0987654321' },
          },
        ],
      },
      users: [],
    };

    it('retrieves assigned team successfully for valid persisted customer', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(mockCustomer10);

      const superAdminUser = { id: 1, role: 'SUPER_ADMIN' };
      const res = await service.getAssignedTeam(10, superAdminUser);

      expect(res.success).toBe(true);
      expect(res.data.customerId).toBe(10);
      expect(res.data.teamId).toBe(3);
      expect(res.data.team).toEqual({
        id: 3,
        name: 'Growth Squad',
        description: 'Squad responsible for outbound growth',
        leader: 'John Doe',
        memberCount: 2,
        members: expect.arrayContaining([
          expect.objectContaining({ id: 1, name: 'John Doe', role: 'LEAD' }),
          expect.objectContaining({ id: 2, name: 'Jane Smith', role: 'MEMBER' }),
        ]),
      });
    });

    it('assigns customer to a valid team successfully (mutation)', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        deletedAt: null,
      });

      mockPrisma.team.findUnique.mockResolvedValue({
        id: 3,
        customerId: 1,
        name: 'Growth Squad',
      });

      mockPrisma.customer.update.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        assignedTeamId: 3,
        assignedTeam: {
          id: 3,
          name: 'Growth Squad',
          description: 'Squad responsible for outbound growth',
          leader: { id: 1, firstName: 'John', lastName: 'Doe', email: 'john@acme.com', phone: '1234567890' },
          _count: { members: 1 },
          members: [],
        },
      });

      const adminUser = { id: 1, role: 'ADMIN', customerId: 1 };
      const res = await service.assignTeam(10, 3, adminUser);

      expect(res.success).toBe(true);
      expect(res.message).toBe('Customer successfully assigned to team.');
      expect(res.data.teamId).toBe(3);
      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { assignedTeamId: 3 },
        include: expect.any(Object),
      });
      expect(mockWorkService.syncCustomerTeamWorkAssignments).toHaveBeenCalledWith(10, 3);
    });

    it('unassigns team when teamId is null', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        deletedAt: null,
        assignedTeamId: 3,
      });

      mockPrisma.customer.update.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        assignedTeamId: null,
        assignedTeam: null,
      });

      const superAdminUser = { id: 1, role: 'SUPER_ADMIN' };
      const res = await service.assignTeam(10, null, superAdminUser);

      expect(res.success).toBe(true);
      expect(res.message).toBe('Customer team unassigned.');
      expect(res.data.teamId).toBeNull();
      expect(res.data.team).toBeNull();
    });
  });

  describe('Non-Existent Customer and Non-Existent Team (404)', () => {
    it('throws NotFoundException when customer does not exist in getAssignedTeam', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      mockPrisma.lead.findFirst.mockResolvedValue(null);

      const user = { id: 1, role: 'SUPER_ADMIN' };
      await expect(service.getAssignedTeam(9999, user)).rejects.toThrow(NotFoundException);
      await expect(service.getAssignedTeam(9999, user)).rejects.toThrow('Customer #9999 not found.');
    });

    it('throws NotFoundException when customer does not exist in assignTeam', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      const user = { id: 1, role: 'SUPER_ADMIN' };
      await expect(service.assignTeam(9999, 2, user)).rejects.toThrow(NotFoundException);
      await expect(service.assignTeam(9999, 2, user)).rejects.toThrow('Customer #9999 not found.');
    });

    it('throws NotFoundException when target team does not exist in assignTeam', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        deletedAt: null,
      });
      mockPrisma.team.findUnique.mockResolvedValue(null);

      const user = { id: 1, role: 'SUPER_ADMIN' };
      await expect(service.assignTeam(10, 8888, user)).rejects.toThrow(NotFoundException);
      await expect(service.assignTeam(10, 8888, user)).rejects.toThrow('Team #8888 not found.');
    });
  });

  describe('Tenant Isolation and Authorization', () => {
    it('blocks unauthorized caller (e.g., normal CUSTOMER user) with ForbiddenException (403)', async () => {
      const normalCustomerUser = { id: 50, role: 'CUSTOMER', customerId: 10 };
      await expect(service.assignTeam(10, 2, normalCustomerUser)).rejects.toThrow(ForbiddenException);
      await expect(service.assignTeam(10, 2, normalCustomerUser)).rejects.toThrow(
        'You do not have permission to assign teams to customers.',
      );
    });

    it('blocks cross-tenant team assignment when caller belongs to customer 20 but modifies customer 10', async () => {
      const tenantUser = { id: 5, role: 'ADMIN', customerId: 20 };
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        deletedAt: null,
      });

      await expect(service.assignTeam(10, 2, tenantUser)).rejects.toThrow(ForbiddenException);
      await expect(service.assignTeam(10, 2, tenantUser)).rejects.toThrow(
        'You do not have permission to assign teams to this customer.',
      );
    });

    it('blocks assigning a team belonging to a different tenant', async () => {
      const tenantUser = { id: 5, role: 'ADMIN', customerId: 10 };
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        deletedAt: null,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 2,
        name: 'Other Tenant Team',
        customerId: 99, // Owned by another tenant
      });

      await expect(service.assignTeam(10, 2, tenantUser)).rejects.toThrow(ForbiddenException);
      await expect(service.assignTeam(10, 2, tenantUser)).rejects.toThrow(
        'You do not have permission to assign a team belonging to another tenant.',
      );
    });

    it('allows system admin/agency staff (customerId=1) to assign team to customer', async () => {
      const agencyAdmin = { id: 2, role: 'ADMIN', customerId: 1 };
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        deletedAt: null,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 2,
        name: 'Agency Team',
        customerId: 1,
      });
      mockPrisma.customer.update.mockResolvedValue({
        id: 10,
        name: 'Acme Corp',
        assignedTeamId: 2,
        assignedTeam: {
          id: 2,
          name: 'Agency Team',
          leader: null,
          members: [],
          _count: { members: 0 },
        },
      });

      const res = await service.assignTeam(10, 2, agencyAdmin);
      expect(res.success).toBe(true);
      expect(res.data.teamId).toBe(2);
    });
  });
});
