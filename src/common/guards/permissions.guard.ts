import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, RequiredPermission } from '../decorators/permissions.decorator';
import { RoleType } from '@prisma/client';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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

    if (
      userRoles.some((r: string) =>
        [
          'SUPER_ADMIN',
          'CUSTOMER_ADMIN',
          'COMPANY_ADMIN',
          'TENANT_ADMIN',
          'CUSTOMER',
          'ADMIN',
        ].includes(r),
      )
    ) {
      return true;
    }

    const userPermissions: { module?: string; action?: string }[] = user.permissions || [];
    const checkMatch = (reqPerm: RequiredPermission, userPerm: { module?: string; action?: string }) => {
      const uMod = (userPerm.module || '').toUpperCase().replace(/^EMPLOYEE\./, '').replace(/\./g, '_');
      const uAct = (userPerm.action || '').toUpperCase();
      const rMod = (reqPerm.module || '').toUpperCase().replace(/^EMPLOYEE\./, '').replace(/\./g, '_');
      const rAct = (reqPerm.action || '').toUpperCase();

      const modMatches = uMod === rMod || uMod === rMod.replace(/_/g, '');
      const actMatches =
        uAct === rAct ||
        uAct === 'MANAGE' ||
        uAct === 'ALL' ||
        (rAct === 'VIEW' && uAct === 'READ') ||
        (rAct === 'READ' && uAct === 'VIEW') ||
        (rAct === 'CHANGE_STAGE' && (uAct === 'CHANGE_STAGE' || uAct === 'EDIT'));
      return modMatches && actMatches;
    };

    const hasPermission = requiredPermissions.every((reqPerm) =>
      userPermissions.some((userPerm) => checkMatch(reqPerm, userPerm)),
    );

    if (!hasPermission) {
      const missing = requiredPermissions
        .filter((reqPerm) => !userPermissions.some((userPerm) => checkMatch(reqPerm, userPerm)))
        .map((p) => `${p.module}:${p.action}`)
        .join(', ');
      throw new ForbiddenException(`Access denied: Missing required permission [${missing}]`);
    }

    return true;
  }
}
