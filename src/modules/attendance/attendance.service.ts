import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PunchAttendanceDto } from './dto/punch.dto';
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

    return employee;
  }

  private async resolveOfficeForEmployee(employee: any) {
    const activeOffices = await this.prisma.branchGeofence.findMany({
      where: { customerId: employee.customerId, isActive: true },
      select: {
        id: true,
        name: true,
        city: true,
        latitude: true,
        longitude: true,
        radiusMeters: true,
        isActive: true,
      },
    });

    console.log('[ATTENDANCE_DEBUG]', {
      employeeId: employee.id,
      organizationId: employee.customerId,
      branchId: employee.branch || null,
      officeLocationId: employee.officeId || (employee.office ? employee.office.id : null),
      activeOfficeLocations: activeOffices,
    });

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

    // If still no office location configured for customer, auto-provision default Head Office for active customer
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
            radiusMeters: 500.0,
            isActive: true,
          },
        });
        console.log(`[ATTENDANCE_DEBUG] Auto-provisioned default Head Office for Customer ID: ${customer.id}`);
        // Link to employee
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

    // Validate latitude, longitude, and radius
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

    let distanceMeters = 0;
    const allowedRadius = office.radiusMeters || 200.0;
    let locationInStr = `${office.name}`;

    if (policy.gpsRequired && (dto.latitude !== undefined && dto.longitude !== undefined && !isNaN(dto.latitude) && !isNaN(dto.longitude))) {
      distanceMeters = calculateDistanceMeters(
        dto.latitude,
        dto.longitude,
        office.latitude,
        office.longitude,
      );
      locationInStr = `${office.name} (${distanceMeters}m)`;
    }

    // GEO-FENCE VALIDATION
    if (policy.officeAttendanceRequired && !approvedRemote && !policy.allowOutsideCheckIn) {
      if (dto.latitude === undefined || dto.longitude === undefined || isNaN(dto.latitude) || isNaN(dto.longitude)) {
        throw new BadRequestException('Valid GPS coordinates are required for attendance check-in.');
      }
      if (distanceMeters > allowedRadius) {
        throw new BadRequestException(
          `You are outside your assigned office attendance area. Current distance: ${distanceMeters}m (Allowed radius: ${allowedRadius}m for ${office.name}).`,
        );
      }
    } else if (approvedRemote) {
      locationInStr = `Remote Work (${approvedRemote.reason || 'Approved Remote Duty'})`;
    }

    // Determine Status based on Policy Start Time and Grace Period
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

      if (attendance && attendance.punchIn && !attendance.punchOut && !policy.multiplePunchInAllowed) {
        throw new BadRequestException(
          `You are already punched in for today at ${attendance.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        );
      }

      if (attendance) {
        attendance = await tx.attendance.update({
          where: { id: attendance.id },
          data: {
            punchIn: now,
            status: attendanceStatus,
            officeId: office.id,
            latitude: dto.latitude ?? null,
            longitude: dto.longitude ?? null,
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
            latitude: dto.latitude ?? null,
            longitude: dto.longitude ?? null,
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

    const approvedRemote = await this.prisma.remoteRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        fromDate: { lte: todayEnd },
        toDate: { gte: todayStart },
      },
    });

    let distanceMeters = 0;
    const allowedRadius = office.radiusMeters || 200.0;
    let locationOutStr = `${office.name}`;

    if (policy.gpsRequired && (dto.latitude !== undefined && dto.longitude !== undefined && !isNaN(dto.latitude) && !isNaN(dto.longitude))) {
      distanceMeters = calculateDistanceMeters(
        dto.latitude,
        dto.longitude,
        office.latitude,
        office.longitude,
      );
      locationOutStr = `${office.name} (${distanceMeters}m)`;
    }

    if (policy.officeAttendanceRequired && !approvedRemote && !policy.allowOutsideCheckOut) {
      if (dto.latitude !== undefined && dto.longitude !== undefined && distanceMeters > allowedRadius) {
        throw new BadRequestException(
          `You are outside your assigned office attendance area for Check-Out. Current distance: ${distanceMeters}m (Allowed radius: ${allowedRadius}m for ${office.name}).`,
        );
      }
    } else if (approvedRemote) {
      locationOutStr = `Remote Work (${approvedRemote.reason || 'Approved Remote Duty'})`;
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
        throw new BadRequestException('Cannot punch out without an active punch-in for today.');
      }

      if (attendance.punchOut) {
        throw new BadRequestException('You have already punched out for today.');
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

      let actualWorkingHours = totalElapsedHours;
      if (policy.breakType === 'UNPAID') {
        actualWorkingHours = Math.max(0, totalElapsedHours - totalBreakHours);
      }
      actualWorkingHours = Math.round(actualWorkingHours * 100) / 100;

      // Check Early Checkout vs Minimum Working Hours & Grace
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
        },
      });

      return {
        success: true,
        message: `Punch Out successful. Total working hours: ${actualWorkingHours} hrs (Breaks: ${totalBreakHours} hrs).`,
        data: updated,
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

      // Check if already on break
      const activeBreak = attendance.breaks.find((b) => !b.breakEnd);
      if (activeBreak) {
        throw new BadRequestException(
          `You are already on an active break started at ${activeBreak.breakStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        );
      }

      // Check max breaks count
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
    const policy = await this.getActiveAttendancePolicy(employee.customerId, office.id);

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

      // Recalculate total break duration for attendance
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
