import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

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
        designation: e.designation?.name || 'Staff',
        department: e.department?.name || 'General',
        branch: e.branch || 'Head Office',
        office: e.branch || 'Head Office',
        status: e.status,
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
      branch: employee.branch || 'Head Office',
      office: employee.branch || 'Head Office',
      department: employee.department?.name || 'Media & Production',
      designation: employee.designation?.name || 'Specialist',
      status: employee.status,
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
      if (isNaN(numCustomerId)) throw new BadRequestException('Invalid customerId');
      whereCust.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('customerId is required');
    }

    const [branches, employeeBranches] = await Promise.all([
      this.prisma.branchGeofence.findMany({
        where: { ...whereCust, isActive: true },
        select: { id: true, name: true, city: true },
      }),
      this.prisma.employee.findMany({
        where: whereCust,
        select: { branch: true },
        distinct: ['branch'],
      }),
    ]);

    const set = new Set<string>();
    branches.forEach((b) => set.add(b.name));
    employeeBranches.forEach((e) => {
      if (e.branch && e.branch.trim().length > 0) set.add(e.branch.trim());
    });

    if (set.size === 0) {
      set.add('Head Office');
    }

    return Array.from(set).map((name, idx) => ({
      id: idx + 1,
      name,
    }));
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

  async create(params: CreateEmployeeParams) {
    const { customerId, dto } = params;
    const numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new BadRequestException('Valid customerId is required');
    }

    if (this.planAccessService) {
      await this.planAccessService.checkUserLimit(numCustomerId);
    }

    let department = await this.prisma.department.findFirst({
      where: { customerId: numCustomerId, name: dto.departmentName || 'Media & Production' },
    });
    if (!department) {
      department = await this.prisma.department.create({
        data: {
          customerId: numCustomerId,
          name: dto.departmentName || 'Media & Production',
          code: (dto.departmentName || 'MED').substring(0, 4).toUpperCase(),
        },
      });
    }

    let designation = await this.prisma.designation.findFirst({
      where: { customerId: numCustomerId, name: dto.designationName || 'Photographer' },
    });
    if (!designation) {
      designation = await this.prisma.designation.create({
        data: {
          customerId: numCustomerId,
          name: dto.designationName || 'Photographer',
          code: (dto.designationName || 'PHT').substring(0, 4).toUpperCase(),
          departmentId: department.id,
        },
      });
    }

    const empData: any = {
      customerId: numCustomerId,
      employeeCode: dto.employeeCode,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      branch: dto.branch || 'Head Office',
      departmentId: department.id,
      designationId: designation.id,
      employmentType: dto.employmentType || 'FULL_TIME',
      gender: dto.gender || null,
      dob: dto.dob ? new Date(dto.dob) : null,
      joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : new Date(),
      address: dto.address || null,
      documents: dto.documents || null,
      bankDetails: dto.bankDetails || null,
      emergencyContact: typeof dto.emergencyContact === 'object' ? JSON.stringify(dto.emergencyContact) : (dto.emergencyContact || null),
      managerId: dto.managerId ? Number(dto.managerId) : null,
      status: dto.status || 'ACTIVE',
    };

    return this.prisma.employee.create({
      data: empData,
      include: {
        department: true,
        designation: true,
      },
    });
  }

  async update(params: UpdateEmployeeParams) {
    const { id, customerId, isSuperAdmin, dto } = params;
    await this.findOne({ id, customerId, isSuperAdmin });

    const numId = Number(id);
    const existing = await this.prisma.employee.findUnique({ where: { id: numId } });
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
    if (dto.joiningDate !== undefined) updateData.joiningDate = dto.joiningDate ? new Date(dto.joiningDate) : undefined;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.documents !== undefined) updateData.documents = dto.documents;
    if (dto.bankDetails !== undefined) updateData.bankDetails = dto.bankDetails;
    if (dto.emergencyContact !== undefined) {
      updateData.emergencyContact = typeof dto.emergencyContact === 'object' ? JSON.stringify(dto.emergencyContact) : dto.emergencyContact;
    }
    if (dto.managerId !== undefined) updateData.managerId = dto.managerId ? Number(dto.managerId) : null;

    if (dto.departmentName) {
      let dept = await this.prisma.department.findFirst({
        where: { customerId: targetCustId, name: dto.departmentName },
      });
      if (!dept) {
        dept = await this.prisma.department.create({
          data: {
            customerId: targetCustId,
            name: dto.departmentName,
            code: dto.departmentName.substring(0, 4).toUpperCase(),
          },
        });
      }
      updateData.departmentId = dept.id;
    }

    if (dto.designationName) {
      let desig = await this.prisma.designation.findFirst({
        where: { customerId: targetCustId, name: dto.designationName },
      });
      if (!desig) {
        desig = await this.prisma.designation.create({
          data: {
            customerId: targetCustId,
            name: dto.designationName,
            code: dto.designationName.substring(0, 4).toUpperCase(),
          },
        });
      }
      updateData.designationId = desig.id;
    }

    return this.prisma.employee.update({
      where: { id: numId },
      data: updateData,
      include: {
        department: true,
        designation: true,
      },
    });
  }

  async remove(params: EmployeeFindOneParams) {
    const { id, customerId, isSuperAdmin } = params;
    await this.findOne({ id, customerId, isSuperAdmin });

    const numId = Number(id);
    return this.prisma.employee.update({
      where: { id: numId },
      data: { status: 'INACTIVE' },
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
