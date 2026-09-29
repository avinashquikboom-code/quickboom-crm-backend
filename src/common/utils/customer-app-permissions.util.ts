import { ROLE_PERMISSION_DEFAULTS } from '../constants/rbac.constants';

type PermissionItem = { module: string; action: string };

/**
 * Saved Customer designation permissions, or the default customer-app set
 * when that designation has not been configured yet.
 * An existing role with zero permissions is an explicit deny-all.
 */
export async function resolveCustomerAppPermissionItems(
  prisma: any,
  customerId?: number | string | null,
): Promise<PermissionItem[]> {
  const id = Number(customerId);
  if (!id || Number.isNaN(id) || !prisma?.designation?.findFirst) {
    return ROLE_PERMISSION_DEFAULTS.CUSTOMER || [];
  }

  const designation = await prisma.designation.findFirst({
    where: { customerId: id, code: 'CUSTOMER' },
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: true } },
        },
      },
    },
  });

  if (!designation?.role) {
    return ROLE_PERMISSION_DEFAULTS.CUSTOMER || [];
  }

  return (designation.role.rolePermissions || [])
    .filter((rp: any) =>
      String(rp.permission?.module || '').toUpperCase().startsWith('CUSTOMER_'),
    )
    .map((rp: any) => ({
      module: String(rp.permission.module).toUpperCase(),
      action: String(rp.permission.action).toUpperCase(),
    }));
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
