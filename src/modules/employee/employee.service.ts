import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { RoleType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

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
    if (branch && branch !== 'ALL') where.branch = branch;
    if (department && department !== 'ALL') where.department = { name: department };
    if (designation && designation !== 'ALL') where.designation = { name: designation };
    if (employmentType && employmentType !== 'ALL') where.employmentType = employmentType;

    if (search && search.trim().length > 0) {
      const trimmedSearch = search.trim();
      where.OR = [
        { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
        { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
        { email: { contains: trimmedSearch, mode: 'insensitive' } },
        { employeeCode: { contains: trimmedSearch, mode: 'insensitive' } },
        { branch: { contains: trimmedSearch, mode: 'insensitive' } },
      ];
    }

    // Determine target date window (midnight to 23:59:59)
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          department: true,
          designation: true,
          office: true,
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

    return {
      items: finalItems,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(params: EmployeeFindOneParams) {
    const { id, customerId, isSuperAdmin } = params;
    const numId = Number(id);
    if (isNaN(numId)) {
      throw new BadRequestException('Invalid employee ID');
    }

    const where: any = { id: numId };

    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) {
        throw new BadRequestException('Invalid customerId provided');
      }
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for employee access');
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const employee = await this.prisma.employee.findFirst({
      where,
      include: {
        department: true,
        designation: true,
        office: true,
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
      throw new NotFoundException(`Employee with ID ${id} not found`);
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
      employeeId: employee.employeeCode,
      name: `${employee.firstName} ${employee.lastName}`,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone || '+91 98765 43210',
      officeId: employee.officeId || null,
      officeObj: employee.office,
      branch: employee.office?.name || employee.branch || 'Head Office',
      office: employee.office?.name || employee.branch || 'Head Office',
      departmentId: employee.departmentId,
      designationId: employee.designationId,
      department: employee.department?.name || 'Media & Production',
      departmentName: employee.department?.name || 'Media & Production',
      departmentObj: employee.department,
      designation: employee.designation?.name || 'Specialist',
      designationName: employee.designation?.name || 'Specialist',
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
    const todayStart = new Date(targetDate);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(targetDate);
    todayEnd.setHours(23, 59, 59, 999);

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
          punchInStr = att.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (att.punchOut) {
          punchOutStr = att.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
            breakStartStr = activeBreak.breakStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          } else {
            status = att.status === 'LATE' ? 'LATE' : (att.status === 'HALF_DAY' ? 'HALF_DAY' : 'PRESENT');
            if (att.status === 'LATE') lateCount++;
            presentCount++;
            oStat.present++;
          }
        }

        const totalBreakMins = att.breaks.reduce((acc, b) => acc + (b.duration || 0), 0);
        breakDurationMinutes = Math.round(totalBreakMins);
        const hours = Math.floor(att.workingHours || 0);
        const mins = Math.round(((att.workingHours || 0) - hours) * 60);
        totalWorkingHours = `${hours}h ${mins}m`;
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
        punchInTime: punchInStr,
        punchOutTime: punchOutStr,
        breakStartTime: breakStartStr,
        breakDuration: `${breakDurationMinutes}m`,
        totalWorkingHours,
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
   * Format: QB0001, QB0002, ..., QB0099, QB0100
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

    const defaultPrefix = process.env.EMPLOYEE_ID_PREFIX || 'QB';
    const cleanPrefix = (prefix || defaultPrefix).toUpperCase();

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

    let maxNum = 0;
    const regex = new RegExp(`^${cleanPrefix}(\\d+)$`, 'i');

    for (const emp of existingEmployees) {
      const match = emp.employeeCode.match(regex);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }

    // Determine the next number and pad to at least 4 digits
    let candidateNum = maxNum + 1;
    let candidateCode = `${cleanPrefix}${String(candidateNum).padStart(4, '0')}`;

    // Ensure candidate code does not exist in case of non-sequential manual IDs
    const existingCodeSet = new Set(existingEmployees.map((e: any) => e.employeeCode.toUpperCase()));
    while (existingCodeSet.has(candidateCode.toUpperCase())) {
      candidateNum++;
      candidateCode = `${cleanPrefix}${String(candidateNum).padStart(4, '0')}`;
    }

    return { nextEmployeeId: candidateCode, prefix: cleanPrefix };
  }

  async create(params: CreateEmployeeParams) {
    const { customerId, dto } = params;
    const numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new BadRequestException('Valid customerId is required');
    }

    if (this.planAccessService) {
      await this.planAccessService.checkUserLimit(numCustomerId);
    }

    // Execute complete creation inside a single atomic database transaction
    return this.prisma.$transaction(async (tx) => {
      // Handle Auto Employee ID Generation or manual validation
      let finalEmployeeCode = dto.employeeCode ? dto.employeeCode.trim() : '';
      const isAutoGenerate = !finalEmployeeCode || dto.autoGenerateCode === true;
      const defaultPrefix = process.env.EMPLOYEE_ID_PREFIX || 'QB';

      if (isAutoGenerate) {
        const { nextEmployeeId } = await this.getNextEmployeeCode(numCustomerId, defaultPrefix, tx);
        finalEmployeeCode = nextEmployeeId;
      } else {
        // Validate uniqueness for manual entry
        const existing = await tx.employee.findFirst({
          where: {
            customerId: numCustomerId,
            employeeCode: finalEmployeeCode,
          },
        });
        if (existing) {
          throw new ConflictException(
            `Employee ID "${finalEmployeeCode}" is already assigned to another employee.`,
          );
        }
      }

      // Department resolution
      let department: any = null;
      if (dto.departmentId) {
        department = await tx.department.findFirst({
          where: { id: Number(dto.departmentId), customerId: numCustomerId },
        });
        if (!department) {
          throw new BadRequestException(`Department #${dto.departmentId} not found`);
        }
      } else if (dto.departmentName) {
        department = await tx.department.findFirst({
          where: { customerId: numCustomerId, name: dto.departmentName },
        });
        if (!department) {
          department = await tx.department.create({
            data: {
              customerId: numCustomerId,
              name: dto.departmentName,
              code: (dto.departmentName || 'MED').substring(0, 4).toUpperCase(),
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
        // If user exists and new password was specifically provided, update password
        const updateUserData: any = {
          isActive: (dto.status || 'ACTIVE') === 'ACTIVE',
        };
        if (dto.password?.trim()) {
          updateUserData.passwordHash = passwordHash;
        }
        user = await tx.user.update({
          where: { id: user.id },
          data: updateUserData,
        });
      }

      // Assign Employee mobile role
      let employeeRole = await tx.role.findFirst({
        where: {
          OR: [
            { customerId: numCustomerId, name: 'Employee' },
            { customerId: numCustomerId, type: RoleType.CUSTOM },
            { customerId: null, name: 'Employee' },
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

      const empData: any = {
        customerId: numCustomerId,
        userId: user.id,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: normalizedEmail,
        phone: dto.phone,
        officeId,
        branch: branchName,
        departmentId: department.id,
        designationId: designation.id,
        employmentType: dto.employmentType || 'FULL_TIME',
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

      const createdEmployee = await tx.employee.create({
        data: {
          ...empData,
          employeeCode: finalEmployeeCode,
        },
        include: {
          department: true,
          designation: true,
          office: true,
        },
      });

      return createdEmployee;
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
      if (dto.firstName !== undefined) updateData.firstName = dto.firstName;
      if (dto.lastName !== undefined) updateData.lastName = dto.lastName;
      if (dto.email !== undefined) updateData.email = dto.email;
      if (dto.phone !== undefined) updateData.phone = dto.phone;
      if (dto.branch !== undefined) updateData.branch = dto.branch;
      if (dto.status !== undefined) updateData.status = dto.status;
      if (dto.employmentType !== undefined) updateData.employmentType = dto.employmentType;
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
        }
        if (dto.password && dto.password.trim().length > 0) {
          userUpdate.passwordHash = await bcrypt.hash(dto.password.trim(), 10);
        }
        if (dto.firstName !== undefined) userUpdate.firstName = dto.firstName;
        if (dto.lastName !== undefined) userUpdate.lastName = dto.lastName;
        if (dto.phone !== undefined) userUpdate.phone = dto.phone;

        if (Object.keys(userUpdate).length > 0) {
          await tx.user
            .update({
              where: { id: existing.userId },
              data: userUpdate,
            })
            .catch(() => null);
        }
      }

      if (dto.departmentId !== undefined && dto.departmentId !== null) {
        const numDeptId = Number(dto.departmentId);
        const dept = await tx.department.findFirst({
          where: { id: numDeptId, customerId: targetCustId },
        });
        if (!dept) {
          throw new BadRequestException(`Department #${numDeptId} not found`);
        }
        updateData.departmentId = dept.id;
      } else if (dto.departmentName) {
        let dept = await tx.department.findFirst({
          where: { customerId: targetCustId, name: dto.departmentName },
        });
        if (!dept) {
          dept = await tx.department.create({
            data: {
              customerId: targetCustId,
              name: dto.departmentName,
              code: dto.departmentName.substring(0, 4).toUpperCase(),
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

      return tx.employee.update({
        where: { id: numId },
        data: updateData,
        include: {
          department: true,
          designation: true,
          office: true,
        },
      });
    });
  }

  async remove(params: EmployeeFindOneParams) {
    const { id, customerId, isSuperAdmin } = params;
    await this.findOne({ id, customerId, isSuperAdmin });

    const numId = Number(id);
    try {
      return await this.prisma.employee.delete({
        where: { id: numId },
      });
    } catch {
      return await this.prisma.employee.update({
        where: { id: numId },
        data: { status: 'INACTIVE' },
      });
    }
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
      employeeName: r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : 'Employee',
      employeeId: r.employee?.employeeCode || 'EMP-001',
      requestType: 'WORK_FROM_HOME',
      date: r.fromDate ? r.fromDate.toISOString().split('T')[0] : '2026-08-21',
      reason: r.reason || 'Remote work request',
      status: r.status,
      appliedOn: r.createdAt ? r.createdAt.toISOString().split('T')[0] : '2026-08-15',
    }));
  }

  async getAttendance(
    customerId?: number | string,
    isSuperAdmin = false,
    options?: { date?: string; branch?: string },
  ) {
    const where: any = {};
    if (customerId !== undefined && customerId !== null) {
      const numCustomerId = Number(customerId);
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required for attendance access');
    }

    if (options?.date) {
      const d = new Date(options.date);
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }

    if (options?.branch && options.branch !== 'ALL') {
      where.employee = { branch: options.branch };
    }

    const records = await this.prisma.attendance.findMany({
      where,
      include: {
        employee: true,
        breaks: { orderBy: { breakStart: 'asc' } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    });

    return records.map((a) => {
      const breakMins = a.breaks.reduce((acc, b) => acc + (b.duration || 0), 0);
      const hours = Math.floor(a.workingHours || 0);
      const mins = Math.round(((a.workingHours || 0) - hours) * 60);

      return {
        id: String(a.id),
        customerId: a.customerId,
        employeeName: a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : 'Employee',
        employeeId: a.employee?.employeeCode || 'EMP-001',
        branch: a.employee?.branch || 'Head Office',
        office: a.employee?.branch || 'Head Office',
        date: a.date ? a.date.toISOString().split('T')[0] : '2026-08-21',
        punchIn: a.punchIn ? a.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
        punchOut: a.punchOut ? a.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (a.punchIn ? 'Not Checked Out' : '—'),
        workingHours: `${hours}h ${mins}m`,
        breaksCount: a.breaks.length,
        totalBreak: `${Math.round(breakMins)} min`,
        status: a.status,
        location: a.locationIn || 'Office GPS',
      };
    });
  }
}
