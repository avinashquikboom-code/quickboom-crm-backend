import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { RoleType, Prisma, AccessOverrideType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { STANDARD_PERMISSIONS, ROLE_PERMISSION_DEFAULTS } from '../../common/constants/rbac.constants';
import {
  getBusinessDate,
  getBusinessDayRange,
  formatTimeInTimezone,
  formatDurationHoursMinutes,
} from '../../common/utils/timezone.util';

export interface FindAllEmployeesParams {
  customerId?: number | string;
  isSuperAdmin?: boolean;
  search?: string;
  status?: string;
  branch?: string;
  department?: string;
  designation?: string;
  employmentType?: string;
  attendanceStatus?: string;
  date?: string;
  page?: number;
  limit?: number;
  excludeAdmins?: boolean;
  bpoOnly?: boolean;
}

export interface EmployeeFindOneParams {
  id: number | string;
  customerId?: number | string;
  isSuperAdmin?: boolean;
}

export interface CreateEmployeeParams {
  customerId: number | string;
  dto: CreateEmployeeDto;
  bypassUserLimit?: boolean;
}

export interface UpdateEmployeeParams {
  id: number | string;
  customerId?: number | string;
  isSuperAdmin?: boolean;
  dto: UpdateEmployeeDto;
}

import { PlanAccessService } from '../subscription/plan-access.service';

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planAccessService?: PlanAccessService,
  ) {}

  async findAll(params: FindAllEmployeesParams) {
    const {
      customerId,
      isSuperAdmin,
      search,
      status,
      branch,
      department,
      designation,
      employmentType,
      attendanceStatus,
      date,
      page = 1,
      limit = 50,
    } = params;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) {
        throw new BadRequestException('Invalid customerId provided');
      }
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for employee access');
    }

    if (status && status !== 'ALL') {
      where.status = status;
    } else {
      // By default, exclude employees moved to Bin (status='DELETED')
      where.status = { not: 'DELETED' };
    }
    const shouldExcludeAdmins = params.excludeAdmins !== false;
    if (shouldExcludeAdmins) {
      where.NOT = [
        {
          user: {
            OR: [
              {
                userRoles: {
                  some: {
                    role: {
                      OR: [
                        { type: RoleType.SUPER_ADMIN },
                        { type: RoleType.CUSTOMER_ADMIN },
                        { type: RoleType.TENANT_ADMIN },
                        { name: { in: ['SUPER_ADMIN', 'Super Administrator', 'Super Admin', 'ADMIN', 'Admin', 'COMPANY_ADMIN', 'TENANT_ADMIN', 'System Admin'] } },
                      ],
                    },
                  },
                },
              },
              { email: { in: ['admin@quickboom.com', 'admin@quikboom.com'] } },
            ],
          },
        },
        {
          OR: [
            { email: { in: ['admin@quickboom.com', 'admin@quikboom.com'] } },
            { email: { contains: 'superadmin', mode: 'insensitive' as Prisma.QueryMode } },
            { firstName: { equals: 'Super', mode: 'insensitive' as Prisma.QueryMode }, lastName: { equals: 'Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { firstName: { equals: 'Super Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { firstName: { equals: 'Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { lastName: { equals: 'Super Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { designation: { name: { in: ['Super Admin', 'SUPER_ADMIN', 'Platform Administrator', 'System Administrator'] } } },
          ],
        },
      ];
    }

    const andConditions: any[] = [];

    if (branch && branch !== 'ALL') {
      andConditions.push({
        OR: [
          { branch: { equals: branch, mode: 'insensitive' as Prisma.QueryMode } },
          { office: { name: { equals: branch, mode: 'insensitive' as Prisma.QueryMode } } },
        ],
      });
    }

    const isBpoRequested = params.bpoOnly === true || (department && department.toUpperCase() === 'BPO');

    if (isBpoRequested) {
      andConditions.push({
        OR: [
          { department: { name: { contains: 'BPO', mode: 'insensitive' as Prisma.QueryMode } } },
          { department: { code: { contains: 'BPO', mode: 'insensitive' as Prisma.QueryMode } } },
          { designation: { name: { contains: 'BPO', mode: 'insensitive' as Prisma.QueryMode } } },
          { designation: { code: { contains: 'BPO', mode: 'insensitive' as Prisma.QueryMode } } },
          { teamMembers: { some: { team: { name: { contains: 'BPO', mode: 'insensitive' as Prisma.QueryMode } } } } },
        ],
      });
    } else if (department && department !== 'ALL') {
      andConditions.push({
        OR: [
          { department: { name: { contains: department, mode: 'insensitive' as Prisma.QueryMode } } },
          { department: { code: { contains: department, mode: 'insensitive' as Prisma.QueryMode } } },
          { teamMembers: { some: { team: { name: { contains: department, mode: 'insensitive' as Prisma.QueryMode } } } } },
        ],
      });
    }

    if (designation && designation !== 'ALL') {
      where.designation = { name: { equals: designation, mode: 'insensitive' as Prisma.QueryMode } };
    }
    if (employmentType && employmentType !== 'ALL') where.employmentType = employmentType;

    if (search && search.trim().length > 0) {
      const trimmedSearch = search.trim();
      andConditions.push({
        OR: [
          { firstName: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
          { lastName: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
          { email: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
          { phone: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
          { employeeCode: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
          { branch: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
          { department: { name: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } } },
          { designation: { name: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    // Determine target date window (midnight to 23:59:59)
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const baseCountWhere = { ...where };
    delete baseCountWhere.status;

    const [items, total, activeCount, inactiveCount] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          department: true,
          designation: true,
          office: true,
          shift: true,
          attendances: {
            where: {
              date: { gte: startOfDay, lte: endOfDay },
            },
            include: {
              breaks: { orderBy: { breakStart: 'asc' } },
            },
            take: 1,
          },
          leaveRequests: {
            where: {
              fromDate: { lte: endOfDay },
              toDate: { gte: startOfDay },
              status: 'APPROVED',
            },
            include: { leaveType: true },
            take: 1,
          },
        },
      }),
      this.prisma.employee.count({ where }),
      this.prisma.employee.count({ where: { ...baseCountWhere, status: 'ACTIVE' } }),
      this.prisma.employee.count({ where: { ...baseCountWhere, status: 'INACTIVE' } }),
    ]);

    const formatted = items.map((e) => {
      const att = e.attendances && e.attendances.length > 0 ? e.attendances[0] : null;
      const leave = e.leaveRequests && e.leaveRequests.length > 0 ? e.leaveRequests[0] : null;

      let displayStatus = 'Absent';
      let checkInStr: string | null = null;
      let checkOutStr: string | null = null;
      let workingHoursStr = '0h 0m';
      let totalBreakMinutes = 0;
      let isCurrentlyOnBreak = false;
      let activeBreakStartStr: string | null = null;

      if (leave) {
        displayStatus = 'On Leave';
      } else if (att) {
        if (att.punchIn) {
          checkInStr = att.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (att.punchOut) {
          checkOutStr = att.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          displayStatus = 'Checked Out';
        } else {
          // Check if currently on break
          const openBreak = att.breaks.find((b) => !b.breakEnd);
          if (openBreak) {
            displayStatus = 'On Break';
            isCurrentlyOnBreak = true;
            activeBreakStartStr = openBreak.breakStart.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });
          } else {
            displayStatus = att.status === 'LATE' ? 'Late' : (att.status === 'HALF_DAY' ? 'Half Day' : 'Present');
          }
        }

        const breakMins = att.breaks.reduce((acc, b) => acc + (b.duration || 0), 0);
        totalBreakMinutes = Math.round(breakMins);

        const hours = Math.floor(att.workingHours || 0);
        const mins = Math.round(((att.workingHours || 0) - hours) * 60);
        workingHoursStr = `${hours}h ${mins}m`;
      } else {
        displayStatus = 'Absent';
      }

      return {
        id: e.id,
        customerId: e.customerId,
        userId: e.userId,
        employeeId: e.employeeCode,
        employeeCode: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        phone: e.phone || '',
        gender: e.gender || null,
        dob: e.dob || null,
        address: e.address || null,
        documents: e.documents || null,
        bankDetails: e.bankDetails || null,
        emergencyContact: e.emergencyContact || null,
        managerId: e.managerId || null,
        employmentType: e.employmentType || 'FULL_TIME',
        departmentId: e.departmentId,
        designationId: e.designationId,
        designation: e.designation?.name || 'Staff',
        designationName: e.designation?.name || 'Staff',
        department: e.department?.name || 'General',
        departmentName: e.department?.name || 'General',
        departmentObj: e.department,
        designationObj: e.designation,
        officeId: e.officeId || null,
        officeObj: e.office,
        shiftId: e.shiftId || null,
        shift: e.shift?.name || null,
        shiftName: e.shift?.name || null,
        shiftObj: e.shift
          ? {
              id: e.shift.id,
              name: e.shift.name,
              code: e.shift.code,
              startTime: e.shift.startTime,
              endTime: e.shift.endTime,
              durationHours: e.shift.durationHours,
              status: e.shift.status,
            }
          : null,
        branch: e.office?.name || e.branch || 'Head Office',
        office: e.office?.name || e.branch || 'Head Office',
        status: e.status,
        mobileLoginEnabled: e.mobileLoginEnabled !== false,
        joiningDate: e.joiningDate,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        attendance: {
          status: displayStatus,
          rawStatus: att?.status || (leave ? 'ON_LEAVE' : 'ABSENT'),
          checkIn: checkInStr,
          checkOut: checkOutStr || (att?.punchIn && !att?.punchOut ? 'Not Checked Out' : null),
          workingHours: workingHoursStr,
          breaksToday: att?.breaks ? att.breaks.length : 0,
          totalBreak: `${totalBreakMinutes} min`,
          totalBreakMinutes,
          isCurrentlyOnBreak,
          activeBreakStart: activeBreakStartStr,
          location: att?.locationIn || 'Office GPS',
          leave: leave
            ? {
                isOnLeave: true,
                leaveType: leave.leaveType?.name || 'Approved Leave',
                approvalStatus: leave.status,
                days: leave.days || 1,
                reason: leave.reason || 'Personal / Annual Leave',
                startDate: leave.fromDate.toISOString().split('T')[0],
                endDate: leave.toDate.toISOString().split('T')[0],
              }
            : {
                isOnLeave: false,
                leaveType: null,
                approvalStatus: null,
                days: null,
                reason: null,
                startDate: null,
                endDate: null,
              },
        },
      };
    });

    // Optional attendance status filter in memory if specified
    const finalItems = attendanceStatus && attendanceStatus !== 'ALL'
      ? formatted.filter(
          (f) =>
            f.attendance.status.toLowerCase() === attendanceStatus.toLowerCase() ||
            f.attendance.rawStatus.toLowerCase() === attendanceStatus.toLowerCase(),
        )
      : formatted;

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      success: true,
      items: finalItems,
      data: finalItems,
      employees: finalItems,
      counts: {
        total,
        active: activeCount,
        inactive: inactiveCount,
      },
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async findOne(params: EmployeeFindOneParams) {
    const { id, customerId, isSuperAdmin } = params;
    if (!id || String(id).trim() === '') {
      throw new BadRequestException('Employee ID is required');
    }

    const idStr = String(id).trim();
    const numId = Number(idStr);
    const isNumeric = !isNaN(numId) && String(numId) === idStr && numId > 0;

    let numCustomerId: number | undefined;
    if (customerId !== undefined && customerId !== null) {
      numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) {
        throw new BadRequestException('Invalid customerId provided');
      }
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for employee access');
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const where: Prisma.EmployeeWhereInput = {
      ...(numCustomerId ? { customerId: numCustomerId } : {}),
      OR: [
        ...(isNumeric ? [{ id: numId }] : []),
        { employeeCode: { equals: idStr, mode: 'insensitive' as Prisma.QueryMode } },
        ...(isNumeric ? [{ employeeCode: { equals: `EMP-${idStr.padStart(3, '0')}`, mode: 'insensitive' as Prisma.QueryMode } }] : []),
        ...(isNumeric ? [{ employeeCode: { equals: `EMP${idStr.padStart(3, '0')}`, mode: 'insensitive' as Prisma.QueryMode } }] : []),
        ...(isNumeric ? [{ employeeCode: { equals: `QB${idStr.padStart(4, '0')}`, mode: 'insensitive' as Prisma.QueryMode } }] : []),
      ],
    };

    const employee = await this.prisma.employee.findFirst({
      where,
      include: {
        department: true,
        designation: true,
        office: true,
        shift: true,
        attendances: {
          orderBy: { date: 'desc' },
          take: 30,
          include: {
            breaks: { orderBy: { breakStart: 'asc' } },
          },
        },
        leaveRequests: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { leaveType: true },
        },
        works: { take: 10, orderBy: { scheduledDate: 'desc' } },
      },
    });

    if (!employee) {
      throw new NotFoundException({
        success: false,
        message: `Employee with identifier '${id}' not found`,
        error: 'EMPLOYEE_NOT_FOUND',
      });
    }

    // Today's attendance
    const todayAtt = (employee.attendances || []).find((a) => {
      const d = new Date(a.date);
      return d >= todayStart && d <= todayEnd;
    });

    const activeLeave = (employee.leaveRequests || []).find((l) => {
      return (
        l.status === 'APPROVED' &&
        new Date(l.fromDate) <= todayEnd &&
        new Date(l.toDate) >= todayStart
      );
    });

    let todayStatus = 'Absent';
    let checkInStr: string | null = null;
    let checkOutStr: string | null = null;
    let workingHoursStr = '0h 0m';
    let totalBreakMinutes = 0;
    let isCurrentlyOnBreak = false;
    let activeBreakStartStr: string | null = null;

    if (activeLeave) {
      todayStatus = 'On Leave';
    } else if (todayAtt) {
      if (todayAtt.punchIn) {
        checkInStr = todayAtt.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      if (todayAtt.punchOut) {
        checkOutStr = todayAtt.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        todayStatus = 'Checked Out';
      } else {
        const openBreak = todayAtt.breaks.find((b) => !b.breakEnd);
        if (openBreak) {
          todayStatus = 'On Break';
          isCurrentlyOnBreak = true;
          activeBreakStartStr = openBreak.breakStart.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
        } else {
          todayStatus = todayAtt.status === 'LATE' ? 'Late' : (todayAtt.status === 'HALF_DAY' ? 'Half Day' : 'Present');
        }
      }

      const breakMins = todayAtt.breaks.reduce((acc, b) => acc + (b.duration || 0), 0);
      totalBreakMinutes = Math.round(breakMins);
      const hours = Math.floor(todayAtt.workingHours || 0);
      const mins = Math.round(((todayAtt.workingHours || 0) - hours) * 60);
      workingHoursStr = `${hours}h ${mins}m`;
    }

    return {
      id: employee.id,
      customerId: employee.customerId,
      userId: employee.userId,
      employeeId: employee.employeeCode,
      employeeCode: employee.employeeCode,
      name: `${employee.firstName} ${employee.lastName}`,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone || '+91 98765 43210',
      officeId: employee.officeId || null,
      officeObj: employee.office,
      shiftId: employee.shiftId || null,
      shift: employee.shift?.name || null,
      shiftName: employee.shift?.name || null,
      shiftObj: employee.shift
        ? {
            id: employee.shift.id,
            name: employee.shift.name,
            code: employee.shift.code,
            startTime: employee.shift.startTime,
            endTime: employee.shift.endTime,
            durationHours: employee.shift.durationHours,
            gracePeriodMinutes: employee.shift.gracePeriodMinutes,
            breakDurationMinutes: employee.shift.breakDurationMinutes,
            isNightShift: employee.shift.isNightShift,
            status: employee.shift.status,
          }
        : null,
      branch: employee.office?.name || employee.branch || 'Head Office',
      office: employee.office?.name || employee.branch || 'Head Office',
      departmentId: employee.departmentId,
      designationId: employee.designationId,
      department: employee.department?.name || 'General',
      departmentName: employee.department?.name || 'General',
      departmentObj: employee.department,
      designation: employee.designation?.name || 'Staff',
      designationName: employee.designation?.name || 'Staff',
      designationObj: employee.designation,
      status: employee.status,
      mobileLoginEnabled: employee.mobileLoginEnabled !== false,
      joiningDate: employee.joiningDate,
      todayAttendance: {
        status: todayStatus,
        checkIn: checkInStr,
        checkOut: checkOutStr || (todayAtt?.punchIn && !todayAtt?.punchOut ? 'Not Checked Out' : null),
        workingHours: workingHoursStr,
        breaksToday: todayAtt?.breaks ? todayAtt.breaks.length : 0,
        totalBreak: `${totalBreakMinutes} min`,
        totalBreakMinutes,
        isCurrentlyOnBreak,
        activeBreakStart: activeBreakStartStr,
        location: todayAtt?.locationIn || 'Office GPS',
      },
      breaks: todayAtt
        ? todayAtt.breaks.map((b, idx) => ({
            id: b.id,
            breakNumber: idx + 1,
            start: b.breakStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            end: b.breakEnd ? b.breakEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
            duration: b.duration ? `${Math.round(b.duration)} min` : (b.breakEnd ? '0 min' : 'Currently Active'),
            isActive: !b.breakEnd,
          }))
        : [],
      leaves: (employee.leaveRequests || []).map((l) => ({
        id: l.id,
        leaveType: l.leaveType?.name || 'Leave',
        fromDate: l.fromDate.toISOString().split('T')[0],
        toDate: l.toDate.toISOString().split('T')[0],
        days: l.days || 1,
        reason: l.reason || 'General leave',
        status: l.status,
        appliedOn: l.createdAt.toISOString().split('T')[0],
      })),
      attendanceHistory: (employee.attendances || []).map((a) => {
        const hours = Math.floor(a.workingHours || 0);
        const mins = Math.round(((a.workingHours || 0) - hours) * 60);
        return {
          id: a.id,
          date: a.date.toISOString().split('T')[0],
          checkIn: a.punchIn ? a.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
          checkOut: a.punchOut ? a.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (a.punchIn ? 'Not Checked Out' : '—'),
          workingHours: `${hours}h ${mins}m`,
          status: a.status,
          location: a.locationIn || 'Office GPS',
          breaksCount: a.breaks ? a.breaks.length : 0,
        };
      }),
      works: employee.works || [],
    };
  }

  async getOffices(customerId?: number | string, isSuperAdmin = false) {
    const whereCust: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        whereCust.customerId = numCustomerId;
      }
    }

    const branches = await this.prisma.branchGeofence.findMany({
      where: { ...whereCust, isActive: true },
      select: {
        id: true,
        name: true,
        city: true,
        latitude: true,
        longitude: true,
        radiusMeters: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    if (branches.length === 0) {
      return [
        {
          id: 1,
          name: 'Head Office',
          city: 'Mumbai',
          latitude: 19.076,
          longitude: 72.8777,
          radiusMeters: 200,
          isActive: true,
        },
      ];
    }

    return branches;
  }

  /**
   * Applies Auto Check-out to open attendance records that either:
   * 1. Belong to a previous day, OR
   * 2. Exceeded the 12-hour safety window
   */
  private async autoCheckOutOpenAttendances(customerId?: number) {
    const now = new Date();
    const { start: todayStart } = getBusinessDayRange(now);
    const safetyHoursMs = 12 * 60 * 60 * 1000;
    const safetyDate = new Date(now.getTime() - safetyHoursMs);

    const openRecords = await this.prisma.attendance.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        punchIn: { not: null },
        punchOut: null,
        OR: [
          { date: { lt: todayStart } },
          { punchIn: { lte: safetyDate } },
        ],
      },
      include: {
        breaks: true,
        employee: { include: { shift: true } },
      },
    });

    for (const att of openRecords) {
      try {
        const punchInDate = new Date(att.punchIn!);
        const { dateStr } = getBusinessDayRange(punchInDate);
        const [year, month, day] = dateStr.split('-').map(Number);

        const policy = await this.prisma.attendancePolicy.findFirst({
          where: { customerId: att.customerId, isActive: true },
          orderBy: { officeId: 'desc' },
        });

        const endTimeStr = att.employee?.shift?.endTime || policy?.officeEndTime || '18:30';
        const [endHour, endMin] = endTimeStr.split(':').map(Number);
        let scheduledEnd = new Date(year, month - 1, day, endHour || 18, endMin || 30, 0, 0);

        if (scheduledEnd.getTime() <= punchInDate.getTime()) {
          scheduledEnd = new Date(punchInDate.getTime() + (policy?.workingHoursPerDay || 8.0) * 60 * 60 * 1000);
        }
        if (scheduledEnd.getTime() > now.getTime()) {
          scheduledEnd = now;
        }

        let totalBreakMins = 0;
        for (const b of att.breaks) {
          if (!b.breakEnd) {
            let bEnd = new Date(new Date(b.breakStart).getTime() + (policy?.maxBreakDurationMins || 60) * 60 * 1000);
            if (bEnd.getTime() > scheduledEnd.getTime()) bEnd = scheduledEnd;
            if (bEnd.getTime() < new Date(b.breakStart).getTime()) bEnd = new Date(b.breakStart);
            const bDuration = Math.max(0, Math.round((bEnd.getTime() - new Date(b.breakStart).getTime()) / (1000 * 60)));
            await this.prisma.attendanceBreak.update({
              where: { id: b.id },
              data: { breakEnd: bEnd, duration: bDuration },
            });
            totalBreakMins += bDuration;
          } else {
            totalBreakMins += (b.duration || Math.max(0, Math.round((new Date(b.breakEnd).getTime() - new Date(b.breakStart).getTime()) / (1000 * 60))));
          }
        }

        const grossMins = Math.max(0, Math.round((scheduledEnd.getTime() - punchInDate.getTime()) / (1000 * 60)));
        const netWorkingMins = Math.max(0, grossMins - totalBreakMins);
        const actualHours = Math.round((netWorkingMins / 60) * 100) / 100;
        const wasPunchInLate = Boolean(att.isLate || att.status === 'LATE');
        const finalStatus = wasPunchInLate
          ? (actualHours < (policy?.minWorkingHoursForHalfDay || 4.0) ? 'HALF_DAY' : 'LATE')
          : (actualHours >= (policy?.minWorkingHoursForHalfDay || 4.0) ? 'PRESENT' : (actualHours > 0 ? 'HALF_DAY' : 'PRESENT'));

        await this.prisma.attendance.update({
          where: { id: att.id },
          data: {
            punchOut: scheduledEnd,
            workingHours: actualHours,
            workingMinutes: netWorkingMins,
            breakDuration: Math.round((totalBreakMins / 60) * 100) / 100,
            status: finalStatus as any,
            isLate: wasPunchInLate,
            lateMinutes: wasPunchInLate ? (att.lateMinutes || 0) : 0,
            locationOut: 'Auto Check-out (Forgot Punch-Out)',
          },
        });
      } catch (err: any) {
        console.error(`[AUTO_CHECKOUT_ERR] EmployeeService failed to auto-checkout ${att.id}:`, err?.message);
      }
    }
  }

  async getLiveAttendance(
    customerId?: number | string,
    isSuperAdmin = false,
    branchFilter?: string,
    dateFilter?: string,
  ) {
    const whereEmp: any = {
      status: 'ACTIVE',
      NOT: [
        {
          user: {
            userRoles: {
              some: {
                role: {
                  OR: [
                    { type: RoleType.SUPER_ADMIN },
                    { name: { in: ['SUPER_ADMIN', 'Super Administrator', 'Super Admin', 'ADMIN', 'Admin'] } },
                  ],
                },
              },
            },
          },
        },
        {
          OR: [
            { firstName: { equals: 'Super', mode: 'insensitive' as Prisma.QueryMode }, lastName: { equals: 'Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { firstName: { equals: 'Super Admin', mode: 'insensitive' as Prisma.QueryMode } },
            { email: { in: ['admin@quickboom.com', 'admin@quikboom.com'] } },
          ],
        },
      ],
    };
    const whereCust: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      whereEmp.customerId = numCustomerId;
      whereCust.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for live attendance access');
    }

    // Run auto check-out for any open attendances
    await this.autoCheckOutOpenAttendances(whereCust.customerId);

    // Fetch active canonical branches for the customer to normalize offices
    const activeBranches = await this.prisma.branchGeofence.findMany({
      where: { ...whereCust, isActive: true },
      select: { id: true, name: true },
    });

    if (branchFilter && branchFilter !== 'ALL') {
      const matchedBranch = activeBranches.find(
        (b) => b.name.toLowerCase() === branchFilter.toLowerCase() || String(b.id) === branchFilter,
      );
      if (matchedBranch) {
        whereEmp.OR = [
          { officeId: matchedBranch.id },
          { branch: { equals: matchedBranch.name, mode: 'insensitive' as Prisma.QueryMode } },
          { branch: { equals: branchFilter, mode: 'insensitive' as Prisma.QueryMode } },
        ];
      } else {
        whereEmp.branch = { equals: branchFilter, mode: 'insensitive' as Prisma.QueryMode };
      }
    }

    const targetDate = dateFilter ? new Date(dateFilter) : new Date();
    const { dateStr, start: todayStart, end: todayEnd } = getBusinessDayRange(targetDate);

    const [employees, todayAttendances, todayLeaves] = await Promise.all([
      this.prisma.employee.findMany({
        where: whereEmp,
        include: { department: true, designation: true, office: true },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: {
          ...whereCust,
          date: { gte: todayStart, lte: todayEnd },
        },
        include: {
          breaks: { orderBy: { breakStart: 'asc' } },
        },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          ...whereCust,
          fromDate: { lte: todayEnd },
          toDate: { gte: todayStart },
          status: 'APPROVED',
        },
        include: { leaveType: true },
      }),
    ]);

    const attendanceMap = new Map<number, typeof todayAttendances[0]>();
    for (const att of todayAttendances) {
      attendanceMap.set(att.employeeId, att);
    }

    const leaveMap = new Map<number, typeof todayLeaves[0]>();
    for (const leave of todayLeaves) {
      leaveMap.set(leave.employeeId, leave);
    }

    let presentCount = 0;
    let onBreakCount = 0;
    let onLeaveCount = 0;
    let absentCount = 0;
    let checkedOutCount = 0;
    let lateCount = 0;

    // Canonical office-wise aggregation map
    const officeStatsMap = new Map<
      string,
      { officeId: number | null; officeName: string; total: number; present: number; onBreak: number; onLeave: number; absent: number }
    >();

    const liveRecords = employees.map((emp) => {
      const att = attendanceMap.get(emp.id);
      const leave = leaveMap.get(emp.id);

      // Resolve canonical office using relation or matching active branch
      let canonicalId: number | null = emp.office?.id || emp.officeId || null;
      let canonicalName = emp.office?.name?.trim();

      if (!canonicalName) {
        const empBranchTrimmed = (emp.branch || '').trim();
        const matched = activeBranches.find(
          (b) => b.name.trim().toLowerCase() === empBranchTrimmed.toLowerCase(),
        );
        if (matched) {
          canonicalId = matched.id;
          canonicalName = matched.name.trim();
        } else {
          canonicalName = empBranchTrimmed || 'Head Office';
        }
      }

      const officeKey = canonicalId ? `id_${canonicalId}` : `name_${canonicalName.toLowerCase()}`;

      if (!officeStatsMap.has(officeKey)) {
        officeStatsMap.set(officeKey, {
          officeId: canonicalId,
          officeName: canonicalName,
          total: 0,
          present: 0,
          onBreak: 0,
          onLeave: 0,
          absent: 0,
        });
      }
      const oStat = officeStatsMap.get(officeKey)!;
      oStat.total++;

      let status = 'ABSENT';
      let punchInStr: string | null = null;
      let punchOutStr: string | null = null;
      let breakStartStr: string | null = null;
      let breakDurationMinutes = 0;
      let totalWorkingHours = '0h 0m';

      if (leave) {
        status = 'ON_LEAVE';
        onLeaveCount++;
        oStat.onLeave++;
      } else if (att) {
        if (att.punchIn) {
          punchInStr = formatTimeInTimezone(att.punchIn);
        }
        if (att.punchOut) {
          punchOutStr = formatTimeInTimezone(att.punchOut);
          status = 'CHECKED_OUT';
          checkedOutCount++;
          oStat.present++;
        } else {
          // Check if currently on break
          const activeBreak = att.breaks.find((b) => !b.breakEnd);
          if (activeBreak) {
            status = 'ON_BREAK';
            onBreakCount++;
            oStat.onBreak++;
            breakStartStr = formatTimeInTimezone(activeBreak.breakStart);
          } else {
            status = att.status === 'LATE' ? 'LATE' : (att.status === 'HALF_DAY' ? 'HALF_DAY' : 'PRESENT');
            if (att.status === 'LATE' && att.isLate) lateCount++;
            presentCount++;
            oStat.present++;
          }
        }

        const totalBreakMins = att.breaks.reduce((acc, b) => {
          if (b.duration) return acc + b.duration;
          if (b.breakEnd) {
            return (
              acc +
              Math.max(
                0,
                Math.round(
                  (new Date(b.breakEnd).getTime() - new Date(b.breakStart).getTime()) / (1000 * 60),
                ),
              )
            );
          }
          return (
            acc +
            Math.max(
              0,
              Math.round((Date.now() - new Date(b.breakStart).getTime()) / (1000 * 60)),
            )
          );
        }, 0);
        breakDurationMinutes = Math.round(totalBreakMins);

        let netWorkingMinutes = att.workingMinutes || 0;
        if (att.punchIn && !att.punchOut) {
          const gross = Math.max(
            0,
            Math.round((Date.now() - new Date(att.punchIn).getTime()) / (1000 * 60)),
          );
          netWorkingMinutes = Math.max(0, gross - totalBreakMins);
        } else if (att.punchIn && att.punchOut && (!netWorkingMinutes || netWorkingMinutes === 0)) {
          const gross = Math.max(
            0,
            Math.round(
              (new Date(att.punchOut).getTime() - new Date(att.punchIn).getTime()) / (1000 * 60),
            ),
          );
          netWorkingMinutes = Math.max(0, gross - totalBreakMins);
        }
        totalWorkingHours = formatDurationHoursMinutes(netWorkingMinutes);
      } else {
        status = 'ABSENT';
        absentCount++;
        oStat.absent++;
      }

      return {
        id: emp.id,
        customerId: emp.customerId,
        employeeCode: emp.employeeCode,
        name: `${emp.firstName} ${emp.lastName}`,
        role: emp.designation?.name || 'Staff',
        department: emp.department?.name || 'General',
        branch: canonicalName,
        office: canonicalName,
        status,
        punchIn: att?.punchIn ? att.punchIn.toISOString() : null,
        punchInAt: att?.punchIn ? att.punchIn.toISOString() : null,
        punchInTime: punchInStr,
        punchOut: att?.punchOut ? att.punchOut.toISOString() : null,
        punchOutAt: att?.punchOut ? att.punchOut.toISOString() : null,
        punchOutTime: punchOutStr,
        breakStartTime: breakStartStr,
        breakDuration: formatDurationHoursMinutes(breakDurationMinutes),
        totalBreakMinutes: breakDurationMinutes,
        totalWorkingHours,
        workingMinutes: att?.workingMinutes || 0,
        location: att?.locationIn || 'Office GPS',
        leaveType: leave?.leaveType?.name || null,
        leaveReason: leave?.reason || null,
      };
    });

    const offices = Array.from(officeStatsMap.values()).map((stats) => ({
      officeId: stats.officeId,
      officeName: stats.officeName,
      totalEmployees: stats.total,
      present: stats.present,
      onBreak: stats.onBreak,
      onLeave: stats.onLeave,
      absent: stats.absent,
    }));

    return {
      summary: {
        totalEmployees: employees.length,
        presentCount,
        onBreakCount,
        onLeaveCount,
        absentCount,
        checkedOutCount,
        lateCount,
        currentlyWorking: presentCount,
        attendancePercentage:
          employees.length > 0
            ? Math.round(((presentCount + onBreakCount) / employees.length) * 100)
            : 0,
      },
      offices,
      records: liveRecords,
    };
  }

  /**
   * Preview or allocate the next sequential Employee ID for a customer
   * Format: EMP-001, EMP-002, ..., EMP-099, EMP-100
   */
  async getNextEmployeeCode(
    customerId?: number | string,
    prefix?: string,
    txClient?: any,
  ): Promise<{ nextEmployeeId: string; prefix: string }> {
    const client = txClient || this.prisma;
    let numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      const defaultCust = await client.customer.findFirst({ select: { id: true } });
      numCustomerId = defaultCust?.id || 1;
    }

    const defaultPrefix = process.env.EMPLOYEE_ID_PREFIX || 'EMP';
    const cleanPrefix = (prefix || defaultPrefix).toUpperCase().replace(/-+$/, '');

    // Query existing employee codes for this customer that match the prefix
    const existingEmployees = await client.employee.findMany({
      where: {
        customerId: numCustomerId,
        employeeCode: {
          startsWith: cleanPrefix,
        },
      },
      select: { employeeCode: true },
    });

    // Query audit logs using this.prisma outside of tx to avoid connection multiplexing or transaction aborts
    let auditLogs: any[] = [];
    if (this.prisma?.auditLog) {
      try {
        auditLogs = await this.prisma.auditLog.findMany({
          where: {
            customerId: numCustomerId,
            module: 'EMPLOYEE',
          },
          select: { details: true },
          take: 500,
          orderBy: { id: 'desc' },
        });
      } catch {
        auditLogs = [];
      }
    }

    let maxNum = 0;
    const regex = new RegExp(`^${cleanPrefix}-?(\\d+)$`, 'i');

    for (const emp of existingEmployees) {
      const match = emp.employeeCode.match(regex);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }

    for (const log of auditLogs) {
      const code = (log.details as any)?.employeeCode;
      if (code && typeof code === 'string') {
        const match = code.match(regex);
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    }

    // Determine the next number and pad to at least 3 digits (EMP-001, EMP-002, ...)
    let candidateNum = maxNum + 1;
    let candidateCode = `${cleanPrefix}-${String(candidateNum).padStart(3, '0')}`;

    // Ensure candidate code does not exist in case of non-sequential manual IDs
    const existingCodeSet = new Set(existingEmployees.map((e: any) => e.employeeCode.toUpperCase()));
    while (existingCodeSet.has(candidateCode.toUpperCase())) {
      candidateNum++;
      candidateCode = `${cleanPrefix}-${String(candidateNum).padStart(3, '0')}`;
    }

    return { nextEmployeeId: candidateCode, prefix: cleanPrefix };
  }

  /**
   * Resolves the default enterprise customer workspace ID for global Super Admin operations.
   * Auto-heals root customer (ID: 1) if inactive or deleted, or falls back to first active customer.
   */
  async resolveDefaultCustomerId(): Promise<number> {
    const rootCustomer = await this.prisma.customer.findUnique({
      where: { id: 1 },
    });
    if (rootCustomer) {
      if (!rootCustomer.isActive || rootCustomer.deletedAt) {
        await this.prisma.customer.update({
          where: { id: 1 },
          data: { isActive: true, deletedAt: null },
        });
      }
      return rootCustomer.id;
    }

    const firstActive = await this.prisma.customer.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { id: 'asc' },
    });
    if (firstActive) {
      return firstActive.id;
    }

    const defaultOrg = await this.prisma.customer.create({
      data: {
        name: 'QuikBoom Enterprise',
        companyName: 'QuikBoom Enterprise Workspace',
        email: 'admin@quickboom.com',
        isActive: true,
        customerType: 'ENTERPRISE',
      },
    });
    return defaultOrg.id;
  }

  async create(params: CreateEmployeeParams) {
    const { customerId, dto } = params;
    const numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new BadRequestException('Valid customerId is required');
    }

    if (this.planAccessService && !params.bypassUserLimit) {
      await this.planAccessService.checkUserLimit(numCustomerId);
    }

    // Execute complete creation inside a single atomic database transaction
    return this.prisma.$transaction(async (tx) => {
      // Employee ID is ALWAYS system-generated by the backend.
      // Any employeeCode or autoGenerateCode sent from the frontend is intentionally ignored.
      // Generation happens inside the transaction for concurrency safety.
      const defaultPrefix = process.env.EMPLOYEE_ID_PREFIX || 'EMP';
      const { nextEmployeeId: finalEmployeeCode } = await this.getNextEmployeeCode(
        numCustomerId,
        defaultPrefix,
        tx,
      );
      console.log(`[EMPLOYEE] Auto-generated employeeCode: ${finalEmployeeCode} for customerId: ${numCustomerId}`);

      // Department resolution
      let department: any = null;
      if (dto.departmentId) {
        const numDeptId = Number(dto.departmentId);
        department = await tx.department.findFirst({
          where: { id: numDeptId, customerId: numCustomerId },
        });
        if (!department && dto.departmentName) {
          department = await tx.department.findFirst({
            where: { customerId: numCustomerId, name: { equals: dto.departmentName, mode: 'insensitive' as Prisma.QueryMode } },
          });
        }
        if (!department) {
          const crossDept = await tx.department.findFirst({ where: { id: numDeptId } });
          if (crossDept) {
            let localDept = await tx.department.findFirst({
              where: { customerId: numCustomerId, name: { equals: crossDept.name, mode: 'insensitive' as Prisma.QueryMode } },
            });
            if (!localDept) {
              localDept = await tx.department.create({
                data: {
                  customerId: numCustomerId,
                  name: crossDept.name,
                  code: crossDept.code || crossDept.name.substring(0, 5).toUpperCase(),
                  isActive: crossDept.isActive,
                },
              });
            }
            department = localDept;
          }
        }
        if (!department) {
          throw new NotFoundException({
            success: false,
            message: `Department #${dto.departmentId} not found`,
            error: 'DEPARTMENT_NOT_FOUND',
          });
        }
      } else if (dto.departmentName) {
        department = await tx.department.findFirst({
          where: { customerId: numCustomerId, name: { equals: dto.departmentName, mode: 'insensitive' as Prisma.QueryMode } },
        });
        if (!department) {
          department = await tx.department.create({
            data: {
              customerId: numCustomerId,
              name: dto.departmentName,
              code: (dto.departmentName || 'DEPT').substring(0, 5).toUpperCase(),
              isActive: true,
            },
          });
        }
      } else {
        department = await tx.department.findFirst({
          where: { customerId: numCustomerId, isActive: true },
          orderBy: { id: 'asc' },
        });
        if (!department) {
          department = await tx.department.create({
            data: {
              customerId: numCustomerId,
              name: 'General',
              code: 'GEN',
              isActive: true,
            },
          });
        }
      }

      if (department && department.isActive === false) {
        throw new BadRequestException({
          success: false,
          message: 'Selected department is no longer active.',
          error: 'DEPARTMENT_INACTIVE',
        });
      }

      // Designation resolution
      let designation: any = null;
      if (dto.designationId) {
        const numDesigId = Number(dto.designationId);
        designation = await tx.designation.findFirst({
          where: { id: numDesigId, customerId: numCustomerId },
        });
        if (!designation && dto.designationName) {
          designation = await tx.designation.findFirst({
            where: { customerId: numCustomerId, name: { equals: dto.designationName, mode: 'insensitive' as Prisma.QueryMode } },
          });
        }
        if (!designation) {
          const crossDesig = await tx.designation.findFirst({ where: { id: numDesigId } });
          if (crossDesig) {
            let localDesig = await tx.designation.findFirst({
              where: { customerId: numCustomerId, name: { equals: crossDesig.name, mode: 'insensitive' as Prisma.QueryMode } },
            });
            if (!localDesig) {
              localDesig = await tx.designation.create({
                data: {
                  customerId: numCustomerId,
                  name: crossDesig.name,
                  code: `${crossDesig.code || 'DES'}-${Date.now().toString().slice(-4)}`,
                  departmentId: department?.id || null,
                  isActive: crossDesig.isActive,
                },
              });
            }
            designation = localDesig;
          }
        }
        if (!designation) {
          throw new BadRequestException(`Designation #${dto.designationId} not found`);
        }
      } else if (dto.designationName) {
        designation = await tx.designation.findFirst({
          where: { customerId: numCustomerId, name: { equals: dto.designationName, mode: 'insensitive' as Prisma.QueryMode } },
        });
        if (!designation) {
          designation = await tx.designation.create({
            data: {
              customerId: numCustomerId,
              name: dto.designationName,
              code: `${(dto.designationName || 'STF').substring(0, 4).toUpperCase()}-${Date.now().toString().slice(-4)}`,
              departmentId: department?.id || null,
              isActive: true,
            },
          });
        }
      } else {
        designation = await tx.designation.findFirst({
          where: { customerId: numCustomerId, isActive: true },
          orderBy: { id: 'asc' },
        });
        if (!designation) {
          designation = await tx.designation.create({
            data: {
              customerId: numCustomerId,
              name: 'Staff',
              code: `STF-${Date.now().toString().slice(-4)}`,
              departmentId: department?.id || null,
              isActive: true,
            },
          });
        }
      }

      if (designation && designation.isActive === false) {
        throw new BadRequestException({
          success: false,
          message: 'Selected designation is no longer active.',
          error: 'DESIGNATION_INACTIVE',
        });
      }

      // User account password hashing
      const normalizedEmail = dto.email.trim().toLowerCase();
      const hasExplicitPassword = Boolean(dto.password && dto.password.trim().length > 0);
      const rawPassword = hasExplicitPassword ? dto.password!.trim() : 'Password@123';
      const passwordHash = await bcrypt.hash(rawPassword, 10);
      const cleanPhone = dto.phone && dto.phone.trim().length > 0 ? dto.phone.trim() : null;

      // Find or create linked User account
      let user = await tx.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      });

      if (!user) {
        if (cleanPhone) {
          const duplicatePhoneUser = await tx.user.findFirst({
            where: { phone: cleanPhone },
          });
          if (duplicatePhoneUser) {
            throw new BadRequestException({
              success: false,
              message: `Phone number '${cleanPhone}' is already registered to another user account.`,
              error: 'PHONE_ALREADY_EXISTS',
            });
          }
        }

        user = await tx.user.create({
          data: {
            customerId: numCustomerId,
            email: normalizedEmail,
            phone: cleanPhone,
            firstName: dto.firstName,
            lastName: dto.lastName,
            passwordHash,
            isActive: (dto.status || 'ACTIVE') === 'ACTIVE',
            isVerified: true,
          },
        });
      } else {
        if (cleanPhone) {
          const duplicatePhoneUser = await tx.user.findFirst({
            where: { phone: cleanPhone, id: { not: user.id } },
          });
          if (duplicatePhoneUser) {
            throw new BadRequestException({
              success: false,
              message: `Phone number '${cleanPhone}' is already registered to another user account.`,
              error: 'PHONE_ALREADY_EXISTS',
            });
          }
        }

        const updateUserData: any = {
          firstName: dto.firstName || user.firstName,
          lastName: dto.lastName || user.lastName,
          phone: cleanPhone || user.phone,
          isActive: (dto.status || 'ACTIVE') === 'ACTIVE',
          isVerified: true,
          deletedAt: null,
          ...(hasExplicitPassword || !user.passwordHash ? { passwordHash } : {}),
        };
        if (user.customerId !== null && user.customerId !== numCustomerId) {
          throw new ConflictException({
            success: false,
            message: 'A user account with this email already belongs to another organization.',
            error: 'USER_BELONGS_TO_ANOTHER_TENANT',
          });
        }
        if (user.customerId === null) {
          updateUserData.customerId = numCustomerId;
        }

        user = await tx.user.update({
          where: { id: user.id },
          data: updateUserData,
        });
      }

      // ─────────────────────────────────────────────────────────────────────
      // DUPLICATE GUARD: Check if this User or email already has an Employee record.
      // Employee.userId is @unique — a second create() would throw P2002.
      // We detect and reject it here with a clean 409 BEFORE calling create().
      // ─────────────────────────────────────────────────────────────────────
      let existingEmployeeForUser = await tx.employee.findFirst({
        where: {
          OR: [
            { userId: user.id },
            { email: normalizedEmail, customerId: numCustomerId },
          ],
        },
        select: { id: true, employeeCode: true, customerId: true },
      });

      if (!existingEmployeeForUser && tx.employee.findUnique) {
        existingEmployeeForUser = await tx.employee.findUnique({
          where: { userId: user.id } as any,
          select: { id: true, employeeCode: true, customerId: true },
        });
      }

      if (existingEmployeeForUser) {
        throw new ConflictException({
          success: false,
          message: 'This user is already registered as an employee',
          error: 'EMPLOYEE_ALREADY_EXISTS',
          existingEmployeeCode: existingEmployeeForUser.employeeCode,
        });
      }

      // Assign Employee mobile role
      let employeeRole = await tx.role.findFirst({
        where: {
          OR: [
            { customerId: numCustomerId, name: { equals: 'Employee', mode: 'insensitive' } },
            { customerId: null, name: { equals: 'Employee', mode: 'insensitive' } },
            { customerId: numCustomerId, name: { equals: 'EMPLOYEE', mode: 'insensitive' } },
            { customerId: null, name: { equals: 'EMPLOYEE', mode: 'insensitive' } },
          ],
        },
      });

      if (!employeeRole) {
        employeeRole = await tx.role.create({
          data: {
            customerId: numCustomerId,
            name: 'Employee',
            type: RoleType.CUSTOM,
            description: 'Employee mobile application role',
          },
        });
      }

      const existingUserRole = await tx.userRole.findFirst({
        where: {
          userId: user.id,
          roleId: employeeRole.id,
        },
      });

      if (!existingUserRole) {
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: employeeRole.id,
          },
        });
      }

      // Link designation-specific role if one exists (e.g. Video Editor, Graphic Designer, Photographer)
      if (designation?.name && designation.name.toUpperCase() !== 'STAFF') {
        const desigRole = await tx.role.findFirst({
          where: {
            OR: [
              { customerId: numCustomerId, name: { equals: designation.name, mode: 'insensitive' } },
              { customerId: null, name: { equals: designation.name, mode: 'insensitive' } },
            ],
          },
        });
        if (desigRole) {
          const hasDesigUserRole = await tx.userRole.findFirst({
            where: { userId: user.id, roleId: desigRole.id },
          });
          if (!hasDesigUserRole) {
            await tx.userRole.create({
              data: { userId: user.id, roleId: desigRole.id },
            });
          }
        }
      }

      // Office / Branch resolution with geo-fence linkage
      let officeId: number | null = null;
      let branchName = dto.branch || dto.officeName || 'Head Office';

      if (dto.officeId) {
        const numOfficeId = Number(dto.officeId);
        let office = await tx.branchGeofence.findFirst({
          where: { id: numOfficeId, customerId: numCustomerId },
        });
        if (!office) {
          const crossOffice = await tx.branchGeofence.findFirst({ where: { id: numOfficeId } });
          if (crossOffice) {
            let localOffice = await tx.branchGeofence.findFirst({
              where: { customerId: numCustomerId, name: { equals: crossOffice.name, mode: 'insensitive' } },
            });
            if (!localOffice) {
              localOffice = await tx.branchGeofence.create({
                data: {
                  customerId: numCustomerId,
                  name: crossOffice.name,
                  city: crossOffice.city || 'Mumbai',
                  latitude: crossOffice.latitude || 19.076,
                  longitude: crossOffice.longitude || 72.8777,
                  radiusMeters: crossOffice.radiusMeters || 200,
                  isActive: crossOffice.isActive,
                },
              });
            }
            office = localOffice;
          }
        }
        if (!office) {
          throw new BadRequestException(`Office #${dto.officeId} not found or does not belong to this customer`);
        }
        if (office && office.isActive === false) {
          throw new BadRequestException('Selected office is no longer active.');
        }
        officeId = office.id;
        branchName = office.name;
      } else if (dto.branch || dto.officeName) {
        const targetName = (dto.branch || dto.officeName || '').trim();
        const office = await tx.branchGeofence.findFirst({
          where: {
            customerId: numCustomerId,
            name: { equals: targetName, mode: 'insensitive' },
          },
        });
        if (office) {
          officeId = office.id;
          branchName = office.name;
        }
      }

      if (!officeId) {
        const defaultOffice = await tx.branchGeofence.findFirst({
          where: { customerId: numCustomerId, isActive: true },
          orderBy: { id: 'asc' },
        });
        if (defaultOffice) {
          officeId = defaultOffice.id;
          branchName = defaultOffice.name;
        } else {
          const createdDefault = await tx.branchGeofence.create({
            data: {
              customerId: numCustomerId,
              name: 'Head Office',
              city: 'Mumbai',
              latitude: 19.0760,
              longitude: 72.8777,
              radiusMeters: 200.0,
              isActive: true,
            },
          });
          officeId = createdDefault.id;
          branchName = createdDefault.name;
        }
      }

      // Shift resolution & validation
      let shiftId: number | null = null;
      if (dto.shiftId) {
        const numShiftId = Number(dto.shiftId);
        let shift = await tx.shift.findFirst({
          where: { id: numShiftId, customerId: numCustomerId },
        });
        if (!shift) {
          const crossShift = await tx.shift.findFirst({ where: { id: numShiftId } });
          if (crossShift) {
            let localShift = await tx.shift.findFirst({
              where: { customerId: numCustomerId, name: { equals: crossShift.name, mode: 'insensitive' } },
            });
            if (!localShift) {
              localShift = await tx.shift.create({
                data: {
                  customerId: numCustomerId,
                  name: crossShift.name,
                  code: `${crossShift.code || 'SH'}-${Date.now().toString().slice(-4)}`,
                  startTime: crossShift.startTime,
                  endTime: crossShift.endTime,
                  durationHours: crossShift.durationHours,
                  status: crossShift.status,
                },
              });
            }
            shift = localShift;
          }
        }
        if (!shift) {
          throw new BadRequestException(`Shift #${numShiftId} not found or does not belong to this customer`);
        }
        if (shift.status !== 'ACTIVE') {
          throw new BadRequestException(`Shift '${shift.name}' is inactive and cannot be assigned`);
        }
        shiftId = shift.id;
      }

      const empData: any = {
        customerId: numCustomerId,
        userId: user.id,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: normalizedEmail,
        phone: dto.phone,
        officeId,
        shiftId,
        branch: branchName,
        departmentId: department?.id || null,
        designationId: designation?.id || null,
        employmentType: dto.employmentType || 'FULL_TIME',
        employeeType: dto.employeeType || 'COMPANY',
        city: dto.city || null,
        gender: dto.gender || null,
        dob: dto.dob ? new Date(dto.dob) : null,
        joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : new Date(),
        address: dto.address || null,
        documents: dto.documents || null,
        bankDetails: dto.bankDetails || null,
        emergencyContact:
          typeof dto.emergencyContact === 'object'
            ? JSON.stringify(dto.emergencyContact)
            : dto.emergencyContact || null,
        managerId: dto.managerId ? Number(dto.managerId) : null,
        status: dto.status || 'ACTIVE',
        mobileLoginEnabled: dto.mobileLoginEnabled !== false,
      };

      // ─────────────────────────────────────────────────────────────────────
      // Create the employee record. The P2002 catch below handles the rare
      // race condition where two concurrent requests pass the duplicate guard
      // but only one wins the DB unique constraint.
      // ─────────────────────────────────────────────────────────────────────
      try {
        const createdEmployee = await tx.employee.create({
          data: {
            ...empData,
            employeeCode: finalEmployeeCode,
          },
          include: {
            department: true,
            designation: true,
            office: true,
            shift: true,
          },
        });

        if (this.prisma?.auditLog) {
          this.prisma.auditLog.create({
            data: {
              customerId: numCustomerId,
              userId: user.id,
              action: 'EMPLOYEE_CREATED',
              module: 'EMPLOYEE',
              details: {
                employeeId: createdEmployee.id,
                employeeCode: finalEmployeeCode,
                email: createdEmployee.email,
              },
            },
          }).catch(() => null);
        }

        return createdEmployee;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException({
            success: false,
            message: 'This user is already registered as an employee',
            error: 'EMPLOYEE_ALREADY_EXISTS',
          });
        }
        throw error;
      }
    });
  }

  async update(params: UpdateEmployeeParams) {
    const { id, customerId, isSuperAdmin, dto } = params;
    await this.findOne({ id, customerId, isSuperAdmin });

    const numId = Number(id);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employee.findUnique({ where: { id: numId } });
      const targetCustId = existing?.customerId || (customerId ? Number(customerId) : 1);

      const updateData: any = {};
      // ── NOTE: userId is intentionally EXCLUDED from updateData. ──
      // Employee.userId is @unique and immutable after creation.
      // Changing the linked user during edit is not supported.
      // Attempting to update userId would cause P2002 if the new user
      // already has an Employee record.
      if (dto.firstName !== undefined) updateData.firstName = dto.firstName;
      if (dto.lastName !== undefined) updateData.lastName = dto.lastName;
      if (dto.email !== undefined) updateData.email = dto.email;
      if (dto.phone !== undefined) updateData.phone = dto.phone;
      if (dto.branch !== undefined) updateData.branch = dto.branch;
      if (dto.status !== undefined) updateData.status = dto.status;
      if (dto.employmentType !== undefined) updateData.employmentType = dto.employmentType;
      if (dto.employeeType !== undefined) updateData.employeeType = dto.employeeType;
      if (dto.city !== undefined) updateData.city = dto.city;
      if (dto.gender !== undefined) updateData.gender = dto.gender;
      if (dto.dob !== undefined) updateData.dob = dto.dob ? new Date(dto.dob) : null;
      if (dto.joiningDate !== undefined)
        updateData.joiningDate = dto.joiningDate ? new Date(dto.joiningDate) : undefined;
      if (dto.address !== undefined) updateData.address = dto.address;
      if (dto.documents !== undefined) updateData.documents = dto.documents;
      if (dto.bankDetails !== undefined) updateData.bankDetails = dto.bankDetails;
      if (dto.emergencyContact !== undefined) {
        updateData.emergencyContact =
          typeof dto.emergencyContact === 'object'
            ? JSON.stringify(dto.emergencyContact)
            : dto.emergencyContact;
      }
      if (dto.managerId !== undefined)
        updateData.managerId = dto.managerId ? Number(dto.managerId) : null;
      if (dto.mobileLoginEnabled !== undefined)
        updateData.mobileLoginEnabled = dto.mobileLoginEnabled;

      // Handle user account updates (status & optional password)
      if (existing?.userId) {
        const userRecord = await tx.user.findUnique({
          where: { id: existing.userId },
        });

        if (userRecord) {
          const userUpdate: any = {};
          if (dto.status !== undefined) {
            userUpdate.isActive = dto.status === 'ACTIVE';
            if (dto.status === 'ACTIVE') {
              userUpdate.deletedAt = null;
            }
          }
          if (dto.password && dto.password.trim().length > 0) {
            userUpdate.passwordHash = await bcrypt.hash(dto.password.trim(), 10);
          }
          if (dto.firstName !== undefined) userUpdate.firstName = dto.firstName;
          if (dto.lastName !== undefined) userUpdate.lastName = dto.lastName;

          if (dto.phone !== undefined) {
            const cleanPhone = dto.phone && dto.phone.trim().length > 0 ? dto.phone.trim() : null;
            if (cleanPhone) {
              const duplicatePhoneUser = await tx.user.findFirst({
                where: {
                  phone: cleanPhone,
                  id: { not: existing.userId },
                },
              });
              if (duplicatePhoneUser) {
                throw new BadRequestException({
                  success: false,
                  message: `Phone number '${cleanPhone}' is already in use by another account.`,
                  error: 'PHONE_ALREADY_IN_USE',
                });
              }
            }
            userUpdate.phone = cleanPhone;
          }

          if (dto.email !== undefined) {
            const cleanEmail = dto.email.trim().toLowerCase();
            if (cleanEmail && cleanEmail !== userRecord.email) {
              const duplicateEmailUser = await tx.user.findFirst({
                where: {
                  email: cleanEmail,
                  id: { not: existing.userId },
                },
              });
              if (duplicateEmailUser) {
                throw new BadRequestException({
                  success: false,
                  message: `Email '${cleanEmail}' is already in use by another account.`,
                  error: 'EMAIL_ALREADY_IN_USE',
                });
              }
              userUpdate.email = cleanEmail;
            }
          }

          if (userRecord.customerId !== null) {
            userUpdate.customerId = targetCustId;
          }

          if (Object.keys(userUpdate).length > 0) {
            await tx.user.update({
              where: { id: existing.userId },
              data: userUpdate,
            });
          }
        }
      } else {
        // Auto-heal missing User account for this employee
        const normalizedEmail = (dto.email || existing?.email || '').trim().toLowerCase();
        if (normalizedEmail) {
          let user = await tx.user.findFirst({ where: { email: normalizedEmail } });
          const rawPassword = dto.password?.trim() || 'Password@123';
          const passwordHash = await bcrypt.hash(rawPassword, 10);
          const cleanPhone = dto.phone && dto.phone.trim().length > 0 ? dto.phone.trim() : null;

          if (!user) {
            if (cleanPhone) {
              const duplicatePhoneUser = await tx.user.findFirst({
                where: { phone: cleanPhone },
              });
              if (duplicatePhoneUser) {
                throw new BadRequestException({
                  success: false,
                  message: `Phone number '${cleanPhone}' is already in use by another account.`,
                  error: 'PHONE_ALREADY_IN_USE',
                });
              }
            }

            user = await tx.user.create({
              data: {
                customerId: targetCustId,
                email: normalizedEmail,
                phone: cleanPhone,
                firstName: dto.firstName || existing?.firstName || 'Employee',
                lastName: dto.lastName || existing?.lastName || '',
                passwordHash,
                isActive: (dto.status || existing?.status || 'ACTIVE') === 'ACTIVE',
                isVerified: true,
              },
            });
          } else {
            if (cleanPhone) {
              const duplicatePhoneUser = await tx.user.findFirst({
                where: { phone: cleanPhone, id: { not: user.id } },
              });
              if (duplicatePhoneUser) {
                throw new BadRequestException({
                  success: false,
                  message: `Phone number '${cleanPhone}' is already in use by another account.`,
                  error: 'PHONE_ALREADY_IN_USE',
                });
              }
            }

            await tx.user.update({
              where: { id: user.id },
              data: {
                customerId: user.customerId !== null ? targetCustId : null,
                isActive: (dto.status || existing?.status || 'ACTIVE') === 'ACTIVE',
                deletedAt: null,
                phone: cleanPhone || user.phone,
                ...(dto.password?.trim() ? { passwordHash } : {}),
              },
            });
          }

          updateData.userId = user.id;

          // Assign Employee role
          let employeeRole = await tx.role.findFirst({
            where: {
              OR: [
                { customerId: targetCustId, name: { equals: 'Employee', mode: 'insensitive' } },
                { customerId: null, name: { equals: 'Employee', mode: 'insensitive' } },
                { customerId: targetCustId, name: { equals: 'EMPLOYEE', mode: 'insensitive' } },
                { customerId: null, name: { equals: 'EMPLOYEE', mode: 'insensitive' } },
              ],
            },
          });
          if (!employeeRole) {
            employeeRole = await tx.role.create({
              data: {
                customerId: targetCustId,
                name: 'Employee',
                type: RoleType.CUSTOM,
                description: 'Employee mobile application role',
              },
            });
          }
          const hasUserRole = await tx.userRole.findFirst({
            where: { userId: user.id, roleId: employeeRole.id },
          });
          if (!hasUserRole) {
            await tx.userRole.create({
              data: { userId: user.id, roleId: employeeRole.id },
            });
          }
        }
      }

      if (dto.departmentId !== undefined && dto.departmentId !== null && String(dto.departmentId).trim() !== '') {
        const numDeptId = Number(dto.departmentId);
        let dept = await tx.department.findFirst({
          where: { id: numDeptId, customerId: targetCustId },
        });
        if (!dept && dto.departmentName) {
          dept = await tx.department.findFirst({
            where: { customerId: targetCustId, name: { equals: dto.departmentName, mode: 'insensitive' as Prisma.QueryMode } },
          });
        }
        if (!dept) {
          const crossDept = await tx.department.findFirst({ where: { id: numDeptId } });
          if (crossDept) {
            let localDept = await tx.department.findFirst({
              where: { customerId: targetCustId, name: { equals: crossDept.name, mode: 'insensitive' as Prisma.QueryMode } },
            });
            if (!localDept) {
              localDept = await tx.department.create({
                data: {
                  customerId: targetCustId,
                  name: crossDept.name,
                  code: crossDept.code || crossDept.name.substring(0, 5).toUpperCase(),
                  isActive: crossDept.isActive,
                },
              });
            }
            dept = localDept;
          }
        }
        if (!dept) {
          throw new NotFoundException({
            success: false,
            message: `Department #${numDeptId} not found`,
            error: 'DEPARTMENT_NOT_FOUND',
          });
        }
        if (dept && dept.isActive === false) {
          throw new BadRequestException({
            success: false,
            message: 'Selected department is no longer active.',
            error: 'DEPARTMENT_INACTIVE',
          });
        }
        updateData.departmentId = dept.id;
      } else if (dto.departmentName) {
        let dept = await tx.department.findFirst({
          where: { customerId: targetCustId, name: { equals: dto.departmentName, mode: 'insensitive' as Prisma.QueryMode } },
        });
        if (!dept) {
          dept = await tx.department.create({
            data: {
              customerId: targetCustId,
              name: dto.departmentName,
              code: dto.departmentName.substring(0, 5).toUpperCase(),
              isActive: true,
            },
          });
        }
        if (dept && dept.isActive === false) {
          throw new BadRequestException({
            success: false,
            message: 'Selected department is no longer active.',
            error: 'DEPARTMENT_INACTIVE',
          });
        }
        updateData.departmentId = dept.id;
      }

      if (dto.designationId !== undefined && dto.designationId !== null && String(dto.designationId).trim() !== '') {
        const numDesigId = Number(dto.designationId);
        let desig = await tx.designation.findFirst({
          where: { id: numDesigId, customerId: targetCustId },
        });
        if (!desig && dto.designationName) {
          desig = await tx.designation.findFirst({
            where: { customerId: targetCustId, name: { equals: dto.designationName, mode: 'insensitive' as Prisma.QueryMode } },
          });
        }
        if (!desig) {
          const crossDesig = await tx.designation.findFirst({ where: { id: numDesigId } });
          if (crossDesig) {
            let localDesig = await tx.designation.findFirst({
              where: { customerId: targetCustId, name: { equals: crossDesig.name, mode: 'insensitive' as Prisma.QueryMode } },
            });
            if (!localDesig) {
              localDesig = await tx.designation.create({
                data: {
                  customerId: targetCustId,
                  name: crossDesig.name,
                  code: `${crossDesig.code || 'DES'}-${Date.now().toString().slice(-4)}`,
                  departmentId: updateData.departmentId || existing?.departmentId || null,
                  isActive: crossDesig.isActive,
                },
              });
            }
            desig = localDesig;
          }
        }
        if (!desig) {
          throw new BadRequestException(`Designation #${numDesigId} not found`);
        }
        if (desig && desig.isActive === false) {
          throw new BadRequestException({
            success: false,
            message: 'Selected designation is no longer active.',
            error: 'DESIGNATION_INACTIVE',
          });
        }
        updateData.designationId = desig.id;
      } else if (dto.designationName) {
        let desig = await tx.designation.findFirst({
          where: { customerId: targetCustId, name: { equals: dto.designationName, mode: 'insensitive' as Prisma.QueryMode } },
        });
        if (!desig) {
          desig = await tx.designation.create({
            data: {
              customerId: targetCustId,
              name: dto.designationName,
              code: `${dto.designationName.substring(0, 4).toUpperCase()}-${Date.now().toString().slice(-4)}`,
              departmentId: updateData.departmentId || existing?.departmentId || null,
              isActive: true,
            },
          });
        }
        if (desig && desig.isActive === false) {
          throw new BadRequestException({
            success: false,
            message: 'Selected designation is no longer active.',
            error: 'DESIGNATION_INACTIVE',
          });
        }
        updateData.designationId = desig.id;
      }

      if (dto.officeId !== undefined && dto.officeId !== null && String(dto.officeId).trim() !== '') {
        const numOfficeId = Number(dto.officeId);
        let office = await tx.branchGeofence.findFirst({
          where: { id: numOfficeId, customerId: targetCustId },
        });
        if (!office) {
          const crossOffice = await tx.branchGeofence.findFirst({ where: { id: numOfficeId } });
          if (crossOffice) {
            let localOffice = await tx.branchGeofence.findFirst({
              where: { customerId: targetCustId, name: { equals: crossOffice.name, mode: 'insensitive' } },
            });
            if (!localOffice) {
              localOffice = await tx.branchGeofence.create({
                data: {
                  customerId: targetCustId,
                  name: crossOffice.name,
                  city: crossOffice.city || 'Mumbai',
                  latitude: crossOffice.latitude || 19.076,
                  longitude: crossOffice.longitude || 72.8777,
                  radiusMeters: crossOffice.radiusMeters || 200,
                  isActive: crossOffice.isActive,
                },
              });
            }
            office = localOffice;
          }
        }
        if (!office) {
          throw new BadRequestException(`Office #${numOfficeId} not found`);
        }
        if (office && office.isActive === false) {
          throw new BadRequestException('Selected office is no longer active.');
        }
        updateData.officeId = office.id;
        updateData.branch = office.name;
      } else if (dto.officeName || dto.branch) {
        const officeNameTarget = (dto.officeName || dto.branch || '').trim();
        const office = await tx.branchGeofence.findFirst({
          where: {
            customerId: targetCustId,
            name: { equals: officeNameTarget, mode: 'insensitive' },
          },
        });
        if (office) {
          updateData.officeId = office.id;
          updateData.branch = office.name;
        }
      }

      if (dto.shiftId !== undefined) {
        if (dto.shiftId === null || dto.shiftId === 0 || String(dto.shiftId).trim() === '') {
          updateData.shiftId = null;
        } else {
          const numShiftId = Number(dto.shiftId);
          let shift = await tx.shift.findFirst({
            where: { id: numShiftId, customerId: targetCustId },
          });
          if (!shift) {
            const crossShift = await tx.shift.findFirst({ where: { id: numShiftId } });
            if (crossShift) {
              let localShift = await tx.shift.findFirst({
                where: { customerId: targetCustId, name: { equals: crossShift.name, mode: 'insensitive' } },
              });
              if (!localShift) {
                localShift = await tx.shift.create({
                  data: {
                    customerId: targetCustId,
                    name: crossShift.name,
                    code: `${crossShift.code || 'SH'}-${Date.now().toString().slice(-4)}`,
                    startTime: crossShift.startTime,
                    endTime: crossShift.endTime,
                    durationHours: crossShift.durationHours,
                    status: crossShift.status,
                  },
                });
              }
              shift = localShift;
            }
          }
          if (!shift) {
            throw new BadRequestException(`Shift #${numShiftId} not found or does not belong to this customer`);
          }
          if (shift.status !== 'ACTIVE') {
            throw new BadRequestException(`Shift '${shift.name}' is inactive and cannot be assigned`);
          }
          updateData.shiftId = shift.id;
        }
      }

      return tx.employee.update({
        where: { id: numId },
        data: updateData,
        include: {
          department: true,
          designation: true,
          office: true,
          shift: true,
        },
      });
    });
  }

  async remove(params: EmployeeFindOneParams & { hardDelete?: boolean }) {
    const { id, customerId, isSuperAdmin } = params;
    const existing = await this.findOne({ id, customerId, isSuperAdmin });

    const numId = Number(existing.id);
    const userId = existing?.userId ? Number(existing.userId) : null;
    const empCustomerId = Number(existing.customerId);

    // ── PERMANENT HARD-DELETE ──────────────────────────────────────────
    return this.prisma.$transaction(async (tx) => {
      // 1. Invalidate/delete all active authentication sessions, refresh tokens, and device tokens for linked user
      if (userId) {
        if (tx.refreshToken?.deleteMany) {
          await tx.refreshToken.deleteMany({ where: { userId } });
        }
        if (tx.session?.deleteMany) {
          await tx.session.deleteMany({ where: { userId } });
        }
        if (tx.userDeviceToken?.deleteMany) {
          await tx.userDeviceToken.deleteMany({ where: { userId } });
        }
      }

      // 2. Unlink or delete all foreign key relations referencing this employee
      if (tx.task?.updateMany) {
        await tx.task.updateMany({
          where: { employeeId: numId },
          data: { employeeId: null },
        });
      }
      if (tx.taskProof?.updateMany) {
        await tx.taskProof.updateMany({
          where: { employeeId: numId },
          data: { employeeId: null },
        });
      }

      if (tx.work?.updateMany) {
        await tx.work.updateMany({
          where: { assignedToId: numId },
          data: { assignedToId: null },
        });
        await tx.work.updateMany({
          where: { editorId: numId },
          data: { editorId: null },
        });
      }

      if (tx.workTask?.updateMany) {
        await tx.workTask.updateMany({
          where: { assignedToId: numId },
          data: { assignedToId: null },
        });
      }

      if (tx.workAccessRequest?.deleteMany) {
        await tx.workAccessRequest.deleteMany({ where: { employeeId: numId } });
      }
      if (tx.employeeModuleOverride?.deleteMany) {
        await tx.employeeModuleOverride.deleteMany({ where: { employeeId: numId } });
      }
      if (tx.employeeLeadLimit?.deleteMany) {
        await tx.employeeLeadLimit.deleteMany({ where: { employeeId: numId } });
      }
      if (tx.locationTrackingSetting?.deleteMany) {
        await tx.locationTrackingSetting.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.teamMember?.deleteMany) {
        await tx.teamMember.deleteMany({ where: { employeeId: numId } });
      }

      // Unlink structural leadership assignments to prevent restrict constraint violations
      if (tx.team?.updateMany) {
        await tx.team.updateMany({
          where: { leaderId: numId },
          data: { leaderId: null },
        });
      }
      if (tx.department?.updateMany) {
        await tx.department.updateMany({
          where: { headId: numId },
          data: { headId: null },
        });
      }
      if (tx.customer?.updateMany) {
        await tx.customer.updateMany({
          where: { assignedEmployeeId: numId },
          data: { assignedEmployeeId: null },
        });
      }
      if (tx.lead?.updateMany) {
        await tx.lead.updateMany({
          where: { employeeId: numId },
          data: { employeeId: null },
        });
      }

      if (tx.visit?.deleteMany) {
        await tx.visit.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.monthlySchedule?.updateMany) {
        await tx.monthlySchedule.updateMany({
          where: { assignedEmployeeId: numId },
          data: { assignedEmployeeId: null },
        });
      }

      if (tx.employeeLocation?.deleteMany) {
        await tx.employeeLocation.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.employeeClaim?.deleteMany) {
        await tx.employeeClaim.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.employeeLoan?.deleteMany) {
        await tx.employeeLoan.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.remoteRequest?.deleteMany) {
        await tx.remoteRequest.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.salarySlip?.deleteMany) {
        await tx.salarySlip.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.salaryStructure?.deleteMany) {
        await tx.salaryStructure.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.payrollItem?.deleteMany) {
        await tx.payrollItem.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.leaveAdjustmentHistory?.deleteMany) {
        await tx.leaveAdjustmentHistory.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.employeeLeaveBalance?.deleteMany) {
        await tx.employeeLeaveBalance.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.leaveRequest?.deleteMany) {
        await tx.leaveRequest.deleteMany({ where: { employeeId: numId } });
      }

      if (tx.attendanceBreak?.deleteMany) {
        await tx.attendanceBreak.deleteMany({
          where: { attendance: { employeeId: numId } },
        });
      }

      if (tx.attendance?.deleteMany) {
        await tx.attendance.deleteMany({ where: { employeeId: numId } });
      }

      // 3. Record deletion in AuditLog
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            customerId: empCustomerId,
            userId: userId,
            action: 'EMPLOYEE_DELETED',
            module: 'EMPLOYEE',
            details: {
              employeeId: existing.id,
              employeeCode: existing.employeeCode || existing.employeeId,
              email: existing.email,
            },
          },
        });
      }

      // 4. Delete the Employee record completely from the database
      await tx.employee.delete({
        where: { id: numId },
      });

      // 5. User safety check & deletion/deactivation
      if (userId && tx.user) {
        // Check if user is attached to other entities (e.g. is Admin, leads, deals, tickets)
        const isSharedOrAdmin = await tx.user.findFirst({
          where: {
            id: userId,
            OR: [
              { userRoles: { some: { role: { type: { in: [RoleType.SUPER_ADMIN, RoleType.CUSTOMER_ADMIN, RoleType.TENANT_ADMIN] } } } } },
              { assignedLeads: { some: {} } },
              { createdLeads: { some: {} } },
              { assignedDeals: { some: {} } },
              { assignedContacts: { some: {} } },
              { assignedTickets: { some: {} } },
              { createdTickets: { some: {} } },
              { assignedTasks: { some: {} } },
              { createdTasks: { some: {} } },
            ],
          },
        });

        if (!isSharedOrAdmin) {
          // Nullify audit logs linked to this user before deletion to prevent restrict constraint violation
          if (tx.auditLog?.updateMany) {
            await tx.auditLog.updateMany({
              where: { userId },
              data: { userId: null },
            });
          }
          if (tx.notification?.deleteMany) {
            await tx.notification.deleteMany({ where: { userId } });
          }
          if (tx.userRole?.deleteMany) {
            await tx.userRole.deleteMany({ where: { userId } });
          }
          await tx.user.delete({ where: { id: userId } });
        } else {
          // Shared / Admin user -> permanently deactivate and mark deletedAt
          await tx.user.update({
            where: { id: userId },
            data: { isActive: false, deletedAt: new Date() },
          });
        }
      }

      return {
        success: true,
        message: 'Employee deleted successfully',
      };
    });
  }


  async getLeaves(user?: any, customerId?: number | string, isSuperAdmin = false) {
    const where: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for leaves access');
    }

    const isEmpUser = user && (String(user.role).toUpperCase() === 'EMPLOYEE' || user.roleType === 'EMPLOYEE' || user.employee != null);
    if (isEmpUser) {
      const emp = user.employee || (await this.prisma.employee.findFirst({
        where: {
          OR: [
            { userId: user.id },
            ...(user.email ? [{ email: { equals: user.email.trim().toLowerCase(), mode: 'insensitive' as Prisma.QueryMode } }] : []),
          ],
        },
      }));
      if (emp) {
        where.employeeId = emp.id;
      }
    }

    const leaves = await this.prisma.leaveRequest.findMany({
      where,
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });

    return leaves.map((l) => ({
      id: String(l.id),
      customerId: l.customerId,
      employeeName: l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : 'Employee',
      employeeId: l.employee?.employeeCode || 'EMP-001',
      leaveType: l.leaveType?.name || 'Casual Leave',
      fromDate: l.fromDate ? l.fromDate.toISOString().split('T')[0] : '2026-08-20',
      toDate: l.toDate ? l.toDate.toISOString().split('T')[0] : '2026-08-22',
      totalDays: l.days || 1,
      reason: l.reason || 'Leave request',
      status: l.status,
      appliedOn: l.createdAt ? l.createdAt.toISOString().split('T')[0] : '2026-08-15',
    }));
  }

  async getRemoteRequests(user?: any, customerId?: number | string, isSuperAdmin = false) {
    const where: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for remote requests access');
    }

    const isEmpUser = user && (String(user.role).toUpperCase() === 'EMPLOYEE' || user.roleType === 'EMPLOYEE' || user.employee != null);
    if (isEmpUser) {
      const emp = user.employee || (await this.prisma.employee.findFirst({
        where: {
          OR: [
            { userId: user.id },
            ...(user.email ? [{ email: { equals: user.email.trim().toLowerCase(), mode: 'insensitive' as Prisma.QueryMode } }] : []),
          ],
        },
      }));
      if (emp) {
        where.employeeId = emp.id;
      }
    }

    const requests = await this.prisma.remoteRequest.findMany({
      where,
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((r) => ({
      id: String(r.id),
      customerId: r.customerId,
      employeeName: r.employee ? `${r.employee.firstName} ${r.employee.lastName || ''}`.trim() : 'Employee',
      employeeId: r.employee?.employeeCode || 'EMP-001',
      requestType: 'WORK_FROM_HOME',
      date: r.fromDate ? r.fromDate.toISOString().split('T')[0] : '',
      fromDate: r.fromDate ? r.fromDate.toISOString().split('T')[0] : '',
      toDate: r.toDate ? r.toDate.toISOString().split('T')[0] : '',
      startTime: r.startTime || '09:00 AM',
      endTime: r.endTime || '06:00 PM',
      days: r.days || 1,
      reason: r.reason || 'Remote work request',
      status: r.status,
      appliedOn: r.createdAt ? r.createdAt.toISOString().split('T')[0] : '',
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    }));
  }

  async getAttendance(
    customerId?: number | string,
    isSuperAdmin = false,
    options?: { date?: string; branch?: string; search?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(Number(options?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(options?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for attendance access');
    }

    if (options?.date) {
      const { start, end } = getBusinessDayRange(options.date);
      where.date = { gte: start, lte: end };
    }

    if (options?.branch && options.branch !== 'ALL') {
      const activeBranches = await this.prisma.branchGeofence.findMany({
        where: { ...(where.customerId ? { customerId: where.customerId } : {}), isActive: true },
        select: { id: true, name: true },
      });
      const matchedBranch = activeBranches.find(
        (b) => b.name.toLowerCase() === options.branch!.toLowerCase() || String(b.id) === options.branch,
      );
      if (matchedBranch) {
        where.employee = {
          ...(where.employee || {}),
          OR: [
            { officeId: matchedBranch.id },
            { branch: { equals: matchedBranch.name, mode: 'insensitive' as Prisma.QueryMode } },
            { branch: { equals: options.branch, mode: 'insensitive' as Prisma.QueryMode } },
          ],
        };
      } else {
        where.employee = {
          ...(where.employee || {}),
          branch: { equals: options.branch, mode: 'insensitive' as Prisma.QueryMode },
        };
      }
    }

    if (options?.search) {
      where.employee = {
        ...(where.employee || {}),
        OR: [
          { firstName: { contains: options.search, mode: 'insensitive' } },
          { lastName: { contains: options.search, mode: 'insensitive' } },
          { employeeCode: { contains: options.search, mode: 'insensitive' } },
        ],
      };
    }

    // Auto-checkout any open attendances before listing
    await this.autoCheckOutOpenAttendances(where.customerId);

    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: {
          employee: { include: { office: true } },
          breaks: { orderBy: { breakStart: 'asc' } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.attendance.count({ where }),
    ]);

    const formatted = records.map((a) => {
      const breakSessions = a.breaks.map((b, idx) => {
        const bStartIso = b.breakStart ? b.breakStart.toISOString() : null;
        const bEndIso = b.breakEnd ? b.breakEnd.toISOString() : null;
        const bDuration = b.duration || (b.breakEnd
          ? Math.max(0, Math.round((new Date(b.breakEnd).getTime() - new Date(b.breakStart).getTime()) / (1000 * 60)))
          : Math.max(0, Math.round((Date.now() - new Date(b.breakStart).getTime()) / (1000 * 60))));

        return {
          id: b.id || idx + 1,
          sessionNumber: idx + 1,
          breakStart: bStartIso,
          breakEnd: bEndIso,
          breakStartFormatted: b.breakStart ? formatTimeInTimezone(b.breakStart) : '—',
          breakEndFormatted: b.breakEnd ? formatTimeInTimezone(b.breakEnd) : (b.breakStart ? 'Active Break' : '—'),
          durationMinutes: bDuration,
          durationFormatted: formatDurationHoursMinutes(bDuration),
          isOngoing: !b.breakEnd,
        };
      });

      const breakMins = a.breaks
        .filter((b) => b.breakEnd)
        .reduce(
          (acc, b) =>
            acc +
            (b.duration ||
              Math.max(
                0,
                Math.round(
                  (new Date(b.breakEnd!).getTime() - new Date(b.breakStart).getTime()) / (1000 * 60),
                ),
              )),
          0,
        );

      let grossWorkingMinutes = 0;
      if (a.punchIn && a.punchOut) {
        grossWorkingMinutes = Math.max(
          0,
          Math.round((new Date(a.punchOut).getTime() - new Date(a.punchIn).getTime()) / (1000 * 60)),
        );
      } else if (a.punchIn && !a.punchOut) {
        grossWorkingMinutes = Math.max(
          0,
          Math.round((Date.now() - new Date(a.punchIn).getTime()) / (1000 * 60)),
        );
      }

      let netWorkingMinutes = a.workingMinutes || 0;
      if (!netWorkingMinutes || netWorkingMinutes === 0) {
        netWorkingMinutes = Math.max(0, grossWorkingMinutes - breakMins);
      }

      const punchInIso = a.punchIn ? a.punchIn.toISOString() : null;
      const punchOutIso = a.punchOut ? a.punchOut.toISOString() : null;
      const punchInFormatted = a.punchIn ? formatTimeInTimezone(a.punchIn) : '—';
      const punchOutFormatted = a.punchOut
        ? formatTimeInTimezone(a.punchOut)
        : (a.punchIn ? '—' : '—');
      const grossWorkingFormatted = formatDurationHoursMinutes(grossWorkingMinutes);
      const netWorkingFormatted = formatDurationHoursMinutes(netWorkingMinutes);
      const totalBreakFormatted = formatDurationHoursMinutes(breakMins);
      const isAutoCheckout = Boolean(a.locationOut?.includes('Auto Check-out') || a.locationOut?.includes('Forgot Punch-Out'));

      return {
        id: String(a.id),
        customerId: a.customerId,
        employeeName: a.employee ? `${a.employee.firstName} ${a.employee.lastName}`.trim() : 'Employee',
        employeeId: a.employee?.employeeCode || `EMP-${a.employeeId}`,
        branch: a.employee?.office?.name || a.employee?.branch || 'Head Office',
        office: a.employee?.office?.name || a.employee?.branch || 'Head Office',
        attendanceDate: a.date ? getBusinessDate(a.date) : '—',
        date: a.date ? getBusinessDate(a.date) : '—',
        punchInAt: punchInIso,
        punchIn: punchInFormatted,
        punchInTime: punchInFormatted,
        punchInFormatted,
        checkIn: punchInFormatted,
        punchOutAt: punchOutIso,
        punchOut: punchOutFormatted,
        punchOutTime: punchOutFormatted,
        punchOutFormatted,
        checkOut: punchOutFormatted,
        totalBreakMinutes: Math.round(breakMins),
        totalBreak: totalBreakFormatted,
        breakDuration: totalBreakFormatted,
        breaksCount: a.breaks.length,
        breakSessions,
        grossWorkingMinutes,
        grossWorkingHours: grossWorkingFormatted,
        workingMinutes: netWorkingMinutes,
        workingHours: netWorkingFormatted,
        netWorkingHours: netWorkingFormatted,
        status: a.status,
        location: a.locationIn || 'Office GPS',
        locationIn: a.locationIn || null,
        locationOut: a.locationOut || null,
        isAutoCheckout,
        isLate: Boolean(a.isLate),
        lateMinutes: a.lateMinutes || 0,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: formatted,
      items: formatted,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async getMyProfile(user: any, customerId?: number | string) {
    if (!user) {
      throw new ForbiddenException('Authenticated user required');
    }

    let employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user.id },
          { email: { equals: user.email?.trim().toLowerCase(), mode: 'insensitive' } },
        ],
      },
      include: {
        department: true,
        designation: true,
        office: true,
        shift: true,
        user: { select: { avatar: true } },
        customer: {
          select: {
            id: true,
            companyName: true,
            name: true,
            email: true,
            phone: true,
            city: true,
            state: true,
          },
        },
      },
    });

    if (!employee && customerId) {
      const numCustomerId = Number(customerId);
      if (!isNaN(numCustomerId)) {
        employee = await this.prisma.employee.findFirst({
          where: { customerId: numCustomerId, status: 'ACTIVE' },
          include: {
            department: true,
            designation: true,
            office: true,
            shift: true,
            user: { select: { avatar: true } },
            customer: true,
          },
        });
      }
    }

    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    let managerName = 'Direct Reporting';
    if (employee.managerId) {
      const manager = await this.prisma.employee.findUnique({
        where: { id: employee.managerId },
        select: { firstName: true, lastName: true },
      });
      if (manager) {
        managerName = `${manager.firstName} ${manager.lastName}`;
      }
    }

    return {
      id: employee.id,
      customerId: employee.customerId,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      email: employee.email,
      phone: employee.phone || '',
      profilePhoto: employee.user?.avatar || null,
      avatar: employee.user?.avatar || null,
      gender: employee.gender || '',
      dob: employee.dob ? employee.dob.toISOString().split('T')[0] : '',
      joiningDate: employee.joiningDate ? employee.joiningDate.toISOString().split('T')[0] : '',
      department: employee.department?.name || 'General',
      departmentId: employee.departmentId,
      designation: employee.designation?.name || 'Staff',
      designationId: employee.designationId,
      branch: employee.branch || employee.office?.name || 'Head Office',
      officeId: employee.officeId,
      office: employee.office,
      manager: managerName,
      managerId: employee.managerId,
      employmentType: employee.employmentType || 'FULL_TIME',
      address: employee.address || '',
      emergencyContact: employee.emergencyContact || '',
      bankDetails: employee.bankDetails || {},
      documents: employee.documents || [],
      status: employee.status || 'ACTIVE',
      organization: employee.customer?.companyName || employee.customer?.name || 'QuikBoom Enterprise',
    };
  }

  async getEmployeePermissions(params: {
    employeeId: number | string;
    customerId?: number | string;
    isSuperAdmin?: boolean;
  }) {
    const empId = Number(params.employeeId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: empId },
      include: {
        designation: true,
        user: {
          include: {
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        employeeModuleOverrides: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${empId} not found`);
    }

    if (!params.isSuperAdmin && params.customerId && employee.customerId !== Number(params.customerId)) {
      throw new ForbiddenException('Access denied to employee in another organization');
    }

    // Determine user roles
    const userRoles = employee.user?.userRoles?.map((ur) => ur.role.name) || [];
    const roleName = userRoles[0] || employee.designation?.name || 'EMPLOYEE';

    // Compute role default permissions
    const rolePermissionsSet = new Set<string>();

    let hasDbPermissions = false;
    if (employee.user?.userRoles) {
      for (const ur of employee.user.userRoles) {
        if (ur.role?.rolePermissions && ur.role.rolePermissions.length > 0) {
          hasDbPermissions = true;
          ur.role.rolePermissions.forEach((rp) => {
            if (rp.permission) {
              rolePermissionsSet.add(`${rp.permission.module.toUpperCase()}:${rp.permission.action.toUpperCase()}`);
            }
          });
        }
      }
    }

    if (!hasDbPermissions) {
      for (const rName of userRoles.length > 0 ? userRoles : [roleName]) {
        const upper = rName.toUpperCase().replace(/\s+/g, '_');
        let matchedKey: string | null = null;
        if (ROLE_PERMISSION_DEFAULTS[upper]) {
          matchedKey = upper;
        } else if (upper.includes('TELECALL') || upper.includes('TELESALES')) {
          matchedKey = 'TELECALLER';
        } else if (upper.includes('DESIGNER')) {
          matchedKey = 'DESIGNER';
        } else if (upper.includes('EDITOR')) {
          matchedKey = 'EDITOR';
        } else if (upper.includes('SOCIAL') || upper.includes('SSM')) {
          matchedKey = 'SOCIAL_MEDIA_MANAGER';
        } else if (upper.includes('PHOTO') || upper.includes('SHOOT')) {
          matchedKey = 'PHOTOGRAPHER';
        } else if (upper.includes('SALES')) {
          matchedKey = 'SALES_EXECUTIVE';
        } else if (upper.includes('HR')) {
          matchedKey = 'HR';
        } else if (upper.includes('MANAGER')) {
          matchedKey = 'MANAGER';
        } else if (upper.includes('EMPLOYEE')) {
          matchedKey = 'EMPLOYEE';
        }

        if (matchedKey && ROLE_PERMISSION_DEFAULTS[matchedKey]) {
          ROLE_PERMISSION_DEFAULTS[matchedKey].forEach((p) => {
            rolePermissionsSet.add(`${p.module.toUpperCase()}:${p.action.toUpperCase()}`);
          });
        }
      }
    }

    // Build lookup for existing individual employee overrides
    const overrideMap = new Map<string, string>();
    (employee.employeeModuleOverrides || []).forEach((ov) => {
      overrideMap.set(ov.moduleKey.toUpperCase(), String(ov.override).toUpperCase());
      overrideMap.set(ov.moduleKey.toLowerCase(), String(ov.override).toUpperCase());
    });

    // 19 standard mobile modules definition
    const MODULE_METADATA: Array<{ key: string; label: string; category: string; description: string }> = [
      { key: 'DASHBOARD', label: 'Dashboard', category: 'SYSTEM', description: 'Main home view & overview metrics' },
      { key: 'CALENDAR', label: 'Calendar', category: 'CALENDAR', description: 'Personal & team schedule, shoots, visits' },
      { key: 'MY_WORK', label: 'My Work', category: 'WORKSPACE', description: 'SSM assigned tasks and creative deliverables' },
      { key: 'LEADS', label: 'Leads', category: 'CRM', description: 'Inbound inquiries and lead management pipeline' },
      { key: 'FOLLOW_UP', label: 'Follow Ups', category: 'CRM', description: 'Scheduled client and prospect calls' },
      { key: 'VISITS', label: 'Field Visits', category: 'CRM', description: 'Client physical visits and check-ins' },
      { key: 'PROPOSALS', label: 'Proposals', category: 'CRM', description: 'Commercial quotes and contract proposals' },
      { key: 'PACKAGES', label: 'Packages', category: 'CRM', description: 'Service catalog packages and pricing' },
      { key: 'PAYMENTS', label: 'Payments', category: 'CRM', description: 'Customer transaction records and receipts' },
      { key: 'WORK_EXECUTION', label: 'Work Execution', category: 'WORKSPACE', description: 'Daily production tasks & shoot delivery' },
      { key: 'CREATIVE_WORK', label: 'Creative Work', category: 'CREATIVE', description: 'Graphics, video edits, reels & campaigns' },
      { key: 'ATTENDANCE', label: 'Attendance', category: 'HRM', description: 'Daily check-in / check-out and shifts' },
      { key: 'LEAVE', label: 'Leave', category: 'HRM', description: 'Leave requests and balance tracking' },
      { key: 'REMOTE_WORK', label: 'Remote Work', category: 'HRM', description: 'Work from home / remote status' },
      { key: 'TASKS', label: 'Tasks', category: 'WORKSPACE', description: 'General company & project to-dos' },
      { key: 'SALARY', label: 'Salary & Payslips', category: 'HRM', description: 'Monthly payroll records and compensation' },
      { key: 'NOTIFICATIONS', label: 'Notifications', category: 'SYSTEM', description: 'Push notifications & activity inbox' },
      { key: 'PROFILE', label: 'Profile', category: 'SYSTEM', description: 'Employee personal profile details' },
      { key: 'SETTINGS', label: 'Settings', category: 'SYSTEM', description: 'App preferences and account settings' },
    ];

    const modules = MODULE_METADATA.map((meta) => {
      // Role default status
      const roleDefault =
        rolePermissionsSet.has(`${meta.key}:VIEW`) ||
        Array.from(rolePermissionsSet).some((k) => k.startsWith(`${meta.key}:`));

      const rawOverride = overrideMap.get(meta.key) || overrideMap.get(meta.key.toLowerCase()) || 'DEFAULT';
      let override: 'INHERIT' | 'ALLOW' | 'DENY' = 'INHERIT';
      if (rawOverride === 'ALLOW') override = 'ALLOW';
      else if (rawOverride === 'DENY') override = 'DENY';

      let effective = roleDefault;
      if (override === 'ALLOW') effective = true;
      else if (override === 'DENY') effective = false;

      return {
        moduleKey: meta.key,
        label: meta.label,
        category: meta.category,
        description: meta.description,
        roleDefault,
        override,
        effective,
      };
    });

    const granularPermissions = STANDARD_PERMISSIONS.map((perm) => {
      const permKey = `${perm.module.toUpperCase()}:${perm.action.toUpperCase()}`;
      const roleDefault = rolePermissionsSet.has(permKey);

      const rawOverride =
        overrideMap.get(perm.key.toLowerCase()) ||
        overrideMap.get(permKey) ||
        overrideMap.get(perm.module.toUpperCase()) ||
        'DEFAULT';

      let override: 'INHERIT' | 'ALLOW' | 'DENY' = 'INHERIT';
      if (rawOverride === 'ALLOW') override = 'ALLOW';
      else if (rawOverride === 'DENY') override = 'DENY';

      let effective = roleDefault;
      if (override === 'ALLOW') effective = true;
      else if (override === 'DENY') effective = false;

      return {
        key: perm.key,
        module: perm.module,
        action: perm.action,
        label: perm.label,
        description: perm.description,
        category: perm.category,
        roleDefault,
        override,
        effective,
      };
    });

    return {
      employeeId: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      roleName,
      roles: userRoles,
      modules,
      granularPermissions,
    };
  }

  async updateEmployeePermissions(params: {
    employeeId: number | string;
    customerId?: number | string;
    isSuperAdmin?: boolean;
    overrides: Array<{ moduleKey: string; override: 'INHERIT' | 'ALLOW' | 'DENY' | 'DEFAULT' }>;
  }) {
    const empId = Number(params.employeeId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: empId },
      select: { id: true, customerId: true },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${empId} not found`);
    }

    if (!params.isSuperAdmin && params.customerId && employee.customerId !== Number(params.customerId)) {
      throw new ForbiddenException('Access denied to employee in another organization');
    }

    const customerId = employee.customerId;

    for (const item of params.overrides) {
      const modKey = (item.moduleKey || '').trim();
      if (!modKey) continue;
      const ovType = String(item.override).toUpperCase();

      if (ovType === 'INHERIT' || ovType === 'DEFAULT') {
        await this.prisma.employeeModuleOverride.deleteMany({
          where: {
            customerId,
            employeeId: empId,
            moduleKey: modKey,
          },
        });
      } else if (ovType === 'ALLOW' || ovType === 'DENY') {
        const overrideVal: AccessOverrideType = ovType === 'ALLOW' ? AccessOverrideType.ALLOW : AccessOverrideType.DENY;
        await this.prisma.employeeModuleOverride.upsert({
          where: {
            customerId_employeeId_moduleKey: {
              customerId,
              employeeId: empId,
              moduleKey: modKey,
            },
          },
          create: {
            customerId,
            employeeId: empId,
            moduleKey: modKey,
            override: overrideVal,
          },
          update: {
            override: overrideVal,
          },
        });
      }
    }

    return {
      success: true,
      message: 'Employee permissions updated successfully',
    };
  }
}

