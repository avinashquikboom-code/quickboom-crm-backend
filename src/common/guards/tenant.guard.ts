import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RoleType } from '@prisma/client';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Super Admins bypass tenant isolation check
    if (user && user.roles?.includes(RoleType.SUPER_ADMIN)) {
      return true;
    }

    const headerTenantId = request.headers['x-tenant-id'];
    const userTenantId = user?.tenantId;

    if (!userTenantId) {
      throw new ForbiddenException('User does not belong to any tenant');
    }

    if (headerTenantId && headerTenantId !== userTenantId) {
      throw new ForbiddenException('Cross-tenant access forbidden');
    }

    request.tenantId = userTenantId;
    return true;
  }
}
