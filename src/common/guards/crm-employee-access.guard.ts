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

    const required = this.reflector.getAllAndOverride<Array<'SALES' | 'VISITOR'>>(CRM_CATEGORY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) || ['SALES', 'VISITOR'];

    const category = await this.resolveCategory(user);
    const employeeStatus = String(user.employee?.status || 'ACTIVE').toUpperCase();
    const sharedRoute = required.includes('SALES') && required.includes('VISITOR');
    const allowed = employeeStatus === 'ACTIVE' && (
      required.includes(category as 'SALES' | 'VISITOR') ||
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

    await this.assertOwnRecords(request, user);
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

  private async assertOwnRecords(request: any, user: any) {
    const requested = Number(request.query?.employeeId ?? request.query?.assignedToId);
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    const broaderAccess = permissions.some((permission: any) => {
      const module = String(permission?.module || '').toUpperCase().replace(/^EMPLOYEE\./, '').replace(/[.:]/g, '_');
      const action = String(permission?.action || '').toUpperCase();
      return ['DATA_CAPTURE', 'DATACAPTURE'].includes(module) &&
        ['VIEW_ALL', 'ALL', 'MANAGE', '*'].includes(action);
    });
    if (Number.isInteger(requested) && requested > 0 && !broaderAccess) {
      const ownIds = [user.employee?.id, user.employeeId]
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      if (!ownIds.includes(requested)) {
        throw new ForbiddenException('You can only access CRM records assigned to you.');
      }
    }

    const path = String(request.originalUrl || request.url || '');
    if (!path.includes('/data-capture/') || isUserAdmin(user) || broaderAccess) return;
    const userId = Number(user.id || user.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new ForbiddenException('Authenticated employee required to access capture records.');
    }
    const jobId = request.params?.jobId ||
      (path.includes('/jobs/') ? request.params?.id : null);
    if (jobId && this.prisma?.dataCaptureJob?.findFirst) {
      const ownedJob = await this.prisma.dataCaptureJob.findFirst({
        where: {
          jobId: String(jobId),
          userId,
          ...(Number(user.customerId) > 0 ? { customerId: Number(user.customerId) } : {}),
        },
        select: { jobId: true },
      });
      if (!ownedJob) throw new ForbiddenException('You can only access your own capture sessions.');
      return;
    }
    const recordId = Number(request.params?.id);
    if (Number.isInteger(recordId) && recordId > 0 && this.prisma?.dataCapturePlace?.findFirst) {
      const ownedRecord = await this.prisma.dataCapturePlace.findFirst({
        where: {
          id: recordId,
          ...(Number(user.customerId) > 0 ? { customerId: Number(user.customerId) } : {}),
          job: { is: { userId } },
        },
        select: { id: true },
      });
      if (!ownedRecord) throw new ForbiddenException('You can only access your own captured records.');
    }

    const body = request.body || {};
    const requestedIds = [
      ...(Array.isArray(body.ids) ? body.ids : []),
      ...(Array.isArray(body.placeIds) ? body.placeIds : []),
      ...(Array.isArray(body.captureIds) ? body.captureIds : []),
      ...(Array.isArray(body.places) ? body.places.map((item: any) => item?.id || item?.captureId || item?.dataCaptureId) : []),
    ].map(Number).filter((id: number) => Number.isInteger(id) && id > 0);
    const uniqueIds = [...new Set(requestedIds)];
    if (uniqueIds.length && this.prisma?.dataCapturePlace?.findMany) {
      const ownedRecords = await this.prisma.dataCapturePlace.findMany({
        where: {
          id: { in: uniqueIds },
          ...(Number(user.customerId) > 0 ? { customerId: Number(user.customerId) } : {}),
          job: { is: { userId } },
        },
        select: { id: true },
      });
      if (ownedRecords.length !== uniqueIds.length) {
        throw new ForbiddenException('You can only access your own captured records.');
      }
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
