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
import { CRM_APP_ACCESS_DENIED } from '../crm/crm-app-access';
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

    const required = this.reflector.getAllAndOverride<Array<'BPO' | 'VISITOR'>>(CRM_CATEGORY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) || ['BPO', 'VISITOR'];

    const category = await this.resolveCategory(user);
    const employeeStatus = String(user.employee?.status || 'ACTIVE').toUpperCase();
    const allowed = employeeStatus === 'ACTIVE' && required.includes(category as 'BPO' | 'VISITOR');
    if (!allowed) {
      const message = CRM_APP_ACCESS_DENIED;
      await this.audit(request, user, category, 'ACCESS_DENIED', 'FAILED', message);
      throw new ForbiddenException(message);
    }

    this.assertOwnRecords(request, user);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(request.method || '').toUpperCase())) {
      await this.audit(request, user, category, 'ACCESS', 'SUCCESS');
    }
    return true;
  }

  private async resolveCategory(user: any): Promise<CrmEmployeeCategory> {
    let department = user.employee?.department;
    let designation = user.employee?.designation;
    const needsLookup = !department?.name && !designation?.name;
    if (needsLookup && this.prisma?.employee) {
      const employeeId = Number(user.employee?.id || user.employeeId);
      const employee = await this.prisma.employee.findFirst({
        where: {
          OR: [
            ...(Number.isInteger(employeeId) && employeeId > 0 ? [{ id: employeeId }] : []),
            ...(user.id ? [{ userId: Number(user.id) }] : []),
          ],
        },
        include: { department: true, designation: true },
      }).catch(() => null);
      department = employee?.department || department;
      designation = employee?.designation || designation;
      if (employee && user.employee) {
        user.employee.id = user.employee.id || employee.id;
      } else if (employee) {
        user.employee = employee;
      }
    }

    const roles = [
      user.role,
      user.roleType,
      ...(Array.isArray(user.roles) ? user.roles : []),
    ];
    return classifyCrmEmployee({
      departmentName: department?.name,
      departmentCode: department?.code,
      designationName: typeof designation === 'string' ? designation : designation?.name,
      designationCode: designation?.code,
      roles,
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
