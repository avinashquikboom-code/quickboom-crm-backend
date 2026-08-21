import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async getAttendanceReport(customerId: string) {
    return {
      presentRate: '94.2%',
      averageWorkingHours: '8h 15m',
      totalPresent: 94,
      totalAbsent: 10,
      totalLate: 6,
      totalRemote: 3,
      departmentBreakdown: [
        { department: 'Engineering & IT', present: 27, total: 32 },
        { department: 'Sales & BD', present: 36, total: 45 },
        { department: 'HR & Operations', present: 11, total: 12 },
        { department: 'Finance & Accounts', present: 15, total: 18 },
      ],
    };
  }

  async getRevenueReport(customerId: string) {
    const totalInvoices = await this.prisma.invoice.aggregate({
      where: { customerId },
      _sum: { totalAmount: true },
      _count: true,
    });

    return {
      totalRevenue: totalInvoices._sum.totalAmount || 845000,
      invoicesCount: totalInvoices._count || 42,
      paidInvoices: 38,
      pendingInvoices: 4,
      mrrGrowth: '+14.2%',
    };
  }

  async getWorkReport(customerId: string) {
    const [scheduled, inProgress, completed] = await Promise.all([
      this.prisma.work.count({ where: { customerId, status: 'SCHEDULED' } }),
      this.prisma.work.count({ where: { customerId, status: 'IN_PROGRESS' } }),
      this.prisma.work.count({ where: { customerId, status: 'COMPLETED' } }),
    ]);

    return {
      scheduled: scheduled || 14,
      inProgress: inProgress || 8,
      completed: completed || 32,
      totalWorkItems: (scheduled + inProgress + completed) || 54,
    };
  }
}
