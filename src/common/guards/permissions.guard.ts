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

    if (user.roles?.includes(RoleType.SUPER_ADMIN) || user.roles?.includes(RoleType.CUSTOMER_ADMIN)) {
      return true;
    }

    const userPermissions = user.permissions || [];
    const hasPermission = requiredPermissions.every((reqPerm) =>
      userPermissions.some(
        (userPerm) =>
          userPerm.module === reqPerm.module &&
          (userPerm.action === reqPerm.action || userPerm.action === 'MANAGE'),
      ),
    );

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient fine-grained permissions');
    }

    return true;
  }
}
