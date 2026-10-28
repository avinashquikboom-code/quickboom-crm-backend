import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { LeadRepository } from './lead.repository';

/** Extra Visitor restriction; authentication, permissions and tenant guards still run. */
@Injectable()
export class VisitorLeadActionsGuard implements CanActivate {
  constructor(private readonly repository: LeadRepository) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    if (!(await this.repository.isVisitorUser(request.user))) return true;
    const handler = context.getHandler().name;
    if (handler === 'checkDuplicate' || handler === 'updateStatus') return true;
    if (handler === 'manageVisit' && ['START', 'COMPLETE'].includes(request.body?.action) && request.body?.employeeId == null) return true;
    throw new ForbiddenException('Visitors may only complete their assigned scheduled visit; other lead mutations are forbidden.');
  }
}
