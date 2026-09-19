import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogFilterDto } from './dto/audit-log.dto';

export interface CreateAuditLogParams {
  userId?: number | null;
  userName?: string | null;
  userRole?: string | null;
  source?: string | null; // ADMIN_PANEL, MOBILE_APP
  action: string; // LOGIN, LOGOUT, CREATE, UPDATE, DELETE, APPROVE, REJECT, SUBMIT, etc.
  module: string; // Attendance, Leave, Remote Work, Influencers, CRM, Settings, Payroll, etc.
  description?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  endpoint?: string | null;
  method?: string | null;
  ipAddress?: string | null;
  device?: string | null;
  status?: string; // SUCCESS, FAILED
  errorMessage?: string | null;
  details?: any;
  customerId?: number | null;
}

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'passwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'bearer',
  'authorization',
  'secret',
  'secretaccesskey',
  'accesskeyid',
  'apikey',
  'api_key',
  'authkey',
  'webhooksecret',
  'paymentsecret',
  'razorpay_signature',
  'razorpaysignature',
  'otp',
  'smsotp',
  'smtppassword',
  'smtp_password',
  'creditcard',
  'cvv',
  'pin',
];

export function redactSensitiveData(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // If it looks like a JWT token
    if (data.startsWith('eyJ') && data.includes('.')) {
      return '[REDACTED_JWT]';
    }
    return data;
  }
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(redactSensitiveData);

  const copy: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    const lower = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) {
      copy[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      copy[key] = redactSensitiveData(val);
    } else {
      copy[key] = val;
    }
  }
  return copy;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Central entry point to create an audit log entry.
   * Runs asynchronously and catches any write error to ensure it never disrupts user requests.
   */
  async create(params: CreateAuditLogParams) {
    try {
      const sanitizedDetails = params.details ? redactSensitiveData(params.details) : undefined;
      const cleanSource = (params.source || 'ADMIN_PANEL').toUpperCase();
      const cleanStatus = (params.status || 'SUCCESS').toUpperCase();
      const cleanAction = (params.action || 'MUTATION').toUpperCase();

      let resolvedUserId: number | null = null;
      if (params.userId) {
        try {
          const userExists = await this.prisma.user.findUnique({
            where: { id: Number(params.userId) },
            select: { id: true },
          });
          if (userExists) resolvedUserId = userExists.id;
        } catch (_) {}
      }

      let resolvedCustomerId: number | null = null;
      if (params.customerId) {
        try {
          const custExists = await this.prisma.customer.findUnique({
            where: { id: Number(params.customerId) },
            select: { id: true },
          });
          if (custExists) resolvedCustomerId = custExists.id;
        } catch (_) {}
      }

      return await this.prisma.auditLog.create({
        data: {
          userId: resolvedUserId,
          customerId: resolvedCustomerId,
          userName: params.userName || null,
          userRole: params.userRole ? params.userRole.toUpperCase() : null,
          source: cleanSource,
          action: cleanAction,
          module: params.module || 'System',
          description: params.description || null,
          entityType: params.entityType || null,
          entityId: params.entityId ? String(params.entityId) : null,
          endpoint: params.endpoint || null,
          method: params.method ? params.method.toUpperCase() : null,
          ipAddress: params.ipAddress || null,
          device: params.device || null,
          status: cleanStatus,
          errorMessage: params.errorMessage || null,
          details: sanitizedDetails,
        },
      });
    } catch (err: any) {
      this.logger.error(`[AUDIT_LOG_ERROR] Failed to record audit log: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Backward-compatible helper method used by older services.
   */
  async log(
    action: string,
    module: string,
    details: any,
    customerId?: number | string,
    userId?: number | string,
    ipAddress?: string,
  ) {
    return this.create({
      action,
      module,
      details,
      customerId: customerId ? Number(customerId) : null,
      userId: userId ? Number(userId) : null,
      ipAddress,
      source: 'ADMIN_PANEL',
      status: 'SUCCESS',
    });
  }

  /**
   * Filtered, paginated list of audit logs.
   * Real data only from PostgreSQL.
   */
  async findAll(filters: AuditLogFilterDto) {
    const page = Math.max(1, Number(filters.page || 1));
    const limit = Math.min(100, Math.max(1, Number(filters.limit || 20)));
    const skip = (page - 1) * limit;

    const where: any = {};

    // Source filter
    if (filters.source && filters.source.toUpperCase() !== 'ALL') {
      where.source = filters.source.toUpperCase();
    }

    // Role filter
    if (filters.role && filters.role.toUpperCase() !== 'ALL') {
      const roleUpper = filters.role.toUpperCase();
      if (roleUpper === 'ADMIN') {
        where.userRole = { in: ['ADMIN', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'CUSTOMER_ADMIN'] };
      } else {
        where.userRole = roleUpper;
      }
    }

    // Status filter
    if (filters.status && filters.status.toUpperCase() !== 'ALL') {
      where.status = filters.status.toUpperCase();
    }

    // Module filter
    if (filters.module && filters.module.toUpperCase() !== 'ALL') {
      where.module = { equals: filters.module, mode: 'insensitive' };
    }

    // Action filter
    if (filters.action && filters.action.toUpperCase() !== 'ALL') {
      where.action = { equals: filters.action.toUpperCase() };
    }

    // Customer ID filter
    if (filters.customerId) {
      where.customerId = Number(filters.customerId);
    }

    // User ID filter
    if (filters.userId) {
      where.userId = Number(filters.userId);
    }

    // Date range filter
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        if (!isNaN(start.getTime())) {
          where.createdAt.gte = start;
        }
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        if (!isNaN(end.getTime())) {
          // Set to end of day if only date is passed
          if (filters.endDate.length <= 10) {
            end.setHours(23, 59, 59, 999);
          }
          where.createdAt.lte = end;
        }
      }
    }

    // Text search filter across multiple fields
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { userName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { module: { contains: q, mode: 'insensitive' } },
        { action: { contains: q, mode: 'insensitive' } },
        { entityId: { contains: q, mode: 'insensitive' } },
        { endpoint: { contains: q, mode: 'insensitive' } },
        { ipAddress: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          customer: {
            select: {
              id: true,
              companyName: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const formatted = items.map((log) => {
      const resolvedUserName =
        log.userName ||
        (log.user ? `${log.user.firstName || ''} ${log.user.lastName || ''}`.trim() : null) ||
        (log.user?.email ? log.user.email : null) ||
        (log.customerId ? `Customer #${log.customerId}` : 'System');

      return {
        id: log.id,
        timestamp: log.createdAt,
        createdAt: log.createdAt,
        userId: log.userId,
        userName: resolvedUserName,
        userEmail: log.user?.email || null,
        role: log.userRole || 'ADMIN',
        userRole: log.userRole || 'ADMIN',
        source: log.source || 'ADMIN_PANEL',
        module: log.module,
        action: log.action,
        description: log.description || `${log.action} action performed on ${log.module}`,
        entityType: log.entityType,
        entityId: log.entityId,
        endpoint: log.endpoint,
        method: log.method,
        ipAddress: log.ipAddress || '—',
        device: log.device,
        status: log.status || 'SUCCESS',
        errorMessage: log.errorMessage,
        details: log.details,
        customerId: log.customerId,
        companyName: log.customer?.companyName || null,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items: formatted,
      data: formatted,
      pagination: {
        page,
        pageSize: limit,
        limit,
        total,
        totalPages,
      },
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * Get single audit log details by ID.
   */
  async findById(id: number) {
    const log = await this.prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        customer: {
          select: {
            id: true,
            companyName: true,
          },
        },
      },
    });

    if (!log) {
      throw new NotFoundException(`Audit log entry #${id} not found`);
    }

    const resolvedUserName =
      log.userName ||
      (log.user ? `${log.user.firstName || ''} ${log.user.lastName || ''}`.trim() : null) ||
      (log.user?.email ? log.user.email : null) ||
      (log.customerId ? `Customer #${log.customerId}` : 'System');

    return {
      id: log.id,
      timestamp: log.createdAt,
      createdAt: log.createdAt,
      userId: log.userId,
      userName: resolvedUserName,
      userEmail: log.user?.email || null,
      role: log.userRole || 'ADMIN',
      userRole: log.userRole || 'ADMIN',
      source: log.source || 'ADMIN_PANEL',
      module: log.module,
      action: log.action,
      description: log.description || `${log.action} on ${log.module}`,
      entityType: log.entityType,
      entityId: log.entityId,
      endpoint: log.endpoint,
      method: log.method,
      ipAddress: log.ipAddress || '—',
      device: log.device,
      status: log.status || 'SUCCESS',
      errorMessage: log.errorMessage,
      details: log.details,
      customerId: log.customerId,
      companyName: log.customer?.companyName || null,
    };
  }

  /**
   * Aggregated statistics for the Activity Logs header cards and filter options.
   */
  async getStats() {
    const [total, adminCount, mobileCount, successCount, failedCount, rawModules, rawActions] =
      await Promise.all([
        this.prisma.auditLog.count(),
        this.prisma.auditLog.count({ where: { source: 'ADMIN_PANEL' } }),
        this.prisma.auditLog.count({ where: { source: 'MOBILE_APP' } }),
        this.prisma.auditLog.count({ where: { status: 'SUCCESS' } }),
        this.prisma.auditLog.count({ where: { status: 'FAILED' } }),
        this.prisma.auditLog.groupBy({
          by: ['module'],
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 20,
        }),
        this.prisma.auditLog.groupBy({
          by: ['action'],
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
          take: 20,
        }),
      ]);

    const modules = rawModules.map((m) => m.module).filter(Boolean);
    const actions = rawActions.map((a) => a.action).filter(Boolean);

    return {
      total,
      adminCount,
      mobileCount,
      successCount,
      failedCount,
      modules,
      actions,
    };
  }
}
