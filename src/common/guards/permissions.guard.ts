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
        ['SUPER_ADMIN', 'CUSTOMER_ADMIN', 'COMPANY_ADMIN', 'TENANT_ADMIN'].includes(r),
      )
    ) {
      return true;
    }

    const userPermissions: { module?: string; action?: string }[] = user.permissions || [];
    const hasPermission = requiredPermissions.every((reqPerm) =>
      userPermissions.some(
        (userPerm) =>
          userPerm.module?.toUpperCase() === reqPerm.module?.toUpperCase() &&
          (userPerm.action?.toUpperCase() === reqPerm.action?.toUpperCase() ||
            userPerm.action?.toUpperCase() === 'MANAGE' ||
            userPerm.action?.toUpperCase() === 'ALL'),
      ),
    );

    if (!hasPermission) {
      const missing = requiredPermissions
        .filter(
          (reqPerm) =>
            !userPermissions.some(
              (userPerm) =>
                userPerm.module?.toUpperCase() === reqPerm.module?.toUpperCase() &&
                (userPerm.action?.toUpperCase() === reqPerm.action?.toUpperCase() ||
                  userPerm.action?.toUpperCase() === 'MANAGE' ||
                  userPerm.action?.toUpperCase() === 'ALL'),
            ),
        )
        .map((p) => `${p.module}:${p.action}`)
        .join(', ');
      throw new ForbiddenException(`Access denied: Missing required permission [${missing}]`);
    }

    return true;
  }
}
