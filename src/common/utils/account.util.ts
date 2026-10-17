export function isUserSuperAdmin(user: any): boolean { return user?.accountType === 'SUPER_ADMIN'; }
export function isUserAdmin(user: any): boolean { return ['SUPER_ADMIN', 'ADMIN'].includes(user?.accountType); }
export function isUserAdminOrStaff(user: any): boolean { return isUserAdmin(user) || Boolean(user?.employee?.id); }
export function isUserNormalCustomer(user: any): boolean { return !isUserAdminOrStaff(user); }
