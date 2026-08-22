import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLeaveDto, RejectLeaveDto } from './dto/leave.dto';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';
import { AttendanceStatus, RequestStatus } from '@prisma/client';

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCustomerId(customerId?: number | string): Promise<number> {
    if (customerId !== undefined && customerId !== null) {
      const num = Number(customerId);
      if (!isNaN(num) && num > 0) return num;
    }
    const firstCust = await this.prisma.customer.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    return firstCust ? firstCust.id : 1;
  }

  // ==========================================
  // 1. TODAY'S WORKFORCE AVAILABILITY
  // ==========================================
  async getAvailability(
    customerId?: number | string,
    query?: {
      search?: string;
      officeId?: string | number;
      departmentId?: string | number;
      status?: string;
      date?: string;
    },
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    // Target date window (midnight to 23:59:59)
    const targetDate = query?.date ? new Date(query.date) : new Date();
    const todayStart = new Date(targetDate);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(targetDate);
    todayEnd.setHours(23, 59, 59, 999);

    const whereEmp: any = {
      customerId: numCustomerId,
      status: 'ACTIVE',
    };

    if (query?.officeId && query.officeId !== 'ALL') {
      whereEmp.officeId = Number(query.officeId);
    }

    if (query?.departmentId && query.departmentId !== 'ALL') {
      whereEmp.departmentId = Number(query.departmentId);
    }

    // Fetch all active employees with relations
    const employees = await this.prisma.employee.findMany({
      where: whereEmp,
      include: {
        department: true,
        designation: true,
        office: true,
        attendances: {
          where: {
            date: { gte: todayStart, lte: todayEnd },
          },
          include: {
            breaks: { orderBy: { breakStart: 'asc' } },
          },
          take: 1,
        },
        leaveRequests: {
          where: {
            fromDate: { lte: todayEnd },
            toDate: { gte: todayStart },
            status: RequestStatus.APPROVED,
          },
          include: { leaveType: true },
          take: 1,
        },
      },
      orderBy: { firstName: 'asc' },
    });

    let totalEmployees = employees.length;
    let availableCount = 0;
    let onLeaveCount = 0;
    let absentCount = 0;
    let onBreakCount = 0;

    const roster = employees.map((emp) => {
      const att = emp.attendances && emp.attendances.length > 0 ? emp.attendances[0] : null;
      const leave = emp.leaveRequests && emp.leaveRequests.length > 0 ? emp.leaveRequests[0] : null;

      let status: 'AVAILABLE' | 'ON_LEAVE' | 'ABSENT' | 'ON_BREAK' = 'ABSENT';
      let checkInStr = '—';
      let checkOutStr = '—';
      let breakStatus = 'No';
      let lastActivity = 'Inactive';

      if (leave) {
        status = 'ON_LEAVE';
        onLeaveCount++;
        lastActivity = `On Leave (${leave.leaveType?.name || 'Approved'})`;
      } else if (att && att.punchIn) {
        checkInStr = att.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (att.punchOut) {
          checkOutStr = att.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          status = 'AVAILABLE';
          availableCount++;
          lastActivity = `Checked Out at ${checkOutStr}`;
        } else {
          // Check if currently on break
          const activeBreak = (att.breaks || []).find((b) => !b.breakEnd);
          if (activeBreak) {
            status = 'ON_BREAK';
            onBreakCount++;
            breakStatus = activeBreak.breakStart.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });
            lastActivity = `On Break since ${breakStatus}`;
          } else {
            status = 'AVAILABLE';
            availableCount++;
            lastActivity = `Active On-Duty (In: ${checkInStr})`;
          }
        }
      } else {
        status = 'ABSENT';
        absentCount++;
        lastActivity = 'Not Checked In';
      }

      return {
        id: emp.id,
        employeeCode: emp.employeeCode || `EMP-${emp.id}`,
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        phone: emp.phone || '—',
        officeId: emp.officeId,
        office: emp.office?.name || emp.branch || 'Head Office',
        officeCity: emp.office?.city || '',
        departmentId: emp.departmentId,
        department: emp.department?.name || 'General',
        designationId: emp.designationId,
        designation: emp.designation?.name || 'Staff',
        status,
        checkIn: checkInStr,
        checkOut: checkOutStr,
        break: breakStatus,
        lastActivity,
        todayAttendance: att,
        todayLeave: leave,
      };
    });

    // Apply client filter criteria
    let filtered = roster;
    if (query?.status && query.status !== 'ALL') {
      filtered = filtered.filter((r) => r.status === query.status);
    }

    if (query?.search && query.search.trim().length > 0) {
      const s = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(s) ||
          r.employeeCode.toLowerCase().includes(s) ||
          r.department.toLowerCase().includes(s) ||
          r.designation.toLowerCase().includes(s) ||
          r.office.toLowerCase().includes(s),
      );
    }

    return {
      summary: {
        totalEmployees,
        availableCount,
        onLeaveCount,
        absentCount,
        onBreakCount,
        availabilityRate:
          totalEmployees > 0 ? Math.round(((availableCount + onBreakCount) / totalEmployees) * 100) : 0,
      },
      records: filtered,
    };
  }

  // ==========================================
  // 2. LEAVE REQUESTS MANAGEMENT
  // ==========================================
  async getLeaveRequests(
    customerId?: number | string,
    query?: {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? query.limit : 100;
    const skip = (page - 1) * limit;

    const where: any = {
      customerId: numCustomerId,
    };

    if (query?.status && query.status !== 'ALL') {
      where.status = query.status.toUpperCase() as RequestStatus;
    }

    if (query?.search && query.search.trim().length > 0) {
      const s = query.search.trim();
      where.OR = [
        { employee: { firstName: { contains: s, mode: 'insensitive' } } },
        { employee: { lastName: { contains: s, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: s, mode: 'insensitive' } } },
        { reason: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [items, total, pendingCount, approvedCount, rejectedCount] =
      await Promise.all([
        this.prisma.leaveRequest.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            employee: {
              include: {
                department: true,
                designation: true,
                office: true,
              },
            },
            leaveType: true,
          },
        }),
        this.prisma.leaveRequest.count({ where }),
        this.prisma.leaveRequest.count({
          where: { customerId: numCustomerId, status: RequestStatus.PENDING },
        }),
        this.prisma.leaveRequest.count({
          where: { customerId: numCustomerId, status: RequestStatus.APPROVED },
        }),
        this.prisma.leaveRequest.count({
          where: { customerId: numCustomerId, status: RequestStatus.REJECTED },
        }),
      ]);

    return {
      data: items.map((l) => ({
        id: l.id,
        customerId: l.customerId,
        employeeId: l.employeeId,
        employeeCode: l.employee?.employeeCode || `EMP-${l.employeeId}`,
        employeeName: l.employee ? `${l.employee.firstName} ${l.employee.lastName}`.trim() : 'Employee',
        employee: l.employee
          ? {
              id: l.employee.id,
              employeeCode: l.employee.employeeCode,
              name: `${l.employee.firstName} ${l.employee.lastName}`.trim(),
              email: l.employee.email,
              phone: l.employee.phone,
              department: l.employee.department?.name || 'General',
              designation: l.employee.designation?.name || 'Staff',
              office: l.employee.office?.name || l.employee.branch || 'Head Office',
              officeCity: l.employee.office?.city || '',
            }
          : null,
        department: l.employee?.department?.name || 'General',
        office: l.employee?.office?.name || l.employee?.branch || 'Head Office',
        leaveTypeId: l.leaveTypeId,
        leaveType: l.leaveType?.name || 'Casual Leave',
        fromDate: l.fromDate ? l.fromDate.toISOString().split('T')[0] : '',
        toDate: l.toDate ? l.toDate.toISOString().split('T')[0] : '',
        days: l.days || 1,
        totalDays: l.days || 1,
        reason: l.reason || 'Personal Leave',
        attachmentUrl: l.attachmentUrl,
        status: l.status,
        rejectionReason: l.rejectionReason,
        appliedOn: l.createdAt ? l.createdAt.toISOString().split('T')[0] : '',
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      })),
      counts: {
        all: total,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
      },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getLeaveRequestById(customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id, customerId: numCustomerId },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
            office: true,
          },
        },
        leaveType: true,
      },
    });

    if (!leave) {
      throw new NotFoundException(`Leave request #${id} not found`);
    }

    return {
      id: leave.id,
      customerId: leave.customerId,
      employeeId: leave.employeeId,
      employeeCode: leave.employee?.employeeCode || `EMP-${leave.employeeId}`,
      employeeName: leave.employee
        ? `${leave.employee.firstName} ${leave.employee.lastName}`.trim()
        : 'Employee',
      employee: {
        id: leave.employee?.id,
        employeeCode: leave.employee?.employeeCode,
        name: `${leave.employee?.firstName} ${leave.employee?.lastName}`.trim(),
        email: leave.employee?.email,
        phone: leave.employee?.phone,
        department: leave.employee?.department?.name || 'General',
        designation: leave.employee?.designation?.name || 'Staff',
        office: leave.employee?.office?.name || leave.employee?.branch || 'Head Office',
        officeCity: leave.employee?.office?.city || '',
      },
      department: leave.employee?.department?.name || 'General',
      office: leave.employee?.office?.name || leave.employee?.branch || 'Head Office',
      leaveTypeId: leave.leaveTypeId,
      leaveType: leave.leaveType?.name || 'Casual Leave',
      fromDate: leave.fromDate ? leave.fromDate.toISOString().split('T')[0] : '',
      toDate: leave.toDate ? leave.toDate.toISOString().split('T')[0] : '',
      days: leave.days || 1,
      totalDays: leave.days || 1,
      reason: leave.reason || 'Personal Leave',
      attachmentUrl: leave.attachmentUrl,
      status: leave.status,
      rejectionReason: leave.rejectionReason,
      appliedOn: leave.createdAt ? leave.createdAt.toISOString().split('T')[0] : '',
      createdAt: leave.createdAt,
      updatedAt: leave.updatedAt,
    };
  }

  async approveLeave(user: any, customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id, customerId: numCustomerId },
      include: { employee: true },
    });

    if (!leave) {
      throw new NotFoundException(`Leave request #${id} not found`);
    }

    if (leave.status === RequestStatus.APPROVED) {
      throw new BadRequestException('Leave request is already approved');
    }

    if (leave.status === RequestStatus.REJECTED) {
      throw new BadRequestException(`Cannot approve request that is currently ${leave.status}`);
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: RequestStatus.APPROVED,
        approvedById: user?.id || null,
        rejectionReason: null,
      },
    });

    // Check if leave covers today, and update today's attendance record
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    if (leave.fromDate <= todayEnd && leave.toDate >= today) {
      const todayAtt = await this.prisma.attendance.findFirst({
        where: {
          employeeId: leave.employeeId,
          date: { gte: today, lte: todayEnd },
        },
      });

      if (todayAtt && !todayAtt.punchIn) {
        await this.prisma.attendance.update({
          where: { id: todayAtt.id },
          data: { status: AttendanceStatus.LEAVE },
        });
      }
    }

    return {
      success: true,
      message: `Leave request for ${leave.employee ? leave.employee.firstName : 'employee'} approved successfully.`,
      data: updated,
    };
  }

  async rejectLeave(
    user: any,
    customerId: number | string | undefined,
    id: number,
    dto?: RejectLeaveDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id, customerId: numCustomerId },
      include: { employee: true },
    });

    if (!leave) {
      throw new NotFoundException(`Leave request #${id} not found`);
    }

    if (leave.status === RequestStatus.REJECTED) {
      throw new BadRequestException('Leave request is already rejected');
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: RequestStatus.REJECTED,
        rejectionReason: dto?.rejectionReason?.trim() || 'Declined by Administrator / HR',
        approvedById: user?.id || null,
      },
    });

    return {
      success: true,
      message: `Leave request rejected.`,
      data: updated,
    };
  }

  async createLeave(customerId: number | string | undefined, dto: CreateLeaveDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    // Resolve or find leave type
    let leaveTypeId = dto.leaveTypeId;
    if (!leaveTypeId) {
      let typeName = dto.leaveTypeName || 'Casual Leave';
      let type = await this.prisma.leaveType.findFirst({
        where: { customerId: numCustomerId, name: { equals: typeName, mode: 'insensitive' } },
      });
      if (!type) {
        type = await this.prisma.leaveType.create({
          data: {
            customerId: numCustomerId,
            name: typeName,
            code: typeName.substring(0, 3).toUpperCase(),
            daysAllowedPerYear: 12,
          },
        });
      }
      leaveTypeId = type.id;
    }

    const fromDate = new Date(dto.fromDate);
    const toDate = new Date(dto.toDate);

    let days = dto.days;
    if (!days || isNaN(days)) {
      const diffMs = toDate.getTime() - fromDate.getTime();
      days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1);
    }

    return this.prisma.leaveRequest.create({
      data: {
        customerId: numCustomerId,
        employeeId: Number(dto.employeeId),
        leaveTypeId,
        fromDate,
        toDate,
        days,
        reason: dto.reason?.trim() || null,
        status: RequestStatus.PENDING,
      },
      include: {
        employee: true,
        leaveType: true,
      },
    });
  }

  // ==========================================
  // 3. PUBLIC HOLIDAYS MANAGEMENT
  // ==========================================
  async getPublicHolidays(
    customerId?: number | string,
    query?: {
      search?: string;
      officeId?: string | number;
      year?: string | number;
      isActive?: boolean;
    },
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const where: any = { customerId: numCustomerId };

    if (query?.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query?.officeId && query.officeId !== 'ALL') {
      const numOff = Number(query.officeId);
      where.OR = [{ officeId: numOff }, { officeId: null }];
    }

    if (query?.search && query.search.trim().length > 0) {
      const s = query.search.trim();
      where.name = { contains: s, mode: 'insensitive' };
    }

    if (query?.year) {
      const yr = Number(query.year);
      if (!isNaN(yr)) {
        where.date = {
          gte: new Date(`${yr}-01-01T00:00:00.000Z`),
          lte: new Date(`${yr}-12-31T23:59:59.999Z`),
        };
      }
    }

    const holidays = await this.prisma.publicHoliday.findMany({
      where,
      orderBy: { date: 'asc' },
      include: {
        office: {
          select: { id: true, name: true, city: true },
        },
      },
    });

    return holidays.map((h) => ({
      id: h.id,
      name: h.name,
      date: h.date.toISOString().split('T')[0],
      rawDate: h.date,
      description: h.description || '',
      officeId: h.officeId,
      officeName: h.office?.name || 'All Offices',
      officeCity: h.office?.city || '',
      scope: h.office ? `${h.office.name} (${h.office.city || 'Branch'})` : 'All Offices',
      isActive: h.isActive,
      status: h.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    }));
  }

  async getPublicHolidayById(customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const holiday = await this.prisma.publicHoliday.findFirst({
      where: { id, customerId: numCustomerId },
      include: { office: true },
    });

    if (!holiday) {
      throw new NotFoundException(`Public holiday #${id} not found`);
    }

    return {
      ...holiday,
      date: holiday.date.toISOString().split('T')[0],
      officeName: holiday.office?.name || 'All Offices',
      status: holiday.isActive ? 'ACTIVE' : 'INACTIVE',
    };
  }

  async createPublicHoliday(user: any, customerId: number | string | undefined, dto: CreateHolidayDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const trimmedName = dto.name.trim();

    if (!trimmedName) {
      throw new BadRequestException('Holiday name is required');
    }

    const holidayDate = new Date(dto.date);
    if (isNaN(holidayDate.getTime())) {
      throw new BadRequestException('Valid holiday date is required');
    }

    // Check duplicate for same date & office scope
    const dayStart = new Date(holidayDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(holidayDate);
    dayEnd.setHours(23, 59, 59, 999);

    const existing = await this.prisma.publicHoliday.findFirst({
      where: {
        customerId: numCustomerId,
        date: { gte: dayStart, lte: dayEnd },
        officeId: dto.officeId ? Number(dto.officeId) : null,
      },
    });

    if (existing) {
      throw new ConflictException(
        `A holiday ("${existing.name}") is already declared for this date and location scope.`,
      );
    }

    let officeId: number | null = null;
    if (dto.officeId) {
      const office = await this.prisma.branchGeofence.findFirst({
        where: { id: Number(dto.officeId), customerId: numCustomerId },
      });
      if (!office) {
        throw new BadRequestException(`Office #${dto.officeId} not found`);
      }
      officeId = office.id;
    }

    return this.prisma.publicHoliday.create({
      data: {
        customerId: numCustomerId,
        name: trimmedName,
        date: holidayDate,
        description: dto.description?.trim() || null,
        officeId,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
        createdById: user?.id || null,
      },
      include: {
        office: true,
      },
    });
  }

  async updatePublicHoliday(
    customerId: number | string | undefined,
    id: number,
    dto: UpdateHolidayDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const holiday = await this.prisma.publicHoliday.findFirst({
      where: { id, customerId: numCustomerId },
    });

    if (!holiday) {
      throw new NotFoundException(`Public holiday #${id} not found`);
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description.trim() || null;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.isActive !== undefined) data.isActive = Boolean(dto.isActive);
    if (dto.officeId !== undefined) {
      if (dto.officeId) {
        const office = await this.prisma.branchGeofence.findFirst({
          where: { id: Number(dto.officeId), customerId: numCustomerId },
        });
        if (!office) throw new BadRequestException(`Office #${dto.officeId} not found`);
        data.officeId = office.id;
      } else {
        data.officeId = null;
      }
    }

    return this.prisma.publicHoliday.update({
      where: { id },
      data,
      include: { office: true },
    });
  }

  async deletePublicHoliday(customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const holiday = await this.prisma.publicHoliday.findFirst({
      where: { id, customerId: numCustomerId },
    });

    if (!holiday) {
      throw new NotFoundException(`Public holiday #${id} not found`);
    }

    await this.prisma.publicHoliday.delete({
      where: { id },
    });

    return {
      success: true,
      message: `Public holiday "${holiday.name}" deleted successfully.`,
    };
  }
}
