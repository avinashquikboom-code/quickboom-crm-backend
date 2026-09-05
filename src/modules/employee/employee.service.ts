import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { RoleType, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
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

    if (status && status !== 'ALL') where.status = status;
    if (branch && branch !== 'ALL') {
      where.OR = [
        { branch: { equals: branch, mode: 'insensitive' as Prisma.QueryMode } },
        { office: { name: { equals: branch, mode: 'insensitive' as Prisma.QueryMode } } },
      ];
    }
    if (department && department !== 'ALL') {
      where.department = { name: { equals: department, mode: 'insensitive' as Prisma.QueryMode } };
    }
    if (designation && designation !== 'ALL') {
      where.designation = { name: { equals: designation, mode: 'insensitive' as Prisma.QueryMode } };
    }
    if (employmentType && employmentType !== 'ALL') where.employmentType = employmentType;

    if (search && search.trim().length > 0) {
      const trimmedSearch = search.trim();
      const searchConditions = [
        { firstName: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
        { lastName: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
        { email: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
        { phone: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
        { employeeCode: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
        { branch: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } },
        { department: { name: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } } },
        { designation: { name: { contains: trimmedSearch, mode: 'insensitive' as Prisma.QueryMode } } },
      ];

      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: searchConditions },
        ];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
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

  async getLiveAttendance(
    customerId?: number | string,
    isSuperAdmin = false,
    branchFilter?: string,
    dateFilter?: string,
  ) {
    const whereEmp: any = { status: 'ACTIVE' };
    const whereCust: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      whereEmp.customerId = numCustomerId;
      whereCust.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for live attendance access');
    }

    if (branchFilter && branchFilter !== 'ALL') {
      whereEmp.branch = branchFilter;
    }

    const targetDate = dateFilter ? new Date(dateFilter) : new Date();
    const { dateStr, start: todayStart, end: todayEnd } = getBusinessDayRange(targetDate);

    const [employees, todayAttendances, todayLeaves] = await Promise.all([
      this.prisma.employee.findMany({
        where: whereEmp,
        include: { department: true, designation: true },
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

    // Office-wise aggregation map
    const officeStatsMap = new Map<
      string,
      { total: number; present: number; onBreak: number; onLeave: number; absent: number }
    >();

    const liveRecords = employees.map((emp) => {
      const att = attendanceMap.get(emp.id);
      const leave = leaveMap.get(emp.id);
      const officeName = emp.branch || 'Head Office';

      if (!officeStatsMap.has(officeName)) {
        officeStatsMap.set(officeName, { total: 0, present: 0, onBreak: 0, onLeave: 0, absent: 0 });
      }
      const oStat = officeStatsMap.get(officeName)!;
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
            if (att.status === 'LATE') lateCount++;
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
        branch: officeName,
        office: officeName,
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

    const offices = Array.from(officeStatsMap.entries()).map(([officeName, stats]) => ({
      officeName,
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

    // Query existing and historical employee codes for this customer that match the prefix
    const [existingEmployees, auditLogs] = await Promise.all([
      client.employee.findMany({
        where: {
          customerId: numCustomerId,
          employeeCode: {
            startsWith: cleanPrefix,
          },
        },
        select: { employeeCode: true },
      }),
      client.auditLog
        ? client.auditLog.findMany({
            where: {
              customerId: numCustomerId,
              module: 'EMPLOYEE',
            },
            select: { details: true },
            take: 500,
            orderBy: { id: 'desc' },
          }).catch(() => [])
        : Promise.resolve([]),
    ]);

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
            },
          });
        }
      } else {
        department = await tx.department.findFirst({
          where: { customerId: numCustomerId },
          orderBy: { id: 'asc' },
        });
        if (!department) {
          department = await tx.department.create({
            data: {
              customerId: numCustomerId,
              name: 'General',
              code: 'GEN',
            },
          });
        }
      }

      // Designation resolution
      let designation: any = null;
      if (dto.designationId) {
        designation = await tx.designation.findFirst({
          where: { id: Number(dto.designationId), customerId: numCustomerId },
        });
        if (!designation) {
          throw new BadRequestException(`Designation #${dto.designationId} not found`);
        }
      } else if (dto.designationName) {
        designation = await tx.designation.findFirst({
          where: { customerId: numCustomerId, name: dto.designationName },
        });
        if (!designation) {
          designation = await tx.designation.create({
            data: {
              customerId: numCustomerId,
              name: dto.designationName,
              code: (dto.designationName || 'STF').substring(0, 4).toUpperCase(),
              departmentId: department?.id || null,
            },
          });
        }
      } else {
        designation = await tx.designation.findFirst({
          where: { customerId: numCustomerId },
          orderBy: { id: 'asc' },
        });
        if (!designation) {
          designation = await tx.designation.create({
            data: {
              customerId: numCustomerId,
              name: 'Staff',
              code: 'STF',
              departmentId: department?.id || null,
            },
          });
        }
      }

      // User account password hashing
      const normalizedEmail = dto.email.trim().toLowerCase();
      const rawPassword = dto.password?.trim() || 'Password@123';
      const passwordHash = await bcrypt.hash(rawPassword, 10);

      // Find or create linked User account
      let user = await tx.user.findFirst({
        where: { email: normalizedEmail },
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            customerId: numCustomerId,
            email: normalizedEmail,
            phone: dto.phone || null,
            firstName: dto.firstName,
            lastName: dto.lastName,
            passwordHash,
            isActive: (dto.status || 'ACTIVE') === 'ACTIVE',
            isVerified: true,
          },
        });
      } else {
        // If user exists, update credentials, customerId, and active status
        const updateUserData: any = {
          customerId: numCustomerId,
          firstName: dto.firstName || user.firstName,
          lastName: dto.lastName || user.lastName,
          phone: dto.phone || user.phone,
          isActive: (dto.status || 'ACTIVE') === 'ACTIVE',
          isVerified: true,
          deletedAt: null,
          passwordHash,
        };
        user = await tx.user.update({
          where: { id: user.id },
          data: updateUserData,
        });
      }

      // ─────────────────────────────────────────────────────────────────────
      // DUPLICATE GUARD: Check if this User already has an Employee record.
      // Employee.userId is @unique — a second create() would throw P2002.
      // We detect and reject it here with a clean 409 BEFORE calling create().
      // ─────────────────────────────────────────────────────────────────────
      const existingEmployeeForUser = await tx.employee.findUnique({
        where: { userId: user.id },
        select: { id: true, employeeCode: true, customerId: true },
      });

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
        const office = await tx.branchGeofence.findFirst({
          where: { id: Number(dto.officeId), customerId: numCustomerId },
        });
        if (!office) {
          throw new BadRequestException(`Office #${dto.officeId} not found or does not belong to this customer`);
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
        const shift = await tx.shift.findFirst({
          where: { id: numShiftId, customerId: numCustomerId },
        });
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
        departmentId: department.id,
        designationId: designation.id,
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

        if (tx.auditLog) {
          await tx.auditLog.create({
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
        if (dto.phone !== undefined) userUpdate.phone = dto.phone;
        userUpdate.customerId = targetCustId;

        if (Object.keys(userUpdate).length > 0) {
          await tx.user
            .update({
              where: { id: existing.userId },
              data: userUpdate,
            })
            .catch(() => null);
        }
      } else {
        // Auto-heal missing User account for this employee
        const normalizedEmail = (dto.email || existing?.email || '').trim().toLowerCase();
        if (normalizedEmail) {
          let user = await tx.user.findFirst({ where: { email: normalizedEmail } });
          const rawPassword = dto.password?.trim() || 'Password@123';
          const passwordHash = await bcrypt.hash(rawPassword, 10);

          if (!user) {
            user = await tx.user.create({
              data: {
                customerId: targetCustId,
                email: normalizedEmail,
                phone: dto.phone || existing?.phone || null,
                firstName: dto.firstName || existing?.firstName || 'Employee',
                lastName: dto.lastName || existing?.lastName || '',
                passwordHash,
                isActive: (dto.status || existing?.status || 'ACTIVE') === 'ACTIVE',
                isVerified: true,
              },
            });
          } else {
            await tx.user.update({
              where: { id: user.id },
              data: {
                customerId: targetCustId,
                isActive: (dto.status || existing?.status || 'ACTIVE') === 'ACTIVE',
                deletedAt: null,
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
          throw new NotFoundException({
            success: false,
            message: `Department #${numDeptId} not found`,
            error: 'DEPARTMENT_NOT_FOUND',
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
            },
          });
        }
        updateData.departmentId = dept.id;
      }

      if (dto.designationId !== undefined && dto.designationId !== null) {
        const numDesigId = Number(dto.designationId);
        const desig = await tx.designation.findFirst({
          where: { id: numDesigId, customerId: targetCustId },
        });
        if (!desig) {
          throw new BadRequestException(`Designation #${numDesigId} not found`);
        }
        updateData.designationId = desig.id;
      } else if (dto.designationName) {
        let desig = await tx.designation.findFirst({
          where: { customerId: targetCustId, name: dto.designationName },
        });
        if (!desig) {
          desig = await tx.designation.create({
            data: {
              customerId: targetCustId,
              name: dto.designationName,
              code: dto.designationName.substring(0, 4).toUpperCase(),
              departmentId: updateData.departmentId || existing?.departmentId || null,
            },
          });
        }
        updateData.designationId = desig.id;
      }

      if (dto.officeId !== undefined && dto.officeId !== null) {
        const numOfficeId = Number(dto.officeId);
        const office = await tx.branchGeofence.findFirst({
          where: { id: numOfficeId, customerId: targetCustId },
        });
        if (!office) {
          throw new BadRequestException(`Office #${numOfficeId} not found`);
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
          const shift = await tx.shift.findFirst({
            where: { id: numShiftId, customerId: targetCustId },
          });
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

  async remove(params: EmployeeFindOneParams) {
    const { id, customerId, isSuperAdmin } = params;
    const existing = await this.findOne({ id, customerId, isSuperAdmin });

    const numId = Number(existing.id);
    const userId = existing?.userId ? Number(existing.userId) : null;
    const empCustomerId = Number(existing.customerId);

    return this.prisma.$transaction(async (tx) => {
      // 1. Invalidate/delete all active authentication sessions, refresh tokens, and device tokens for linked user
      if (userId) {
        await tx.refreshToken.deleteMany({
          where: { userId },
        });

        await tx.session.deleteMany({
          where: { userId },
        });

        await tx.userDeviceToken.deleteMany({
          where: { userId },
        });
      }

      // 2. Unlink or delete all foreign key relations referencing this employee
      await tx.task.updateMany({
        where: { employeeId: numId },
        data: { employeeId: null },
      });

      await tx.work.updateMany({
        where: { assignedToId: numId },
        data: { assignedToId: null },
      });

      await tx.work.updateMany({
        where: { editorId: numId },
        data: { editorId: null },
      });

      await tx.workTask.updateMany({
        where: { assignedToId: numId },
        data: { assignedToId: null },
      });

      await tx.teamMember.deleteMany({
        where: { employeeId: numId },
      });

      await tx.visit.deleteMany({
        where: { employeeId: numId },
      });

      await tx.monthlySchedule.updateMany({
        where: { assignedEmployeeId: numId },
        data: { assignedEmployeeId: null },
      });

      await tx.employeeLocation.deleteMany({
        where: { employeeId: numId },
      });

      await tx.employeeClaim.deleteMany({
        where: { employeeId: numId },
      });

      await tx.employeeLoan.deleteMany({
        where: { employeeId: numId },
      });

      await tx.remoteRequest.deleteMany({
        where: { employeeId: numId },
      });

      await tx.salarySlip.deleteMany({
        where: { employeeId: numId },
      });

      await tx.salaryStructure.deleteMany({
        where: { employeeId: numId },
      });

      await tx.payrollItem.deleteMany({
        where: { employeeId: numId },
      });

      await tx.leaveAdjustmentHistory.deleteMany({
        where: { employeeId: numId },
      });

      await tx.employeeLeaveBalance.deleteMany({
        where: { employeeId: numId },
      });

      await tx.leaveRequest.deleteMany({
        where: { employeeId: numId },
      });

      await tx.attendance.deleteMany({
        where: { employeeId: numId },
      });

      // 3. Record deletion in AuditLog to permanently reserve the employeeCode in audit history
      if (tx.auditLog) {
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
        }).catch(() => null);
      }

      // 4. Delete the Employee record completely from the database
      await tx.employee.delete({
        where: { id: numId },
      });

      // 5. User safety check & deletion/deactivation
      if (userId) {
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
          // Exclusively employee user -> delete user roles & user record
          await tx.userRole.deleteMany({ where: { userId } });
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

  async getLeaves(customerId?: number | string, isSuperAdmin = false) {
    const where: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for leaves access');
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

  async getRemoteRequests(customerId?: number | string, isSuperAdmin = false) {
    const where: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for remote requests access');
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
      where.employee = { branch: options.branch };
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

    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: {
          employee: true,
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
          id: b.id,
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

      return {
        id: String(a.id),
        customerId: a.customerId,
        employeeName: a.employee ? `${a.employee.firstName} ${a.employee.lastName}`.trim() : 'Employee',
        employeeId: a.employee?.employeeCode || `EMP-${a.employeeId}`,
        branch: a.employee?.branch || 'Head Office',
        office: a.employee?.branch || 'Head Office',
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
}
