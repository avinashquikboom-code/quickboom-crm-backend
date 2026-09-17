import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLeaveDto,
  RejectLeaveDto,
  AdjustLeaveBalanceDto,
} from './dto/leave.dto';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';
import {
  UpsertAttendancePolicyDto,
  UpsertLeavePolicyDto,
  UpsertSalaryPolicyDto,
  UpsertClaimPolicyDto,
} from './dto/policy.dto';
import { AttendanceStatus, RequestStatus } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationService?: NotificationService,
  ) {}

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
  // 0. LEAVE TYPES
  // ==========================================
  async getLeaveTypes(customerId: number | string | undefined) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    let leaveTypes = await this.prisma.leaveType.findMany({
      where: { customerId: numCustomerId, isActive: true },
      orderBy: { id: 'asc' },
    });

    if (leaveTypes.length === 0) {
      const defaultTypes = [
        { name: 'Casual Leave', code: 'CL', daysAllowedPerYear: 12 },
        { name: 'Sick Leave', code: 'SL', daysAllowedPerYear: 8 },
        { name: 'Paid Leave', code: 'PL', daysAllowedPerYear: 15 },
        { name: 'Unpaid Leave', code: 'UL', daysAllowedPerYear: 0 },
      ];

      for (const dt of defaultTypes) {
        await this.prisma.leaveType.upsert({
          where: { customerId_code: { customerId: numCustomerId, code: dt.code } },
          update: {},
          create: {
            customerId: numCustomerId,
            name: dt.name,
            code: dt.code,
            daysAllowedPerYear: dt.daysAllowedPerYear,
          },
        });
      }

      leaveTypes = await this.prisma.leaveType.findMany({
        where: { customerId: numCustomerId, isActive: true },
        orderBy: { id: 'asc' },
      });
    }

    return {
      success: true,
      data: leaveTypes.map((lt) => ({
        id: lt.id,
        leaveTypeId: lt.id,
        name: lt.name,
        code: lt.code,
        daysAllowedPerYear: lt.daysAllowedPerYear,
        isCarryForward: lt.isCarryForward,
        isActive: lt.isActive,
      })),
    };
  }

  // ==========================================
  // 2. LEAVE REQUESTS MANAGEMENT
  // ==========================================
  async getLeaveRequests(
    user?: any,
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

    // If caller is an Employee (mobile app), scope strictly to their own employee record
    const isEmpUser = user && (String(user.role).toUpperCase() === 'EMPLOYEE' || user.roleType === 'EMPLOYEE');
    if (isEmpUser) {
      const emp = user.employee || (await this.prisma.employee.findFirst({
        where: { userId: user.id, customerId: numCustomerId },
      }));
      if (emp) {
        where.employeeId = emp.id;
      }
    }

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

    const [items, total, pendingCount, approvedCount, rejectedCount] = await Promise.all([
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
        where: { ...where, status: RequestStatus.PENDING },
      }),
      this.prisma.leaveRequest.count({
        where: { ...where, status: RequestStatus.APPROVED },
      }),
      this.prisma.leaveRequest.count({
        where: { ...where, status: RequestStatus.REJECTED },
      }),
    ]);

    const formatted = items.map((l) => ({
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
    }));

    return {
      success: true,
      data: formatted,
      items: formatted,
      counts: {
        all: total,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
      },
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
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

  async createLeave(user: any, customerId: number | string | undefined, dto: CreateLeaveDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    // 1. Resolve target employeeId with strict employee security isolation
    let employeeId: number | null = null;
    const isEmpUser = user && (String(user.role).toUpperCase() === 'EMPLOYEE' || user.roleType === 'EMPLOYEE');

    if (isEmpUser) {
      const selfEmp = user.employee || (await this.prisma.employee.findFirst({
        where: { userId: user.id, customerId: numCustomerId },
      }));
      if (!selfEmp) {
        throw new ForbiddenException('Authenticated employee profile not found');
      }
      employeeId = selfEmp.id;
    } else {
      if (dto.employeeId !== undefined && dto.employeeId !== null && !isNaN(Number(dto.employeeId))) {
        employeeId = Number(dto.employeeId);
      }
      if (!employeeId) {
        if (user?.employee?.id) {
          employeeId = user.employee.id;
        } else if (user?.id) {
          const emp = await this.prisma.employee.findFirst({
            where: { userId: user.id, customerId: numCustomerId },
          });
          if (emp) {
            employeeId = emp.id;
          }
        }
      }
    }

    if (!employeeId) {
      throw new BadRequestException('Valid employeeId is required');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId: numCustomerId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee #${employeeId} not found`);
    }

    // 2. Resolve Leave Type
    let leaveTypeId = dto.leaveTypeId;
    let leaveType: any = null;
    if (leaveTypeId) {
      leaveType = await this.prisma.leaveType.findFirst({
        where: { id: Number(leaveTypeId), customerId: numCustomerId },
      });
      if (!leaveType) {
        throw new NotFoundException(`Leave type #${leaveTypeId} not found`);
      }
    } else {
      const typeName = dto.leaveTypeName || 'Casual Leave';
      leaveType = await this.prisma.leaveType.findFirst({
        where: { customerId: numCustomerId, name: { equals: typeName, mode: 'insensitive' } },
      });
      if (!leaveType) {
        leaveType = await this.prisma.leaveType.create({
          data: {
            customerId: numCustomerId,
            name: typeName,
            code: typeName.substring(0, 3).toUpperCase(),
            daysAllowedPerYear: 12,
          },
        });
      }
      leaveTypeId = leaveType.id;
    }

    // 3. Parse and validate dates
    const fromDate = new Date(dto.fromDate);
    const toDate = new Date(dto.toDate);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid fromDate or toDate provided');
    }
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);
    if (fromDate > toDate) {
      throw new BadRequestException('fromDate cannot be after toDate');
    }

    // 4. Calculate totalDays (inclusive difference)
    const fromStart = new Date(dto.fromDate);
    fromStart.setHours(0, 0, 0, 0);
    const toStart = new Date(dto.toDate);
    toStart.setHours(0, 0, 0, 0);

    const calculatedDays = Math.max(1, Math.round((toStart.getTime() - fromStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const days = dto.days && dto.days > 0 ? Number(dto.days) : calculatedDays;

    const currentYear = fromStart.getFullYear();
    const isUnlimited = leaveType.code === 'UL' || leaveType.name.toLowerCase().includes('unpaid');

    // 5. Pre-check available balance before submission (Available = Allocated - Used/Approved)
    if (!isUnlimited) {
      const existingBalance = await this.prisma.employeeLeaveBalance.findFirst({
        where: {
          employeeId,
          leaveTypeId: leaveType.id,
          year: currentYear,
        },
      });

      const allocated = existingBalance ? existingBalance.allocatedDays : leaveType.daysAllowedPerYear;
      const used = existingBalance ? existingBalance.usedDays : 0.0;
      const available = Math.max(0, allocated - used);

      if (available < days) {
        throw new BadRequestException(
          `Insufficient ${leaveType.name} balance. Available: ${available} day(s), Requested: ${days} day(s).`,
        );
      }
    }

    // 6. Create leave application with status = PENDING (DO NOT DEDUCT BALANCE)
    const created = await this.prisma.leaveRequest.create({
      data: {
        customerId: numCustomerId,
        employeeId,
        leaveTypeId: leaveType.id,
        fromDate,
        toDate,
        days: Math.round(days),
        reason: dto.reason?.trim() || null,
        status: RequestStatus.PENDING,
      },
      include: {
        employee: true,
        leaveType: true,
      },
    });

    return {
      success: true,
      message: 'Leave application submitted successfully with status PENDING',
      data: {
        id: created.id,
        employeeId: created.employeeId,
        leaveTypeId: created.leaveTypeId,
        leaveType: created.leaveType?.name,
        fromDate: created.fromDate.toISOString().split('T')[0],
        toDate: created.toDate.toISOString().split('T')[0],
        days: created.days,
        totalDays: created.days,
        status: created.status,
        reason: created.reason,
        createdAt: created.createdAt,
      },
    };
  }

  async approveLeave(user: any, customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    // Atomic transaction for leave approval + balance deduction
    return this.prisma.$transaction(async (tx) => {
      // 1. Fetch leave application inside transaction
      const leave = await tx.leaveRequest.findFirst({
        where: { id, customerId: numCustomerId },
        include: { employee: true, leaveType: true },
      });

      if (!leave) {
        throw new NotFoundException(`Leave request #${id} not found`);
      }

      // 2. Prevent double deduction: only PENDING leaves can be approved
      if (leave.status === RequestStatus.APPROVED) {
        throw new BadRequestException('Leave request is already approved. Balance was already deducted.');
      }

      if (leave.status !== RequestStatus.PENDING) {
        throw new BadRequestException(`Cannot approve request with status: ${leave.status}. Only PENDING leaves can be approved.`);
      }

      const currentYear = leave.fromDate.getFullYear();
      const requestedDays = Number(leave.days || 1);
      const isUnlimited = leave.leaveType?.code === 'UL' || leave.leaveType?.name.toLowerCase().includes('unpaid');

      // 3. Fetch employee leave balance for that leave type
      let balance = await tx.employeeLeaveBalance.findFirst({
        where: {
          employeeId: leave.employeeId,
          leaveTypeId: leave.leaveTypeId,
          year: currentYear,
        },
      });

      const defaultAllocated = leave.leaveType?.daysAllowedPerYear || 12.0;
      const allocated = balance ? balance.allocatedDays : defaultAllocated;
      const currentUsed = balance ? balance.usedDays : 0.0;
      const available = isUnlimited ? 999 : Math.max(0, allocated - currentUsed);

      // 4. Verify sufficient balance
      if (!isUnlimited && available < requestedDays) {
        throw new BadRequestException(
          `Insufficient ${leave.leaveType?.name || 'leave'} balance to approve this request. Available: ${available} day(s), Requested: ${requestedDays} day(s).`,
        );
      }

      // 5. Deduct requestedDays from balance (Single deduction)
      const newUsed = currentUsed + requestedDays;
      const newRemaining = Math.max(0, allocated - newUsed);

      if (!balance) {
        balance = await tx.employeeLeaveBalance.create({
          data: {
            customerId: numCustomerId,
            employeeId: leave.employeeId,
            leaveTypeId: leave.leaveTypeId,
            year: currentYear,
            allocatedDays: allocated,
            usedDays: newUsed,
            remainingDays: newRemaining,
          },
        });
      } else {
        balance = await tx.employeeLeaveBalance.update({
          where: { id: balance.id },
          data: {
            usedDays: newUsed,
            remainingDays: newRemaining,
          },
        });
      }

      // 6. Update leave status to APPROVED
      const updatedLeave = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: RequestStatus.APPROVED,
          approvedById: user?.id || null,
          rejectionReason: null,
        },
        include: { employee: true, leaveType: true },
      });

      // 7. Check if leave covers today, and update today's attendance record
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      if (leave.fromDate <= todayEnd && leave.toDate >= today) {
        const todayAtt = await tx.attendance.findFirst({
          where: {
            employeeId: leave.employeeId,
            date: { gte: today, lte: todayEnd },
          },
        });

        if (todayAtt && !todayAtt.punchIn) {
          await tx.attendance.update({
            where: { id: todayAtt.id },
            data: { status: AttendanceStatus.LEAVE },
          });
        }
      }

      return {
        success: true,
        message: `Leave request for ${leave.employee ? leave.employee.firstName : 'employee'} approved successfully.`,
        data: updatedLeave,
        balance: {
          leaveTypeId: leave.leaveTypeId,
          leaveType: leave.leaveType?.name,
          allocated: balance.allocatedDays,
          used: balance.usedDays,
          remaining: balance.remainingDays,
        },
      };
    }).then((result) => {
      // Dispatch push notification AFTER transaction commits (non-blocking, never fails the API)
      if (this.notificationService && result?.data) {
        const leaveData = result.data;
        const isHalfDay =
          Number(leaveData.days) === 0.5 ||
          (leaveData.reason && leaveData.reason.toLowerCase().includes('half')) ||
          Number(leaveData.days) < 1;

        this.notificationService
          .sendLeaveApprovalNotification(leaveData.employeeId, leaveData, isHalfDay)
          .catch((err) => {
            this.logger.error(`Failed to send leave approval push notification: ${err?.message}`);
          });
      }
      return result;
    });
  }

  async rejectLeave(
    user: any,
    customerId: number | string | undefined,
    id: number,
    dto?: RejectLeaveDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    return this.prisma.$transaction(async (tx) => {
      const leave = await tx.leaveRequest.findFirst({
        where: { id, customerId: numCustomerId },
        include: { employee: true },
      });

      if (!leave) {
        throw new NotFoundException(`Leave request #${id} not found`);
      }

      if (leave.status === RequestStatus.REJECTED) {
        throw new BadRequestException('Leave request is already rejected');
      }

      if (leave.status !== RequestStatus.PENDING) {
        throw new BadRequestException(`Cannot reject request with status: ${leave.status}. Only PENDING requests can be rejected.`);
      }

      // Update status to REJECTED (NO BALANCE DEDUCTION)
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: RequestStatus.REJECTED,
          rejectionReason: dto?.rejectionReason?.trim() || 'Declined by Administrator / HR',
          approvedById: user?.id || null,
        },
        include: { leaveType: true },
      });

      return {
        success: true,
        message: 'Leave request rejected successfully. No balance was deducted.',
        data: updated,
      };
    }).then((result) => {
      // Dispatch push notification AFTER transaction commits
      if (this.notificationService && result?.data) {
        const leaveData = result.data;
        const isHalfDay =
          Number(leaveData.days) === 0.5 ||
          Number(leaveData.days) < 1;

        this.notificationService
          .sendLeaveRejectionNotification(leaveData.employeeId, leaveData, isHalfDay)
          .catch((err) => {
            this.logger.error(`Failed to send leave rejection push notification: ${err?.message}`);
          });
      }
      return result;
    });
  }

  async cancelLeave(user: any, customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    return this.prisma.$transaction(async (tx) => {
      const leave = await tx.leaveRequest.findFirst({
        where: { id, customerId: numCustomerId },
        include: { employee: true, leaveType: true },
      });

      if (!leave) {
        throw new NotFoundException(`Leave request #${id} not found`);
      }

      if (leave.status === RequestStatus.REJECTED) {
        throw new BadRequestException('Leave request is already rejected or cancelled');
      }

      // If leave was APPROVED, restore the deducted leave balance
      if (leave.status === RequestStatus.APPROVED) {
        const currentYear = leave.fromDate.getFullYear();
        const balance = await tx.employeeLeaveBalance.findFirst({
          where: {
            employeeId: leave.employeeId,
            leaveTypeId: leave.leaveTypeId,
            year: currentYear,
          },
        });

        if (balance) {
          const requestedDays = Number(leave.days || 1);
          const restoredUsed = Math.max(0, balance.usedDays - requestedDays);
          const restoredRemaining = Math.min(balance.allocatedDays, balance.allocatedDays - restoredUsed);

          await tx.employeeLeaveBalance.update({
            where: { id: balance.id },
            data: {
              usedDays: restoredUsed,
              remainingDays: restoredRemaining,
            },
          });
        }
      }

      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: RequestStatus.REJECTED,
          rejectionReason: 'Cancelled by Administrator / Employee',
          approvedById: user?.id || null,
        },
      });

      return {
        success: true,
        message: 'Leave request cancelled successfully. Any deducted balance has been restored.',
        data: updated,
      };
    });
  }

  // ==========================================
  // 3. EMPLOYEE-WISE LEAVE BALANCES & AUDIT
  // ==========================================
  async getLeaveBalances(
    user?: any,
    customerId?: number | string,
    query?: {
      search?: string;
      officeId?: string | number;
      departmentId?: string | number;
      year?: number | string;
    },
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const targetYear = query?.year ? Number(query.year) : new Date().getFullYear();

    // 1. Fetch all configured active leave types for this customer
    let leaveTypes = await this.prisma.leaveType.findMany({
      where: { customerId: numCustomerId, isActive: true },
      orderBy: { id: 'asc' },
    });

    // Ensure default types exist if none created yet
    if (leaveTypes.length === 0) {
      const defaultTypes = [
        { name: 'Casual Leave', code: 'CL', daysAllowedPerYear: 12 },
        { name: 'Sick Leave', code: 'SL', daysAllowedPerYear: 8 },
        { name: 'Paid Leave', code: 'PL', daysAllowedPerYear: 15 },
        { name: 'Unpaid Leave', code: 'UL', daysAllowedPerYear: 0 },
      ];

      for (const dt of defaultTypes) {
        await this.prisma.leaveType.upsert({
          where: { customerId_code: { customerId: numCustomerId, code: dt.code } },
          update: {},
          create: {
            customerId: numCustomerId,
            name: dt.name,
            code: dt.code,
            daysAllowedPerYear: dt.daysAllowedPerYear,
          },
        });
      }

      leaveTypes = await this.prisma.leaveType.findMany({
        where: { customerId: numCustomerId, isActive: true },
        orderBy: { id: 'asc' },
      });
    }

    // 2. If caller is an Employee (mobile app), return their individual balance list directly
    const isEmpUser = user && (String(user.role).toUpperCase() === 'EMPLOYEE' || user.roleType === 'EMPLOYEE');
    if (isEmpUser) {
      const emp = user.employee || (await this.prisma.employee.findFirst({
        where: { userId: user.id, customerId: numCustomerId },
      }));

      if (emp) {
        const empBalances = await this.getEmployeeBalanceDetails(numCustomerId, emp.id);
        const list = empBalances.balances.map((b: any) => ({
          id: b.leaveTypeId,
          leaveTypeId: b.leaveTypeId,
          leaveType: b.leaveTypeName || b.name,
          name: b.leaveTypeName || b.name,
          code: b.code,
          totalAllowed: b.allocated,
          total: b.allocated,
          allocated: b.allocated,
          used: b.used,
          taken: b.used,
          pending: b.pending || 0,
          remaining: b.remaining,
          balance: b.remaining,
          isUnlimited: b.isUnlimited,
        }));

        return {
          success: true,
          data: list,
          balances: list,
        };
      }
    }

    // 3. Admin: Fetch all employees matching filter
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

    const employees = await this.prisma.employee.findMany({
      where: whereEmp,
      include: {
        department: true,
        designation: true,
        office: true,
        leaveBalances: {
          where: { year: targetYear },
          include: { leaveType: true },
        },
        leaveRequests: {
          where: {
            status: RequestStatus.APPROVED,
            fromDate: {
              gte: new Date(`${targetYear}-01-01T00:00:00.000Z`),
              lte: new Date(`${targetYear}-12-31T23:59:59.999Z`),
            },
          },
        },
      },
      orderBy: { firstName: 'asc' },
    });

    let totalAllocatedCompany = 0;
    let totalUsedCompany = 0;
    let totalRemainingCompany = 0;
    let employeesWithRemaining = 0;
    let employeesWithNoRemaining = 0;

    const rows = employees.map((emp) => {
      let empTotalAllocated = 0;
      let empTotalUsed = 0;
      let empTotalRemaining = 0;

      const balancesPerType: Record<
        string,
        {
          leaveTypeId: number;
          leaveTypeName: string;
          allocated: number;
          used: number;
          remaining: number;
          isUnlimited: boolean;
        }
      > = {};

      leaveTypes.forEach((lt) => {
        const storedBalance = emp.leaveBalances.find((b) => b.leaveTypeId === lt.id);
        const approvedUsed = emp.leaveRequests
          .filter((lr) => lr.leaveTypeId === lt.id)
          .reduce((sum, lr) => sum + (lr.days || 1), 0);

        const isUnlimited = lt.code === 'UL' || lt.name.toLowerCase().includes('unpaid');
        const allocated = storedBalance ? storedBalance.allocatedDays : lt.daysAllowedPerYear;
        const used = approvedUsed;
        const remaining = isUnlimited ? 999 : Math.max(0, allocated - used);

        if (!isUnlimited) {
          empTotalAllocated += allocated;
          empTotalUsed += used;
          empTotalRemaining += remaining;
        }

        balancesPerType[lt.name] = {
          leaveTypeId: lt.id,
          leaveTypeName: lt.name,
          allocated,
          used,
          remaining,
          isUnlimited,
        };
      });

      totalAllocatedCompany += empTotalAllocated;
      totalUsedCompany += empTotalUsed;
      totalRemainingCompany += empTotalRemaining;

      if (empTotalRemaining > 0) {
        employeesWithRemaining++;
      } else {
        employeesWithNoRemaining++;
      }

      return {
        id: emp.id,
        employeeCode: emp.employeeCode || `EMP-${emp.id}`,
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        office: emp.office?.name || emp.branch || 'Head Office',
        officeCity: emp.office?.city || '',
        department: emp.department?.name || 'General',
        designation: emp.designation?.name || 'Staff',
        balances: balancesPerType,
        totalAllocated: empTotalAllocated,
        totalUsed: empTotalUsed,
        totalRemaining: empTotalRemaining,
      };
    });

    let filtered = rows;
    if (query?.search && query.search.trim().length > 0) {
      const s = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(s) ||
          r.employeeCode.toLowerCase().includes(s) ||
          r.department.toLowerCase().includes(s) ||
          r.office.toLowerCase().includes(s),
      );
    }

    return {
      leaveTypes: leaveTypes.map((lt) => ({
        id: lt.id,
        name: lt.name,
        code: lt.code,
        daysAllowedPerYear: lt.daysAllowedPerYear,
      })),
      summary: {
        totalEmployees: employees.length,
        employeesWithRemaining,
        employeesWithNoRemaining,
        totalAllocated: totalAllocatedCompany,
        totalUsed: totalUsedCompany,
        totalRemaining: totalRemainingCompany,
      },
      records: filtered,
    };
  }

  async getEmployeeBalanceDetails(customerId: number | string | undefined, employeeId: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const currentYear = new Date().getFullYear();

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId: numCustomerId },
      include: {
        department: true,
        designation: true,
        office: true,
        leaveBalances: {
          where: { year: currentYear },
          include: { leaveType: true },
        },
        leaveRequests: {
          where: {
            status: { in: [RequestStatus.APPROVED, RequestStatus.PENDING] },
            fromDate: {
              gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
              lte: new Date(`${currentYear}-12-31T23:59:59.999Z`),
            },
          },
          include: { leaveType: true },
          orderBy: { fromDate: 'desc' },
        },
        leaveAdjustments: {
          include: { leaveType: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee #${employeeId} not found`);
    }

    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { customerId: numCustomerId, isActive: true },
      orderBy: { id: 'asc' },
    });

    let totalAllocated = 0;
    let totalUsed = 0;
    let totalPending = 0;
    let totalRemaining = 0;

    const balances = leaveTypes.map((lt) => {
      const stored = employee.leaveBalances.find((b) => b.leaveTypeId === lt.id);
      const approvedUsed = employee.leaveRequests
        .filter((r) => r.leaveTypeId === lt.id && r.status === RequestStatus.APPROVED)
        .reduce((sum, r) => sum + (r.days || 1), 0);
      const pending = employee.leaveRequests
        .filter((r) => r.leaveTypeId === lt.id && r.status === RequestStatus.PENDING)
        .reduce((sum, r) => sum + (r.days || 1), 0);

      const isUnlimited = lt.code === 'UL' || lt.name.toLowerCase().includes('unpaid');
      const allocated = stored ? stored.allocatedDays : lt.daysAllowedPerYear;
      const used = stored ? stored.usedDays : approvedUsed;
      const remaining = isUnlimited ? 999 : Math.max(0, allocated - used);

      if (!isUnlimited) {
        totalAllocated += allocated;
        totalUsed += used;
        totalPending += pending;
        totalRemaining += remaining;
      }

      return {
        id: lt.id,
        leaveTypeId: lt.id,
        leaveType: lt.name,
        name: lt.name,
        leaveTypeName: lt.name,
        code: lt.code,
        allocated,
        totalAllowed: allocated,
        total: allocated,
        used,
        taken: used,
        pending,
        remaining,
        balance: remaining,
        isUnlimited,
      };
    });

    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        email: employee.email,
        phone: employee.phone,
        office: employee.office?.name || employee.branch || 'Head Office',
        department: employee.department?.name || 'General',
        designation: employee.designation?.name || 'Staff',
      },
      balances,
      totals: {
        totalAllocated,
        totalUsed,
        totalRemaining,
      },
      adjustments: employee.leaveAdjustments.map((a) => ({
        id: a.id,
        date: a.createdAt.toISOString().split('T')[0],
        createdAt: a.createdAt,
        leaveTypeId: a.leaveTypeId,
        leaveTypeName: a.leaveType?.name || 'Leave',
        action: a.adjustmentType,
        amount: a.adjustmentAmount,
        previousBalance: a.previousBalance,
        newBalance: a.newBalance,
        reason: a.reason,
        adjustedBy: a.adjustedByName || 'HR Manager',
      })),
      recentApprovedLeaves: employee.leaveRequests.map((r) => ({
        id: r.id,
        leaveType: r.leaveType?.name,
        fromDate: r.fromDate.toISOString().split('T')[0],
        toDate: r.toDate.toISOString().split('T')[0],
        days: r.days,
        reason: r.reason,
      })),
    };
  }

  async adjustLeaveBalance(
    user: any,
    customerId: number | string | undefined,
    employeeId: number,
    dto: AdjustLeaveBalanceDto,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const currentYear = new Date().getFullYear();

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId: numCustomerId },
      include: {
        leaveRequests: {
          where: {
            leaveTypeId: dto.leaveTypeId,
            status: RequestStatus.APPROVED,
            fromDate: {
              gte: new Date(`${currentYear}-01-01T00:00:00.000Z`),
              lte: new Date(`${currentYear}-12-31T23:59:59.999Z`),
            },
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee #${employeeId} not found`);
    }

    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id: dto.leaveTypeId, customerId: numCustomerId },
    });

    if (!leaveType) {
      throw new NotFoundException(`Leave type #${dto.leaveTypeId} not found`);
    }

    const trimmedReason = dto.reason?.trim();
    if (!trimmedReason) {
      throw new BadRequestException('Mandatory reason required for leave balance adjustment');
    }

    const amount = Number(dto.amount);
    if (isNaN(amount) || amount < 0) {
      throw new BadRequestException('Adjustment amount must be a non-negative number');
    }

    return this.prisma.$transaction(async (tx) => {
      let balanceRecord = await tx.employeeLeaveBalance.findFirst({
        where: {
          employeeId,
          leaveTypeId: dto.leaveTypeId,
          year: currentYear,
        },
      });

      const previousAllocated = balanceRecord ? balanceRecord.allocatedDays : leaveType.daysAllowedPerYear;
      let newAllocated = previousAllocated;

      if (dto.adjustmentType === 'ADD') {
        newAllocated = previousAllocated + amount;
      } else if (dto.adjustmentType === 'DEDUCT') {
        if (previousAllocated - amount < 0) {
          throw new BadRequestException(
            `Cannot deduct ${amount} days. Current allocated balance is ${previousAllocated} days.`,
          );
        }
        newAllocated = previousAllocated - amount;
      } else if (dto.adjustmentType === 'SET_BALANCE') {
        newAllocated = amount;
      }

      const totalUsed = employee.leaveRequests.reduce((sum, r) => sum + (r.days || 1), 0);
      const remainingDays = Math.max(0, newAllocated - totalUsed);

      let updatedBalance: any;
      if (balanceRecord) {
        updatedBalance = await tx.employeeLeaveBalance.update({
          where: { id: balanceRecord.id },
          data: {
            allocatedDays: newAllocated,
            usedDays: totalUsed,
            remainingDays,
          },
        });
      } else {
        updatedBalance = await tx.employeeLeaveBalance.create({
          data: {
            customerId: numCustomerId,
            employeeId,
            leaveTypeId: dto.leaveTypeId,
            year: currentYear,
            allocatedDays: newAllocated,
            usedDays: totalUsed,
            remainingDays,
          },
        });
      }

      // Record immutable audit history
      const adjustedByName = user?.firstName
        ? `${user.firstName} ${user.lastName || ''}`.trim()
        : 'HR Administrator';

      const history = await tx.leaveAdjustmentHistory.create({
        data: {
          customerId: numCustomerId,
          employeeId,
          leaveTypeId: dto.leaveTypeId,
          balanceId: updatedBalance.id,
          previousBalance: previousAllocated,
          adjustmentType: dto.adjustmentType,
          adjustmentAmount: amount,
          newBalance: newAllocated,
          reason: trimmedReason,
          adjustedById: user?.id || null,
          adjustedByName,
        },
      });

      return {
        success: true,
        message: `Leave balance updated successfully (${previousAllocated} → ${newAllocated} days)`,
        balance: updatedBalance,
        history,
      };
    });
  }

  // ==========================================
  // 4. PUBLIC HOLIDAYS MANAGEMENT
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

  // ==========================================
  // 5. HR POLICIES MANAGEMENT
  // ==========================================
  async getPoliciesOverview(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const [attendance, leave, salary, claim] = await Promise.all([
      this.prisma.attendancePolicy.findFirst({
        where: { customerId: numCustomerId, isActive: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.leavePolicy.findFirst({
        where: { customerId: numCustomerId, isActive: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.salaryPolicy.findFirst({
        where: { customerId: numCustomerId, isActive: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.claimPolicy.findFirst({
        where: { customerId: numCustomerId, isActive: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return {
      attendance: attendance || {
        name: 'Standard Attendance Policy',
        officeStartTime: '09:30',
        officeEndTime: '18:30',
        workingDaysPerWeek: 5,
        workingHoursPerDay: 8.0,
        punchInRequired: true,
        earlyPunchInAllowed: true,
        multiplePunchInAllowed: false,
        gracePeriodMinutes: 15,
        lateArrivalThresholdMins: 30,
        lateRuleAction: 'MARK_LATE',
        punchOutRequired: true,
        minWorkingHours: 8.0,
        earlyCheckoutGraceMinutes: 15,
        earlyCheckoutThresholdMins: 30,
        earlyCheckoutAction: 'MARK_EARLY',
        autoPunchOut: false,
        fullDayAbsenceDeductionPct: 100.0,
        halfDayDeductionPct: 50.0,
        lateArrivalDeductionPct: 25.0,
        earlyCheckoutDeductionPct: 25.0,
        breakExcessDeductionPct: 100.0,
        overtimeEligible: true,
        breakAllowed: true,
        breakRequired: false,
        maxBreakDurationMins: 60,
        minBreakDurationMins: 15,
        maxBreaksPerDay: 2,
        breakGracePeriodMins: 5,
        breakType: 'UNPAID',
        breakExcessAction: 'DEDUCT_EXCESS',
        allowBreakExtension: false,
        officeAttendanceRequired: true,
        gpsRequired: true,
        isActive: true,
        updatedByName: 'Default System Policy',
      },
      leave: leave || {
        name: 'Standard Leave Policy',
        allowHalfDay: true,
        allowBackdatedLeave: false,
        maxBackdatedDays: 3,
        allowFutureLeave: true,
        maxFutureDays: 90,
        allowProbationLeave: false,
        includeHolidaysInLeave: false,
        includeWeekendsInLeave: false,
        minNoticePeriodDays: 2,
        maxConsecutiveDays: 10,
        requiresManagerApproval: true,
        requiresHrApproval: true,
        requiresAttachmentAboveDays: 3,
        isActive: true,
        updatedByName: 'Default System Policy',
      },
      salary: salary || {
        name: 'Standard Salary Policy',
        salaryCycle: 'MONTHLY',
        payrollCycleStartDay: 1,
        workingDaysPerMonth: 30,
        fullDayDeductionPct: 100.0,
        halfDayDeductionPct: 50.0,
        lateArrivalDeductionPct: 25.0,
        earlyCheckoutDeductionPct: 25.0,
        overtimeEnabled: true,
        overtimeMultiplier: 1.5,
        overtimeCalculationMethod: 'HOURLY_BASE',
        commissionEnabled: false,
        commissionPercentage: 0.0,
        pfPercent: 12.0,
        esiPercent: 0.75,
        isActive: true,
        updatedByName: 'Default System Policy',
      },
      claim: claim || {
        name: 'Standard Claim Policy',
        claimsEnabled: true,
        maxClaimAmountPerReceipt: 25000.0,
        monthlyClaimLimit: 100000.0,
        annualClaimLimit: 500000.0,
        receiptRequired: true,
        receiptRequiredAboveAmount: 500.0,
        approvalRequired: true,
        autoApprovalThreshold: 0.0,
        allowedCategories: [
          'TRAVEL',
          'FOOD',
          'FUEL',
          'ACCOMMODATION',
          'MEDICAL',
          'COMMUNICATION',
          'OFFICE_SUPPLIES',
          'OTHER',
        ],
        isActive: true,
        updatedByName: 'Default System Policy',
      },
    };
  }

  async upsertAttendancePolicy(user: any, customerId: number | string | undefined, dto: UpsertAttendancePolicyDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const updatedByName = user?.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : 'HR Administrator';

    const existing = await this.prisma.attendancePolicy.findFirst({
      where: { customerId: numCustomerId, officeId: dto.officeId ? Number(dto.officeId) : null },
    });

    const data: any = {
      customerId: numCustomerId,
      officeId: dto.officeId ? Number(dto.officeId) : null,
      name: dto.name?.trim() || 'Standard Attendance Policy',
      officeStartTime: dto.officeStartTime?.trim() || '09:30',
      officeEndTime: dto.officeEndTime?.trim() || '18:30',
      workingDaysPerWeek: dto.workingDaysPerWeek ?? 5,
      workingHoursPerDay: dto.workingHoursPerDay ?? 8.0,
      punchInRequired: dto.punchInRequired ?? true,
      earlyPunchInAllowed: dto.earlyPunchInAllowed ?? true,
      multiplePunchInAllowed: dto.multiplePunchInAllowed ?? false,
      gracePeriodMinutes: dto.gracePeriodMinutes ?? 15,
      lateArrivalThresholdMins: dto.lateArrivalThresholdMins ?? 30,
      lateRuleAction: dto.lateRuleAction?.trim() || 'MARK_LATE',
      punchOutRequired: dto.punchOutRequired ?? true,
      minWorkingHours: dto.minWorkingHours ?? 8.0,
      earlyCheckoutGraceMinutes: dto.earlyCheckoutGraceMinutes ?? 15,
      earlyCheckoutThresholdMins: dto.earlyCheckoutThresholdMins ?? 30,
      earlyCheckoutAction: dto.earlyCheckoutAction?.trim() || 'MARK_EARLY',
      autoPunchOut: dto.autoPunchOut ?? false,
      fullDayAbsenceDeductionPct: dto.fullDayAbsenceDeductionPct ?? 100.0,
      halfDayDeductionPct: dto.halfDayDeductionPct ?? 50.0,
      lateArrivalDeductionPct: dto.lateArrivalDeductionPct ?? 25.0,
      earlyCheckoutDeductionPct: dto.earlyCheckoutDeductionPct ?? 25.0,
      breakExcessDeductionPct: dto.breakExcessDeductionPct ?? 100.0,
      minWorkingHoursForHalfDay: dto.minWorkingHoursForHalfDay ?? 4.0,
      overtimeEligible: dto.overtimeEligible ?? true,
      breakAllowed: dto.breakAllowed ?? true,
      breakRequired: dto.breakRequired ?? false,
      maxBreakDurationMins: dto.maxBreakDurationMins ?? 60,
      minBreakDurationMins: dto.minBreakDurationMins ?? 15,
      maxBreaksPerDay: dto.maxBreaksPerDay ?? 2,
      breakGracePeriodMins: dto.breakGracePeriodMins ?? 5,
      breakType: dto.breakType?.trim() || 'UNPAID',
      breakExcessAction: dto.breakExcessAction?.trim() || 'DEDUCT_EXCESS',
      allowBreakExtension: dto.allowBreakExtension ?? false,
      officeAttendanceRequired: dto.officeAttendanceRequired ?? true,
      gpsRequired: dto.gpsRequired ?? true,
      allowOutsideCheckIn: dto.allowOutsideCheckIn ?? false,
      allowOutsideCheckOut: dto.allowOutsideCheckOut ?? false,
      isActive: dto.isActive ?? true,
      updatedById: user?.id || null,
      updatedByName,
    };

    if (existing) {
      return this.prisma.attendancePolicy.update({
        where: { id: existing.id },
        data,
      });
    } else {
      return this.prisma.attendancePolicy.create({
        data: {
          ...data,
          createdById: user?.id || null,
        },
      });
    }
  }

  async upsertLeavePolicy(user: any, customerId: number | string | undefined, dto: UpsertLeavePolicyDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const updatedByName = user?.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : 'HR Administrator';

    const existing = await this.prisma.leavePolicy.findFirst({
      where: { customerId: numCustomerId, officeId: dto.officeId ? Number(dto.officeId) : null },
    });

    const data: any = {
      customerId: numCustomerId,
      officeId: dto.officeId ? Number(dto.officeId) : null,
      name: dto.name?.trim() || 'Standard Leave Policy',
      allowHalfDay: dto.allowHalfDay ?? true,
      allowBackdatedLeave: dto.allowBackdatedLeave ?? false,
      maxBackdatedDays: dto.maxBackdatedDays ?? 3,
      allowFutureLeave: dto.allowFutureLeave ?? true,
      maxFutureDays: dto.maxFutureDays ?? 90,
      allowProbationLeave: dto.allowProbationLeave ?? false,
      includeHolidaysInLeave: dto.includeHolidaysInLeave ?? false,
      includeWeekendsInLeave: dto.includeWeekendsInLeave ?? false,
      minNoticePeriodDays: dto.minNoticePeriodDays ?? 2,
      maxConsecutiveDays: dto.maxConsecutiveDays ?? 10,
      requiresManagerApproval: dto.requiresManagerApproval ?? true,
      requiresHrApproval: dto.requiresHrApproval ?? true,
      requiresAttachmentAboveDays: dto.requiresAttachmentAboveDays ?? 3,
      isActive: dto.isActive ?? true,
      updatedById: user?.id || null,
      updatedByName,
    };

    if (existing) {
      return this.prisma.leavePolicy.update({
        where: { id: existing.id },
        data,
      });
    } else {
      return this.prisma.leavePolicy.create({
        data: {
          ...data,
          createdById: user?.id || null,
        },
      });
    }
  }

  async upsertSalaryPolicy(user: any, customerId: number | string | undefined, dto: UpsertSalaryPolicyDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const updatedByName = user?.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : 'HR Administrator';

    const existing = await this.prisma.salaryPolicy.findFirst({
      where: { customerId: numCustomerId, officeId: dto.officeId ? Number(dto.officeId) : null },
    });

    const data: any = {
      customerId: numCustomerId,
      officeId: dto.officeId ? Number(dto.officeId) : null,
      name: dto.name?.trim() || 'Standard Salary Policy',
      salaryCycle: dto.salaryCycle?.trim() || 'MONTHLY',
      payrollCycleStartDay: dto.payrollCycleStartDay ?? 1,
      workingDaysPerMonth: dto.workingDaysPerMonth ?? 30,
      fullDayDeductionPct: dto.fullDayDeductionPct ?? 100.0,
      halfDayDeductionPct: dto.halfDayDeductionPct ?? 50.0,
      lateArrivalDeductionPct: dto.lateArrivalDeductionPct ?? 25.0,
      earlyCheckoutDeductionPct: dto.earlyCheckoutDeductionPct ?? 25.0,
      overtimeEnabled: dto.overtimeEnabled ?? true,
      overtimeMultiplier: dto.overtimeMultiplier ?? 1.5,
      overtimeCalculationMethod: dto.overtimeCalculationMethod?.trim() || 'HOURLY_BASE',
      commissionEnabled: dto.commissionEnabled ?? false,
      commissionType: dto.commissionType?.trim() || 'PERCENTAGE',
      commissionPercentage: dto.commissionPercentage ?? 0.0,
      pfPercent: dto.pfPercent ?? 12.0,
      esiPercent: dto.esiPercent ?? 0.75,
      isActive: dto.isActive ?? true,
      updatedById: user?.id || null,
      updatedByName,
    };

    if (existing) {
      return this.prisma.salaryPolicy.update({
        where: { id: existing.id },
        data,
      });
    } else {
      return this.prisma.salaryPolicy.create({
        data: {
          ...data,
          createdById: user?.id || null,
        },
      });
    }
  }

  async upsertClaimPolicy(user: any, customerId: number | string | undefined, dto: UpsertClaimPolicyDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const updatedByName = user?.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : 'HR Administrator';

    const existing = await this.prisma.claimPolicy.findFirst({
      where: { customerId: numCustomerId, officeId: dto.officeId ? Number(dto.officeId) : null },
    });

    const data: any = {
      customerId: numCustomerId,
      officeId: dto.officeId ? Number(dto.officeId) : null,
      name: dto.name?.trim() || 'Standard Claim Policy',
      claimsEnabled: dto.claimsEnabled ?? true,
      maxClaimAmountPerReceipt: dto.maxClaimAmountPerReceipt ?? 25000.0,
      monthlyClaimLimit: dto.monthlyClaimLimit ?? 100000.0,
      annualClaimLimit: dto.annualClaimLimit ?? 500000.0,
      receiptRequired: dto.receiptRequired ?? true,
      receiptRequiredAboveAmount: dto.receiptRequiredAboveAmount ?? 500.0,
      approvalRequired: dto.approvalRequired ?? true,
      autoApprovalThreshold: dto.autoApprovalThreshold ?? 0.0,
      allowedCategories: dto.allowedCategories || [
        'TRAVEL',
        'FOOD',
        'FUEL',
        'ACCOMMODATION',
        'MEDICAL',
        'COMMUNICATION',
        'OFFICE_SUPPLIES',
        'OTHER',
      ],
      isActive: dto.isActive ?? true,
      updatedById: user?.id || null,
      updatedByName,
    };

    if (existing) {
      return this.prisma.claimPolicy.update({
        where: { id: existing.id },
        data,
      });
    } else {
      return this.prisma.claimPolicy.create({
        data: {
          ...data,
          createdById: user?.id || null,
        },
      });
    }
  }
}
