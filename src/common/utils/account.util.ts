export function isUserSuperAdmin(user: any): boolean {
  if (!user) return false;
  const norm = (val?: any) => String(val || '').toUpperCase().trim().replace(/[\s-]+/g, '_');
  const acc = norm(user?.accountType);
  const role = norm(user?.role);
  const roles = Array.isArray(user?.roles)
    ? user.roles.map((r: any) => norm(typeof r === 'string' ? r : r?.name || r?.role?.name))
    : [];
  return acc === 'SUPER_ADMIN' || role === 'SUPER_ADMIN' || roles.includes('SUPER_ADMIN');
}
export function isUserAdmin(user: any): boolean {
  if (!user) return false;
  const norm = (val?: any) => String(val || '').toUpperCase().trim().replace(/[\s-]+/g, '_');
  const acc = norm(user?.accountType);
  const role = norm(user?.role);
  const roles = Array.isArray(user?.roles)
    ? user.roles.map((r: any) => norm(typeof r === 'string' ? r : r?.name || r?.role?.name))
    : [];
  const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'];
  return (
    adminRoles.includes(acc) ||
    adminRoles.includes(role) ||
    roles.some((r: string) => adminRoles.includes(r))
  );
}
export function isUserAdminOrStaff(user: any): boolean { return isUserAdmin(user) || Boolean(user?.employee?.id); }
export function isUserNormalCustomer(user: any): boolean { return !isUserAdminOrStaff(user); }
