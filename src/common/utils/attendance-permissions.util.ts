import { fromPermissionKey, STANDARD_PERMISSIONS } from '../constants/rbac.constants';

type Permission = { module: string; action: string };
type Override = { moduleKey: string; override: string };

export function isAttendanceOverride(override: Override): boolean {
  return fromPermissionKey(override.moduleKey).module === 'ATTENDANCE';
}

/** Resolve legacy grants before overrides; never promote a granular grant to CREATE. */
export function applyAttendancePermissions(
  permissions: Map<string, Permission>,
  overrides: Override[] = [],
): void {
  const add = (action: string) => permissions.set(`ATTENDANCE:${action}`, { module: 'ATTENDANCE', action });
  const canonical = (action: string) => action === 'CHECK_IN' ? 'PUNCH_IN' : action === 'CHECK_OUT' ? 'PUNCH_OUT' : action;
  const expand = () => {
    for (const action of ['CHECK_IN', 'CHECK_OUT']) {
      if (permissions.delete(`ATTENDANCE:${action}`)) add(canonical(action));
    }
    if (permissions.has('ATTENDANCE:MANAGE') || permissions.has('ATTENDANCE:ALL')) {
      STANDARD_PERMISSIONS.filter(p => p.module === 'ATTENDANCE').forEach(p => add(p.action));
      permissions.delete('ATTENDANCE:MANAGE');
      permissions.delete('ATTENDANCE:ALL');
    }
    if (permissions.has('ATTENDANCE:CREATE')) {
      add('PUNCH_IN');
      add('PUNCH_OUT');
      add('START_BREAK');
      add('END_BREAK');
    }
  };
  const attendanceOverrides = overrides.filter(isAttendanceOverride);
  for (const override of attendanceOverrides) {
    if (String(override.override).toUpperCase() !== 'ALLOW') continue;
    const key = override.moduleKey.trim();
    if (!key.includes('.') && !key.includes(':')) {
      STANDARD_PERMISSIONS.filter(p => p.module === 'ATTENDANCE').forEach(p => add(p.action));
    } else {
      add(canonical(fromPermissionKey(key).action));
    }
  }
  expand();
  // DENY wins independently of database row order, including broad legacy grants.
  for (const override of attendanceOverrides) {
    if (String(override.override).toUpperCase() !== 'DENY') continue;
    const key = override.moduleKey.trim();
    const action = canonical(fromPermissionKey(key).action);
    if ((!key.includes('.') && !key.includes(':')) || ['MANAGE', 'ALL'].includes(action)) {
      for (const permission of permissions.keys()) {
        if (permission.startsWith('ATTENDANCE:')) permissions.delete(permission);
      }
    } else if (action === 'CREATE') {
      for (const denied of ['CREATE', 'PUNCH_IN', 'PUNCH_OUT', 'START_BREAK', 'END_BREAK']) {
        permissions.delete(`ATTENDANCE:${denied}`);
      }
    } else if (action === 'PUNCH_IN') {
      permissions.delete('ATTENDANCE:PUNCH_IN');
      permissions.delete('ATTENDANCE:CREATE');
    } else if (action === 'PUNCH_OUT') {
      permissions.delete('ATTENDANCE:PUNCH_OUT');
      permissions.delete('ATTENDANCE:CREATE');
    } else {
      permissions.delete(`ATTENDANCE:${action}`);
    }
  }
}
