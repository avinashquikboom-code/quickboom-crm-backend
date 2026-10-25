import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCOUNT_TYPES_KEY } from '../decorators/account-types.decorator';
@Injectable()
export class AccountGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<string[]>(ACCOUNT_TYPES_KEY, [context.getHandler(), context.getClass()]);
    const user = context.switchToHttp().getRequest().user;
    if (!user?.id) throw new ForbiddenException('Authentication required');
    if (allowed?.length && user.accountType !== 'SUPER_ADMIN' && !allowed.includes(user.accountType)) throw new ForbiddenException('Administrator account required');
    return true;
  }
}
