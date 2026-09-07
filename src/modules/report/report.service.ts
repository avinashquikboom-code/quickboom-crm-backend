import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryReportDto, ExportReportDto } from './dto/report.dto';
import { getBusinessDate, getBusinessDayRange } from '../../common/utils/timezone.util';

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
}
