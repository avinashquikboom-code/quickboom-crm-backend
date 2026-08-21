import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getLiveMetrics(customerId: string, officeId?: string) {
    const numCustomerId = Number(customerId);
    const hasValidCustomerId = !isNaN(numCustomerId) && numCustomerId > 0;

    const customerWhere = hasValidCustomerId ? { customerId: numCustomerId } : {};

    // Real DB counts
    const [
      totalEmployees,
      activeEmployees,
      branches,
      departments,
      recentAuditLogs,
    ] = await Promise.all([
      this.prisma.employee.count({ where: customerWhere }),
      this.prisma.employee.count({ where: { ...customerWhere, status: 'ACTIVE' } }),
      this.prisma.branchGeofence.findMany({
        where: hasValidCustomerId ? { customerId: numCustomerId } : {},
      }),
      this.prisma.department.findMany({
        where: customerWhere,
        include: {
          employees: { select: { id: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: customerWhere,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const offices = branches.map((b) => ({
      id: String(b.id),
      name: b.name,
      city: b.city || 'Headquarters',
      totalEmployees,
      present: activeEmployees,
      absent: totalEmployees - activeEmployees,
      late: 0,
      onLeave: 0,
      remote: 0,
      working: activeEmployees,
      checkedOut: 0,
    }));

    const summary = {
      totalEmployees,
      present: activeEmployees,
      absent: Math.max(0, totalEmployees - activeEmployees),
      late: 0,
      onLeave: 0,
      remote: 0,
      working: activeEmployees,
      onBreak: 0,
      checkedOut: 0,
      locationTrackingActive: activeEmployees,
    };

    const recentActivity = recentAuditLogs.map((log) => ({
      id: String(log.id),
      timestamp: new Date(log.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      title: `${log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'} performed ${log.action} on ${log.module}`,
      office: 'HQ',
      category: log.action.toLowerCase(),
    }));

    const deptList = departments.map((d) => ({
      name: d.name,
      total: d.employees.length,
      present: d.employees.length,
      absent: 0,
      late: 0,
      remote: 0,
      onLeave: 0,
      working: d.employees.length,
    }));

    return {
      success: true,
      timestamp: new Date().toISOString(),
      customerId,
      selectedOfficeId: officeId || 'all',
      summary,
      offices,
      recentPunchIns: [],
      recentPunchOuts: [],
      recentActivity,
      departments: deptList,
    };
  }

  async getOffices(customerId: string) {
    const numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      return [{ id: 'all', name: 'All Offices' }];
    }

    const branches = await this.prisma.branchGeofence.findMany({
      where: { customerId: numCustomerId },
    });

    return [
      { id: 'all', name: 'All Offices' },
      ...branches.map((b) => ({ id: String(b.id), name: b.name })),
    ];
  }

  async getSuperAdminMetrics() {
    const [
      totalCustomers,
      activeCustomers,
      totalUsers,
      totalLeads,
      totalDeals,
      activeSubs,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.customer.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.lead.count({ where: { deletedAt: null } }),
      this.prisma.deal.count({ where: { deletedAt: null } }),
      this.prisma.customerSubscription.findMany({
        where: { status: 'ACTIVE' },
        include: { plan: true },
      }),
    ]);

    const mrr = activeSubs.reduce(
      (acc, sub) => acc + (sub.plan ? Number(sub.plan.monthlyPrice) : 0),
      0
    );

    return {
      totalCustomers,
      activeCustomers,
      totalUsers,
      totalLeads,
      totalDeals,
      mrr,
      uptime: '99.99%',
    };
  }
}
