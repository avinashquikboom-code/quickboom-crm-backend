import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { CRM_CATEGORY_KEY } from '../decorators/crm-category.decorator';
import { classifyCrmEmployee, CrmEmployeeCategory } from '../crm/crm-employee-category';
import { crmCategoryForEmployee, hasExplicitLeadView } from '../crm/crm-app-access';
import {
  CRM_APP_ACCESS_DENIED,
  CRM_APP_ACCESS_RESTRICTED_TITLE,
  CRM_APP_ACCESS_RESTRICTED_MESSAGE,
} from '../crm/crm-app-access';
import { isUserAdmin } from '../utils/role.util';

@Injectable()
export class CrmEmployeeAccessGuard implements CanActivate {
  private readonly logger = new Logger(CrmEmployeeAccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    if (isUserAdmin(user)) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<Array<'BPO' | 'VISITOR' | 'SALES'>>(CRM_CATEGORY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) || ['BPO', 'VISITOR', 'SALES'];

    const category = await this.resolveCategory(user);
    const employeeStatus = String(user.employee?.status || 'ACTIVE').toUpperCase();
    const sharedRoute = required.includes('BPO') && required.includes('VISITOR') && required.includes('SALES');
    const allowed = employeeStatus === 'ACTIVE' && (
      required.includes(category as 'BPO' | 'VISITOR' | 'SALES') ||
      (sharedRoute && category === 'NONE' && hasExplicitLeadView(user))
    );
    if (!allowed) {
      const message = CRM_APP_ACCESS_RESTRICTED_MESSAGE;
      await this.audit(request, user, category, 'ACCESS_DENIED', 'FAILED', message);
      throw new ForbiddenException({
        statusCode: 403,
        error: CRM_APP_ACCESS_RESTRICTED_TITLE,
        message: CRM_APP_ACCESS_RESTRICTED_MESSAGE,
      });
    }

    this.assertOwnRecords(request, user);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(request.method || '').toUpperCase())) {
      await this.audit(request, user, category, 'ACCESS', 'SUCCESS');
    }
    return true;
  }

  private async resolveCategory(user: any): Promise<CrmEmployeeCategory> {
    let employee = user.employee;
    if (this.prisma?.employee?.findFirst) {
      const employeeId = Number(user.employee?.id || user.employeeId);
      const loaded = await this.prisma.employee.findFirst({
        where: {
          OR: [
            ...(Number.isInteger(employeeId) && employeeId > 0 ? [{ id: employeeId }] : []),
            ...(user.id ? [{ userId: Number(user.id) }] : []),
          ],
        },
        include: {
          department: true,
          designation: true,
          teamMembers: { include: { team: true } },
          ledTeams: true,
        },
      }).catch(() => null);
      if (loaded) {
        employee = loaded;
        user.employee = loaded;
      }
    }

    const category = crmCategoryForEmployee(employee);
    if (category !== 'NONE') return category;
    return classifyCrmEmployee({
      roles: [user.role, user.roleType, ...(Array.isArray(user.roles) ? user.roles : [])],
    });
  }

  private assertOwnRecords(request: any, user: any) {
    const requested = Number(request.query?.employeeId ?? request.query?.assignedToId);
    if (!Number.isInteger(requested) || requested <= 0) return;
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    const broaderAccess = permissions.some((permission: any) => {
      const action = String(permission?.action || '').toUpperCase();
      return action === 'VIEW_ALL' || action === 'ALL' || action === 'MANAGE' || action === '*';
    });
    if (broaderAccess) return;
    const ownIds = [user.employee?.id, user.employeeId]
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (!ownIds.includes(requested)) {
      throw new ForbiddenException('You can only access CRM records assigned to you.');
    }
  }

  private async audit(
    request: any,
    user: any,
    category: CrmEmployeeCategory,
    action: string,
    status: 'SUCCESS' | 'FAILED',
    errorMessage?: string,
  ) {
    const customerId = Number(user.customerId || user.employee?.customerId);
    const payload = {
      customerId: Number.isInteger(customerId) && customerId > 0 ? customerId : null,
      userId: Number(user.id) || null,
      userName: user.email || user.fullName || null,
      userRole: String(user.role || 'EMPLOYEE'),
      source: 'MOBILE_APP',
      action,
      module: 'CRM',
      description: `CRM ${category} ${request.method} ${request.originalUrl || request.url}`,
      endpoint: String(request.originalUrl || request.url || ''),
      method: String(request.method || ''),
      status,
      errorMessage: errorMessage || null,
      details: { crmCategory: category },
    };
    this.logger.log(`[CRM_ACCESS] ${status} category=${category} ${payload.method} ${payload.endpoint}`);
    if (!this.prisma?.auditLog?.create) return;
    await this.prisma.auditLog.create({ data: payload }).catch((error: any) => {
      this.logger.warn(`[CRM_ACCESS] audit log skipped: ${error?.message || error}`);
    });
  }
}
