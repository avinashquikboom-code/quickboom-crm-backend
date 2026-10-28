import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditLogService } from './audit-log.service';

const EXCLUDED_URL_PREFIXES = [
  '/api/v1/audit-logs',
  '/audit-logs',
  '/api/v1/health',
  '/health',
  '/api/v1/metrics',
  '/metrics',
  '/favicon.ico',
  '/api/v1/auth/refresh',
  '/auth/refresh',
  '/api/v1/notifications/unread-count',
  '/notifications/unread-count',
  '/api/v1/hrm/live-dashboard',
];

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (!request) return next.handle();

    const { method, url, headers, body, params } = request;

    // Ignore pre-flight or non-mutating requests
    if (method === 'OPTIONS' || method === 'HEAD') {
      return next.handle();
    }

    const cleanUrl = (url || '').split('?')[0];

    // Check excluded paths
    if (EXCLUDED_URL_PREFIXES.some((p) => cleanUrl.startsWith(p))) {
      return next.handle();
    }

    // By default, only log mutating requests (POST, PUT, PATCH, DELETE) or explicit export/download actions
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isExplicitAudit = cleanUrl.includes('/export') || cleanUrl.includes('/download');
    if (!isMutation && !isExplicitAudit) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: (responseBody: any) => {
          this.processLog(request, responseBody, null);
        },
        error: (err: any) => {
          this.processLog(request, null, err);
        },
      }),
    );
  }

  private processLog(request: any, responseBody: any, error: any) {
    try {
      const { method, url, headers, body, params } = request;
      const user = request.user;
      const cleanUrl = (url || '').split('?')[0];

      // Resolve user role
      let userRole = user?.role || user?.userRoles?.[0]?.role?.name || null;
      if (userRole) {
        userRole = String(userRole).toUpperCase().replace(/\s+/g, '_');
      } else if (cleanUrl.includes('/customer/')) {
        userRole = 'CUSTOMER';
      } else if (cleanUrl.includes('/employee/')) {
        userRole = 'EMPLOYEE';
      } else if (cleanUrl.includes('/admin/')) {
        userRole = 'ADMIN';
      }

      // Resolve source
      const clientType = (headers?.['x-client-type'] || '').toLowerCase();
      const userAgent = (headers?.['user-agent'] || '').toLowerCase();
      let source = 'ADMIN_PANEL';

      if (
        clientType === 'mobile' ||
        userAgent.includes('dart') ||
        userAgent.includes('okhttp') ||
        userAgent.includes('cfnetwork') ||
        userAgent.includes('flutter') ||
        headers?.['x-device-info']
      ) {
        source = 'MOBILE_APP';
      } else if (clientType === 'admin') {
        source = 'ADMIN_PANEL';
      } else if (userRole === 'CUSTOMER' || userRole === 'EMPLOYEE') {
        source = 'MOBILE_APP';
      }

      // Resolve user name and user ID
      const userId = user?.id ? Number(user.id) : (body?.userId ? Number(body.userId) : null);
      let userName =
        user?.firstName || user?.lastName
          ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
          : (user?.name || user?.email || body?.email || body?.phone || body?.username || null);

      if (!userName && userRole) {
        userName = `${userRole} User`;
      }

      const customerId = user?.customerId ? Number(user.customerId) : (headers?.['x-customer-id'] ? Number(headers['x-customer-id']) : null);

      // Resolve module
      const moduleName = this.resolveModule(cleanUrl);

      // Resolve action
      const actionName = this.resolveAction(cleanUrl, method);

      // Resolve entity
      const entityId = params?.id || body?.id || body?.bookingId || body?.leaveId || body?.employeeId || null;
      const entityType = this.resolveEntityType(cleanUrl, moduleName);

      // Format description
      const status = error ? 'FAILED' : 'SUCCESS';
      const errorMessage = error?.response?.message || error?.message || null;
      const description = this.formatDescription(actionName, moduleName, entityType, entityId, status, errorMessage);

      // IP and device
      const rawIp = headers?.['x-forwarded-for'] || request.socket?.remoteAddress || request.ip || '127.0.0.1';
      const ipAddress = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(',')[0].trim();
      const device = headers?.['user-agent'] ? String(headers['user-agent']).substring(0, 200) : (source === 'MOBILE_APP' ? 'Mobile App' : 'Web Browser');

      // Asynchronously record log
      setImmediate(() => {
        this.auditLogService.create({
          userId,
          customerId,
          userName,
          userRole,
          source,
          action: actionName,
          module: moduleName,
          description,
          entityType,
          entityId: entityId ? String(entityId) : null,
          endpoint: cleanUrl,
          method,
          ipAddress,
          device,
          status,
          errorMessage,
          details: body ? body : (responseBody && typeof responseBody === 'object' ? responseBody : undefined),
        });
      });
    } catch (e: any) {
      this.logger.warn(`[AUDIT_INTERCEPTOR_ERROR] Failed processing log: ${e?.message}`);
    }
  }

  private resolveModule(url: string): string {
    const lower = url.toLowerCase();
    if (lower.includes('/attendance')) return 'Attendance';
    if (lower.includes('/leave') || lower.includes('/leaves')) return 'Leave';
    if (lower.includes('/remote-work') || lower.includes('/remotework')) return 'Remote Work';
    if (lower.includes('/influencer')) return 'Influencers';
    if (lower.includes('/lead') || lower.includes('/leads') || lower.includes('/crm')) return 'CRM';
    if (lower.includes('/employee') || lower.includes('/employees') || lower.includes('/hrm')) return 'HRM';
    if (lower.includes('/department') || lower.includes('/designation') || lower.includes('/office')) return 'HRM';
    if (lower.includes('/payroll') || lower.includes('/claim') || lower.includes('/loan') || lower.includes('/salary')) return 'Payroll';
    if (lower.includes('/setting') || lower.includes('/integration') || lower.includes('/policy') || lower.includes('/template')) return 'Settings';
    if (lower.includes('/invoice') || lower.includes('/subscription') || lower.includes('/payment')) return 'Billing';
    if (lower.includes('/auth') || lower.includes('/login') || lower.includes('/register') || lower.includes('/password')) return 'Authentication';
    if (lower.includes('/visit') || lower.includes('/visits')) return 'Visits';
    if (lower.includes('/task') || lower.includes('/tasks')) return 'Tasks';
    if (lower.includes('/master')) return 'Master Data';
    if (lower.includes('/marketing') || lower.includes('/banner')) return 'Marketing';

    // Default: extract first meaningful segment
    const parts = url.replace(/^\/api\/v1\//, '').replace(/^\//, '').split('/');
    if (parts.length > 0 && parts[0]) {
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }
    return 'System';
  }

  private resolveAction(url: string, method: string): string {
    const lower = url.toLowerCase();
    if (lower.includes('/login')) return 'LOGIN';
    if (lower.includes('/logout')) return 'LOGOUT';
    if (lower.includes('/approve')) return 'APPROVE';
    if (lower.includes('/reject')) return 'REJECT';
    if (lower.includes('/check-in') || lower.includes('/checkin')) return 'CHECK_IN';
    if (lower.includes('/check-out') || lower.includes('/checkout')) return 'CHECK_OUT';
    if (lower.includes('/cancel')) return 'CANCEL';
    if (lower.includes('/suspend')) return 'SUSPEND';
    if (lower.includes('/verify')) return 'VERIFY';
    if (lower.includes('/submit') || lower.includes('/apply') || lower.includes('/register')) return 'SUBMIT';
    if (lower.includes('/upload')) return 'UPLOAD';
    if (lower.includes('/download') || lower.includes('/export')) return 'DOWNLOAD';
    if (lower.includes('/reset')) return 'RESET';
    if (lower.includes('/test')) return 'TEST';

    switch (method.toUpperCase()) {
      case 'POST':
        return 'CREATE';
      case 'PUT':
      case 'PATCH':
        return 'UPDATE';
      case 'DELETE':
        return 'DELETE';
      default:
        return 'VIEW';
    }
  }

  private resolveEntityType(url: string, moduleName: string): string {
    const parts = url.replace(/^\/api\/v1\//, '').replace(/^\//, '').split('/');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part !== 'admin' && part !== 'customer' && part !== 'employee') {
        // Singularize simple trailing 's'
        let name = part;
        if (name.endsWith('ies')) {
          name = name.slice(0, -3) + 'y';
        } else if (name.endsWith('s') && !name.endsWith('ss')) {
          name = name.slice(0, -1);
        }
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
    }
    return moduleName;
  }

  private formatDescription(
    action: string,
    module: string,
    entityType: string,
    entityId: string | null,
    status: string,
    errorMessage?: string | null,
  ): string {
    const target = entityId ? `${entityType} #${entityId}` : entityType;
    if (status === 'FAILED') {
      return `Failed to ${action.toLowerCase()} ${target}: ${errorMessage || 'Request error'}`;
    }

    switch (action) {
      case 'LOGIN':
        return `User successfully logged into the system`;
      case 'LOGOUT':
        return `User logged out of session`;
      case 'CHECK_IN':
        return `Employee recorded attendance check-in`;
      case 'CHECK_OUT':
        return `Employee recorded attendance check-out`;
      case 'APPROVE':
        return `Approved ${target}`;
      case 'REJECT':
        return `Rejected ${target}`;
      case 'SUBMIT':
        return `Submitted new ${target}`;
      case 'CREATE':
        return `Created new ${target}`;
      case 'UPDATE':
        return `Updated ${target}`;
      case 'DELETE':
        return `Deleted ${target}`;
      default:
        return `${action} performed on ${target}`;
    }
  }
}
