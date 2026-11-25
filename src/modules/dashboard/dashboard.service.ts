import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialMetricsService } from '../invoice/financial-metrics.service';
import { getBusinessDate, getBusinessDayRange } from '../../common/utils/timezone.util';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly financialMetrics?: FinancialMetricsService,
  ) {}

  async getUnifiedSummary(filters: {
    customerId?: number | null;
    fromDate?: string;
    toDate?: string;
    departmentId?: number | null;
    employeeId?: number | null;
    branchId?: number | null;
  }) {
    const hasCustomer = Boolean(filters.customerId && filters.customerId > 0);
    const baseCust = hasCustomer ? { customerId: filters.customerId! } : {};

    const range = this.financialMetrics
      ? this.financialMetrics.resolveDateBounds(filters.fromDate, filters.toDate)
      : { start: undefined, end: undefined };

    const dateFilter =
      range.start && range.end
        ? { gte: range.start, lte: range.end }
        : range.start
          ? { gte: range.start }
          : range.end
            ? { lte: range.end }
            : undefined;

    const empWhere: any = {
      ...baseCust,
      status: 'ACTIVE',
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.employeeId ? { id: filters.employeeId } : {}),
      ...(filters.branchId ? { officeId: filters.branchId } : {}),
    };

    const filteredEmployees = await this.prisma.employee.findMany({
      where: empWhere,
      select: { id: true, userId: true },
    });
    const filteredEmpIds = filteredEmployees.map((e) => e.id);
    const filteredUserIds = filteredEmployees.map((e) => e.userId).filter((id): id is number => Boolean(id));
    const hasOrgScope = Boolean(filters.departmentId || filters.employeeId || filters.branchId);

    const leadWhere: any = {
      ...baseCust,
      deletedAt: null,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      ...(hasOrgScope
        ? { assignedToId: { in: filteredUserIds.length ? filteredUserIds : [-1] } }
        : {}),
    };

    const dealWhere: any = {
      ...baseCust,
      deletedAt: null,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      ...(hasOrgScope
        ? { assignedToId: { in: filteredUserIds.length ? filteredUserIds : [-1] } }
        : {}),
    };

    const todayRange = getBusinessDayRange(getBusinessDate(new Date()));
    const attWhere: any = {
      ...baseCust,
      date: dateFilter || { gte: todayRange.start, lte: todayRange.end },
      ...(hasOrgScope ? { employeeId: { in: filteredEmpIds.length ? filteredEmpIds : [-1] } } : {}),
    };

    const [
      financial,
      leads,
      deals,
      totalCustomers,
      newCustomers,
      activeSubscriptions,
      presentAttendance,
      upcomingFollowUps,
      recentPayments,
      stages,
    ] = await Promise.all([
      this.financialMetrics
        ? this.financialMetrics.getFinancialSummary({
            customerId: filters.customerId,
            fromDate: filters.fromDate,
            toDate: filters.toDate,
          })
        : Promise.resolve(null),
      this.prisma.lead.findMany({
        where: leadWhere,
        select: { id: true, status: true, stageId: true, source: true, createdAt: true },
      }),
      this.prisma.deal.findMany({
        where: dealWhere,
        select: { id: true, isWon: true, isLost: true, amount: true, createdAt: true },
      }),
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.customer.count({
        where: { deletedAt: null, ...(dateFilter ? { createdAt: dateFilter } : {}) },
      }),
      this.prisma.customerSubscription.count({
        where: { ...baseCust, status: 'ACTIVE' },
      }),
      this.prisma.attendance.findMany({
        where: { ...attWhere, punchIn: { not: null } },
        select: { employeeId: true },
        distinct: ['employeeId'],
      }),
      this.prisma.task.findMany({
        where: {
          ...baseCust,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          ...(dateFilter ? { dueDate: dateFilter } : { dueDate: { gte: todayRange.start } }),
        },
        orderBy: { dueDate: 'asc' },
        take: 8,
      }),
      this.prisma.paymentHistory.findMany({
        where: {
          ...baseCust,
          deletedAt: null,
          status: { in: ['SUCCESS', 'PAID', 'REFUNDED'] },
          ...(dateFilter ? { createdAt: dateFilter } : {}),
        },
        include: { customer: { select: { id: true, name: true, companyName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.leadStage.findMany({
        where: { ...baseCust, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    const convertedLeads = leads.filter((l) => ['WON', 'CONVERTED'].includes(String(l.status || '').toUpperCase())).length;
    const wonDeals = deals.filter((d) => Boolean(d.isWon)).length;

    const sourceMap = new Map<string, number>();
    for (const l of leads) {
      const src = (l.source || 'DIRECT').trim().toUpperCase();
      sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
    }

    const stageMap = new Map<string, number>();
    for (const s of stages) stageMap.set(s.name, 0);
    for (const l of leads) {
      const matched = stages.find((s) => s.id === l.stageId);
      const label = matched?.name || String(l.status || 'NEW');
      stageMap.set(label, (stageMap.get(label) || 0) + 1);
    }

    // Group collections & leads by business date (Asia/Kolkata)
    const seriesMap = new Map<string, { date: string; revenue: number; leads: number }>();
    for (const l of leads) {
      const d = getBusinessDate(l.createdAt);
      const entry = seriesMap.get(d) || { date: d, revenue: 0, leads: 0 };
      entry.leads += 1;
      seriesMap.set(d, entry);
    }
    for (const p of recentPayments) {
      if (String(p.status || '').toUpperCase() === 'REFUNDED') continue;
      const d = getBusinessDate(p.createdAt);
      const entry = seriesMap.get(d) || { date: d, revenue: 0, leads: 0 };
      entry.revenue += Number(p.totalAmount || p.amount || 0);
      seriesMap.set(d, entry);
    }

    return {
      dateRange: { from: filters.fromDate || null, to: filters.toDate || null },
      lastSyncedAt: new Date().toISOString(),
      snapshot: {
        totalCustomers,
        activeEmployees: filteredEmployees.length,
        presentEmployees: presentAttendance.length,
        activeSubscriptions,
      },
      periodMetrics: {
        totalLeads: leads.length,
        convertedLeads,
        conversionRate: leads.length > 0 ? Math.round((convertedLeads / leads.length) * 1000) / 10 : 0,
        newCustomers,
        totalDeals: deals.length,
        wonDeals,
        totalInvoicedAmount: financial?.totalInvoicedAmount ?? 0,
        actualRevenueCollected: financial?.totalCollectedAmount ?? 0,
        outstandingPayments: financial?.outstandingReceivables ?? 0,
        upcomingCollections: financial?.upcomingCollectionsTotal ?? 0,
        onlineCollections: financial?.onlineCollections ?? 0,
        offlineCollections: financial?.offlineCollections ?? 0,
        collectionGrowthPercent: (financial as any)?.collectionGrowthPercent ?? null,
      },
      leadsBySource: Array.from(sourceMap.entries()).map(([source, count]) => ({ source, count })),
      leadsByStage: Array.from(stageMap.entries()).map(([stage, count]) => ({ stage, count })),
      salesPerformance: Array.from(seriesMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      upcomingActivities: upcomingFollowUps.map((f) => ({
        id: f.id,
        title: f.title || f.description || 'Scheduled Task',
        leadName: 'Task',
        scheduledAt: f.dueDate,
        status: f.status,
      })),
      recentTransactions: recentPayments.map((p) => ({
        id: p.id,
        customerName: p.customer?.companyName || p.customer?.name || 'Customer',
        amount: Number(p.totalAmount || p.amount || 0),
        paymentMethod: p.paymentMethod || 'ONLINE',
        status: p.status,
        createdAt: p.createdAt,
      })),
    };
  }

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
