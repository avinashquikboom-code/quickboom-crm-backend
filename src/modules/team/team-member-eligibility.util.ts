import { Prisma } from '@prisma/client';

/** Team categories follow the existing roster's department/team-label convention.
 * Positive eligibility permits multi-team employees without admitting BPO-only staff.
 */
export function teamMemberEligibility(
  team: { id: number; name: string; description?: string | null },
): Prisma.EmployeeWhereInput {
  const label = team.name.toLowerCase();
  const category = /\bbpo\b/.test(label.replace(/[_-]/g, ' ')) ? 'BPO'
    : /\bproduction\b/.test(label.replace(/[_-]/g, ' ')) ? 'PRODUCTION' : null;
  const where: Prisma.EmployeeWhereInput = {
    status: 'ACTIVE',
    OR: [{ userId: null }, { user: { isActive: true, deletedAt: null } }],
    NOT: { teamMembers: { some: { teamId: team.id } } },
  };
  if (!category) return where;
  const contains = { contains: category, mode: 'insensitive' as const };
  const eligible: Prisma.EmployeeWhereInput[] = [
    { department: { isActive: true, OR: [{ name: contains }, { code: contains }] } },
    { teamMembers: { some: { team: { isActive: true, name: contains } } } },
    { ledTeams: { some: { isActive: true, name: contains } } },
  ];
  // Preserve the existing BPO roster's designation-based eligibility.
  if (category === 'BPO') eligible.push({ designation: { OR: [{ name: contains }, { code: contains }] } });
  where.AND = [{ OR: eligible }];
  return where;
}
