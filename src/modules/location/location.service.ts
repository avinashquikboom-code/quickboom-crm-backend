import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LocationUpdateDto {
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
  timestamp?: string;
  trackingType?: 'ATTENDANCE' | 'VISIT' | 'WORKING_HOURS' | 'MANUAL';
  attendanceId?: string;
  visitId?: string;
}

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  constructor(private prisma: PrismaService) {}

  // Calculate distance between two GPS coordinates using Haversine formula (meters)
  calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371e3; // metres
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c); // Distance in meters
  }

  // Record employee location update
  async recordLocationUpdate(
    customerId: number | string,
    employeeId: number | string,
    dto: LocationUpdateDto,
  ) {
    let numCustomerId = Number(customerId);
    let numEmployeeId = Number(employeeId);

    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      const defaultCust = await this.prisma.customer.findFirst({ select: { id: true } });
      numCustomerId = defaultCust?.id || 1;
    }
    if (isNaN(numEmployeeId) || numEmployeeId <= 0) {
      const defaultEmp = await this.prisma.employee.findFirst({
        where: { customerId: numCustomerId },
        select: { id: true },
      });
      numEmployeeId = defaultEmp?.id || 1;
    }

    this.logger.log(
      `Recording location update for employee ${numEmployeeId} in customer ${numCustomerId}: lat=${dto.latitude}, lng=${dto.longitude}`,
    );

    return this.prisma.employeeLocation.create({
      data: {
        customerId: numCustomerId,
        employeeId: numEmployeeId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy ?? 10.0,
        address: dto.address,
        trackingType: (dto.trackingType as any) || 'ATTENDANCE',
        attendanceId: dto.attendanceId ? Number(dto.attendanceId) : null,
        visitId: dto.visitId ? Number(dto.visitId) : null,
        timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
      },
    });
  }

  // Get active live locations for admin panel
  async getLiveLocations(customerId?: number | string) {
    const numCustomerId = customerId ? Number(customerId) : NaN;
    const whereClause: any = {};
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      whereClause.customerId = numCustomerId;
    }

    const locations = await this.prisma.employeeLocation.findMany({
      where: whereClause,
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    const employeeIds = Array.from(new Set(locations.map((l) => l.employeeId)));
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });

    const empMap = new Map(employees.map((e) => [e.id, e]));

    return locations.map((loc) => {
      const emp = empMap.get(loc.employeeId);
      return {
        ...loc,
        employee: emp
          ? {
              id: emp.id,
              employeeCode: emp.employeeCode,
              firstName: emp.firstName,
              lastName: emp.lastName,
              name: `${emp.firstName} ${emp.lastName}`,
              branch: emp.branch,
              department: emp.department?.name || 'General',
              designation: emp.designation?.name || 'Staff',
            }
          : null,
      };
    });
  }

  // Get history timeline for specific employee and date
  async getLocationHistory(
    customerId: number | string,
    employeeId: number | string,
    date: string,
  ) {
    const numCustomerId = Number(customerId);
    const numEmployeeId = Number(employeeId);
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const whereClause: any = {
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      whereClause.customerId = numCustomerId;
    }
    if (!isNaN(numEmployeeId) && numEmployeeId > 0) {
      whereClause.employeeId = numEmployeeId;
    }

    return this.prisma.employeeLocation.findMany({
      where: whereClause,
      orderBy: { timestamp: 'asc' },
    });
  }

  // Branch Geofence Management
  async getBranchGeofences(customerId?: number | string) {
    const numCustomerId = customerId ? Number(customerId) : NaN;
    const whereClause: any = { isActive: true };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      whereClause.customerId = numCustomerId;
    }

    return this.prisma.branchGeofence.findMany({
      where: whereClause,
    });
  }

  async createBranchGeofence(
    customerId: number | string,
    data: { name: string; city?: string; latitude: number; longitude: number; radiusMeters?: number },
  ) {
    let numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      const defaultCust = await this.prisma.customer.findFirst({ select: { id: true } });
      numCustomerId = defaultCust?.id || 1;
    }

    return this.prisma.branchGeofence.create({
      data: {
        customerId: numCustomerId,
        name: data.name,
        city: data.city,
        latitude: data.latitude,
        longitude: data.longitude,
        radiusMeters: data.radiusMeters ?? 200.0,
      },
    });
  }
}
