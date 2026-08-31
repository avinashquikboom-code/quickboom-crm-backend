import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PunchAttendanceDto, QueryAttendanceHistoryDto } from './dto/punch.dto';
import { AttendanceStatus } from '@prisma/client';

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  private async getAuthenticatedEmployee(user: any, customerId?: number | string) {
    if (!user) {
      throw new ForbiddenException('Authenticated user context required');
    }

    let employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user.id },
          { email: { equals: user.email?.trim().toLowerCase(), mode: 'insensitive' } },
        ],
      },
      include: {
        office: true,
        department: true,
        designation: true,
      },
    });

    if (!employee && customerId) {
      const numCustomerId = Number(customerId);
      if (!isNaN(numCustomerId)) {
        employee = await this.prisma.employee.findFirst({
          where: { customerId: numCustomerId, status: 'ACTIVE' },
          include: { office: true, department: true, designation: true },
        });
      }
    }

    if (!employee) {
      throw new NotFoundException('No active employee profile linked to your user account.');
    }

    if (employee.status && employee.status.toUpperCase() === 'INACTIVE') {
      throw new ForbiddenException('Employee profile is inactive.');
    }

    return employee;
  }

  async resolveOfficeForEmployee(employee: any) {
    let selectedOffice: any = null;

    if (employee.office && employee.office.isActive) {
      selectedOffice = employee.office;
    } else if (employee.officeId) {
      const office = await this.prisma.branchGeofence.findUnique({
        where: { id: employee.officeId },
      });
      if (office && office.isActive) {
        selectedOffice = office;
      }
    }

    if (!selectedOffice && employee.branch) {
      const office = await this.prisma.branchGeofence.findFirst({
        where: {
          customerId: employee.customerId,
          name: { equals: employee.branch.trim(), mode: 'insensitive' },
          isActive: true,
        },
      });
      if (office) selectedOffice = office;
    }

    if (!selectedOffice) {
      const defaultOffice = await this.prisma.branchGeofence.findFirst({
        where: { customerId: employee.customerId, isActive: true },
        orderBy: { id: 'asc' },
      });
      if (defaultOffice) selectedOffice = defaultOffice;
    }

    // Auto-provision default Head Office if active customer exists with no office yet
    if (!selectedOffice) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: employee.customerId },
      });

      if (customer && customer.isActive) {
        selectedOffice = await this.prisma.branchGeofence.create({
          data: {
            customerId: customer.id,
            name: 'Head Office',
            city: 'Mumbai',
            latitude: 19.0760,
            longitude: 72.8777,
            radiusMeters: 200.0,
            isActive: true,
          },
        });
        await this.prisma.employee.update({
          where: { id: employee.id },
          data: { officeId: selectedOffice.id, branch: selectedOffice.name },
        });
      }
    }

    if (!selectedOffice) {
      throw new BadRequestException(
        'No active office location configured for your organization. Please contact Admin.',
      );
    }

    if (
      isNaN(selectedOffice.latitude) ||
      isNaN(selectedOffice.longitude) ||
      selectedOffice.latitude < -90 ||
      selectedOffice.latitude > 90 ||
      selectedOffice.longitude < -180 ||
      selectedOffice.longitude > 180
    ) {
      throw new BadRequestException(
        `Invalid GPS coordinates (${selectedOffice.latitude}, ${selectedOffice.longitude}) configured for office "${selectedOffice.name}". Coordinates must be valid latitude (-90 to 90) and longitude (-180 to 180). Please contact Admin.`,
      );
    }

    if (!selectedOffice.radiusMeters || selectedOffice.radiusMeters <= 0) {
      throw new BadRequestException(
        `Invalid attendance radius (${selectedOffice.radiusMeters}m) configured for office "${selectedOffice.name}". Radius must be greater than 0 meters. Please contact Admin.`,
      );
    }

    return selectedOffice;
  }

  private async getActiveAttendancePolicy(customerId: number, officeId?: number | null) {
    if (officeId) {
      const officePolicy = await this.prisma.attendancePolicy.findFirst({
        where: { customerId, officeId, isActive: true },
      });
      if (officePolicy) return officePolicy;
    }

    const customerPolicy = await this.prisma.attendancePolicy.findFirst({
      where: { customerId, officeId: null, isActive: true },
    });
    if (customerPolicy) return customerPolicy;

    return {
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
      minWorkingHoursForHalfDay: 4.0,
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
      allowOutsideCheckIn: false,
      allowOutsideCheckOut: false,
    };
  }

  async checkIn(user: any, customerId: number | string | undefined, dto: PunchAttendanceDto) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);
    const policy = await this.getActiveAttendancePolicy(employee.customerId, office.id);

    // Validate GPS inputs
    if (
      dto.latitude === undefined ||
      dto.longitude === undefined ||
      isNaN(dto.latitude) ||
      isNaN(dto.longitude) ||
      dto.latitude < -90 ||
      dto.latitude > 90 ||
      dto.longitude < -180 ||
      dto.longitude > 180
    ) {
      throw new BadRequestException('Valid GPS latitude (-90 to 90) and longitude (-180 to 180) are required.');
    }

    if (dto.latitude === 0 && dto.longitude === 0 && (office.latitude !== 0 || office.longitude !== 0)) {
      throw new BadRequestException('Invalid GPS coordinates (0, 0). Please enable GPS and try again.');
    }

    if (dto.accuracy !== undefined && (isNaN(dto.accuracy) || dto.accuracy <= 0)) {
      throw new BadRequestException('GPS accuracy must be a positive number.');
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const now = new Date();

    // Check if employee has approved remote work for today
    const approvedRemote = await this.prisma.remoteRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        fromDate: { lte: todayEnd },
        toDate: { gte: todayStart },
      },
    });

    const distanceMeters = calculateDistanceMeters(
      dto.latitude,
      dto.longitude,
      office.latitude,
      office.longitude,
    );
    const allowedRadius = office.radiusMeters || 200.0;
    let locationInStr = `${office.name} (${distanceMeters}m)`;

    // GEOFENCE VALIDATION
    if (!approvedRemote && distanceMeters > allowedRadius) {
      console.log(`[ATTENDANCE]
employeeId: ${employee.id}
branchId: ${office.id}
action: PUNCH_IN
distanceMeters: ${distanceMeters}
allowedRadiusMeters: ${allowedRadius}
result: REJECTED`);

      console.log(`[ATTENDANCE_DEBUG]
authenticatedUserId: ${user.id}
employeeId: ${employee.id}
customerId: ${employee.customerId}
branchId: ${office.id}
officeLatitude: ${office.latitude}
officeLongitude: ${office.longitude}
allowedRadiusMeters: ${allowedRadius}
employeeLatitude: ${dto.latitude}
employeeLongitude: ${dto.longitude}
gpsAccuracy: ${dto.accuracy ?? 'N/A'}
distanceMeters: ${distanceMeters}
result: REJECTED`);

      throw new ForbiddenException({
        statusCode: 403,
        success: false,
        message: 'You are outside the allowed office radius',
        data: {
          distanceMeters,
          allowedRadiusMeters: allowedRadius,
          officeName: office.name,
        },
      });
    }

    console.log(`[ATTENDANCE]
employeeId: ${employee.id}
branchId: ${office.id}
action: PUNCH_IN
distanceMeters: ${distanceMeters}
allowedRadiusMeters: ${allowedRadius}
result: ALLOWED`);

    console.log(`[ATTENDANCE_DEBUG]
authenticatedUserId: ${user.id}
employeeId: ${employee.id}
customerId: ${employee.customerId}
branchId: ${office.id}
officeLatitude: ${office.latitude}
officeLongitude: ${office.longitude}
allowedRadiusMeters: ${allowedRadius}
employeeLatitude: ${dto.latitude}
employeeLongitude: ${dto.longitude}
gpsAccuracy: ${dto.accuracy ?? 'N/A'}
distanceMeters: ${distanceMeters}
result: ALLOWED`);

    if (approvedRemote) {
      locationInStr = `Remote Work (${approvedRemote.reason || 'Approved Remote Duty'})`;
    }

    // Determine status based on Policy
    let attendanceStatus: AttendanceStatus = AttendanceStatus.PRESENT;
    try {
      const [startHour, startMin] = (policy.officeStartTime || '09:30').split(':').map(Number);
      const scheduledStartTime = new Date(now);
      scheduledStartTime.setHours(startHour || 9, startMin || 30, 0, 0);

      const graceMinutes = policy.gracePeriodMinutes || 15;
      const lateThresholdMinutes = policy.lateArrivalThresholdMins || 30;

      const graceLimit = new Date(scheduledStartTime.getTime() + graceMinutes * 60 * 1000);
      const lateLimit = new Date(scheduledStartTime.getTime() + lateThresholdMinutes * 60 * 1000);

      if (now > graceLimit) {
        if (now > lateLimit && policy.lateRuleAction === 'HALF_DAY') {
          attendanceStatus = AttendanceStatus.HALF_DAY;
        } else {
          attendanceStatus = AttendanceStatus.LATE;
        }
      }
    } catch {
      attendanceStatus = AttendanceStatus.PRESENT;
    }

    return this.prisma.$transaction(async (tx) => {
      let attendance = await tx.attendance.findFirst({
        where: {
          employeeId: employee.id,
          date: { gte: todayStart, lte: todayEnd },
        },
      });

      if (attendance && attendance.punchIn && !attendance.punchOut) {
        throw new ConflictException({
          statusCode: 409,
          success: false,
          message: 'You are already punched in',
        });
      }

      if (attendance) {
        attendance = await tx.attendance.update({
          where: { id: attendance.id },
          data: {
            punchIn: now,
            punchOut: null,
            status: attendanceStatus,
            officeId: office.id,
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracy: dto.accuracy ?? null,
            distanceFromOffice: distanceMeters,
            locationIn: locationInStr,
          },
        });
      } else {
        attendance = await tx.attendance.create({
          data: {
            customerId: employee.customerId,
            employeeId: employee.id,
            date: now,
            punchIn: now,
            status: attendanceStatus,
            officeId: office.id,
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracy: dto.accuracy ?? null,
            distanceFromOffice: distanceMeters,
            locationIn: locationInStr,
          },
        });
      }

      return {
        success: true,
        message: `Punch In successful${approvedRemote ? ' (Remote Work Mode)' : ` at ${office.name}`}. Status: ${attendanceStatus}.`,
        data: attendance,
        status: attendanceStatus,
        office: {
          id: office.id,
          name: office.name,
          city: office.city,
          distanceMeters,
          allowedRadius,
        },
      };
    });
  }

  async checkOut(user: any, customerId: number | string | undefined, dto: PunchAttendanceDto) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);
    const policy = await this.getActiveAttendancePolicy(employee.customerId, office.id);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const now = new Date();

    let distanceMeters = 0;
    const allowedRadius = office.radiusMeters || 200.0;
    let locationOutStr = `${office.name}`;

    if (dto.latitude !== undefined && dto.longitude !== undefined && !isNaN(dto.latitude) && !isNaN(dto.longitude)) {
      distanceMeters = calculateDistanceMeters(
        dto.latitude,
        dto.longitude,
        office.latitude,
        office.longitude,
      );
      locationOutStr = `${office.name} (${distanceMeters}m)`;
    }

    return this.prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.findFirst({
        where: {
          employeeId: employee.id,
          date: { gte: todayStart, lte: todayEnd },
        },
        include: {
          breaks: true,
        },
      });

      if (!attendance || !attendance.punchIn) {
        throw new NotFoundException({
          statusCode: 404,
          success: false,
          message: 'No active punch-in found',
        });
      }

      if (attendance.punchOut) {
        throw new ConflictException({
          statusCode: 409,
          success: false,
          message: 'Already punched out',
        });
      }

      // Check if there is an active break currently running
      const activeBreak = attendance.breaks.find((b) => !b.breakEnd);
      if (activeBreak) {
        throw new BadRequestException(
          'You have an active break in progress. Please end your break before punching out.',
        );
      }

      // Calculate total break duration in hours
      const totalBreakMinutes = attendance.breaks.reduce(
        (sum, b) => sum + (b.duration || 0),
        0,
      );
      const totalBreakHours = Math.round((totalBreakMinutes / 60) * 100) / 100;

      // Calculate working hours
      const totalElapsedMs = now.getTime() - new Date(attendance.punchIn).getTime();
      const totalElapsedHours = Math.max(0, totalElapsedMs / (1000 * 60 * 60));
      const totalElapsedMinutes = Math.max(0, Math.round(totalElapsedMs / (1000 * 60)));

      let actualWorkingHours = totalElapsedHours;
      if (policy.breakType === 'UNPAID') {
        actualWorkingHours = Math.max(0, totalElapsedHours - totalBreakHours);
      }
      actualWorkingHours = Math.round(actualWorkingHours * 100) / 100;

      const minRequiredHours = policy.minWorkingHours || 8.0;
      const earlyGraceHours = (policy.earlyCheckoutGraceMinutes || 15) / 60;
      let finalStatus = attendance.status;

      if (actualWorkingHours < minRequiredHours - earlyGraceHours) {
        if (policy.earlyCheckoutAction === 'HALF_DAY' || actualWorkingHours < (policy.minWorkingHoursForHalfDay || 4.0)) {
          finalStatus = AttendanceStatus.HALF_DAY;
        }
      }

      const updated = await tx.attendance.update({
        where: { id: attendance.id },
        data: {
          punchOut: now,
          workingHours: actualWorkingHours,
          breakDuration: totalBreakHours,
          status: finalStatus,
          locationOut: locationOutStr,
          punchOutLatitude: dto.latitude ?? null,
          punchOutLongitude: dto.longitude ?? null,
          punchOutAccuracy: dto.accuracy ?? null,
        },
      });

      console.log(`[ATTENDANCE]
employeeId: ${employee.id}
branchId: ${office.id}
action: PUNCH_OUT
distanceMeters: ${distanceMeters}
workingMinutes: ${totalElapsedMinutes}
result: SUCCESS`);

      return {
        success: true,
        message: `Punch Out successful. Total working hours: ${actualWorkingHours} hrs (${totalElapsedMinutes} mins).`,
        data: {
          ...updated,
          workingMinutes: totalElapsedMinutes,
        },
        office: {
          id: office.id,
          name: office.name,
          city: office.city,
          distanceMeters,
          allowedRadius,
        },
      };
    });
  }

  async getTodayAttendance(user: any, customerId: number | string | undefined) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayAtt = await this.prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: todayStart, lte: todayEnd },
      },
      include: {
        breaks: true,
      },
    });

    const isPunchedIn = Boolean(todayAtt?.punchIn && !todayAtt?.punchOut);
    const isPunchedOut = Boolean(todayAtt?.punchIn && todayAtt?.punchOut);
    let workingMinutes = 0;

    if (todayAtt?.punchIn) {
      const endTime = todayAtt.punchOut ? new Date(todayAtt.punchOut) : new Date();
      const elapsedMs = endTime.getTime() - new Date(todayAtt.punchIn).getTime();
      workingMinutes = Math.max(0, Math.round(elapsedMs / (1000 * 60)));
    }

    const currentStatus = isPunchedIn
      ? 'PUNCHED_IN'
      : isPunchedOut
      ? 'PUNCHED_OUT'
      : 'NOT_MARKED';

    return {
      success: true,
      data: {
        date: new Date().toISOString().split('T')[0],
        status: currentStatus,
        punchInAt: todayAtt?.punchIn ? todayAtt.punchIn.toISOString() : null,
        punchOutAt: todayAtt?.punchOut ? todayAtt.punchOut.toISOString() : null,
        workingMinutes,
        workingHours: todayAtt?.workingHours || 0,
        isPunchedIn,
        rawStatus: todayAtt?.status || 'NOT_MARKED',
      },
    };
  }

  async getAttendanceHistory(
    user: any,
    customerId: number | string | undefined,
    query: QueryAttendanceHistoryDto,
  ) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const whereClause: any = {
      customerId: employee.customerId,
      employeeId: employee.id,
    };

    if (query.date) {
      const dStart = new Date(query.date);
      dStart.setHours(0, 0, 0, 0);
      const dEnd = new Date(query.date);
      dEnd.setHours(23, 59, 59, 999);
      whereClause.date = { gte: dStart, lte: dEnd };
    } else if (query.dateFrom || query.dateTo) {
      whereClause.date = {};
      if (query.dateFrom) {
        const from = new Date(query.dateFrom);
        from.setHours(0, 0, 0, 0);
        whereClause.date.gte = from;
      }
      if (query.dateTo) {
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        whereClause.date.lte = to;
      }
    }

    const [total, items] = await Promise.all([
      this.prisma.attendance.count({ where: whereClause }),
      this.prisma.attendance.findMany({
        where: whereClause,
        orderBy: { date: 'desc' },
        skip,
        take: limit,
        include: {
          office: {
            select: { id: true, name: true, city: true, radiusMeters: true },
          },
          breaks: true,
        },
      }),
    ]);

    return {
      success: true,
      data: items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async startBreak(user: any, customerId: number | string | undefined, dto?: any) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);
    const policy = await this.getActiveAttendancePolicy(employee.customerId, office.id);

    if (!policy.breakAllowed) {
      throw new BadRequestException('Employee breaks are disabled according to the active attendance policy.');
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.findFirst({
        where: {
          employeeId: employee.id,
          date: { gte: todayStart, lte: todayEnd },
        },
        include: {
          breaks: true,
        },
      });

      if (!attendance || !attendance.punchIn) {
        throw new BadRequestException('Cannot start a break without punching in first.');
      }

      if (attendance.punchOut) {
        throw new BadRequestException('Cannot start a break after punching out.');
      }

      const activeBreak = attendance.breaks.find((b) => !b.breakEnd);
      if (activeBreak) {
        throw new BadRequestException(
          `You are already on an active break started at ${activeBreak.breakStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        );
      }

      const completedBreaksCount = attendance.breaks.length;
      if (completedBreaksCount >= (policy.maxBreaksPerDay || 2)) {
        throw new BadRequestException(
          `Maximum allowed breaks reached for today (${policy.maxBreaksPerDay} max).`,
        );
      }

      const newBreak = await tx.attendanceBreak.create({
        data: {
          attendanceId: attendance.id,
          breakStart: now,
        },
      });

      return {
        success: true,
        message: `Break started at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        data: newBreak,
      };
    });
  }

  async endBreak(user: any, customerId: number | string | undefined, dto?: any) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.findFirst({
        where: {
          employeeId: employee.id,
          date: { gte: todayStart, lte: todayEnd },
        },
        include: {
          breaks: true,
        },
      });

      if (!attendance) {
        throw new BadRequestException('No active attendance record found for today.');
      }

      const activeBreak = attendance.breaks.find((b) => !b.breakEnd);
      if (!activeBreak) {
        throw new BadRequestException('No active break found to end.');
      }

      const durationMinutes = Math.max(
        1,
        Math.round((now.getTime() - new Date(activeBreak.breakStart).getTime()) / (1000 * 60)),
      );

      const updatedBreak = await tx.attendanceBreak.update({
        where: { id: activeBreak.id },
        data: {
          breakEnd: now,
          duration: durationMinutes,
        },
      });

      const allBreaks = await tx.attendanceBreak.findMany({
        where: { attendanceId: attendance.id, breakEnd: { not: null } },
      });
      const totalBreakMinutes = allBreaks.reduce((sum, b) => sum + (b.duration || 0), 0);
      const totalBreakHours = Math.round((totalBreakMinutes / 60) * 100) / 100;

      await tx.attendance.update({
        where: { id: attendance.id },
        data: {
          breakDuration: totalBreakHours,
        },
      });

      return {
        success: true,
        message: `Break ended. Duration: ${durationMinutes} minutes.`,
        data: updatedBreak,
      };
    });
  }

  async getMyAttendanceStatus(user: any, customerId: number | string | undefined) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayAtt = await this.prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: todayStart, lte: todayEnd },
      },
      include: {
        breaks: true,
      },
    });

    const isPunchedIn = Boolean(todayAtt?.punchIn && !todayAtt?.punchOut);
    const activeBreak = todayAtt?.breaks.find((b) => !b.breakEnd);

    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        name: `${employee.firstName} ${employee.lastName}`,
        email: employee.email,
        department: employee.department?.name || 'General',
        designation: employee.designation?.name || 'Staff',
      },
      assignedOffice: {
        id: office.id,
        name: office.name,
        city: office.city,
        latitude: office.latitude,
        longitude: office.longitude,
        radiusMeters: office.radiusMeters,
      },
      status: {
        isPunchedIn,
        isOnBreak: Boolean(activeBreak),
        activeBreakStart: activeBreak?.breakStart ? activeBreak.breakStart.toISOString() : null,
        punchInTime: todayAtt?.punchIn ? todayAtt.punchIn.toISOString() : null,
        punchOutTime: todayAtt?.punchOut ? todayAtt.punchOut.toISOString() : null,
        workingHours: todayAtt?.workingHours || 0,
        breakDuration: todayAtt?.breakDuration || 0,
        rawStatus: todayAtt?.status || 'NOT_MARKED',
      },
      todayAttendance: todayAtt,
    };
  }
}
