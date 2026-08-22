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

    // Lookup employee by userId or email
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

    // Fallback: If SuperAdmin or Admin testing without linked Employee record, link or pick first employee
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
    if (employee.office && employee.office.isActive) {
      return employee.office;
    }

    if (employee.officeId) {
      const office = await this.prisma.branchGeofence.findUnique({
        where: { id: employee.officeId },
      });
      if (office && office.isActive) {
        return office;
      }
    }

    // Check by branch name
    if (employee.branch) {
      const office = await this.prisma.branchGeofence.findFirst({
        where: {
          customerId: employee.customerId,
          name: { equals: employee.branch.trim(), mode: 'insensitive' },
          isActive: true,
        },
      });
      if (office) return office;
    }

    // Default office for customer
    const defaultOffice = await this.prisma.branchGeofence.findFirst({
      where: { customerId: employee.customerId, isActive: true },
      orderBy: { id: 'asc' },
    });

    if (!defaultOffice) {
      throw new BadRequestException(
        'No active office location configured for your organization. Please contact Admin.',
      );
    }

    return defaultOffice;
  }

  async checkIn(user: any, customerId: number | string | undefined, dto: PunchAttendanceDto) {
    if (dto.latitude === undefined || dto.longitude === undefined || isNaN(dto.latitude) || isNaN(dto.longitude)) {
      throw new BadRequestException('Valid GPS coordinates (latitude & longitude) are required.');
    }

    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);

    // Calculate distance from assigned office coordinates
    const distanceMeters = calculateDistanceMeters(
      dto.latitude,
      dto.longitude,
      office.latitude,
      office.longitude,
    );

    const allowedRadius = office.radiusMeters || 200.0;

    // GEO-FENCE VALIDATION: Check if employee is within allowed radius
    if (distanceMeters > allowedRadius) {
      throw new BadRequestException(
        `You are outside your assigned office attendance area. Current distance: ${distanceMeters}m (Allowed radius: ${allowedRadius}m for ${office.name}).`,
      );
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const now = new Date();

    // Check existing attendance for today
    let attendance = await this.prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: todayStart, lte: todayEnd },
      },
    });

    if (attendance && attendance.punchIn && !attendance.punchOut) {
      throw new BadRequestException(
        `You are already punched in for today at ${attendance.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
      );
    }

    if (attendance) {
      attendance = await this.prisma.attendance.update({
        where: { id: attendance.id },
        data: {
          punchIn: now,
          status: AttendanceStatus.PRESENT,
          officeId: office.id,
          latitude: dto.latitude,
          longitude: dto.longitude,
          distanceFromOffice: distanceMeters,
          locationIn: `${office.name} (${distanceMeters}m)`,
        },
      });
    } else {
      attendance = await this.prisma.attendance.create({
        data: {
          customerId: employee.customerId,
          employeeId: employee.id,
          date: now,
          punchIn: now,
          status: AttendanceStatus.PRESENT,
          officeId: office.id,
          latitude: dto.latitude,
          longitude: dto.longitude,
          distanceFromOffice: distanceMeters,
          locationIn: `${office.name} (${distanceMeters}m)`,
        },
      });
    }

    return {
      success: true,
      message: `Punch In successful at ${office.name} (${distanceMeters}m from office center).`,
      data: attendance,
      office: {
        id: office.id,
        name: office.name,
        city: office.city,
        distanceMeters,
        allowedRadius,
      },
    };
  }

  async checkOut(user: any, customerId: number | string | undefined, dto: PunchAttendanceDto) {
    if (dto.latitude === undefined || dto.longitude === undefined || isNaN(dto.latitude) || isNaN(dto.longitude)) {
      throw new BadRequestException('Valid GPS coordinates (latitude & longitude) are required.');
    }

    const employee = await this.getAuthenticatedEmployee(user, customerId);
    const office = await this.resolveOfficeForEmployee(employee);

    // Calculate distance from assigned office coordinates
    const distanceMeters = calculateDistanceMeters(
      dto.latitude,
      dto.longitude,
      office.latitude,
      office.longitude,
    );

    const allowedRadius = office.radiusMeters || 200.0;

    // GEO-FENCE VALIDATION: Check if employee is within allowed radius for check-out
    if (distanceMeters > allowedRadius) {
      throw new BadRequestException(
        `You are outside your assigned office attendance area for Check-Out. Current distance: ${distanceMeters}m (Allowed radius: ${allowedRadius}m for ${office.name}).`,
      );
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const now = new Date();

    const attendance = await this.prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: todayStart, lte: todayEnd },
      },
    });

    if (!attendance || !attendance.punchIn) {
      throw new BadRequestException('Cannot punch out without an active punch-in for today.');
    }

    const diffMs = now.getTime() - new Date(attendance.punchIn).getTime();
    const workingHours = Math.max(0, Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100);

    const updated = await this.prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        punchOut: now,
        workingHours,
        locationOut: `${office.name} (${distanceMeters}m)`,
      },
    });

    return {
      success: true,
      message: `Punch Out successful at ${office.name}. Total hours worked: ${workingHours} hrs.`,
      data: updated,
      office: {
        id: office.id,
        name: office.name,
        city: office.city,
        distanceMeters,
        allowedRadius,
      },
    };
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
        punchInTime: todayAtt?.punchIn ? todayAtt.punchIn.toISOString() : null,
        punchOutTime: todayAtt?.punchOut ? todayAtt.punchOut.toISOString() : null,
        workingHours: todayAtt?.workingHours || 0,
        rawStatus: todayAtt?.status || 'NOT_MARKED',
      },
      todayAttendance: todayAtt,
    };
  }
}
