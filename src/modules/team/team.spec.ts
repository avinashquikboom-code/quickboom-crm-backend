import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TeamService } from './team.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('TeamService - Functional End-to-End Team Management', () => {
  let service: TeamService;
  let prisma: PrismaService;

  const mockPrismaService = {
    team: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    teamMember: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('1. findAll (List Teams with Filters & Pagination)', () => {
    it('should return paginated teams with leader and member count for customer', async () => {
      const mockTeams = [
        {
          id: 1,
          customerId: 101,
          name: 'Video Production Team',
          description: 'Reels and Video Editors',
          leaderId: 10,
          isActive: true,
          leader: { id: 10, firstName: 'John', lastName: 'Doe', employeeCode: 'EMP-010' },
          members: [
            { id: 1, employeeId: 10, role: 'LEADER', employee: { id: 10, firstName: 'John' } },
            { id: 2, employeeId: 11, role: 'MEMBER', employee: { id: 11, firstName: 'Alice' } },
          ],
        },
      ];

      mockPrismaService.team.findMany.mockResolvedValue(mockTeams);
      mockPrismaService.team.count.mockResolvedValue(1);

      const result = await service.findAll(101, { page: 1, limit: 10, status: 'ACTIVE' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].memberCount).toBe(2);
      expect(result.data[0].status).toBe('ACTIVE');
      expect(result.pagination.total).toBe(1);
      expect(mockPrismaService.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 101, isActive: true }),
        }),
      );
    });

    it('should throw BadRequestException if customerId is invalid', async () => {
      await expect(service.findAll('invalid' as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('2. findOne (Team Details)', () => {
    it('should return team details when team belongs to customer', async () => {
      const mockTeam = {
        id: 1,
        customerId: 101,
        name: 'Design Squad',
        leaderId: 15,
        isActive: true,
        leader: { id: 15, firstName: 'Sarah', lastName: 'Connor' },
        members: [{ id: 1, employeeId: 15, employee: { id: 15, firstName: 'Sarah' } }],
        works: [],
      };

      mockPrismaService.team.findFirst.mockResolvedValue(mockTeam);

      const result = await service.findOne(101, 1);
      expect(result.name).toBe('Design Squad');
      expect(result.status).toBe('ACTIVE');
      expect(result.memberCount).toBe(1);
    });

    it('should throw NotFoundException when team does not belong to customer', async () => {
      mockPrismaService.team.findFirst.mockResolvedValue(null);

      await expect(service.findOne(101, 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('3. create (Create Team with Tenant Validation)', () => {
    it('should create team with valid leader and deduplicated members in same tenant', async () => {
      // Leader exists in customer 101
      mockPrismaService.employee.findFirst.mockResolvedValue({ id: 10, customerId: 101 });
      // Members 10, 11 exist in customer 101
      mockPrismaService.employee.findMany.mockResolvedValue([
        { id: 10 },
        { id: 11 },
      ]);
      mockPrismaService.team.create.mockResolvedValue({ id: 1, name: 'Creative Unit' });
      mockPrismaService.team.findUnique.mockResolvedValue({
        id: 1,
        name: 'Creative Unit',
        leader: { id: 10, firstName: 'John' },
        members: [{ id: 1, employeeId: 10 }, { id: 2, employeeId: 11 }],
      });

      const result = await service.create(101, {
        name: 'Creative Unit',
        description: 'New team',
        leaderId: 10,
        memberIds: [10, 11, 11], // Duplicate 11 should be deduplicated
      });

      expect(mockPrismaService.team.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 101,
          name: 'Creative Unit',
          leaderId: 10,
        }),
      });
      expect(mockPrismaService.teamMember.createMany).toHaveBeenCalledWith({
        data: [
          { teamId: 1, employeeId: 10, role: 'LEADER' },
          { teamId: 1, employeeId: 11, role: 'MEMBER' },
        ],
        skipDuplicates: true,
      });
      expect(result).toBeDefined();
    });

    it('should throw BadRequestException if leader belongs to another customer', async () => {
      mockPrismaService.employee.findFirst.mockResolvedValue(null); // Not found in customer 101

      await expect(
        service.create(101, {
          name: 'Hacked Team',
          leaderId: 999, // belongs to customer 102
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if member belongs to another customer', async () => {
      mockPrismaService.employee.findMany.mockResolvedValue([{ id: 10 }]); // Only 1 found, but 2 requested

      await expect(
        service.create(101, {
          name: 'Cross-Tenant Team',
          memberIds: [10, 999],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. update (Update Team & Synchronize Members)', () => {
    it('should update team and synchronize member list', async () => {
      mockPrismaService.team.findFirst.mockResolvedValue({ id: 1, customerId: 101, leaderId: 10 });
      mockPrismaService.employee.findMany.mockResolvedValue([{ id: 12 }, { id: 13 }]);
      mockPrismaService.team.update.mockResolvedValue({ id: 1, name: 'Updated Team' });
      mockPrismaService.team.findUnique.mockResolvedValue({
        id: 1,
        name: 'Updated Team',
        members: [{ id: 3, employeeId: 12 }, { id: 4, employeeId: 13 }],
      });

      const result = await service.update(101, 1, {
        name: 'Updated Team',
        memberIds: [12, 13],
      });

      expect(mockPrismaService.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ name: 'Updated Team' }) }),
      );
      expect(mockPrismaService.teamMember.deleteMany).toHaveBeenCalledWith({
        where: { teamId: 1, employeeId: { notIn: [12, 13] } },
      });
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException if updating non-existent team', async () => {
      mockPrismaService.team.findFirst.mockResolvedValue(null);

      await expect(service.update(101, 999, { name: 'New Name' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('5. remove (Deactivate or Delete)', () => {
    it('should deactivate team by setting isActive to false', async () => {
      mockPrismaService.team.findFirst.mockResolvedValue({ id: 1, name: 'Alpha Team', customerId: 101 });
      mockPrismaService.team.update.mockResolvedValue({ id: 1, isActive: false });

      const res = await service.remove(101, 1, false);
      expect(res.success).toBe(true);
      expect(mockPrismaService.team.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { isActive: false },
      });
    });

    it('should permanently delete team when permanent is true and team has no assigned members or records', async () => {
      mockPrismaService.team.findFirst.mockResolvedValue({ id: 1, name: 'Alpha Team', customerId: 101, leaderId: null, _count: { members: 0, works: 0, assignedCustomers: 0 } });
      mockPrismaService.team.delete.mockResolvedValue({ id: 1 });

      const res = await service.remove(101, 1, true);
      expect(res.success).toBe(true);
      expect(mockPrismaService.team.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should throw BadRequestException when deleting a team with assigned members or records', async () => {
      mockPrismaService.team.findFirst.mockResolvedValue({
        id: 1,
        name: 'Alpha Team',
        customerId: 101,
        leaderId: 10,
        _count: { members: 2, works: 0, assignedCustomers: 0 },
      });

      await expect(service.remove(101, 1, true)).rejects.toThrow(
        'Cannot delete this team because it has assigned employees or related records. Please reassign/remove them first.',
      );
    });
  });

  describe('6. Member Actions (addMember & removeMember)', () => {
    it('should add member when employee and team belong to customer', async () => {
      mockPrismaService.team.findFirst.mockResolvedValue({ id: 1, customerId: 101 });
      mockPrismaService.employee.findFirst.mockResolvedValue({ id: 10, customerId: 101 });
      mockPrismaService.teamMember.upsert.mockResolvedValue({ id: 1, teamId: 1, employeeId: 10, role: 'SPECIALIST' });

      const res = await service.addMember(101, 1, { employeeId: 10, role: 'SPECIALIST' });
      expect(res.role).toBe('SPECIALIST');
    });

    it('should remove member from team', async () => {
      mockPrismaService.team.findFirst.mockResolvedValue({ id: 1, customerId: 101 });
      mockPrismaService.teamMember.delete.mockResolvedValue({ id: 1 });

      const res = await service.removeMember(101, 1, 10);
      expect(mockPrismaService.teamMember.delete).toHaveBeenCalled();
    });
  });
});
