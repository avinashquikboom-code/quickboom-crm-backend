import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, RequiredPermission } from '../decorators/permissions.decorator';

export function userHasModulePermission(
  user: any,
  module: string,
  action: string,
): boolean {
  const userPermissions: { module?: string; action?: string }[] = user?.permissions || [];
  const rMod = String(module || '')
    .toUpperCase()
    .replace(/^EMPLOYEE\./, '')
    .replace(/\./g, '_');
  const rAct = String(action || '').toUpperCase();
  const normalizeMod = (m: string) => (m.endsWith('S') ? m.slice(0, -1) : m);

  return userPermissions.some((userPerm) => {
    const uMod = String(userPerm.module || '')
      .toUpperCase()
      .replace(/^EMPLOYEE\./, '')
      .replace(/\./g, '_');
    const uAct = String(userPerm.action || '').toUpperCase();
    const modMatches =
      uMod === rMod ||
      uMod === rMod.replace(/_/g, '') ||
      normalizeMod(uMod) === normalizeMod(rMod);
    const actMatches =
      uAct === rAct ||
      uAct === 'MANAGE' ||
      uAct === 'ALL' ||
      (rAct === 'VIEW' && (uAct === 'READ' || uAct === 'VIEW')) ||
      (rAct === 'CREATE' && (uAct === 'CREATE' || uAct === 'SCHEDULE' || uAct === 'ADD'));
    return modMatches && actMatches;
  });
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<RequiredPermission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    const userRoles: string[] = Array.isArray(user.roles)
      ? user.roles.map((r: any) => String(r).toUpperCase().replace(/\s+/g, '_'))
      : (user.role ? [String(user.role).toUpperCase().replace(/\s+/g, '_')] : []);

    const isPlatformAdmin = userRoles.some((r: string) =>
      ['SUPER_ADMIN', 'COMPANY_ADMIN', 'TENANT_ADMIN', 'ADMIN'].includes(r),
    );
    const isCustomerAccount = userRoles.some((r: string) =>
      ['CUSTOMER', 'CUSTOMER_ADMIN'].includes(r),
    );
    const customerScoped = requiredPermissions.filter((p) =>
      String(p.module || '').toUpperCase().startsWith('CUSTOMER_'),
    );

    if (isPlatformAdmin) {
      return true;
    }

    // Customer-admin workspace access stays open except customer-app modules.
    if (isCustomerAccount && customerScoped.length === 0) {
      return true;
    }

    // Employee routes are not gated by customer-app permissions.
    if (!isCustomerAccount && customerScoped.length === requiredPermissions.length) {
      return true;
    }

    const permissionsToCheck =
      isCustomerAccount && customerScoped.length > 0 ? customerScoped : requiredPermissions;

    const userPermissions: { module?: string; action?: string }[] = user.permissions || [];
    const checkMatch = (reqPerm: RequiredPermission, userPerm: { module?: string; action?: string }) => {
      const uMod = (userPerm.module || '').toUpperCase().replace(/^EMPLOYEE\./, '').replace(/\./g, '_');
      const uAct = (userPerm.action || '').toUpperCase();
      const rMod = (reqPerm.module || '').toUpperCase().replace(/^EMPLOYEE\./, '').replace(/\./g, '_');
      const rAct = (reqPerm.action || '').toUpperCase();

      const normalizeMod = (m: string) => (m.endsWith('S') ? m.slice(0, -1) : m);
      const isLeadScheduleVisitEquivalent =
        ((rMod === 'VISITS' && (rAct === 'CREATE' || rAct === 'SCHEDULE')) ||
          (rMod === 'LEADS' && rAct === 'SCHEDULE_VISIT')) &&
        (uMod === 'LEADS' && (uAct === 'SCHEDULE_VISIT' || uAct === 'SCHEDULE' || uAct === 'CHANGE_STAGE'));

      if (isLeadScheduleVisitEquivalent) {
        return true;
      }

      const modMatches =
        uMod === rMod ||
        uMod === rMod.replace(/_/g, '') ||
        normalizeMod(uMod) === normalizeMod(rMod);

      const actMatches =
        uAct === rAct ||
        uAct === 'MANAGE' ||
        uAct === 'ALL' ||
        (rAct === 'VIEW' && uAct === 'READ') ||
        (rAct === 'READ' && uAct === 'VIEW') ||
        ((rAct === 'CREATE' || rAct === 'SCHEDULE') &&
          (uAct === 'CREATE' || uAct === 'SCHEDULE' || uAct === 'SCHEDULE_VISIT' || uAct === 'ADD')) ||
        (rAct === 'CHANGE_STAGE' && (uAct === 'CHANGE_STAGE' || uAct === 'EDIT')) ||
        (rAct === 'SCHEDULE_VISIT' && (uAct === 'SCHEDULE_VISIT' || uAct === 'CHANGE_STAGE' || uAct === 'CREATE'));
      return modMatches && actMatches;
    };

    const hasPermission = permissionsToCheck.every((reqPerm) =>
      userPermissions.some((userPerm) => checkMatch(reqPerm, userPerm)),
    );

    if (!hasPermission) {
      const missing = permissionsToCheck
        .filter((reqPerm) => !userPermissions.some((userPerm) => checkMatch(reqPerm, userPerm)))
        .map((p) => `${p.module}:${p.action}`)
        .join(', ');
      throw new ForbiddenException(`Access denied: Missing required permission [${missing}]`);
    }

    return true;
  }
}
