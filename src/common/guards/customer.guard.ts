import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RoleType } from '@prisma/client';

@Injectable()
export class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Super Admins bypass customer isolation check
    const isSuperAdmin = Boolean(
      user && (
        user.roles?.includes(RoleType.SUPER_ADMIN) ||
        user.roles?.includes('SUPER_ADMIN') ||
        user.roles?.some((r: any) => String(r).toUpperCase().replace(/\s+/g, '_') === 'SUPER_ADMIN') ||
        String(user.role).toUpperCase().replace(/\s+/g, '_') === 'SUPER_ADMIN'
      )
    );

    if (isSuperAdmin) {
      const explicitCustomerId = request.headers['x-customer-id'] || request.query?.customerId;
      if (explicitCustomerId && !isNaN(Number(explicitCustomerId)) && Number(explicitCustomerId) > 0) {
        request.customerId = Number(explicitCustomerId);
      } else if (user?.customerId) {
        request.customerId = Number(user.customerId);
      }
      return true;
    }

    const headerCustomerId = request.headers['x-customer-id'];
    const userCustomerId = user?.customerId;

    if (!userCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    if (headerCustomerId && Number(headerCustomerId) !== Number(userCustomerId)) {
      throw new ForbiddenException('Cross-customer access forbidden');
    }

    request.customerId = Number(userCustomerId);
    return true;
  }
}

