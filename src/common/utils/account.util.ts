export function isUserSuperAdmin(user: any): boolean {
  const norm = (val?: any) => String(val || '').toUpperCase().trim();
  return norm(user?.accountType) === 'SUPER_ADMIN' || norm(user?.role) === 'SUPER_ADMIN';
}
export function isUserAdmin(user: any): boolean {
  const norm = (val?: any) => String(val || '').toUpperCase().trim();
  const acc = norm(user?.accountType);
  const role = norm(user?.role);
  const roles = Array.isArray(user?.roles) ? user.roles.map((r: any) => norm(r)) : [];
  return (
    ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'].includes(acc) ||
    ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'].includes(role) ||
    roles.some((r: string) => ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'].includes(r))
  );
}
export function isUserAdminOrStaff(user: any): boolean { return isUserAdmin(user) || Boolean(user?.employee?.id); }
export function isUserNormalCustomer(user: any): boolean { return !isUserAdminOrStaff(user); }
