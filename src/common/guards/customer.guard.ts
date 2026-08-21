import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RoleType } from '@prisma/client';

@Injectable()
export class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Super Admins bypass customer isolation check
    if (user && user.roles?.includes(RoleType.SUPER_ADMIN)) {
      const explicitCustomerId = request.headers['x-customer-id'] || request.query?.customerId;
      if (explicitCustomerId) {
        request.customerId = Number(explicitCustomerId);
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
