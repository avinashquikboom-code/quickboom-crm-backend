import { RoleType } from '@prisma/client';

export function isUserSuperAdmin(user: any): boolean {
  if (!user) return false;
  if (user.role) {
    const normalized = String(user.role).toUpperCase().replace(/[\s_]+/g, '');
    if (normalized === 'SUPERADMIN' || user.role === RoleType.SUPER_ADMIN) {
      return true;
    }
  }
  if (Array.isArray(user.roles)) {
    return user.roles.some((r: any) => {
      if (!r) return false;
      const val = typeof r === 'string' ? r : r?.type || r?.name || String(r);
      const normalized = String(val).toUpperCase().replace(/[\s_]+/g, '');
      return normalized === 'SUPERADMIN' || r === RoleType.SUPER_ADMIN;
    });
  }
  if (Array.isArray(user.userRoles)) {
    return user.userRoles.some((ur: any) => {
      const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
      const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
      return type === RoleType.SUPER_ADMIN || name === 'SUPERADMIN' || name === 'SUPERADMINISTRATOR';
    });
  }
  return false;
}

export function isUserAdminOrStaff(user: any): boolean {
  if (!user) return false;
  if (isUserSuperAdmin(user)) return true;

  const rawRoles: any[] = [];
  if (user.role) rawRoles.push(user.role);
  if (user.roleType) rawRoles.push(user.roleType);
  if (Array.isArray(user.roles)) rawRoles.push(...user.roles);

  for (const r of rawRoles) {
    if (!r) continue;
    const val = typeof r === 'string' ? r : r?.type || r?.name || String(r);
    const normalized = String(val).toUpperCase().replace(/[\s_-]+/g, '');
    if (
      normalized === 'SUPERADMIN' ||
      normalized === 'COMPANYADMIN' ||
      normalized === 'CUSTOMERADMIN' ||
      normalized === 'TENANTADMIN' ||
      normalized === 'ADMIN' ||
      normalized === 'EMPLOYEE' ||
      normalized === 'SALESMANAGER' ||
      normalized === 'SALESEXECUTIVE' ||
      normalized === 'SUPPORTAGENT' ||
      normalized === 'CREATIVELEAD' ||
      normalized === 'EDITOR'
    ) {
      return true;
    }
  }
  return false;
}

export function isUserAdmin(user: any): boolean {
  if (!user) return false;
  if (isUserSuperAdmin(user)) return true;

  const rawRoles: any[] = [];
  if (user.role) rawRoles.push(user.role);
  if (user.roleType) rawRoles.push(user.roleType);
  if (Array.isArray(user.roles)) rawRoles.push(...user.roles);
  if (Array.isArray(user.userRoles)) {
    for (const ur of user.userRoles) {
      if (ur.role?.type) rawRoles.push(ur.role.type);
      if (ur.role?.name) rawRoles.push(ur.role.name);
    }
  }

  for (const r of rawRoles) {
    if (!r) continue;
    const val = typeof r === 'string' ? r : r?.type || r?.name || String(r);
    const normalized = String(val).toUpperCase().replace(/[\s_-]+/g, '');
    if (
      normalized === 'SUPERADMIN' ||
      normalized === 'COMPANYADMIN' ||
      normalized === 'CUSTOMERADMIN' ||
      normalized === 'TENANTADMIN' ||
      normalized === 'ADMIN'
    ) {
      return true;
    }
  }
  return false;
}

export function isUserNormalCustomer(user: any): boolean {
  if (!user) return true;
  if (isUserAdminOrStaff(user)) return false;
  return true;
}
