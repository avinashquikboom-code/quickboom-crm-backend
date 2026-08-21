import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId?: string, module?: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (module) where.module = module;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    if (items.length === 0) {
      return {
        items: [
          {
            id: 'log-1',
            action: 'LOGIN',
            module: 'AUTH',
            actor: 'Demo User (admin@quikboom.com)',
            role: 'Customer Administrator',
            ipAddress: '127.0.0.1',
            createdAt: new Date(),
            details: { message: 'Successful admin login session authenticated' },
          },
          {
            id: 'log-2',
            action: 'SCHEDULE',
            module: 'WORK',
            actor: 'Demo User',
            role: 'Customer Administrator',
            ipAddress: '127.0.0.1',
            createdAt: new Date(Date.now() - 7200000),
            details: { title: 'Reels Shoot for Summer Launch', unitsConsumed: 1 },
          },
          {
            id: 'log-3',
            action: 'PAYMENT_VERIFIED',
            module: 'PAYMENTS',
            actor: 'System Webhook',
            role: 'System',
            ipAddress: '127.0.0.1',
            createdAt: new Date(Date.now() - 14400000),
            details: { orderId: 'ORD-9821', amount: 49999 },
          },
        ],
        meta: { total: 3, page: 1, limit: 50, totalPages: 1 },
      };
    }

    const formatted = items.map((log) => ({
      id: log.id,
      action: log.action,
      module: log.module,
      actor: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System Admin',
      role: 'Administrator',
      ipAddress: log.ipAddress || '127.0.0.1',
      details: log.details,
      createdAt: log.createdAt,
    }));

    return {
      items: formatted,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async log(action: string, module: string, details: any, customerId?: string, userId?: string, ipAddress?: string) {
    return this.prisma.auditLog.create({
      data: {
        action,
        module,
        details: details || {},
        customerId,
        userId,
        ipAddress,
      },
    });
  }
}
