import { CUSTOMER_APP_PERMISSIONS, ROLE_PERMISSION_DEFAULTS } from '../constants/rbac.constants';

type PermissionItem = { module: string; action: string };

export function mapCustomerRolePermissionRows(rows: any[]): PermissionItem[] {
  return (rows || [])
    .filter((rp) => String(rp?.permission?.module || '').toUpperCase().startsWith('CUSTOMER_'))
    .map((rp) => ({
      module: String(rp.permission.module).toUpperCase(),
      action: String(rp.permission.action).toUpperCase(),
    }));
}

/**
 * Roles & Permissions edits the company Customer designation.
 * Prefer that tenant role (the customer that has employees) and the most
 * recently saved permission set. A client-owned copy must not override it.
 */
export function pickConfiguredCustomerDesignation(rows: any[]): any | null {
  const withRole = (rows || []).filter((row) => row?.role);
  const tenantRoles = withRole.filter(
    (row) => Number(row?.employeeCount || 0) > 0,
  );
  const pool = tenantRoles.length ? tenantRoles : withRole;
  pool.sort((a, b) => {
    const aTime = new Date(a?.role?.permissionsUpdatedAt || a?.updatedAt || 0).getTime();
    const bTime = new Date(b?.role?.permissionsUpdatedAt || b?.updatedAt || 0).getTime();
    if (bTime !== aTime) return bTime - aTime;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
  return pool[0] || null;
}

export async function resolveMasterCustomerRoleItems(prisma: any): Promise<PermissionItem[] | null> {
  if (typeof prisma?.designation?.findMany === 'function') {
    try {
      const rows = await prisma.designation.findMany({
        where: { code: 'CUSTOMER', audience: 'CUSTOMER' },
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },

        },
      });
      const picked = pickConfiguredCustomerDesignation(rows);
      if (picked?.role?.rolePermissions) {
        return mapCustomerRolePermissionRows(picked.role.rolePermissions);
      }
    } catch {
      // fallback
    }
  }

  if (typeof prisma?.designation?.findFirst === 'function') {
    try {
      const ownRole = await prisma.designation.findFirst({
        where: {
          OR: [
            { code: 'CUSTOMER', audience: 'CUSTOMER' },
            { audience: 'CUSTOMER' },
          ],
        },
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },
        },
        orderBy: { id: 'asc' },
      });
      if (ownRole?.role?.rolePermissions) {
        return mapCustomerRolePermissionRows(ownRole.role.rolePermissions);
      }
    } catch {
      // fallback
    }
  }

  return null;
}

/**
 * Customer mobile effective permissions:
 * assigned customer role defaults, otherwise the seeded Customer role,
 * then INHERIT / ALLOW / DENY overrides on that customer.
 */
export async function resolveCustomerAppPermissionItems(
  prisma: any,
  customerId?: number | string | null,
): Promise<PermissionItem[]> {
throw new Error('Customer app permissions have been removed');
  }

export function applyPermissionItems(
  permissionsMap: Map<string, PermissionItem>,
  items: PermissionItem[],
) {
  for (const item of items) {
    const module = item.module.toUpperCase();
    const action = item.action.toUpperCase();
    permissionsMap.set(`${module}:${action}`, { module, action });
  }
}

/**
 * Replace CUSTOMER_* entries with the effective customer-app set.
 * If clearNonCustomer is true (for pure customer sessions), removes all non-customer permissions too.
 */
export function applyCustomerEffectivePermissions(
  permissionsMap: Map<string, PermissionItem>,
  items: PermissionItem[],
  clearNonCustomer = false,
) {
  if (clearNonCustomer) {
    permissionsMap.clear();
  } else {
    for (const key of Array.from(permissionsMap.keys())) {
      if (key.startsWith('CUSTOMER_')) {
        permissionsMap.delete(key);
      }
    }
  }
  applyPermissionItems(permissionsMap, items);
}
