import {
  Injectable,
  Optional,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { evaluateLatePunch, dateToMinutesInIST, parseTimeStringToMinutes } from '../payroll/salary-calculation';
import { classifyPunchOut, scheduledCheckout } from './attendance-classification';
import { PunchAttendanceDto, QueryAttendanceHistoryDto } from './dto/punch.dto';
import { AttendanceStatus } from '@prisma/client';
import {
  getBusinessDate,
  getBusinessDayRange,
  formatTimeInTimezone,
  formatDurationHoursMinutes,
  isRemoteWorkActiveNow,
} from '../../common/utils/timezone.util';

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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationService?: NotificationService,
  ) {}

  private async getAuthenticatedEmployee(user: any, customerId?: number | string) {
    if (!user) {
      throw new ForbiddenException('Authenticated user context required');
    }

    const targetCustomerId = user?.customerId || (customerId ? Number(customerId) : undefined);

    let employee = await this.prisma.employee.findFirst({
      where: {
        ...(targetCustomerId ? { customerId: targetCustomerId } : {}),
        OR: [
          { userId: user.id },
          { email: { equals: user.email?.trim().toLowerCase(), mode: 'insensitive' } },
        ],
      },
      include: {
        office: true,
        department: true,
        designation: true,
        shift: true,
        user: { select: { avatar: true } },
      },
    });

    if (!employee && user.id) {
      employee = await this.prisma.employee.findFirst({
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
          shift: true,
          user: { select: { avatar: true } },
        },
      });
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

    // 1. Direct active office linked to employee
    if (employee.office && employee.office.isActive && employee.office.customerId === employee.customerId) {
      selectedOffice = employee.office;
    } else if (employee.officeId) {
      const office = await this.prisma.branchGeofence.findFirst({
        where: { id: employee.officeId, customerId: employee.customerId, isActive: true },
      });
      if (office) {
        selectedOffice = office;
      }
    }

    // 2. Branch name match
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

    // 3. Customer default active office
    if (!selectedOffice) {
      const defaultOffice = await this.prisma.branchGeofence.findFirst({
        where: { customerId: employee.customerId, isActive: true },
        orderBy: { id: 'asc' },
      });
      if (defaultOffice) selectedOffice = defaultOffice;
    }

    // 4. Any office for customer (if inactive)
    if (!selectedOffice) {
      const anyOffice = await this.prisma.branchGeofence.findFirst({
        where: { customerId: employee.customerId },
        orderBy: { id: 'asc' },
      });
      if (anyOffice) selectedOffice = anyOffice;
    }

    // If still no office found for this customer
    if (!selectedOffice) {
      throw new NotFoundException(
        'Assigned office location is not configured for your organization. Please contact Admin.',
      );
    }

    // Validate coordinates
    if (
      selectedOffice.latitude === null ||
      selectedOffice.latitude === undefined ||
      selectedOffice.longitude === null ||
      selectedOffice.longitude === undefined ||
      isNaN(Number(selectedOffice.latitude)) ||
      isNaN(Number(selectedOffice.longitude))
    ) {
      throw new BadRequestException(
        `Assigned office location is not configured. Coordinates are missing for office "${selectedOffice.name}". Please contact Admin.`,
      );
    }

    const lat = Number(selectedOffice.latitude);
    const lng = Number(selectedOffice.longitude);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new BadRequestException(
        `Invalid GPS coordinates (${selectedOffice.latitude}, ${selectedOffice.longitude}) configured for office "${selectedOffice.name}". Coordinates must be valid latitude (-90 to 90) and longitude (-180 to 180). Please contact Admin.`,
      );
    }

    if (
      selectedOffice.radiusMeters === null ||
      selectedOffice.radiusMeters === undefined ||
      isNaN(Number(selectedOffice.radiusMeters)) ||
      Number(selectedOffice.radiusMeters) <= 0
    ) {
      throw new BadRequestException(
        `Invalid attendance radius (${selectedOffice.radiusMeters}m) configured for office "${selectedOffice.name}". Radius must be greater than 0 meters. Please contact Admin.`,
      );
    }

    // Link officeId to employee if not already set
    if (employee.officeId !== selectedOffice.id && employee.id) {
      try {
        await this.prisma.employee.update({
          where: { id: employee.id },
          data: { officeId: selectedOffice.id, branch: selectedOffice.name },
        });
      } catch (err: any) {
        console.warn(`[RESOLVE_OFFICE] Could not auto-link office ${selectedOffice.id} to employee ${employee.id}:`, err?.message);
      }
    }

    return selectedOffice;
  }

  private async getActiveAttendancePolicy(customerId: number, officeId?: number) {
    const policy = await this.prisma.attendancePolicy.findFirst({
      where: {
        customerId,
        isActive: true,
        ...(officeId ? { OR: [{ officeId }, { officeId: null }] } : {}),
      },
      orderBy: { officeId: 'desc' },
    });

    if (policy) return policy;

    return {
      name: 'Standard Attendance Policy',
      officeStartTime: '09:30',
      officeEndTime: '18:30',
      halfDayStartTime: '14:00',
      workingDaysPerWeek: 5,
      workingHoursPerDay: 8.0,
      punchInRequired: true,
      earlyPunchInAllowed: true,
      multiplePunchInAllowed: false,
      gracePeriodMinutes: 0,
      lateArrivalThresholdMins: 30,
      lateRuleAction: 'MARK_LATE',
      punchOutRequired: true,
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
      halfDayThresholdHours: 4.5,
      minWorkingHours: 8.0,
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

  /**
   * Applies the "Forgot Punch-Out" / "Auto Check-out" rule to a single open attendance record.
   * Sets punchOut to scheduled shift/office end time (or standard hours) without creating duplicate records.
   * If punch in was on time, preserves status: PRESENT and isLate: false (NO Late Mark).
   */
  async applyAutoCheckOutForRecord(tx: any, attendance: any, policy?: any, shift?: any) {
    if (!attendance || !attendance.punchIn || attendance.punchOut) {
      return attendance;
    }

    const client = tx || this.prisma;
    const punchInDate = new Date(attendance.punchIn);
    const now = new Date();

    const activePolicy = policy || (await this.getActiveAttendancePolicy(attendance.customerId, attendance.officeId));

    let activeShift = shift;
    if (!activeShift && attendance.employeeId) {
      const emp = await client.employee.findUnique({
        where: { id: attendance.employeeId },
        include: { shift: true },
      });
      activeShift = emp?.shift;
    }

    const scheduledEndTime = scheduledCheckout(punchInDate, now, activePolicy, activeShift);

    // Fetch breaks for this attendance record
    const breaks = await client.attendanceBreak.findMany({
      where: { attendanceId: attendance.id },
      orderBy: { breakStart: 'asc' },
    });

    // Close any running breaks
    let totalBreakMinutes = 0;
    for (const b of breaks) {
      if (!b.breakEnd) {
        let bEnd = new Date(new Date(b.breakStart).getTime() + (activePolicy.maxBreakDurationMins || 60) * 60 * 1000);
        if (bEnd.getTime() > scheduledEndTime.getTime()) {
          bEnd = scheduledEndTime;
        }
        if (bEnd.getTime() < new Date(b.breakStart).getTime()) {
          bEnd = new Date(b.breakStart);
        }
        const bDuration = Math.max(0, Math.round((bEnd.getTime() - new Date(b.breakStart).getTime()) / (1000 * 60)));
        await client.attendanceBreak.update({
          where: { id: b.id },
          data: {
            breakEnd: bEnd,
            duration: bDuration,
          },
        });
        totalBreakMinutes += bDuration;
      } else {
        const bDuration =
          b.duration ||
          Math.max(0, Math.round((new Date(b.breakEnd).getTime() - new Date(b.breakStart).getTime()) / (1000 * 60)));
        totalBreakMinutes += bDuration;
      }
    }

    const totalBreakHours = Math.round((totalBreakMinutes / 60) * 100) / 100;

    // Gross and Net working minutes
    const grossElapsedMs = scheduledEndTime.getTime() - punchInDate.getTime();
    const grossElapsedMinutes = Math.max(0, Math.round(grossElapsedMs / (1000 * 60)));
    const netWorkingMinutes = Math.max(0, grossElapsedMinutes - totalBreakMinutes);
    const actualWorkingHours = Math.round((netWorkingMinutes / 60) * 100) / 100;

    // Status Determination:
    // IMPORTANT: Keep Late Arrival Grace Period ONLY for late punch in.
    // If employee punched in on time, missing punch-out must NOT trigger a late mark.
    const wasPunchInLate = Boolean(attendance.isLate || attendance.status === AttendanceStatus.LATE);
    const { status: finalStatus } = classifyPunchOut({
      currentStatus: attendance.status,
      isLate: wasPunchInLate,
      workedHours: actualWorkingHours,
      policy: activePolicy,
      shift: activeShift,
    });

    const updated = await client.attendance.update({
      where: { id: attendance.id },
      data: {
        punchOut: scheduledEndTime,
        workingHours: actualWorkingHours,
        workingMinutes: netWorkingMinutes,
        breakDuration: totalBreakHours,
        status: finalStatus,
        isLate: wasPunchInLate,
        lateMinutes: wasPunchInLate ? (attendance.lateMinutes || 0) : 0,
        locationOut: 'Auto Check-out (Forgot Punch-Out)',
      },
    });

    console.log(`[ATTENDANCE AUTO_CHECKOUT]
employeeId: ${attendance.employeeId}
attendanceId: ${attendance.id}
punchIn: ${punchInDate.toISOString()}
autoPunchOut: ${scheduledEndTime.toISOString()}
workingHours: ${actualWorkingHours}
status: ${finalStatus}
wasLate: ${wasPunchInLate}`);

    return updated;
  }

  /**
   * Processes all unclosed attendances that either:
   * 1. Belong to a past business day (date < todayStart), OR
   * 2. Have exceeded the safety hours window (default: 12 hours)
   */
  async processAutoCheckOuts(options?: { customerId?: number; employeeId?: number; upToDate?: Date }) {
    const now = options?.upToDate || new Date();
    const { start: todayStart } = getBusinessDayRange(now);

    const safetyHours = 12; // Safety hours threshold
    const safetyThresholdDate = new Date(now.getTime() - safetyHours * 60 * 60 * 1000);

    const openAttendances = await this.prisma.attendance.findMany({
      where: {
        ...(options?.customerId ? { customerId: options.customerId } : {}),
        ...(options?.employeeId ? { employeeId: options.employeeId } : {}),
        punchIn: { not: null },
        punchOut: null,
        OR: [
          { date: { lt: todayStart } },
          { punchIn: { lte: safetyThresholdDate } },
        ],
      },
      include: {
        breaks: true,
      },
      orderBy: { date: 'asc' },
    });

    if (!openAttendances || openAttendances.length === 0) {
      return [];
    }

    const updatedRecords: any[] = [];
    for (const att of openAttendances) {
      try {
        const res = await this.applyAutoCheckOutForRecord(this.prisma, att);
        updatedRecords.push(res);
      } catch (err: any) {
        console.error(`[AUTO_CHECKOUT_ERROR] Error processing attendance ${att.id}:`, err?.message);
      }
    }

    return updatedRecords;
  }

  async checkIn(user: any, customerId: number | string | undefined, dto: PunchAttendanceDto) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);
    const policy = await this.getActiveAttendancePolicy(employee.customerId, office.id);

    // Gracefully handle previous day's or expired open punch records via Auto Check-out
    await this.processAutoCheckOuts({ employeeId: employee.id });

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

    const now = new Date();
    const { dateStr, start: todayStart, end: todayEnd } = getBusinessDayRange(now);

    // Check if employee has approved remote work for today and active within start/end time window
    const approvedRemote = await this.prisma.remoteRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        fromDate: { lte: todayEnd },
        toDate: { gte: todayStart },
      },
    });

    const isRemoteActive = isRemoteWorkActiveNow(approvedRemote, now);

    const distanceMeters = calculateDistanceMeters(
      Number(dto.latitude),
      Number(dto.longitude),
      Number(office.latitude),
      Number(office.longitude),
    );
    const allowedRadius = Number(office.radiusMeters) || 200.0;
    const locationStatus = isRemoteActive
      ? 'REMOTE'
      : distanceMeters <= allowedRadius
      ? 'INSIDE_RADIUS'
      : 'OUTSIDE_RADIUS';
    const workMode = isRemoteActive ? 'REMOTE' : 'OFFICE';
    let locationInStr = isRemoteActive
      ? `Remote Work (${approvedRemote?.reason || 'Approved Remote Duty'})`
      : `${office.name} (${distanceMeters}m)`;

    console.log(`[ATTENDANCE GEOFENCE]
employeeId: ${employee.id}
employeeCode: ${employee.employeeCode || 'N/A'}
assignedOfficeId: ${office.id}
assignedOfficeName: ${office.name}
officeLat: ${office.latitude}
officeLng: ${office.longitude}
allowedRadius: ${allowedRadius}
currentLat: ${dto.latitude}
currentLng: ${dto.longitude}
accuracy: ${dto.accuracy ?? 'N/A'}
calculatedDistance: ${distanceMeters}
isRemoteActive: ${isRemoteActive}`);

    // GEOFENCE VALIDATION: Strict backend validation when remote work is not active
    if (!isRemoteActive && distanceMeters > allowedRadius) {
      throw new ForbiddenException({
        statusCode: 403,
        success: false,
        message: 'You are outside the allowed office radius',
        data: {
          distanceMeters,
          allowedRadiusMeters: allowedRadius,
          locationStatus: 'OUTSIDE_RADIUS',
          workMode: 'OFFICE',
          officeName: office.name,
          office: {
            id: office.id,
            name: office.name,
            city: office.city,
            latitude: Number(office.latitude),
            longitude: Number(office.longitude),
            radiusMeters: allowedRadius,
          },
        },
      });
    }

    const lateEvaluation = await this.evaluatePunchLateness(employee, policy, now);
    const isLatePunchIn = lateEvaluation.isLate;
    const lateMinutesCount = lateEvaluation.lateMinutes;
    // A new punch has no completed working duration yet. Lateness is stored
    // independently; only checkout can determine a short working day.
    const attendanceStatus: AttendanceStatus = isLatePunchIn ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

    const result = await this.prisma.$transaction(async (tx) => {
      if ((tx as any).$queryRaw) {
        try {
          await (tx as any).$queryRaw`SELECT id FROM "Employee" WHERE id = ${employee.id} FOR UPDATE`;
        } catch {
          // Graceful fallback for mock tests without raw query support
        }
      }

      let attendance = await tx.attendance.findFirst({
        where: {
          employeeId: employee.id,
          date: { gte: todayStart, lte: todayEnd },
        },
        orderBy: { id: 'desc' },
      });

      if (attendance && attendance.punchIn && !attendance.punchOut) {
        throw new ConflictException({
          statusCode: 409,
          success: false,
          message: "Today's punch in is already completed.",
        });
      }

      if (attendance) {
        attendance = await tx.attendance.update({
          where: { id: attendance.id },
          data: {
            punchIn: now,
            punchOut: null,
            status: attendance.status === AttendanceStatus.LEAVE ? AttendanceStatus.LEAVE : attendanceStatus,
            isLate: isLatePunchIn,
            lateMinutes: lateMinutesCount,
            lateDeduction: lateEvaluation.deduction,
            lateRatePerMinute: lateEvaluation.ratePerMinute,
            lateGraceMinutes: lateEvaluation.gracePeriodMinutes,
            workMode,
            locationStatus,
            officeId: office.id,
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracy: dto.accuracy ?? null,
            distanceFromOffice: distanceMeters,
            locationIn: locationInStr,
            punchInBiometricVerified: Boolean(dto.biometricVerified),
          },
        });
      } else {
        attendance = await tx.attendance.create({
          data: {
            customerId: employee.customerId,
            employeeId: employee.id,
            date: todayStart,
            punchIn: now,
            status: attendanceStatus,
            isLate: isLatePunchIn,
            lateMinutes: lateMinutesCount,
            lateDeduction: lateEvaluation.deduction,
            lateRatePerMinute: lateEvaluation.ratePerMinute,
            lateGraceMinutes: lateEvaluation.gracePeriodMinutes,
            workMode,
            locationStatus,
            officeId: office.id,
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracy: dto.accuracy ?? null,
            distanceFromOffice: distanceMeters,
            locationIn: locationInStr,
            punchInBiometricVerified: Boolean(dto.biometricVerified),
          },
        });
      }

      console.log(`[ATTENDANCE]
employeeId: ${employee.id}
attendanceDate: ${dateStr}
serverNowUTC: ${now.toISOString()}
businessTime: ${formatTimeInTimezone(now)}
workMode: ${workMode}
punchInAtSaved: ${attendance.punchIn?.toISOString()}`);

      const punchInIso = attendance.punchIn ? attendance.punchIn.toISOString() : null;

      return {
        success: true,
        message: isLatePunchIn
          ? `Late Punch-In Detected. You punched in ${lateMinutesCount} minutes late today. Your applicable late-mark deduction is ${this.formatLateMoney(lateEvaluation.deduction, lateEvaluation.currency)}.`
          : `Punch In successful${isRemoteActive ? ' (Remote Work Mode)' : ` at ${office.name}`}. Status: ${attendanceStatus}.`,
        data: {
          attendanceId: attendance.id,
          employeeId: employee.employeeCode || `EMP-${employee.id}`,
          attendanceDate: dateStr,
          punchInAt: punchInIso,
          punchIn: punchInIso,
          punchOutAt: null,
          punchOut: null,
          status: attendance.status,
          workMode,
          office: {
            id: office.id,
            name: office.name,
            city: office.city,
            latitude: office.latitude,
            longitude: office.longitude,
          },
          distanceMeters,
          allowedRadiusMeters: allowedRadius,
          locationStatus,
          biometricVerified: Boolean(dto.biometricVerified),
          isLate: isLatePunchIn,
          lateMinutes: lateMinutesCount,
          gracePeriodMinutes: lateEvaluation.gracePeriodMinutes,
          lateRatePerMinute: lateEvaluation.ratePerMinute,
          lateDeduction: lateEvaluation.deduction,
        },
        status: attendance.status,
        office: {
          id: office.id,
          name: office.name,
          city: office.city,
          distanceMeters,
          allowedRadius,
        },
      };
    });
    await this.notifyAttendanceEvent(employee, result?.data?.attendanceId, 'PUNCH_IN', 'Punch In Successful', `Your attendance was marked successfully at ${formatTimeInTimezone(now)}. Date: ${dateStr}. Status: ${result?.data?.status || attendanceStatus}.`, { punchInAt: now.toISOString(), attendanceDate: dateStr, status: String(result?.data?.status || attendanceStatus) });
    if (lateEvaluation.applicable && lateEvaluation.isLate && lateEvaluation.lateMinutes > 0) {
      const shiftStart = employee.shift?.startTime || employee.shift?.start || 'assigned shift start';
      await this.notifyAttendanceEvent(employee, result?.data?.attendanceId, 'LATE_MARK', 'Late Mark Recorded', `You are ${result.data.lateMinutes} minutes late today. Your assigned shift started at ${shiftStart}; punch-in was ${formatTimeInTimezone(now)}.`, { lateMinutes: String(result.data.lateMinutes), shiftStart: String(shiftStart), punchInAt: now.toISOString(), attendanceDate: dateStr });
      if (Number(result.data.lateDeduction) > 0) await this.notifyAttendanceEvent(employee, result.data.attendanceId, `LATE_DEDUCTION_${Number(result.data.lateDeduction).toFixed(2)}`, 'Late Mark Deduction Applied', `Your Late Mark deduction for today is ${this.formatLateMoney(Number(result.data.lateDeduction), lateEvaluation.currency)}. Late minutes: ${result.data.lateMinutes}. Deduction rate: ${this.formatLateMoney(Number(result.data.lateRatePerMinute), lateEvaluation.currency)}/min.`, { lateMinutes: String(result.data.lateMinutes), deductionRate: String(result.data.lateRatePerMinute), deductionAmount: String(result.data.lateDeduction), attendanceDate: dateStr });
    }
    return result;
  }

  async checkOut(user: any, customerId: number | string | undefined, dto: PunchAttendanceDto) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);
    const policy = await this.getActiveAttendancePolicy(employee.customerId, office.id);

    const now = new Date();
    const { dateStr, start: todayStart, end: todayEnd } = getBusinessDayRange(now);

    // Check if employee has approved remote work for today and active within start/end time window
    const approvedRemote = await this.prisma.remoteRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        fromDate: { lte: todayEnd },
        toDate: { gte: todayStart },
      },
    });
    const isRemoteActive = isRemoteWorkActiveNow(approvedRemote, now);

    let distanceMeters = 0;
    const allowedRadius = office.radiusMeters || 200.0;
    let locationOutStr = isRemoteActive
      ? `Remote Work (${approvedRemote?.reason || 'Approved Remote Duty'})`
      : `${office.name}`;

    if (dto.latitude !== undefined && dto.longitude !== undefined && !isNaN(dto.latitude) && !isNaN(dto.longitude)) {
      distanceMeters = calculateDistanceMeters(
        dto.latitude,
        dto.longitude,
        office.latitude,
        office.longitude,
      );
      if (!isRemoteActive) {
        locationOutStr = `${office.name} (${distanceMeters}m)`;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.findFirst({
        where: {
          employeeId: employee.id,
          date: { gte: todayStart, lte: todayEnd },
        },
        orderBy: { id: 'desc' },
        include: {
          breaks: true,
        },
      });

      if (!attendance || !attendance.punchIn) {
        throw new NotFoundException({
          statusCode: 404,
          success: false,
          message: 'No active punch-in found for today.',
        });
      }

      if (attendance.punchOut) {
        throw new ConflictException({
          statusCode: 409,
          success: false,
          message: "Today's punch out is already completed.",
        });
      }

      // Check if there is an active break currently running
      const activeBreak = attendance.breaks.find((b) => !b.breakEnd);
      if (activeBreak) {
        throw new BadRequestException(
          'You have an active break in progress. Please end your break before punching out.',
        );
      }

      // Calculate total completed break duration in minutes and hours
      const totalBreakMinutes = attendance.breaks
        .filter((b) => b.breakEnd)
        .reduce(
          (sum, b) =>
            sum +
            (b.duration ||
              Math.max(
                0,
                Math.round(
                  (new Date(b.breakEnd!).getTime() - new Date(b.breakStart).getTime()) /
                    (1000 * 60),
                ),
              )),
          0,
        );
      const totalBreakHours = Math.round((totalBreakMinutes / 60) * 100) / 100;

      // Calculate working hours: Net = Gross elapsed - Total Break
      const totalElapsedMs = now.getTime() - new Date(attendance.punchIn).getTime();
      const totalElapsedMinutes = Math.max(0, Math.round(totalElapsedMs / (1000 * 60)));
      const netWorkingMinutes = Math.max(0, totalElapsedMinutes - totalBreakMinutes);
      const actualWorkingHours = Math.round((netWorkingMinutes / 60) * 100) / 100;

      const classification = classifyPunchOut({
        currentStatus: attendance.status,
        isLate: attendance.isLate,
        lateMinutes: attendance.lateMinutes,
        lateGraceMinutes: attendance.lateGraceMinutes,
        workedHours: actualWorkingHours,
        policy,
        shift: employee.shift,
      });

      const updated = await tx.attendance.update({
        where: { id: attendance.id },
        data: {
          punchOut: now,
          workingHours: actualWorkingHours,
          workingMinutes: netWorkingMinutes,
          breakDuration: totalBreakHours,
          status: classification.status,
          isLate: classification.isLate,
          lateMinutes: attendance.lateMinutes || 0,
          locationOut: locationOutStr,
          punchOutLatitude: dto.latitude ?? null,
          punchOutLongitude: dto.longitude ?? null,
          punchOutAccuracy: dto.accuracy ?? null,
          punchOutBiometricVerified: Boolean(dto.biometricVerified),
        },
      });

      const workingDuration = formatDurationHoursMinutes(netWorkingMinutes);
      const totalBreakFormatted = formatDurationHoursMinutes(totalBreakMinutes);

      console.log(`[ATTENDANCE]
employeeId: ${employee.id}
branchId: ${office.id}
action: PUNCH_OUT
attendanceDate: ${dateStr}
serverNowUTC: ${now.toISOString()}
businessTime: ${formatTimeInTimezone(now)}
punchInAt: ${attendance.punchIn?.toISOString()}
punchOutAtSaved: ${updated.punchOut?.toISOString()}
distanceMeters: ${distanceMeters}
workingMinutes: ${netWorkingMinutes}
workingDuration: ${workingDuration}
totalBreakMinutes: ${totalBreakMinutes}
totalBreakDuration: ${totalBreakFormatted}
biometricVerified: ${Boolean(dto.biometricVerified)}
result: SUCCESS`);

      const punchInIso = attendance.punchIn ? attendance.punchIn.toISOString() : null;
      const punchOutIso = updated.punchOut ? updated.punchOut.toISOString() : null;

      return {
        success: true,
        message: `Punch Out successful. Total working duration: ${workingDuration} (${actualWorkingHours} hrs).`,
        data: {
          attendanceId: updated.id,
          employeeId: employee.employeeCode || `EMP-${employee.id}`,
          attendanceDate: dateStr,
          punchInAt: punchInIso,
          punchIn: punchInIso,
          punchOutAt: punchOutIso,
          punchOut: punchOutIso,
          workingDuration,
          workingHours: updated.workingHours,
          workingMinutes: netWorkingMinutes,
          totalBreakMinutes,
          breakDuration: totalBreakFormatted,
          totalBreak: totalBreakFormatted,
          status: updated.status,
          office: {
            id: office.id,
            name: office.name,
            city: office.city,
          },
          biometricVerified: Boolean(dto.biometricVerified),
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
    await this.notifyAttendanceEvent(employee, result?.data?.attendanceId, 'PUNCH_OUT', 'Punch Out Successful', `Your punch-out was recorded at ${formatTimeInTimezone(new Date(result.data.punchOutAt))}. Total working hours today: ${result.data.workingDuration}.`, { punchOutAt: result.data.punchOutAt, workingMinutes: String(result.data.workingMinutes), attendanceDate: dateStr });
    return result;
  }

  async getTodayAttendance(user: any, customerId: number | string | undefined) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    await this.processAutoCheckOuts({ employeeId: employee.id });
    const { dateStr, start: todayStart, end: todayEnd } = getBusinessDayRange();

    const todayAtt = await this.prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: todayStart, lte: todayEnd },
      },
      orderBy: { id: 'desc' },
      include: {
        breaks: true,
      },
    });

    const isPunchedIn = Boolean(todayAtt?.punchIn && !todayAtt?.punchOut);
    const isPunchedOut = Boolean(todayAtt?.punchIn && todayAtt?.punchOut);
    let grossMinutes = 0;
    let netWorkingMinutes = 0;
    let totalBreakMinutes = 0;

    if (todayAtt) {
      totalBreakMinutes = todayAtt.breaks
        .filter((b) => b.breakEnd)
        .reduce(
          (sum, b) =>
            sum +
            (b.duration ||
              Math.max(
                0,
                Math.round(
                  (new Date(b.breakEnd!).getTime() - new Date(b.breakStart).getTime()) /
                    (1000 * 60),
                ),
              )),
          0,
        );

      if (todayAtt.punchIn) {
        const endTime = todayAtt.punchOut ? new Date(todayAtt.punchOut) : new Date();
        const elapsedMs = endTime.getTime() - new Date(todayAtt.punchIn).getTime();
        grossMinutes = Math.max(0, Math.round(elapsedMs / (1000 * 60)));
        netWorkingMinutes = Math.max(0, grossMinutes - totalBreakMinutes);
      }
    }

    const currentStatus = isPunchedIn
      ? 'PUNCHED_IN'
      : isPunchedOut
      ? 'PUNCHED_OUT'
      : 'NOT_MARKED';

    return {
      success: true,
      data: {
        date: dateStr,
        status: currentStatus,
        punchInAt: todayAtt?.punchIn ? todayAtt.punchIn.toISOString() : null,
        punchOutAt: todayAtt?.punchOut ? todayAtt.punchOut.toISOString() : null,
        workingMinutes: netWorkingMinutes,
        workingHours: Math.round((netWorkingMinutes / 60) * 100) / 100,
        workingDuration: formatDurationHoursMinutes(netWorkingMinutes),
        totalBreakMinutes,
        breakDuration: formatDurationHoursMinutes(totalBreakMinutes),
        totalBreak: formatDurationHoursMinutes(totalBreakMinutes),
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
    await this.processAutoCheckOuts({ employeeId: employee.id });

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const whereClause: any = {
      customerId: employee.customerId,
      employeeId: employee.id,
    };

    if (query.date) {
      const { start: dStart, end: dEnd } = getBusinessDayRange(query.date);
      whereClause.date = { gte: dStart, lte: dEnd };
    } else if (query.dateFrom || query.dateTo) {
      whereClause.date = {};
      if (query.dateFrom) {
        const { start: from } = getBusinessDayRange(query.dateFrom);
        whereClause.date.gte = from;
      }
      if (query.dateTo) {
        const { end: to } = getBusinessDayRange(query.dateTo);
        whereClause.date.lte = to;
      }
    }

    const [total, rawItems] = await Promise.all([
      this.prisma.attendance.count({ where: whereClause }),
      this.prisma.attendance.findMany({
        where: whereClause,
        orderBy: [{ date: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
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

    // Consolidate any duplicate records per business day into a single canonical daily record
    const dailyMap = new Map<string, (typeof rawItems)[0]>();
    for (const item of rawItems) {
      const bDate = item.date ? getBusinessDate(item.date) : 'unknown';
      const existing = dailyMap.get(bDate);
      if (!existing) {
        dailyMap.set(bDate, { ...item, breaks: [...item.breaks] });
      } else {
        if (item.punchIn && (!existing.punchIn || new Date(item.punchIn) < new Date(existing.punchIn))) {
          existing.punchIn = item.punchIn;
        }
        if (item.punchOut && (!existing.punchOut || new Date(item.punchOut) > new Date(existing.punchOut))) {
          existing.punchOut = item.punchOut;
        }
        existing.workingMinutes = Math.max(existing.workingMinutes || 0, item.workingMinutes || 0);
        existing.workingHours = Math.max(existing.workingHours || 0, item.workingHours || 0);
        const existingBreakIds = new Set(existing.breaks.map((b) => b.id));
        for (const brk of item.breaks) {
          if (!existingBreakIds.has(brk.id)) {
            existing.breaks.push(brk);
            existingBreakIds.add(brk.id);
          }
        }
        if ((!existing.locationIn || existing.locationIn === 'Office GPS') && item.locationIn) {
          existing.locationIn = item.locationIn;
        }
      }
    }
    const items = Array.from(dailyMap.values());
    const overtime = await this.prisma.overtimeRequest.findMany({
      where: { customerId: employee.customerId, employeeId: employee.id, deletedAt: null },
      orderBy: { overtimeDate: 'desc' },
      take: 30,
      select: {
        id: true,
        overtimeDate: true,
        overtimeType: true,
        startTime: true,
        endTime: true,
        totalMinutes: true,
        approvedMinutes: true,
        actualStartAt: true,
        actualEndAt: true,
        actualMinutes: true,
        status: true,
      },
    });

    return {
      success: true,
      data: items,
      overtime,
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

    const now = new Date();
    const { start: todayStart, end: todayEnd } = getBusinessDayRange(now);

    return this.prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.findFirst({
        where: {
          employeeId: employee.id,
          date: { gte: todayStart, lte: todayEnd },
        },
        orderBy: { id: 'desc' },
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
          `You are already on an active break started at ${formatTimeInTimezone(activeBreak.breakStart)}.`,
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
        message: `Break started at ${formatTimeInTimezone(now)}.`,
        data: newBreak,
      };
    });
  }

  async endBreak(user: any, customerId: number | string | undefined, dto?: any) {
    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);

    const now = new Date();
    const { start: todayStart, end: todayEnd } = getBusinessDayRange(now);

    return this.prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.findFirst({
        where: {
          employeeId: employee.id,
          date: { gte: todayStart, lte: todayEnd },
        },
        orderBy: { id: 'desc' },
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
    await this.processAutoCheckOuts({ employeeId: employee.id });
    const office = await this.resolveOfficeForEmployee(employee);
    const { dateStr, start: todayStart, end: todayEnd } = getBusinessDayRange();

    const todayAtt = await this.prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: todayStart, lte: todayEnd },
      },
      orderBy: { id: 'desc' },
      include: {
        breaks: true,
      },
    });

    const approvedRemote = await this.prisma.remoteRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        fromDate: { lte: todayEnd },
        toDate: { gte: todayStart },
      },
    });

    // Never substitute a tenant-default shift: deductions must only be
    // computed against the employee's own assigned shift.
    const assignedShift = employee.shift;

    const isPunchedIn = Boolean(todayAtt && todayAtt.punchIn && !todayAtt.punchOut);
    const activeBreak = todayAtt?.breaks?.find((b: any) => !b.breakEnd);
    const policy = await this.getActiveAttendancePolicy(employee.customerId, office?.id);

    const totalBreakMinutes =
      todayAtt?.breaks
        ?.filter((b: any) => b.breakEnd)
        .reduce(
          (sum: number, b: any) =>
            sum +
            (b.duration ||
              Math.max(
                0,
                Math.round(
                  (new Date(b.breakEnd).getTime() - new Date(b.breakStart).getTime()) /
                    (1000 * 60),
                ),
              )),
          0,
        ) || 0;

    let netWorkingMinutes = todayAtt?.workingMinutes || 0;
    if (todayAtt?.punchIn && !todayAtt?.punchOut) {
      const gross = Math.max(
        0,
        Math.round((Date.now() - new Date(todayAtt.punchIn).getTime()) / (1000 * 60)),
      );
      netWorkingMinutes = Math.max(0, gross - totalBreakMinutes);
    } else if (
      todayAtt?.punchIn &&
      todayAtt?.punchOut &&
      (!netWorkingMinutes || netWorkingMinutes === 0)
    ) {
      const gross = Math.max(
        0,
        Math.round(
          (new Date(todayAtt.punchOut).getTime() - new Date(todayAtt.punchIn).getTime()) /
            (1000 * 60),
        ),
      );
      netWorkingMinutes = Math.max(0, gross - totalBreakMinutes);
    }

    const workingHoursVal = Math.round((netWorkingMinutes / 60) * 100) / 100;
    const breakDurationHoursVal = Math.round((totalBreakMinutes / 60) * 100) / 100;

    const now = new Date();
    const isRemoteActive = isRemoteWorkActiveNow(approvedRemote, now);

    const lateMark = await this.resolveTodayLateMark(
      employee,
      todayAtt,
      policy,
      assignedShift,
    );
    const lateMarkPeriodSummary = await this.summarizeEmployeeStoredLateMarks(
      employee.id,
      employee.customerId,
    );

    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        name: [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim() || employee.email?.split('@')[0] || 'Employee',
        firstName: employee.firstName,
        lastName: employee.lastName || '',
        email: employee.email,
        profilePhoto: employee.user?.avatar || null,
        avatar: employee.user?.avatar || null,
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
      assignedShift: assignedShift
        ? {
            id: assignedShift.id,
            name: assignedShift.name,
            code: assignedShift.code,
            startTime: assignedShift.startTime,
            endTime: assignedShift.endTime,
            durationHours: assignedShift.durationHours,
            gracePeriodMinutes: assignedShift.gracePeriodMinutes,
            breakDurationMinutes: assignedShift.breakDurationMinutes,
          }
        : null,
      isRemoteWorkActive: isRemoteActive,
      workMode: isRemoteActive ? 'REMOTE' : 'OFFICE',
      approvedRemote: approvedRemote
        ? {
            id: approvedRemote.id,
            status: approvedRemote.status,
            reason: approvedRemote.reason || 'Approved Remote Duty',
            fromDate: approvedRemote.fromDate ? approvedRemote.fromDate.toISOString().split('T')[0] : null,
            toDate: approvedRemote.toDate ? approvedRemote.toDate.toISOString().split('T')[0] : null,
            startTime: approvedRemote.startTime || '09:00 AM',
            endTime: approvedRemote.endTime || '06:00 PM',
            isCurrentlyActive: isRemoteActive,
          }
        : null,
      policy: {
        officeStartTime: policy.officeStartTime || '09:30',
        officeEndTime: policy.officeEndTime || '18:30',
        gracePeriodMinutes: 0,
        minWorkingHours: policy.minWorkingHours || 8.0,
      },
      status: {
        isPunchedIn,
        isOnBreak: Boolean(activeBreak),
        activeBreakStart: activeBreak?.breakStart ? activeBreak.breakStart.toISOString() : null,
        punchInTime: todayAtt?.punchIn ? todayAtt.punchIn.toISOString() : null,
        punchOutTime: todayAtt?.punchOut ? todayAtt.punchOut.toISOString() : null,
        workingMinutes: netWorkingMinutes,
        workingHours: workingHoursVal,
        workingDuration: formatDurationHoursMinutes(netWorkingMinutes),
        totalBreakMinutes,
        breakDuration: breakDurationHoursVal,
        totalBreakDuration: formatDurationHoursMinutes(totalBreakMinutes),
        rawStatus: todayAtt?.status || 'NOT_MARKED',
        isEligibleLateMark: lateMark.isEligibleLateMark,
        isLate: lateMark.isLate,
        lateMinutes: lateMark.lateMinutes,
        lateDeduction: lateMark.lateDeduction,
        lateRatePerMinute: lateMark.lateRatePerMinute,
        lateGraceMinutes: lateMark.lateGraceMinutes,
        lateMarkStatus: lateMark.lateMarkStatus,
      },
      lateMarkPeriodSummary,
      todayAttendance: todayAtt,
    };
  }

  private async summarizeEmployeeStoredLateMarks(employeeId: number, customerId: number) {
    const businessDate = getBusinessDate();
    const [year, month] = businessDate.split('-').map((part) => Number(part));
    const monthStart = getBusinessDayRange(`${year}-${String(month).padStart(2, '0')}-01`).start;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthEnd = getBusinessDayRange(`${year}-${String(month).padStart(2, '0')}-${lastDay}`).end;

    const rows = await this.prisma.attendance.findMany({
      where: {
        employeeId,
        customerId,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: {
        id: true,
        date: true,
        punchIn: true,
        lateMinutes: true,
        lateDeduction: true,
        lateRatePerMinute: true,
        isLate: true,
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });

    const latestByDay = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const dayKey = getBusinessDate(row.date);
      const prev = latestByDay.get(dayKey);
      if (!prev || row.id > prev.id) latestByDay.set(dayKey, row);
    }

    let fallbackRate = 0;
    try {
      const latePolicy = (this.prisma as any).lateMarkPolicy?.findUnique
        ? await (this.prisma as any).lateMarkPolicy.findUnique({ where: { customerId } })
        : null;
      fallbackRate = Math.max(0, Number(latePolicy?.deductionRatePerMin) || 0);
    } catch { /* fall through */ }

    let lateDays = 0;
    let totalLateMinutes = 0;
    let totalDeduction = 0;
    const rates = new Set<number>();

    for (const row of latestByDay.values()) {
      if (!row.punchIn) continue;
      const minutes = Math.max(0, Number(row.lateMinutes) || 0);
      const storedDeduction = Math.max(0, Number(row.lateDeduction) || 0);
      const storedRate = Number(row.lateRatePerMinute) || 0;
      if (minutes <= 0 && storedDeduction <= 0 && !row.isLate) continue;

      lateDays += 1;
      totalLateMinutes += minutes;
      const rateUsed = storedRate > 0 ? storedRate : fallbackRate;
      const dayDeduction = storedDeduction > 0
        ? storedDeduction
        : Math.round(minutes * rateUsed * 100) / 100;
      totalDeduction += dayDeduction;
      if (rateUsed > 0) rates.add(rateUsed);
    }

    totalDeduction = Math.round(totalDeduction * 100) / 100;

    return {
      month,
      year,
      lateDays,
      totalLateMinutes,
      totalDeduction,
      ratePerMinute: rates.size === 1 ? [...rates][0] : 0,
      mixedRates: rates.size > 1,
      hasData: lateDays > 0 || totalLateMinutes > 0 || totalDeduction > 0,
    };
  }

  private async resolveTodayLateMark(
    employee: any,
    todayAtt: any | null,
    attendancePolicy: any,
    assignedShift: any,
  ): Promise<{
    isEligibleLateMark: boolean;
    isLate: boolean;
    lateMinutes: number;
    lateDeduction: number;
    lateRatePerMinute: number;
    lateGraceMinutes: number;
    lateMarkStatus: string;
  }> {
    const empty = (status: string) => ({
      isEligibleLateMark: false,
      isLate: false,
      lateMinutes: 0,
      lateDeduction: 0,
      lateRatePerMinute: 0,
      lateGraceMinutes: 0,
      lateMarkStatus: status,
    });
    if (!todayAtt?.punchIn) return empty('no_punch_in');

    const shiftForEval =
      assignedShift?.startTime != null
        ? assignedShift
        : employee?.shift?.startTime != null
          ? employee.shift
          : null;
    if (!shiftForEval?.startTime) {
      console.warn(
        `[LATE_MARK] employee=${employee?.id} customer=${employee?.customerId}: no assigned shift with a start time; skipping late evaluation`,
      );
      return empty('no_shift');
    }

    const punchIn = new Date(todayAtt.punchIn);
    const employeeWithShift = { ...employee, shift: shiftForEval };
    const evaluation = await this.evaluatePunchLateness(employeeWithShift, attendancePolicy, punchIn);

    if (!evaluation.applicable || !evaluation.isLate || evaluation.lateMinutes <= 0) {
      return empty(evaluation.reason || 'not_late');
    }

    const storedDeduction = Number((todayAtt as any)?.lateDeduction) || 0;
    const storedRate = Number((todayAtt as any)?.lateRatePerMinute) || 0;
    const storedGrace = Number((todayAtt as any)?.lateGraceMinutes) || 0;

    const lateMinutes = storedGrace > 0 && storedRate > 0
      ? Math.max(0, Number(todayAtt.lateMinutes) || 0) : evaluation.lateMinutes;
    const lateRatePerMinute = storedRate > 0 ? storedRate : evaluation.ratePerMinute;
    const lateGraceMinutes = storedGrace > 0 ? storedGrace : evaluation.gracePeriodMinutes;
    // Older attendance rows predate stored deductions and have database-default
    // zero amounts. Only trust a stored deduction when it is actually > 0;
    // a stored rate with a zero amount is an incomplete record, not a real ₹0.
    const lateDeduction = storedDeduction > 0 ? storedDeduction : evaluation.deduction;

    return {
      isEligibleLateMark: true,
      isLate: true,
      lateMinutes,
      lateDeduction,
      lateRatePerMinute,
      lateGraceMinutes,
      lateMarkStatus: 'eligible',
    };
  }

  public async resolveCustomerId(user: any, customerId?: number | string): Promise<number> {
    const isSuperAdmin =
      user?.role === 'SUPER_ADMIN' ||
      user?.role === 'Super Admin' ||
      (Array.isArray(user?.roles) && user.roles.some((r: string) => r.toUpperCase() === 'SUPER_ADMIN'));

    if (customerId !== undefined && customerId !== null) {
      const num = Number(customerId);
      if (!isNaN(num) && num > 0) return num;
    }

    if (user?.customerId !== undefined && user?.customerId !== null) {
      const num = Number(user.customerId);
      if (!isNaN(num) && num > 0) return num;
    }

    if (isSuperAdmin) {
      const firstCustomer = await this.prisma.customer.findFirst({
        where: { isActive: true },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (firstCustomer) return firstCustomer.id;
    }

    throw new ForbiddenException('A valid organization or customer context is required.');
  }

  private formatLateMoney(amount: number, currency = 'INR') {
    const rounded = Math.round((Number(amount) || 0) * 100) / 100;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
    return currency === 'INR' ? `₹${text}` : `${currency} ${text}`;
  }

  private async evaluatePunchLateness(employee: any, attendancePolicy: any, punchIn: Date) {
    const customerId = employee.customerId;
    const startMinutes = parseTimeStringToMinutes(employee.shift?.startTime);
    const endMinutes = parseTimeStringToMinutes(employee.shift?.endTime);
    const punchMinutes = dateToMinutesInIST(punchIn).minutes;
    const overnight = startMinutes != null && endMinutes != null &&
      (employee.shift?.isNightShift || endMinutes <= startMinutes);
    const schedulePunch = overnight && punchMinutes < startMinutes! && punchMinutes <= endMinutes!
      ? new Date(punchIn.getTime() - 24 * 60 * 60 * 1000) : punchIn;
    const { start, end } = getBusinessDayRange(schedulePunch);
    let isHoliday = false;
    let isApprovedLeave = false;
    let latePolicy: any = null;
    try {
      if ((this.prisma as any).publicHoliday?.findFirst) {
        const holiday = await (this.prisma as any).publicHoliday.findFirst({
          where: { customerId, isActive: true, date: { gte: start, lte: end } },
          select: { id: true },
        });
        isHoliday = Boolean(holiday);
      }
      if (this.prisma.leaveRequest?.findFirst) {
        const leave = await this.prisma.leaveRequest.findFirst({
          where: {
            employeeId: employee.id,
            status: 'APPROVED',
            fromDate: { lte: end },
            toDate: { gte: start },
          },
          select: { id: true },
        });
        isApprovedLeave = Boolean(leave);
      }
      if ((this.prisma as any).lateMarkPolicy?.findUnique) {
        latePolicy = await (this.prisma as any).lateMarkPolicy.findUnique({ where: { customerId } });
      }
    } catch (error: any) {
      console.error(`[LATE_PUNCH_POLICY] employee=${employee.id}: ${error?.message}`);
    }
    return evaluateLatePunch({
      punchIn,
      shift: employee.shift?.startTime ? employee.shift : null,
      policy: latePolicy || {
        isEnabled: true,
        deductionRatePerMin: 1,
        gracePeriodMinutes: employee.shift?.gracePeriodMinutes ?? attendancePolicy?.gracePeriodMinutes ?? 0,
        currency: 'INR',
      },
      isHoliday,
      isApprovedLeave,
      workingDaysPerWeek: attendancePolicy?.workingDaysPerWeek || 5,
      employeeId: employee.id,
      employeeRole: employee.designation?.name || employee.designation?.code || null,
    });
  }

  private async notifyAttendanceEvent(employee: any, attendanceId: number | undefined, eventId: string, title: string, body: string, data: Record<string, string>) {
    const userId = Number(employee?.userId);
    if (!this.notificationService || !attendanceId || !Number.isInteger(userId) || userId <= 0) return;
    try {
      const user = await this.prisma.user.findFirst({ where: { id: userId, customerId: employee.customerId, deletedAt: null }, select: { id: true } });
      if (!user) return;
      const key = `${attendanceId}:${eventId}`;
      const prior = await this.prisma.notification.findMany({ where: { userId, customerId: employee.customerId }, orderBy: { id: 'desc' }, take: 100, select: { data: true } });
      if (prior.some((row: any) => row.data?.eventId === key)) return;
      const type = eventId.startsWith('LATE') ? 'LATE_MARK' : 'ATTENDANCE';
      await this.notificationService.sendPushNotification({ userId, customerId: employee.customerId, title, body, type, data: { ...data, type, eventId: key, attendanceId: String(attendanceId), employeeId: String(employee.id), route: type === 'LATE_MARK' ? '/attendance/late-marks' : '/attendance' } });
    } catch (error: any) { console.error(`[ATTENDANCE_NOTIFICATION] event=${eventId} attendance=${attendanceId} failed: ${error?.message || 'dispatch error'}`); }
  }

  private async notifyLatePunchIn(employee: any, attendanceId: number | undefined, evaluation: { applicable: boolean; isLate: boolean; lateMinutes: number; deduction: number; currency?: string }) {
    if (!this.notificationService || !attendanceId || !evaluation.applicable || !evaluation.isLate || evaluation.lateMinutes <= 0) return;
    const money = this.formatLateMoney(evaluation.deduction, evaluation.currency);
    const title = 'Late Punch-In Detected';
    const ownBody = `You punched in ${evaluation.lateMinutes} minutes late today. Your applicable late-mark deduction is ${money}.`;
    const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ') || 'An employee';
    const otherBody = `${name} punched in ${evaluation.lateMinutes} minutes late today. Applicable late-mark deduction is ${money}.`;
    const recipients = new Set<number>();
    if (employee.userId) recipients.add(Number(employee.userId));
    try {
      if (employee.managerId && this.prisma.employee?.findUnique) {
        const manager = await this.prisma.employee.findUnique({
          where: { id: employee.managerId },
          select: { userId: true },
        });
        if (manager?.userId) recipients.add(manager.userId);
      }
      if ((this.prisma as any).user?.findMany) {
        const admins = await (this.prisma as any).user.findMany({
          where: {
            customerId: employee.customerId,
            deletedAt: null,
            role: { in: ['HR', 'HR_ADMIN', 'ADMIN'] },
          },
          select: { id: true },
          take: 10,
        });
        for (const admin of admins || []) {
          if (admin?.id) recipients.add(Number(admin.id));
        }
      }
    } catch (error: any) {
      console.error(`[LATE_PUNCH_RECIPIENTS] employee=${employee.id}: ${error?.message}`);
    }
    for (const userId of recipients) {
      try {
        if (await this.latePunchAlreadyNotified(userId, attendanceId)) continue;
        await this.notificationService.sendPushNotification({
          userId,
          customerId: employee.customerId,
          title,
          body: userId === Number(employee.userId) ? ownBody : otherBody,
          type: 'LATE_PUNCH_IN',
          data: {
            type: 'LATE_PUNCH_IN',
            attendanceId: String(attendanceId),
            lateMinutes: String(evaluation.lateMinutes),
            deduction: String(evaluation.deduction),
          },
        });
      } catch (error: any) {
        console.error(`[LATE_PUNCH_NOTIFY] attendance=${attendanceId} user=${userId}: ${error?.message}`);
      }
    }
  }

  private async latePunchAlreadyNotified(userId: number, attendanceId: number) {
    if (!this.prisma.notification?.findMany) return false;
    const rows = await this.prisma.notification.findMany({
      where: { userId, type: 'LATE_PUNCH_IN' },
      orderBy: { id: 'desc' },
      take: 30,
      select: { data: true },
    });
    return rows.some((row) => String((row.data as any)?.attendanceId) === String(attendanceId));
  }

  private parseTimeStrToDate(timeStr: string | null | undefined, baseDate: Date): Date | null {
    if (!timeStr) return null;
    const clean = timeStr.trim().toUpperCase();
    const match = clean.match(/(\d+):(\d+)(?::(\d+))?\s*(AM|PM)?/);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const meridian = match[4];
    if (meridian === 'PM' && hours < 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;
    const d = new Date(baseDate);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  async getLiveDashboardData(user: any, customerIdParam?: number | string, dateParam?: string) {
    const customerId = await this.resolveCustomerId(user, customerIdParam);
    await this.processAutoCheckOuts({ customerId });
    const { start: startOfDay, end: endOfDay } = getBusinessDayRange(dateParam);

    const [activeEmployees, offices, attendances, locations] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          customerId,
          status: 'ACTIVE',
        },
        include: {
          department: true,
          designation: true,
          office: true,
          shift: true,
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.branchGeofence.findMany({
        where: {
          customerId,
          isActive: true,
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: {
          customerId,
          date: { gte: startOfDay, lte: endOfDay },
        },
        include: {
          breaks: {
            orderBy: { breakStart: 'asc' },
          },
          office: true,
        },
      }),
      this.prisma.employeeLocation.findMany({
        where: {
          customerId,
          timestamp: { gte: startOfDay, lte: endOfDay },
        },
        orderBy: { timestamp: 'desc' },
      }),
    ]);

    const attMap = new Map<number, (typeof attendances)[0]>();
    for (const att of attendances) {
      attMap.set(att.employeeId, att);
    }

    const locMap = new Map<number, (typeof locations)[0]>();
    for (const loc of locations) {
      if (!locMap.has(loc.employeeId)) {
        locMap.set(loc.employeeId, loc);
      }
    }

    const now = new Date();

    const formattedEmployees = activeEmployees.map((emp) => {
      const att = attMap.get(emp.id);
      const latestLoc = locMap.get(emp.id);
      const assignedOffice =
        emp.office || offices.find((o) => o.id === emp.officeId) || offices[0] || null;

      const punchInDate = att?.punchIn ? new Date(att.punchIn) : null;
      const punchOutDate = att?.punchOut ? new Date(att.punchOut) : null;

      const breaks = att?.breaks || [];
      const activeBreak = breaks.find((b) => !b.breakEnd);
      const isOnBreak = Boolean(activeBreak);
      const activeBreakStart = activeBreak?.breakStart ? activeBreak.breakStart.toISOString() : null;

      let currentBreakMinutes = 0;
      if (activeBreak) {
        currentBreakMinutes = Math.max(
          0,
          Math.round((now.getTime() - new Date(activeBreak.breakStart).getTime()) / (1000 * 60)),
        );
      }

      const totalBreakMinutesToday = breaks.reduce((sum, b) => {
        if (b.duration) return sum + b.duration;
        if (b.breakEnd) {
          return (
            sum +
            Math.round(
              (new Date(b.breakEnd).getTime() - new Date(b.breakStart).getTime()) / (1000 * 60),
            )
          );
        }
        return sum + currentBreakMinutes;
      }, 0);

      let workingMinutes = 0;
      if (punchInDate) {
        const endWork = punchOutDate || now;
        const totalElapsed = Math.max(
          0,
          Math.round((endWork.getTime() - punchInDate.getTime()) / (1000 * 60)),
        );
        workingMinutes = Math.max(0, totalElapsed - totalBreakMinutesToday);
      }

      let currentStatus = 'NOT_CHECKED_IN';
      let attendanceStatus = 'ABSENT';

      if (punchInDate) {
        if (punchOutDate) {
          currentStatus = 'PUNCHED_OUT';
          attendanceStatus = att?.status ? String(att.status) : 'PRESENT';
        } else if (isOnBreak) {
          currentStatus = 'ON_BREAK';
          attendanceStatus = att?.status ? String(att.status) : 'PRESENT';
        } else {
          currentStatus = 'WORKING';
          attendanceStatus = att?.status ? String(att.status) : 'PRESENT';
        }
      }

      const isLate = Boolean(att?.isLate);
      const lateMinutes = att?.lateMinutes || 0;

      const empLat = latestLoc?.latitude ?? att?.punchOutLatitude ?? att?.latitude ?? null;
      const empLng = latestLoc?.longitude ?? att?.punchOutLongitude ?? att?.longitude ?? null;
      const lastLocationUpdate =
        latestLoc?.timestamp?.toISOString() ?? (att?.updatedAt ? att.updatedAt.toISOString() : null);

      let distanceFromOffice: number | null = null;
      let locationStatus = 'UNAVAILABLE';

      if (
        empLat != null &&
        empLng != null &&
        assignedOffice?.latitude != null &&
        assignedOffice?.longitude != null
      ) {
        distanceFromOffice = calculateDistanceMeters(
          empLat,
          empLng,
          assignedOffice.latitude,
          assignedOffice.longitude,
        );
        const radius = assignedOffice.radiusMeters || 200;
        locationStatus = distanceFromOffice <= radius ? 'INSIDE_RADIUS' : 'OUTSIDE_RADIUS';
      } else if (att?.locationStatus) {
        locationStatus = att.locationStatus;
        distanceFromOffice = att.distanceFromOffice ?? null;
      }

      const workMode = att?.workMode || (emp as any).workMode || 'OFFICE';

      return {
        id: emp.id,
        employeeCode: emp.employeeCode,
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        email: emp.email,
        phone: emp.phone || null,
        department: emp.department?.name || 'General',
        departmentId: emp.departmentId || null,
        designation: emp.designation?.name || 'Staff',
        office: assignedOffice
          ? {
              id: assignedOffice.id,
              name: assignedOffice.name,
              city: assignedOffice.city,
              latitude: assignedOffice.latitude,
              longitude: assignedOffice.longitude,
              radiusMeters: assignedOffice.radiusMeters,
            }
          : null,
        shift: emp.shift
          ? {
              id: emp.shift.id,
              name: emp.shift.name,
              code: emp.shift.code,
              startTime: emp.shift.startTime,
              endTime: emp.shift.endTime,
              gracePeriodMinutes: 0,
              durationHours: emp.shift.durationHours || 8,
            }
          : null,
        punchIn: punchInDate ? punchInDate.toISOString() : null,
        punchOut: punchOutDate ? punchOutDate.toISOString() : null,
        workingMinutes,
        currentStatus,
        breakStatus: isOnBreak ? 'ON_BREAK' : 'NO_ACTIVE_BREAK',
        activeBreakStart,
        currentBreakMinutes,
        totalBreakMinutesToday,
        attendanceStatus,
        locationStatus,
        workMode,
        distanceFromOffice,
        latitude: empLat,
        longitude: empLng,
        lastLocationUpdate,
        isLate,
        lateMinutes,
        breaks: breaks.map((b) => ({
          id: b.id,
          breakStart: b.breakStart.toISOString(),
          breakEnd: b.breakEnd ? b.breakEnd.toISOString() : null,
          duration: b.duration || 0,
        })),
      };
    });

    const totalEmployees = activeEmployees.length;
    const present = formattedEmployees.filter((e) => e.punchIn !== null).length;
    const absent = Math.max(0, totalEmployees - present);
    const late = formattedEmployees.filter((e) => e.isLate).length;
    const working = formattedEmployees.filter((e) => e.currentStatus === 'WORKING').length;
    const onBreak = formattedEmployees.filter((e) => e.currentStatus === 'ON_BREAK').length;
    const punchedOut = formattedEmployees.filter((e) => e.currentStatus === 'PUNCHED_OUT').length;
    const remote = formattedEmployees.filter((e) => e.workMode.toUpperCase() === 'REMOTE').length;
    const insideRadius = formattedEmployees.filter(
      (e) => e.locationStatus === 'INSIDE_RADIUS',
    ).length;
    const outsideRadius = formattedEmployees.filter(
      (e) => e.locationStatus === 'OUTSIDE_RADIUS',
    ).length;

    return {
      success: true,
      data: {
        summary: {
          totalEmployees,
          present,
          absent,
          late,
          working,
          onBreak,
          punchedOut,
          remote,
          insideRadius,
          outsideRadius,
        },
        employees: formattedEmployees,
        offices: offices.map((o) => ({
          id: o.id,
          name: o.name,
          city: o.city,
          latitude: o.latitude,
          longitude: o.longitude,
          radiusMeters: o.radiusMeters,
        })),
        timestamp: new Date().toISOString(),
      },
    };
  }

  async getLiveEmployees(user: any, customerIdParam?: number | string, dateParam?: string) {
    const full = await this.getLiveDashboardData(user, customerIdParam, dateParam);
    return {
      success: true,
      data: full.data.employees,
      timestamp: full.data.timestamp,
    };
  }

  async getLiveLocations(user: any, customerIdParam?: number | string, dateParam?: string) {
    const full = await this.getLiveDashboardData(user, customerIdParam, dateParam);
    return {
      success: true,
      data: {
        offices: full.data.offices,
        employees: full.data.employees.filter((e) => e.latitude != null && e.longitude != null),
      },
      timestamp: full.data.timestamp,
    };
  }

  async getLiveBreaks(user: any, customerIdParam?: number | string, dateParam?: string) {
    const full = await this.getLiveDashboardData(user, customerIdParam, dateParam);
    const onBreakEmployees = full.data.employees.filter((e) => e.breakStatus === 'ON_BREAK');
    const allBreaks = full.data.employees.flatMap((e) =>
      e.breaks.map((b) => ({
        employeeId: e.id,
        employeeName: e.name,
        department: e.department,
        ...b,
      })),
    );

    return {
      success: true,
      data: {
        onBreakCount: onBreakEmployees.length,
        activeBreaks: onBreakEmployees,
        allBreaks,
      },
      timestamp: full.data.timestamp,
    };
  }

  async getTodayAttendanceSummary(user: any, customerIdParam?: number | string, dateParam?: string) {
    const full = await this.getLiveDashboardData(user, customerIdParam, dateParam);
    return {
      success: true,
      data: {
        summary: full.data.summary,
        date: dateParam || new Date().toISOString().split('T')[0],
      },
      timestamp: full.data.timestamp,
    };
  }
}
