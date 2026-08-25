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
      if (explicitCustomerId) {
        request.customerId = String(explicitCustomerId).trim();
      } else if (user?.customerId != null) {
        request.customerId = String(user.customerId).trim();
      }
      return true;
    }

    const queryCustomerId = request.query?.customerId;
    const headerCustomerId = request.headers['x-customer-id'];
    const userCustomerId = user?.customerId != null ? String(user.customerId).trim() : undefined;

    if (!userCustomerId || userCustomerId.length === 0) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    if (headerCustomerId) {
      if (!this.matches(headerCustomerId, user.customerId)) {
        throw new ForbiddenException('Cross-customer access forbidden');
      }
    }

    if (queryCustomerId) {
      if (!this.matches(queryCustomerId, user.customerId)) {
        throw new ForbiddenException('Cross-customer access forbidden');
      }
    }

    request.customerId = user.customerId;
    return true;
  }

  private matches(requestedId: any, userCustomerId: any): boolean {
    if (!requestedId || userCustomerId == null) return false;
    const reqStr = String(requestedId).trim().toLowerCase();
    const userStr = String(userCustomerId).trim().toLowerCase();

    if (reqStr === userStr) return true;

    const reqNumeric = reqStr.replace(/^cust[-_]?0*/, '');
    const userNumeric = userStr.replace(/^cust[-_]?0*/, '');
    if (reqNumeric && userNumeric && reqNumeric === userNumeric) {
      return true;
    }

    return false;
  }
}

