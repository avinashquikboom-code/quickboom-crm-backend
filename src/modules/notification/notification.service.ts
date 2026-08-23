import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    customerId: number | string,
    userId?: number | string,
    unreadOnly = false,
    page = 1,
    limit = 20,
    search?: string,
  ) {
    const numCustomerId = Number(customerId);
    const numPage = Math.max(Number(page) || 1, 1);
    const numLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (numPage - 1) * numLimit;

    const where: any = {};
    if (!isNaN(numCustomerId)) {
      where.customerId = numCustomerId;
    }
    if (userId && !isNaN(Number(userId))) {
      where.userId = Number(userId);
    }
    if (unreadOnly) {
      where.isRead = false;
    }

    if (search && search.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: 'insensitive' } },
        { message: { contains: search.trim(), mode: 'insensitive' } },
        { type: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: numLimit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const totalPages = Math.ceil(total / numLimit) || 1;

    return {
      data: items,
      items,
      pagination: {
        page: numPage,
        pageSize: numLimit,
        total,
        totalPages,
      },
      meta: {
        page: numPage,
        limit: numLimit,
        total,
        totalPages,
      },
    };
  }

  async markAsRead(id: number | string) {
    const numId = Number(id);
    return this.prisma.notification.updateMany({
      where: { id: numId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(customerId: number | string) {
    const numCustomerId = Number(customerId);
    return this.prisma.notification.updateMany({
      where: { customerId: numCustomerId, isRead: false },
      data: { isRead: true },
    });
  }
}
