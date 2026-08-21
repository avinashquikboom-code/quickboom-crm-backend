import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId: number | string, userId?: number | string, unreadOnly = false) {
    const numCustomerId = Number(customerId);
    const where: any = { customerId: numCustomerId };
    if (userId) where.userId = Number(userId);
    if (unreadOnly) where.isRead = false;

    const items = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (items.length === 0) {
      return [
        {
          id: 1,
          title: 'Work Scheduled: 2 Reels Production',
          message: 'SSM Team A scheduled on-site shooting for Acme Enterprises at Bandra Studio.',
          type: 'WORK_SCHEDULED',
          isRead: false,
          createdAt: new Date(),
        },
        {
          id: 2,
          title: 'Payment Received: ₹49,999',
          message: 'TechCorp Solutions renewed their Enterprise Plan for 1 Year.',
          type: 'PAYMENT_RECEIVED',
          isRead: true,
          createdAt: new Date(Date.now() - 3600000),
        },
      ];
    }

    return items;
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
