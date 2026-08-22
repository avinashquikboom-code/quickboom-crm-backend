import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleType } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleType[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || (!user.roles && !user.role)) {
      throw new ForbiddenException('Access denied: No user roles present');
    }

    const userRoles: string[] = Array.isArray(user.roles)
      ? user.roles.map((r: any) => String(r).toUpperCase().replace(/\s+/g, '_'))
      : (user.role ? [String(user.role).toUpperCase().replace(/\s+/g, '_')] : []);

    const hasSuperAdmin = userRoles.includes('SUPER_ADMIN');
    if (hasSuperAdmin) {
      return true;
    }

    const hasRole = requiredRoles.some((role) => {
      const normalizedReq = String(role).toUpperCase().replace(/\s+/g, '_');
      return userRoles.includes(normalizedReq);
    });

    if (!hasRole) {
      throw new ForbiddenException(`Requires one of roles: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}

