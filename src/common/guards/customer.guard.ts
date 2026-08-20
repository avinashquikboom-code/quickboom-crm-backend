import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RoleType } from '@prisma/client';

@Injectable()
export class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Super Admins bypass customer isolation check
    if (user && user.roles?.includes(RoleType.SUPER_ADMIN)) {
      return true;
    }

    const headerCustomerId = request.headers['x-customer-id'];
    const userCustomerId = user?.customerId;

    if (!userCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    if (headerCustomerId && headerCustomerId !== userCustomerId) {
      throw new ForbiddenException('Cross-customer access forbidden');
    }

    request.customerId = userCustomerId;
    return true;
  }
}
