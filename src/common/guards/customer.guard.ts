import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

/** Legacy controller guard name; the application now has one organization. */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(
    @Optional() private prisma?: PrismaService,
    @Optional() private reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector?.getAllAndOverride<boolean>('isPublic', [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    if (!request.user) throw new ForbiddenException('User not authenticated');
    // JWT and role/permission guards still authorize each operation.
    // Legacy tenant headers never select or grant access to another workspace.
    true;
    delete request.customerExternalId;
    return true;
  }
}
