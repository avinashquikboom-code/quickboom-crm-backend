import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WORKSPACE_ACTION_KEY } from '../decorators/workspace-action.decorator';
import { isUserAdmin } from '../utils/account.util';
/** Fixed workspace boundaries. Individual record ownership remains in each service. */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>('isPublic', [context.getHandler(), context.getClass()])) return true;
    const user = context.switchToHttp().getRequest().user;
    if (!user?.id) throw new ForbiddenException('Authentication required');
    if (isUserAdmin(user)) return true;
    const actions = this.reflector.getAllAndOverride<{module: string; action: string}[]>(WORKSPACE_ACTION_KEY, [context.getHandler(), context.getClass()]) || [];
    const ownModules = new Set(['ATTENDANCE', 'LEAVE', 'TASKS', 'VISITS', 'DATA_CAPTURE']);
    if (user.employee?.status === 'ACTIVE' && actions.every(a => ownModules.has(a.module) || (a.module === 'SALARY' && a.action === 'VIEW'))) return true;
    throw new ForbiddenException('Administrator account required');
  }
}
