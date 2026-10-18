import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TeamService } from './team.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('Team Deletion & Dependency Safety', () => {
  let service: TeamService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      team: {
        findFirst: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
      teamMember: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn(),
      },
      work: {
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      customer: {
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      commission: {
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (callback: any) => callback(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
  });

  // Test Case 1: Delete a team with no dependencies
  it('1. deletes a team with no dependencies permanently', async () => {
    mockPrisma.team.findFirst.mockResolvedValue({
      id: 10,
      name: 'Clean Team',
      isActive: true,
      _count: { members: 0, works: 0 },
    });
    mockPrisma.team.delete.mockResolvedValue({ id: 10 });

    const result = await service.remove(1, 10, true);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Team "Clean Team" permanently deleted');
    expect(mockPrisma.team.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  // Test Case 2: Delete a team with assigned employees after safely reassigning them
  it('2. reassigns assigned employees and records to another team before permanent deletion', async () => {
    mockPrisma.team.findFirst.mockImplementation(({ where }: any) => {
      if (where.id === 10) return { id: 10, name: 'Old Team', isActive: true };
      if (where.id === 20) return { id: 20, name: 'New Team', isActive: true };
      return null;
    });

    // Employee 101 and 102 are on old team; employee 101 is already on new team
    mockPrisma.teamMember.findMany.mockImplementation(({ where }: any) => {
      if (where.teamId === 10) {
        return [
          { employeeId: 101, role: 'LEADER' },
          { employeeId: 102, role: 'MEMBER' },
        ];
      }
      if (where.teamId === 20) {
        return [{ employeeId: 101, role: 'MEMBER' }];
      }
      return [];
    });

    const result = await service.remove(1, 10, true, 20);

    expect(result.success).toBe(true);
    expect(result.message).toContain('reassigned to "New Team" successfully');
    // Only employee 102 needs to be created on new team (101 already exists)
    expect(mockPrisma.teamMember.createMany).toHaveBeenCalledWith({
      data: [{ teamId: 20, employeeId: 102, role: 'MEMBER' }],
      skipDuplicates: true,
    });
    expect(mockPrisma.work.updateMany).toHaveBeenCalledWith({
      where: { teamId: 10 },
      data: { teamId: 20 },
    });
    expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith({
      where: { assignedTeamId: 10 },
      data: { assignedTeamId: 20 },
    });
    expect(mockPrisma.commission.updateMany).toHaveBeenCalledWith({
      where: { teamId: 10 },
      data: { teamId: 20 },
    });
    expect(mockPrisma.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: 10 } });
    expect(mockPrisma.team.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  // Test Case 3: Delete a team with related tasks or schedules (works)
  it('3. unassigns schedules (works) and customers safely when deleted without reassignment target', async () => {
    mockPrisma.team.findFirst.mockResolvedValue({
      id: 10,
      name: 'Busy Team',
      isActive: true,
      _count: { members: 2, works: 5 },
    });

    const result = await service.remove(1, 10, true);

    expect(result.success).toBe(true);
    expect(mockPrisma.work.updateMany).toHaveBeenCalledWith({
      where: { teamId: 10 },
      data: { teamId: null },
    });
    expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith({
      where: { assignedTeamId: 10 },
      data: { assignedTeamId: null },
    });
    expect(mockPrisma.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: 10 } });
    expect(mockPrisma.team.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  // Test Case 4: Delete a team referenced by historical payroll or commission records
  it('4. retains commission records by setting teamId to null without deleting financial history', async () => {
    mockPrisma.team.findFirst.mockResolvedValue({
      id: 10,
      name: 'Sales Team',
      isActive: true,
    });

    const result = await service.remove(1, 10, true);

    expect(result.success).toBe(true);
    expect(mockPrisma.commission.updateMany).toHaveBeenCalledWith({
      where: { teamId: 10 },
      data: { teamId: null },
    });
    expect(mockPrisma.team.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  // Test Case 5: Verify that a failed deletion leaves all records unchanged (transaction rollback)
  it('5. rolls back and returns actionable dependency details if foreign key error occurs', async () => {
    mockPrisma.team.findFirst.mockResolvedValue({
      id: 10,
      name: 'Locked Team',
      isActive: true,
    });
    // Simulate transaction error
    const fkError: any = new Error('Foreign key violation');
    fkError.code = 'P2003';
    mockPrisma.$transaction.mockRejectedValue(fkError);

    mockPrisma.teamMember.count.mockResolvedValue(3);
    mockPrisma.work.count.mockResolvedValue(8);
    mockPrisma.customer.count.mockResolvedValue(4);

    await expect(service.remove(1, 10, true)).rejects.toThrow(BadRequestException);
    await expect(service.remove(1, 10, true)).rejects.toThrow(
      'Cannot permanently delete team "Locked Team" because related records still reference it (3 member(s), 8 work schedule(s), 4 customer(s)). Please reassign or remove them first, or deactivate the team instead.',
    );
  });

  // Test Case 6: Verify validation and error handling for unauthorized / invalid requests
  it('6. rejects invalid team ID, non-existent team, or reassigning to self / inactive team', async () => {
    await expect(service.remove(1, 0, true)).rejects.toThrow(BadRequestException);
    await expect(service.remove(1, -1, true)).rejects.toThrow(BadRequestException);

    mockPrisma.team.findFirst.mockResolvedValue(null);
    await expect(service.remove(1, 999, true)).rejects.toThrow(NotFoundException);

    mockPrisma.team.findFirst.mockImplementation(({ where }: any) => {
      if (where.id === 10) return { id: 10, name: 'Team A', isActive: true };
      if (where.id === 30) return { id: 30, name: 'Inactive Team', isActive: false };
      return null;
    });

    // Cannot reassign to self
    await expect(service.remove(1, 10, true, 10)).rejects.toThrow(
      'Cannot reassign dependencies to the team being deleted',
    );

    // Cannot reassign to inactive team
    await expect(service.remove(1, 10, true, 30)).rejects.toThrow(
      'Cannot reassign to inactive team "Inactive Team"',
    );

    // Target team not found
    await expect(service.remove(1, 10, true, 999)).rejects.toThrow(
      'Target team with ID 999 for reassignment not found',
    );
  });

  // Test Case 7: Verify both soft-delete and permanent-delete flows
  it('7. deactivates team when permanent is false and keeps associations intact', async () => {
    mockPrisma.team.findFirst.mockResolvedValue({
      id: 10,
      name: 'Active Team',
      isActive: true,
    });
    mockPrisma.team.update.mockResolvedValue({ id: 10, isActive: false });

    const result = await service.remove(1, 10, false);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Team "Active Team" deactivated successfully');
    expect(mockPrisma.team.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { isActive: false },
    });
    // Members, works, and customers must NOT be deleted or unassigned
    expect(mockPrisma.teamMember.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.work.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.team.delete).not.toHaveBeenCalled();
  });
});
