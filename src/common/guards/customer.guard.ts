import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { isUserSuperAdmin } from '../utils/role.util';

@Injectable()
export class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const isSuperAdmin = isUserSuperAdmin(user);

    if (isSuperAdmin) {
      request.isSuperAdmin = true;
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
