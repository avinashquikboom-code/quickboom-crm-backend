import { BadRequestException } from '@nestjs/common';
import { TeamService } from './team.service';
import { teamMemberEligibility } from './team-member-eligibility.util';

describe('team assignment candidate validation', () => {
  const production = { id: 7, name: 'PRODUCTION TEAM_A', isActive: true };
  it('uses the same eligibility scope as the roster and rejects an ineligible direct assignment', async () => {
    const prisma = {
      team: { findFirst: jest.fn().mockResolvedValue(production) },
      employee: { findFirst: jest.fn().mockResolvedValue(null) },
      teamMember: { upsert: jest.fn() },
    };
    const service = new TeamService(prisma as any);
    await expect(service.addMember(undefined, 7, { employeeId: 20 })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.employee.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: 20 }, teamMemberEligibility(production)] },
    });
    expect(prisma.teamMember.upsert).not.toHaveBeenCalled();
  });

  it('accepts an employee approved by the production eligibility query', async () => {
    const prisma = {
      team: { findFirst: jest.fn().mockResolvedValue(production) },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 20 }) },
      teamMember: { upsert: jest.fn().mockResolvedValue({ id: 3, employeeId: 20 }) },
    };
    const result = await new TeamService(prisma as any).addMember(undefined, 7, { employeeId: 20 });
    expect(result.employeeId).toBe(20);
    expect(prisma.teamMember.upsert).toHaveBeenCalledTimes(1);
  });

  it('uses positive production eligibility rather than globally banning BPO memberships', () => {
    const scope = teamMemberEligibility(production);
    expect(scope.status).toBe('ACTIVE');
    expect(scope.NOT).toEqual({ teamMembers: { some: { teamId: 7 } } });
    expect(JSON.stringify(scope.AND)).toContain('PRODUCTION');
    expect(JSON.stringify(scope.AND)).not.toContain('BPO');
  });

  it('preserves BPO designation eligibility', () => {
    const scope = teamMemberEligibility({ id: 8, name: 'BPO TEAM_A' });
    expect(JSON.stringify(scope.AND)).toContain('designation');
    expect(JSON.stringify(scope.AND)).toContain('BPO');
  });
});
