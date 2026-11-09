import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryReportDto, ExportReportDto } from './dto/report.dto';
import { getBusinessDate, getBusinessDayRange } from '../../common/utils/timezone.util';
import { REPORT_CATALOG, REPORT_CATEGORIES, reportById, ReportDefinition } from './report-catalog';
import PDFDocument = require('pdfkit');
import { isUserAdmin, isUserSuperAdmin } from '../../common/utils/role.util';

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper: Parse dates into start and end Date objects in IST
   */
  private resolveDateRange(dateFrom?: string, dateTo?: string) {
    let startDate: Date;
    let endDate: Date;

    if (dateFrom) {
      const fromRange = getBusinessDayRange(dateFrom);
      startDate = fromRange.start;
    } else {
      // Default to 30 days ago
      const past = new Date();
      past.setDate(past.getDate() - 30);
      const fromRange = getBusinessDayRange(getBusinessDate(past));
      startDate = fromRange.start;
    }

    if (dateTo) {
      const toRange = getBusinessDayRange(dateTo);
      endDate = toRange.end;
    } else {
      const todayRange = getBusinessDayRange(getBusinessDate(new Date()));
      endDate = todayRange.end;
    }

    return { startDate, endDate };
  }

  /**
   * Returns aggregated high-level KPIs calculated dynamically from DB.
   */
  async getSummaryReport(customerId: number | string, query?: QueryReportDto) {
    const numCustomerId = Number(customerId) || 1;
    const { startDate, endDate } = this.resolveDateRange(query?.dateFrom, query?.dateTo);

    const [
      totalEmployees,
      activeEmployees,
      attendanceStats,
      attendanceByStatus,
      pendingLeaves,
      approvedLeaves,
      salarySummary,
      visitsCount,
      revenueSummary,
    ] = await Promise.all([
      // Total employees registered
      this.prisma.employee.count({
        where: { customerId: numCustomerId },
      }),
      // Active employees
      this.prisma.employee.count({
        where: { customerId: numCustomerId, status: 'ACTIVE' },
      }),
      // Attendance totals in range
      this.prisma.attendance.aggregate({
        where: {
          customerId: numCustomerId,
          date: { gte: startDate, lte: endDate },
        },
        _count: true,
        _sum: {
          workingHours: true,
          workingMinutes: true,
          breakDuration: true,
        },
      }),
      // Attendance status breakdown
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: {
          customerId: numCustomerId,
          date: { gte: startDate, lte: endDate },
        },
        _count: { status: true },
      }),
      // Leaves pending
      this.prisma.leaveRequest.count({
        where: {
          customerId: numCustomerId,
          status: 'PENDING',
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      // Leaves approved
      this.prisma.leaveRequest.count({
        where: {
          customerId: numCustomerId,
          status: 'APPROVED',
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      // Payroll / Salary aggregate
      this.prisma.salarySlip.aggregate({
        where: {
          customerId: numCustomerId,
          generatedAt: { gte: startDate, lte: endDate },
        },
        _sum: {
          grossSalary: true,
          totalDeductions: true,
          netSalary: true,
        },
        _count: true,
      }),
      // Client / Lead Visits
      this.prisma.visit.count({
        where: {
          customerId: numCustomerId,
          date: { gte: startDate, lte: endDate },
        },
      }),
      // Revenue / Invoices
      this.prisma.invoice.aggregate({
        where: {
          customerId: numCustomerId,
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
    ]);

    // Format status breakdown
    const statusCounts: Record<string, number> = {};
    for (const item of attendanceByStatus) {
      statusCounts[item.status] = item._count.status;
    }

    const presentCount = (statusCounts['PRESENT'] || 0) + (statusCounts['HALF_DAY'] || 0);
    const absentCount = statusCounts['ABSENT'] || 0;
    const totalRecords = attendanceStats._count || 0;
    const presentRate = totalRecords > 0 ? Math.round((presentCount / totalRecords) * 1000) / 10 : 100;

    const totalWorkingHours = Math.round((attendanceStats._sum.workingHours || 0) * 10) / 10;
    const avgWorkingHoursPerRecord =
      presentCount > 0 ? Math.round((totalWorkingHours / presentCount) * 10) / 10 : 0;

    return {
      dateRange: {
        from: startDate.toISOString().split('T')[0],
        to: endDate.toISOString().split('T')[0],
      },
      workforce: {
        total: totalEmployees,
        active: activeEmployees,
      },
      attendance: {
        totalRecords,
        present: presentCount,
        absent: absentCount,
        halfDay: statusCounts['HALF_DAY'] || 0,
        late: statusCounts['LATE'] || 0,
        onLeave: statusCounts['ON_LEAVE'] || 0,
        presentRate: `${presentRate}%`,
        totalWorkingHours,
        avgWorkingHours: `${avgWorkingHoursPerRecord}h`,
      },
      leaves: {
        pending: pendingLeaves,
        approved: approvedLeaves,
        total: pendingLeaves + approvedLeaves,
      },
      payroll: {
        slipsGenerated: salarySummary._count || 0,
        grossSalary: salarySummary._sum.grossSalary || 0,
        totalDeductions: salarySummary._sum.totalDeductions || 0,
        netDisbursed: salarySummary._sum.netSalary || 0,
      },
      visits: {
        total: visitsCount,
      },
      revenue: {
        invoicesCount: revenueSummary._count || 0,
        totalRevenue: revenueSummary._sum.totalAmount || 0,
      },
    };
  }

  /**
   * Returns list-based report data with server-side pagination, filters, and dynamic counts.
   */
  async getReportData(customerId: number | string, query: QueryReportDto) {
    const numCustomerId = Number(customerId) || 1;
    const type = query.type || 'ATTENDANCE';
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const { startDate, endDate } = this.resolveDateRange(query.dateFrom, query.dateTo);

    switch (type) {
      case 'ATTENDANCE': {
        const whereClause: any = {
          customerId: numCustomerId,
          date: { gte: startDate, lte: endDate },
        };

        if (query.status && query.status !== 'ALL') {
          whereClause.status = query.status;
        }

        if (query.search?.trim()) {
          const s = query.search.trim();
          whereClause.employee = {
            OR: [
              { firstName: { contains: s, mode: 'insensitive' } },
              { lastName: { contains: s, mode: 'insensitive' } },
              { employeeCode: { contains: s, mode: 'insensitive' } },
            ],
          };
        }

        if (query.branch && query.branch !== 'ALL') {
          whereClause.office = { name: { contains: query.branch, mode: 'insensitive' } };
        }

        const [items, total] = await Promise.all([
          this.prisma.attendance.findMany({
            where: whereClause,
            include: {
              employee: {
                select: {
                  id: true,
                  employeeCode: true,
                  firstName: true,
                  lastName: true,
                  department: { select: { name: true } },
                  designation: { select: { name: true } },
                },
              },
              office: { select: { id: true, name: true, city: true } },
              breaks: { select: { id: true, breakStart: true, breakEnd: true, duration: true } },
            },
            orderBy: { date: 'desc' },
            skip,
            take: limit,
          }),
          this.prisma.attendance.count({ where: whereClause }),
        ]);

        const formattedItems = items.map((r) => ({
          id: r.id,
          date: r.date.toISOString().split('T')[0],
          employeeId: r.employee?.id,
          employeeCode: r.employee?.employeeCode || '—',
          employeeName: `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.trim() || '—',
          department: r.employee?.department?.name || '—',
          designation: r.employee?.designation?.name || '—',
          punchIn: r.punchIn ? r.punchIn.toISOString() : null,
          punchOut: r.punchOut ? r.punchOut.toISOString() : null,
          workingHours: r.workingHours || 0,
          breakDuration: r.breakDuration || 0,
          status: r.status,
          workMode: r.workMode || 'OFFICE',
          office: r.office?.name || r.locationIn || '—',
        }));

        return {
          type,
          items: formattedItems,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
          },
        };
      }

      case 'PAYROLL': {
        const whereClause: any = {
          customerId: numCustomerId,
          generatedAt: { gte: startDate, lte: endDate },
        };

        if (query.status && query.status !== 'ALL') {
          whereClause.status = query.status;
        }

        if (query.search?.trim()) {
          const s = query.search.trim();
          whereClause.employee = {
            OR: [
              { firstName: { contains: s, mode: 'insensitive' } },
              { lastName: { contains: s, mode: 'insensitive' } },
              { employeeCode: { contains: s, mode: 'insensitive' } },
            ],
          };
        }

        const [slips, total] = await Promise.all([
          this.prisma.salarySlip.findMany({
            where: whereClause,
            include: {
              employee: {
                select: {
                  id: true,
                  employeeCode: true,
                  firstName: true,
                  lastName: true,
                  department: { select: { name: true } },
                  designation: { select: { name: true } },
                },
              },
            },
            orderBy: { generatedAt: 'desc' },
            skip,
            take: limit,
          }),
          this.prisma.salarySlip.count({ where: whereClause }),
        ]);

        const formattedItems = slips.map((s) => ({
          id: s.id,
          slipNumber: s.slipNumber,
          payPeriod: s.payPeriod,
          employeeCode: s.employee?.employeeCode || '—',
          employeeName: `${s.employee?.firstName || ''} ${s.employee?.lastName || ''}`.trim() || '—',
          department: s.employee?.department?.name || '—',
          grossSalary: s.grossSalary,
          totalDeductions: s.totalDeductions,
          netSalary: s.netSalary,
          status: s.status,
          generatedAt: s.generatedAt.toISOString(),
          pdfUrl: s.pdfUrl || null,
        }));

        return {
          type,
          items: formattedItems,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
          },
        };
      }

      case 'LEAVES': {
        const whereClause: any = {
          customerId: numCustomerId,
          createdAt: { gte: startDate, lte: endDate },
        };

        if (query.status && query.status !== 'ALL') {
          whereClause.status = query.status;
        }

        if (query.search?.trim()) {
          const s = query.search.trim();
          whereClause.employee = {
            OR: [
              { firstName: { contains: s, mode: 'insensitive' } },
              { lastName: { contains: s, mode: 'insensitive' } },
              { employeeCode: { contains: s, mode: 'insensitive' } },
            ],
          };
        }

        const [leaves, total] = await Promise.all([
          this.prisma.leaveRequest.findMany({
            where: whereClause,
            include: {
              employee: {
                select: {
                  id: true,
                  employeeCode: true,
                  firstName: true,
                  lastName: true,
                  department: { select: { name: true } },
                },
              },
              leaveType: { select: { id: true, name: true, code: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
          this.prisma.leaveRequest.count({ where: whereClause }),
        ]);

        const formattedItems = leaves.map((l) => ({
          id: l.id,
          employeeCode: l.employee?.employeeCode || '—',
          employeeName: `${l.employee?.firstName || ''} ${l.employee?.lastName || ''}`.trim() || '—',
          department: l.employee?.department?.name || '—',
          leaveType: l.leaveType?.name || 'General Leave',
          fromDate: l.fromDate.toISOString().split('T')[0],
          toDate: l.toDate.toISOString().split('T')[0],
          days: l.days,
          reason: l.reason || '—',
          status: l.status,
          createdAt: l.createdAt.toISOString(),
        }));

        return {
          type,
          items: formattedItems,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
          },
        };
      }

      case 'EMPLOYEES': {
        const whereClause: any = {
          customerId: numCustomerId,
        };

        if (query.status && query.status !== 'ALL') {
          whereClause.status = query.status;
        }

        if (query.department && query.department !== 'ALL') {
          whereClause.department = { name: { contains: query.department, mode: 'insensitive' } };
        }

        if (query.search?.trim()) {
          const s = query.search.trim();
          whereClause.OR = [
            { firstName: { contains: s, mode: 'insensitive' } },
            { lastName: { contains: s, mode: 'insensitive' } },
            { employeeCode: { contains: s, mode: 'insensitive' } },
            { email: { contains: s, mode: 'insensitive' } },
            { phone: { contains: s, mode: 'insensitive' } },
          ];
        }

        const [employees, total] = await Promise.all([
          this.prisma.employee.findMany({
            where: whereClause,
            include: {
              department: { select: { name: true } },
              designation: { select: { name: true } },
              office: { select: { name: true, city: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
          this.prisma.employee.count({ where: whereClause }),
        ]);

        const formattedItems = employees.map((e) => ({
          id: e.id,
          employeeCode: e.employeeCode,
          name: `${e.firstName} ${e.lastName}`.trim(),
          email: e.email,
          phone: e.phone || '—',
          department: e.department?.name || '—',
          designation: e.designation?.name || '—',
          office: e.office?.name || '—',
          status: e.status,
          joiningDate: e.joiningDate ? e.joiningDate.toISOString().split('T')[0] : '—',
        }));

        return {
          type,
          items: formattedItems,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
          },
        };
      }

      case 'VISITS': {
        const whereClause: any = {
          customerId: numCustomerId,
          date: { gte: startDate, lte: endDate },
        };

        if (query.status && query.status !== 'ALL') {
          whereClause.status = query.status;
        }

        if (query.search?.trim()) {
          const s = query.search.trim();
          whereClause.OR = [
            { customerName: { contains: s, mode: 'insensitive' } },
            { purpose: { contains: s, mode: 'insensitive' } },
            { employee: { firstName: { contains: s, mode: 'insensitive' } } },
            { employee: { lastName: { contains: s, mode: 'insensitive' } } },
          ];
        }

        const [visits, total] = await Promise.all([
          this.prisma.visit.findMany({
            where: whereClause,
            include: {
              employee: {
                select: {
                  id: true,
                  employeeCode: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
            orderBy: { date: 'desc' },
            skip,
            take: limit,
          }),
          this.prisma.visit.count({ where: whereClause }),
        ]);

        const formattedItems = visits.map((v) => ({
          id: v.id,
          date: v.date.toISOString().split('T')[0],
          time: v.time || '—',
          clientName: v.customerName,
          purpose: v.purpose,
          location: v.location,
          assignedEmployee: `${v.employee?.firstName || ''} ${v.employee?.lastName || ''}`.trim() || '—',
          employeeCode: v.employee?.employeeCode || '—',
          status: v.status,
          outcome: v.outcome || '—',
        }));

        return {
          type,
          items: formattedItems,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
          },
        };
      }

      default:
        throw new BadRequestException(`Unsupported report type: ${type}`);
    }
  }

  /**
   * Export reports as CSV datasets from real database records with full date-range support.
   */
  async exportReport(customerId: number | string, body: ExportReportDto) {
    const numCustomerId = Number(customerId) || 1;
    const type = body.reportType?.toUpperCase() || 'ATTENDANCE';
    const format = body.format?.toUpperCase() || 'CSV';

    const { startDate, endDate } = this.resolveDateRange(body.dateFrom, body.dateTo);

    let csvContent = '';
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `report_${type.toLowerCase()}_${dateStr}.${format.toLowerCase()}`;

    if (type === 'ATTENDANCE') {
      const records = await this.prisma.attendance.findMany({
        where: {
          customerId: numCustomerId,
          date: { gte: startDate, lte: endDate },
          ...(body.status && body.status !== 'ALL' ? { status: body.status as any } : {}),
        },
        include: {
          employee: {
            select: {
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
          office: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
        take: 5000,
      });

      csvContent =
        'Date,Employee Code,Employee Name,Department,Status,Punch In,Punch Out,Working Hours,Break Duration,Office/Location\n' +
        records
          .map(
            (r) =>
              `"${r.date.toISOString().split('T')[0]}","${r.employee?.employeeCode || ''}","${r.employee?.firstName || ''} ${r.employee?.lastName || ''}","${r.employee?.department?.name || ''}","${r.status}","${r.punchIn ? r.punchIn.toISOString() : ''}","${r.punchOut ? r.punchOut.toISOString() : ''}",${r.workingHours || 0},${r.breakDuration || 0},"${r.office?.name || r.locationIn || 'Office'}"`,
          )
          .join('\n');
    } else if (type === 'PAYROLL') {
      const slips = await this.prisma.salarySlip.findMany({
        where: {
          customerId: numCustomerId,
          generatedAt: { gte: startDate, lte: endDate },
          ...(body.status && body.status !== 'ALL' ? { status: body.status } : {}),
        },
        include: {
          employee: {
            select: {
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
        },
        orderBy: { generatedAt: 'desc' },
        take: 5000,
      });

      csvContent =
        'Slip Number,Pay Period,Employee Code,Employee Name,Department,Gross Salary,Total Deductions,Net Salary,Status\n' +
        slips
          .map(
            (s) =>
              `"${s.slipNumber}","${s.payPeriod}","${s.employee?.employeeCode || ''}","${s.employee?.firstName || ''} ${s.employee?.lastName || ''}","${s.employee?.department?.name || ''}",${s.grossSalary},${s.totalDeductions},${s.netSalary},"${s.status}"`,
          )
          .join('\n');
    } else if (type === 'LEAVES') {
      const leaves = await this.prisma.leaveRequest.findMany({
        where: {
          customerId: numCustomerId,
          createdAt: { gte: startDate, lte: endDate },
          ...(body.status && body.status !== 'ALL' ? { status: body.status as any } : {}),
        },
        include: {
          employee: {
            select: {
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
          leaveType: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });

      csvContent =
        'Employee Code,Employee Name,Department,Leave Type,From Date,To Date,Days,Reason,Status\n' +
        leaves
          .map(
            (l) =>
              `"${l.employee?.employeeCode || ''}","${l.employee?.firstName || ''} ${l.employee?.lastName || ''}","${l.employee?.department?.name || ''}","${l.leaveType?.name || 'General'}","${l.fromDate.toISOString().split('T')[0]}","${l.toDate.toISOString().split('T')[0]}",${l.days},"${(l.reason || '').replace(/"/g, '""')}","${l.status}"`,
          )
          .join('\n');
    } else if (type === 'VISITS') {
      const visits = await this.prisma.visit.findMany({
        where: {
          customerId: numCustomerId,
          date: { gte: startDate, lte: endDate },
          ...(body.status && body.status !== 'ALL' ? { status: body.status as any } : {}),
        },
        include: {
          employee: {
            select: {
              employeeCode: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { date: 'desc' },
        take: 5000,
      });

      csvContent =
        'Date,Time,Client Name,Purpose,Location,Employee Code,Employee Name,Status,Outcome\n' +
        visits
          .map(
            (v) =>
              `"${v.date.toISOString().split('T')[0]}","${v.time || ''}","${v.customerName.replace(/"/g, '""')}","${(v.purpose || '').replace(/"/g, '""')}","${(v.location || '').replace(/"/g, '""')}","${v.employee?.employeeCode || ''}","${v.employee?.firstName || ''} ${v.employee?.lastName || ''}","${v.status}","${(v.outcome || '').replace(/"/g, '""')}"`,
          )
          .join('\n');
    } else {
      const employees = await this.prisma.employee.findMany({
        where: {
          customerId: numCustomerId,
          ...(body.status && body.status !== 'ALL' ? { status: body.status } : {}),
        },
        include: {
          department: { select: { name: true } },
          designation: { select: { name: true } },
          office: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });

      csvContent =
        'Employee Code,Full Name,Email,Phone,Department,Designation,Branch,Status,Joining Date\n' +
        employees
          .map(
            (e) =>
              `"${e.employeeCode}","${e.firstName} ${e.lastName}","${e.email}","${e.phone || ''}","${e.department?.name || ''}","${e.designation?.name || ''}","${e.office?.name || ''}","${e.status}","${e.joiningDate ? e.joiningDate.toISOString().split('T')[0] : ''}"`,
          )
          .join('\n');
    }

    return {
      success: true,
      reportType: type,
      format,
      filename,
      data: csvContent,
      rowsCount: Math.max(0, csvContent.split('\n').length - 1),
      generatedAt: new Date().toISOString(),
    };
  }

  getCatalog() {
    return { categories: REPORT_CATEGORIES, reports: REPORT_CATALOG };
  }

  assertReportAccess(user: any, report: ReportDefinition) {
    if (report.sensitive === 'payroll' && !isUserSuperAdmin(user) && !isUserAdmin(user)) {
      throw new ForbiddenException('Payroll reports are limited to administrators');
    }
  }

  async runCatalogReport(customerId: number, reportId: string, query: QueryReportDto, user?: any) {
    const report = reportById(reportId);
    if (!report) throw new BadRequestException('Unknown report');
    if (!report.available || !report.type) throw new BadRequestException(report.reason || 'This report is not available');
    this.assertReportAccess(user, report);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(query.limit) || 20));
    const preset = report.preset || {};
    const { startDate, endDate } = this.resolveDateRange(query.dateFrom, query.dateTo);
    const status = query.status || preset.status;
    let rows: Record<string, any>[] = [];
    let total = 0;

    if (['ATTENDANCE', 'PAYROLL', 'LEAVES', 'EMPLOYEES', 'VISITS', 'REVENUE'].includes(report.type) && !preset.dateField) {
      const data = await this.getReportData(customerId, { ...query, type: report.type as any, status, page, limit });
      rows = data.items || [];
      total = data.pagination?.total || rows.length;
    } else if (report.type === 'LEADS') {
      const where: any = { customerId, deletedAt: null, createdAt: { gte: startDate, lte: endDate } };
      if (status && status !== 'ALL') where.status = status;
      const [items, count] = await Promise.all([
        this.prisma.lead.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { stage: true, assignedTo: { select: { firstName: true, lastName: true } } } }),
        this.prisma.lead.count({ where }),
      ]);
      total = count;
      rows = items.map((lead) => ({ name: `${lead.firstName} ${lead.lastName}`.trim(), company: lead.companyName || '—', phone: lead.phone || '—', status: lead.stage?.name || lead.status, source: lead.source, category: lead.category || '—', assigned: `${lead.assignedTo?.firstName || ''} ${lead.assignedTo?.lastName || ''}`.trim() || '—' }));
    } else if (report.type === 'DEALS') {
      const where: any = { customerId, deletedAt: null, createdAt: { gte: startDate, lte: endDate } };
      if (preset.outcome === 'closed') where.OR = [{ isWon: true }, { isLost: true }];
      if (query.department || preset.stage) where.stage = { name: { equals: preset.stage || query.department, mode: 'insensitive' } };
      const [items, count] = await Promise.all([
        this.prisma.deal.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { stage: true, company: true, assignedTo: { select: { firstName: true, lastName: true } } } }),
        this.prisma.deal.count({ where }),
      ]);
      total = count;
      rows = items.map((deal) => ({ deal: deal.title, value: deal.amount, stage: deal.stage?.name || '—', company: deal.company?.name || '—', status: deal.isWon ? 'Won' : deal.isLost ? 'Lost' : 'Open', closeDate: deal.expectedClosing ? deal.expectedClosing.toISOString().slice(0, 10) : '—', assigned: `${deal.assignedTo?.firstName || ''} ${deal.assignedTo?.lastName || ''}`.trim() || '—' }));
    } else if (report.type === 'FOLLOWUPS') {
      const where: any = { customerId, deletedAt: null, nextFollowUpDate: { not: null } };
      const items = await this.prisma.lead.findMany({ where, take: 500, orderBy: { nextFollowUpDate: 'asc' }, include: { stage: true, assignedTo: { select: { firstName: true, lastName: true } } } });
      const today = new Date().toISOString().slice(0, 10);
      const filtered = items.filter((lead) => {
        const day = lead.nextFollowUpDate ? lead.nextFollowUpDate.toISOString().slice(0, 10) : '';
        if (preset.bucket === 'upcoming') return day >= today;
        if (preset.bucket === 'overdue') return day < today;
        return true;
      });
      total = filtered.length;
      rows = filtered.slice((page - 1) * limit, page * limit).map((lead) => ({ name: `${lead.firstName} ${lead.lastName}`.trim(), company: lead.companyName || '—', phone: lead.phone || '—', followUp: lead.nextFollowUpDate ? lead.nextFollowUpDate.toISOString().slice(0, 10) : 'Not Scheduled', time: lead.nextFollowUpTime || '—', status: lead.stage?.name || lead.status, assigned: `${lead.assignedTo?.firstName || ''} ${lead.assignedTo?.lastName || ''}`.trim() || '—' }));
    } else if (report.type === 'TASKS') {
      const where: any = { customerId, deletedAt: null, createdAt: { gte: startDate, lte: endDate } };
      if (status && status !== 'ALL') where.status = status;
      const [items, count] = await Promise.all([
        this.prisma.task.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
        this.prisma.task.count({ where }),
      ]);
      total = count;
      rows = items.map((task) => ({ title: task.title, status: task.status, priority: task.priority, due: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : '—' }));
    } else if (report.type === 'AUDIT') {
      const where: any = { customerId, createdAt: { gte: startDate, lte: endDate } };
      const [items, count] = await Promise.all([
        this.prisma.auditLog.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
        this.prisma.auditLog.count({ where }),
      ]);
      total = count;
      rows = items.map((log) => ({ when: log.createdAt.toISOString(), user: log.userName || '—', action: log.action, module: log.module, description: log.description || '—' }));
    } else if (report.type === 'CUSTOMERS') {
      const where: any = { deletedAt: null, createdAt: { gte: startDate, lte: endDate } };
      if (status && status !== 'ALL') where.isActive = status === 'ACTIVE';
      const [items, count] = await Promise.all([
        this.prisma.customer.findMany({ where: { ...where, OR: [{ id: customerId }, { parentCustomerId: customerId }] } as any, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }).catch(() => this.prisma.customer.findMany({ where: { id: customerId, deletedAt: null }, take: limit })),
        this.prisma.customer.count({ where: { id: customerId, deletedAt: null } }),
      ]);
      total = count;
      rows = items.map((item) => ({ name: item.name, email: item.email || '—', phone: item.phone || '—', city: item.city || '—', status: item.isActive ? 'Active' : 'Inactive' }));
    } else if (report.type === 'INVOICES') {
      const where: any = { customerId, deletedAt: null, issueDate: { gte: startDate, lte: endDate } };
      if (preset.outstanding === 'true') where.status = { notIn: ['PAID', 'CANCELLED'] };
      else if (status && status !== 'ALL') where.status = status;
      const [items, count] = await Promise.all([
        this.prisma.invoice.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { issueDate: 'desc' }, include: { contact: true } }),
        this.prisma.invoice.count({ where }),
      ]);
      total = count;
      rows = items.map((invoice) => ({ invoice: invoice.invoiceNo, customer: `${invoice.contact?.firstName || ''} ${invoice.contact?.lastName || ''}`.trim() || '—', status: invoice.status, subtotal: invoice.subTotal, tax: invoice.taxAmount, total: invoice.totalAmount, due: invoice.dueDate.toISOString().slice(0, 10) }));
    } else if (report.type === 'PRODUCTS') {
      const where: any = { customerId, deletedAt: null };
      if (preset.lowStock === 'true') where.stock = { lte: 5 };
      const [items, count] = await Promise.all([
        this.prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: 'asc' } }),
        this.prisma.product.count({ where }),
      ]);
      total = count;
      rows = items.map((product) => ({ name: product.name, sku: product.sku, price: product.unitPrice, tax: product.taxRate, stock: product.stock, status: product.isActive ? 'Active' : 'Inactive' }));
    } else if (report.type === 'INFLUENCERS') {
      const where: any = { deletedAt: null };
      if (status && status !== 'ALL') where.status = status;
      const [items, count] = await Promise.all([
        this.prisma.influencer.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: 'asc' } }),
        this.prisma.influencer.count({ where }),
      ]);
      total = count;
      rows = items.map((person) => ({ name: person.name, platform: person.platform, status: person.status, city: person.city || '—', followers: person.followers }));
    } else if (report.type === 'EMPLOYEES') {
      const where: any = { customerId, joiningDate: { gte: startDate, lte: endDate } };
      const [items, count] = await Promise.all([
        this.prisma.employee.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { joiningDate: 'desc' }, include: { department: true, designation: true } }),
        this.prisma.employee.count({ where }),
      ]);
      total = count;
      rows = items.map((employee) => ({ code: employee.employeeCode, name: `${employee.firstName} ${employee.lastName}`.trim(), department: employee.department?.name || '—', designation: employee.designation?.name || '—', joined: employee.joiningDate.toISOString().slice(0, 10), status: employee.status }));
    }

    const columns = rows[0] ? Object.keys(rows[0]) : [];
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, email: true, phone: true, city: true } });
    return {
      report: { id: report.id, name: report.name, description: report.description, category: report.category },
      company: customer,
      dateRange: { from: startDate.toISOString().slice(0, 10), to: endDate.toISOString().slice(0, 10) },
      filters: { status: status || 'All', stage: preset.stage || query.department || 'All' },
      columns,
      rows,
      summary: { records: total },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
      generatedAt: new Date().toISOString(),
    };
  }

  async buildPdf(customerId: number, reportId: string, query: QueryReportDto, user?: any) {
    const view = await this.runCatalogReport(customerId, reportId, { ...query, page: 1, limit: 500 }, user);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'A4', layout: view.columns.length > 6 ? 'landscape' : 'portrait', bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const company = view.company?.name || 'QB Suite';
      doc.fontSize(16).fillColor('#163A2E').text('QB Suite');
      doc.fontSize(10).fillColor('#172B24').text(company);
      doc.moveDown(0.4);
      doc.fontSize(14).text(view.report.name);
      doc.fontSize(9).fillColor('#718078').text(view.report.description);
      doc.text(`Period: ${view.dateRange.from} to ${view.dateRange.to}`);
      doc.text(`Generated: ${new Date(view.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      doc.text(`Records: ${view.summary.records}`);
      doc.moveDown(0.6);
      if (!view.rows.length) {
        doc.fillColor('#172B24').fontSize(11).text('No records match these filters.');
      } else {
        doc.fontSize(8).fillColor('#172B24');
        view.rows.forEach((row, index) => {
          if (doc.y > doc.page.height - 60) doc.addPage();
          const line = view.columns.map((column) => `${column}: ${row[column] ?? '—'}`).join('  |  ');
          doc.text(`${index + 1}. ${line}`, { width: doc.page.width - 72 });
          doc.moveDown(0.3);
        });
      }
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#718078').text(`${company} · Page ${i + 1} of ${range.count}`, 36, doc.page.height - 28, { align: 'center', width: doc.page.width - 72 });
      }
      doc.end();
    });
    return { filename: `${reportId}.pdf`, buffer };
  }
}
