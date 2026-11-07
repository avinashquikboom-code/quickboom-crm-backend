import { ForbiddenException } from '@nestjs/common';
import { classifyCrmEmployee, CrmEmployeeCategory } from './crm-employee-category';

export const CRM_APP_ACCESS_DENIED =
  'Access Denied. The CRM application is available only to BPO and Visitor employees. Please contact your administrator.';

export function isCrmAppHeader(value?: string | string[]): boolean {
  const header = Array.isArray(value) ? value[0] : value;
  return String(header || '').trim().toLowerCase() === 'crm';
}

function teamSignals(employee: any): string[] {
  const memberships = Array.isArray(employee?.teamMembers) ? employee.teamMembers : [];
  const ledTeams = Array.isArray(employee?.ledTeams) ? employee.ledTeams : [];
  return [
    ...memberships.flatMap((membership: any) => [membership?.team?.name, membership?.team?.code]),
    ...ledTeams.flatMap((team: any) => [team?.name, team?.code]),
  ].filter(Boolean);
}

export function crmCategoryForEmployee(employee: any): CrmEmployeeCategory {
  const designation = employee?.designation;
  return classifyCrmEmployee({
    departmentName: employee?.department?.name,
    departmentCode: employee?.department?.code,
    designationName: typeof designation === 'string' ? designation : designation?.name,
    designationCode: designation?.code,
    roles: teamSignals(employee),
  });
}

/** Reads the employee, department, and team from the database. Does not trust the client. */
export async function assertCrmAppEmployee(prisma: any, user: any): Promise<CrmEmployeeCategory> {
  const employeeId = Number(user?.employee?.id || user?.employeeId);
  const userId = Number(user?.id || user?.sub);
  let employee = user?.employee;
  if (prisma?.employee?.findFirst) {
    const loaded = await prisma.employee.findFirst({
      where: {
        OR: [
          ...(Number.isInteger(employeeId) && employeeId > 0 ? [{ id: employeeId }] : []),
          ...(Number.isInteger(userId) && userId > 0 ? [{ userId }] : []),
        ],
      },
      include: {
        department: true,
        designation: true,
        teamMembers: { include: { team: true } },
        ledTeams: true,
      },
    }).catch(() => null);
    if (loaded) employee = loaded;
  }

  const category = crmCategoryForEmployee(employee);
  const active = employee?.status === 'ACTIVE' && employee?.mobileLoginEnabled !== false;
  if (!employee || !active || (category !== 'BPO' && category !== 'VISITOR')) {
    throw new ForbiddenException(CRM_APP_ACCESS_DENIED);
  }
  return category;
}
