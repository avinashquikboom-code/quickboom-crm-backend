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
    tenantId: string,
    employeeId: string,
    dto: LocationUpdateDto,
  ) {
    this.logger.log(
      `Recording location update for employee ${employeeId} in tenant ${tenantId}: lat=${dto.latitude}, lng=${dto.longitude}`,
    );

    return this.prisma.employeeLocation.create({
      data: {
        tenantId,
        employeeId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy ?? 10.0,
        address: dto.address,
        trackingType: (dto.trackingType as any) || 'ATTENDANCE',
        attendanceId: dto.attendanceId,
        visitId: dto.visitId,
        timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
      },
    });
  }

  // Get active live locations for admin panel
  async getLiveLocations(tenantId: string) {
    return this.prisma.employeeLocation.findMany({
      where: { tenantId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
  }

  // Get history timeline for specific employee and date
  async getLocationHistory(
    tenantId: string,
    employeeId: string,
    date: string,
  ) {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    return this.prisma.employeeLocation.findMany({
      where: {
        tenantId,
        employeeId,
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { timestamp: 'asc' },
    });
  }

  // Branch Geofence Management
  async getBranchGeofences(tenantId: string) {
    return this.prisma.branchGeofence.findMany({
      where: { tenantId, isActive: true },
    });
  }

  async createBranchGeofence(
    tenantId: string,
    data: { name: string; city?: string; latitude: number; longitude: number; radiusMeters?: number },
  ) {
    return this.prisma.branchGeofence.create({
      data: {
        tenantId,
        name: data.name,
        city: data.city,
        latitude: data.latitude,
        longitude: data.longitude,
        radiusMeters: data.radiusMeters ?? 200.0,
      },
    });
  }
}
