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
    (row) => Number(row?.customer?._count?.employees || row?.employeeCount || 0) > 0,
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

/**
 * Customer mobile effective permissions:
 * assigned customer role defaults, otherwise the seeded Customer role,
 * then INHERIT / ALLOW / DENY overrides on that customer.
 */
export async function resolveCustomerAppPermissionItems(
  prisma: any,
  customerId?: number | string | null,
): Promise<PermissionItem[]> {
  const id = Number(customerId);
  const defaults = ROLE_PERMISSION_DEFAULTS.CUSTOMER || [];
  if (!id || Number.isNaN(id) || !prisma?.customer?.findFirst) {
    return defaults;
  }

  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null },
    include: {
      mobileRole: {
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },
        },
      },
      moduleOverrides: true,
    },
  });

  if (!customer) return defaults;

  let items: PermissionItem[] = [];
  let roleResolved = false;

  const roleRows = customer.mobileRole?.role?.rolePermissions || [];
  if (customer.mobileRole?.role) {
    roleResolved = true;
    items = mapCustomerRolePermissionRows(roleRows);
  } else if (!customer.mobileRoleId && typeof prisma?.designation?.findMany === 'function') {
    try {
      const rows = await prisma.designation.findMany({
        where: { code: 'CUSTOMER', audience: 'CUSTOMER' },
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },
          customer: { select: { _count: { select: { employees: true } } } },
        },
      });
      const picked = pickConfiguredCustomerDesignation(rows);
      if (picked?.role) {
        roleResolved = true;
        items = mapCustomerRolePermissionRows(picked.role.rolePermissions);
      }
    } catch {
      roleResolved = false;
    }
  }

  if (!roleResolved && !customer.mobileRoleId && prisma?.designation?.findFirst) {
    // 1. Try finding customer-scoped Customer designation
    let ownRole = await prisma.designation.findFirst({
      where: { customerId: id, code: 'CUSTOMER', audience: 'CUSTOMER' },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });

    // 2. Fall back to master/tenant Customer designation (e.g. customerId: 1)
    if (!ownRole) {
      ownRole = await prisma.designation.findFirst({
        where: {
          code: 'CUSTOMER',
          audience: 'CUSTOMER',
        },
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },
        },
        orderBy: { id: 'asc' },
      });
    }

    // 3. Fall back to any designation with audience: 'CUSTOMER'
    if (!ownRole) {
      ownRole = await prisma.designation.findFirst({
        where: {
          audience: 'CUSTOMER',
        },
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },
        },
        orderBy: { id: 'asc' },
      });
    }

    if (ownRole?.role) {
      roleResolved = true;
      items = mapCustomerRolePermissionRows(ownRole.role.rolePermissions);
    }
  }

  // Only fall back to code defaults if no Customer role/designation was ever configured in the database
  if (!roleResolved && !customer.mobileRoleId) {
    items = defaults.map((p) => ({ module: p.module, action: p.action }));
  }

  const map = new Map<string, PermissionItem>();
  for (const item of items) {
    map.set(`${item.module}:${item.action}`, item);
  }

  for (const ov of customer.moduleOverrides || []) {
    const raw = String(ov.override || '').toUpperCase();
    const key = String(ov.moduleKey || '');
    const matches = CUSTOMER_APP_PERMISSIONS.filter(
      (p) =>
        p.key.toLowerCase() === key.toLowerCase() ||
        `${p.module}:${p.action}` === key.toUpperCase() ||
        p.module.toUpperCase() === key.toUpperCase(),
    );
    if (!matches.length || raw === 'INHERIT' || raw === 'DEFAULT') continue;
    for (const match of matches) {
      const item = { module: match.module, action: match.action };
      if (raw === 'ALLOW') map.set(`${item.module}:${item.action}`, item);
      if (raw === 'DENY') map.delete(`${item.module}:${item.action}`);
    }
  }

  return Array.from(map.values());
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
