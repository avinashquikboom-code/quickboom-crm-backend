import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId: string, userId?: string, unreadOnly = false) {
    const where: any = { customerId };
    if (userId) where.userId = userId;
    if (unreadOnly) where.isRead = false;

    const items = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (items.length === 0) {
      return [
        {
          id: 'n-1',
          title: 'Work Scheduled: 2 Reels Production',
          message: 'SSM Team A scheduled on-site shooting for Acme Enterprises at Bandra Studio.',
          type: 'WORK_SCHEDULED',
          isRead: false,
          createdAt: new Date(),
        },
        {
          id: 'n-2',
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

  async markAsRead(id: string) {
    return this.prisma.notification.updateMany({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(customerId: string) {
    return this.prisma.notification.updateMany({
      where: { customerId, isRead: false },
      data: { isRead: true },
    });
  }
}
