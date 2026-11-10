import { ForbiddenException } from '@nestjs/common';
import { classifyCrmEmployee, CrmEmployeeCategory } from './crm-employee-category';

export const CRM_APP_ACCESS_RESTRICTED_TITLE = 'Access Restricted';

export const CRM_APP_ACCESS_RESTRICTED_MESSAGE =
  'Your account is not authorized to access the QB Suite CRM application.\n\nCRM access is available exclusively to BPO and Visitor team employees. Your account does not belong to an eligible team.\n\nPlease contact your administrator if you believe this is a mistake.';

export const CRM_APP_ACCESS_DENIED = CRM_APP_ACCESS_RESTRICTED_MESSAGE;

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
  const explicitLeadAccess = hasExplicitLeadView(user);
  if (!employee || !active || (category === 'NONE' && !explicitLeadAccess)) {
    throw new ForbiddenException({
      statusCode: 403,
      error: CRM_APP_ACCESS_RESTRICTED_TITLE,
      message: CRM_APP_ACCESS_RESTRICTED_MESSAGE,
    });
  }
  return category === 'NONE' ? 'SALES' : category;
}

export function hasExplicitLeadView(user: any): boolean {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.some((permission: any) => {
    const moduleName = String(permission?.module || '').toUpperCase().replace(/^EMPLOYEE\./, '');
    const action = String(permission?.action || '').toUpperCase();
    return (moduleName === 'LEADS' || moduleName === 'LEAD') && ['VIEW', 'READ', 'MANAGE', 'ALL'].includes(action);
  });
}
