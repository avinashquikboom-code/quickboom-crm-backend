import { CUSTOMER_APP_PERMISSIONS, ROLE_PERMISSION_DEFAULTS } from '../constants/rbac.constants';

type PermissionItem = { module: string; action: string };

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
  const roleRows = customer.mobileRole?.role?.rolePermissions || [];
  if (roleRows.length > 0) {
    items = roleRows
      .filter((rp: any) => String(rp.permission?.module || '').toUpperCase().startsWith('CUSTOMER_'))
      .map((rp: any) => ({
        module: String(rp.permission.module).toUpperCase(),
        action: String(rp.permission.action).toUpperCase(),
      }));
  } else if (!customer.mobileRoleId) {
    const ownRole = await prisma.designation.findFirst({
      where: { customerId: id, code: 'CUSTOMER', audience: 'CUSTOMER' },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });
    const ownRows = ownRole?.role?.rolePermissions || [];
    items = ownRows.length
      ? ownRows
          .filter((rp: any) => String(rp.permission?.module || '').toUpperCase().startsWith('CUSTOMER_'))
          .map((rp: any) => ({
            module: String(rp.permission.module).toUpperCase(),
            action: String(rp.permission.action).toUpperCase(),
          }))
      : defaults.map((p) => ({ module: p.module, action: p.action }));
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
