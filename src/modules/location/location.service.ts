import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationGateway } from './location.gateway';

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

  constructor(
    private prisma: PrismaService,
    private readonly locationGateway: LocationGateway,
  ) {}

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

  // Record employee location update from Mobile App (25s periodic tracking)
  async recordLocationUpdate(
    user: any,
    customerId: number | string | undefined,
    dto: LocationUpdateDto,
  ) {
    if (!user) {
      throw new ForbiddenException('Authenticated user context required');
    }

    // 1. Validate GPS Coordinates
    if (
      dto.latitude === undefined ||
      dto.longitude === undefined ||
      isNaN(Number(dto.latitude)) ||
      isNaN(Number(dto.longitude)) ||
      dto.latitude < -90 ||
      dto.latitude > 90 ||
      dto.longitude < -180 ||
      dto.longitude > 180
    ) {
      throw new BadRequestException('Valid GPS latitude (-90 to 90) and longitude (-180 to 180) are required.');
    }

    if (dto.latitude === 0 && dto.longitude === 0) {
      throw new BadRequestException('Invalid GPS coordinates (0, 0).');
    }

    const targetCustomerId = user?.customerId || (customerId ? Number(customerId) : undefined);

    // 2. Resolve Employee Profile
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
        },
      });
    }

    if (!employee) {
      throw new NotFoundException('No active employee profile linked to your user account.');
    }

    // 3. Compute distance from assigned office geofence if present
    let distanceFromOffice: number | null = null;
    let locationStatus: string = 'INSIDE_RADIUS';

    if (employee.office && employee.office.latitude && employee.office.longitude) {
      distanceFromOffice = this.calculateHaversineDistance(
        Number(dto.latitude),
        Number(dto.longitude),
        Number(employee.office.latitude),
        Number(employee.office.longitude),
      );
      const allowedRadius = Number(employee.office.radiusMeters) || 200.0;
      locationStatus = distanceFromOffice <= allowedRadius ? 'INSIDE_RADIUS' : 'OUTSIDE_RADIUS';
    }

    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // 4. Check today's active attendance
    const todayAtt = await this.prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: todayStart, lte: todayEnd },
      },
      include: { breaks: true },
    });

    let activeStatus: 'WORKING' | 'ON_BREAK' | 'ON_VISIT' | 'REMOTE' | 'CHECKED_OUT' | 'OFFLINE' = 'OFFLINE';
    if (todayAtt?.punchIn && !todayAtt?.punchOut) {
      const onBreak = todayAtt.breaks?.some((b) => !b.breakEnd);
      activeStatus = onBreak ? 'ON_BREAK' : todayAtt.workMode === 'REMOTE' ? 'REMOTE' : 'WORKING';
    } else if (todayAtt?.punchIn && todayAtt?.punchOut) {
      activeStatus = 'CHECKED_OUT';
    }

    // 5. Persist to EmployeeLocation table
    const saved = await this.prisma.employeeLocation.create({
      data: {
        customerId: employee.customerId,
        employeeId: employee.id,
        latitude: Number(dto.latitude),
        longitude: Number(dto.longitude),
        accuracy: dto.accuracy !== undefined ? Number(dto.accuracy) : 10.0,
        address: dto.address,
        distanceFromOffice,
        locationStatus,
        trackingType: (dto.trackingType as any) || 'ATTENDANCE',
        attendanceId: todayAtt?.id ?? (dto.attendanceId ? Number(dto.attendanceId) : null),
        visitId: dto.visitId ? Number(dto.visitId) : null,
        timestamp: now,
      },
    });

    // 6. Broadcast real-time location event via WebSocket Gateway
    const broadcastPayload = {
      id: String(employee.id),
      employeeId: employee.employeeCode || `EMP-${employee.id}`,
      dbEmployeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      firstName: employee.firstName,
      lastName: employee.lastName,
      department: employee.department?.name || 'General',
      designation: employee.designation?.name || 'Staff',
      status: activeStatus,
      lat: saved.latitude,
      lng: saved.longitude,
      latitude: saved.latitude,
      longitude: saved.longitude,
      accuracy: saved.accuracy,
      address: saved.address || (employee.office?.city ? `${employee.office.name}, ${employee.office.city}` : 'Live GPS Point'),
      distanceFromOffice: saved.distanceFromOffice,
      locationStatus: saved.locationStatus,
      lastSeenAt: now.toISOString(),
      lastUpdated: now.toISOString(),
      todayAttendance: todayAtt
        ? {
            punchIn: todayAtt.punchIn ? todayAtt.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
            punchOut: todayAtt.punchOut ? todayAtt.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined,
            workingHours: todayAtt.workingHours || 0.0,
            status: todayAtt.status,
          }
        : {
            punchIn: '',
            workingHours: 0.0,
            status: 'OFFLINE',
          },
      assignedBranch: {
        name: employee.office?.name || 'Head Office',
        radiusMeters: employee.office?.radiusMeters || 200.0,
        distanceMeters: distanceFromOffice || 0,
        isInsideRadius: locationStatus === 'INSIDE_RADIUS',
      },
      trackingMode: 'ACTIVE_TRACKING',
      locationPermission: 'GRANTED',
    };

    this.locationGateway.broadcastLocationUpdate(employee.customerId, broadcastPayload);

    return {
      success: true,
      message: 'Location updated successfully',
      data: {
        id: saved.id,
        employeeId: employee.employeeCode,
        latitude: saved.latitude,
        longitude: saved.longitude,
        accuracy: saved.accuracy,
        updatedAt: now.toISOString(),
      },
    };
  }

  // Get active live locations for Admin Panel initial load
  async getLiveLocations(customerId?: number | string) {
    const numCustomerId = customerId ? Number(customerId) : NaN;
    const whereClause: any = {
      status: 'ACTIVE',
      ...( !isNaN(numCustomerId) && numCustomerId > 0 ? { customerId: numCustomerId } : {} ),
    };

    const employees = await this.prisma.employee.findMany({
      where: whereClause,
      include: {
        department: { select: { name: true } },
        designation: { select: { name: true } },
        office: true,
      },
    });

    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const employeeIds = employees.map((e) => e.id);

    // Fetch latest location for each employee
    const latestLocations = await this.prisma.employeeLocation.findMany({
      where: {
        employeeId: { in: employeeIds },
      },
      orderBy: { timestamp: 'desc' },
      distinct: ['employeeId'],
    });

    const locMap = new Map(latestLocations.map((l) => [l.employeeId, l]));

    // Fetch today's attendance for each employee
    const attendances = await this.prisma.attendance.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: todayStart, lte: todayEnd },
      },
      include: { breaks: true },
    });

    const attMap = new Map(attendances.map((a) => [a.employeeId, a]));

    return employees.map((emp) => {
      const loc = locMap.get(emp.id);
      const att = attMap.get(emp.id);

      let status: 'WORKING' | 'ON_BREAK' | 'ON_VISIT' | 'REMOTE' | 'CHECKED_OUT' | 'OFFLINE' = 'OFFLINE';
      if (att?.punchIn && !att?.punchOut) {
        const onBreak = att.breaks?.some((b) => !b.breakEnd);
        status = onBreak ? 'ON_BREAK' : att.workMode === 'REMOTE' ? 'REMOTE' : 'WORKING';
      } else if (att?.punchIn && att?.punchOut) {
        status = 'CHECKED_OUT';
      }

      const defaultLat = emp.office?.latitude || 19.0760;
      const defaultLng = emp.office?.longitude || 72.8777;

      const lat = loc ? loc.latitude : defaultLat;
      const lng = loc ? loc.longitude : defaultLng;
      const lastSeen = loc ? loc.timestamp : (att?.punchIn || emp.createdAt);

      return {
        id: String(emp.id),
        employeeId: emp.employeeCode || `EMP-${emp.id}`,
        dbEmployeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`.trim(),
        department: emp.department?.name || 'General',
        designation: emp.designation?.name || 'Staff',
        status,
        lat,
        lng,
        accuracy: loc?.accuracy || 15.0,
        address: loc?.address || (emp.office ? `${emp.office.name}, ${emp.office.city || ''}` : 'Main Office'),
        lastUpdated: lastSeen.toISOString(),
        lastSeenAt: lastSeen.toISOString(),
        todayAttendance: {
          punchIn: att?.punchIn ? att.punchIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
          punchOut: att?.punchOut ? att.punchOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined,
          workingHours: att?.workingHours || 0.0,
          status: att?.status || 'OFFLINE',
        },
        assignedBranch: {
          name: emp.office?.name || emp.branch || 'Head Office',
          radiusMeters: emp.office?.radiusMeters || 200.0,
          distanceMeters: loc?.distanceFromOffice || 0,
          isInsideRadius: loc?.locationStatus === 'INSIDE_RADIUS',
        },
        trackingMode: 'ACTIVE_TRACKING',
        locationPermission: loc ? 'GRANTED' : 'UNAVAILABLE',
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

  async getBranchLocation(branchId: number, customerId?: number | string) {
    const numCustomerId = customerId ? Number(customerId) : NaN;
    const branch = await this.prisma.branchGeofence.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException(`Branch with ID ${branchId} not found`);
    }
    if (!isNaN(numCustomerId) && numCustomerId > 0 && branch.customerId !== numCustomerId) {
      throw new ForbiddenException('You do not have access to this branch location');
    }
    return {
      success: true,
      data: {
        id: branch.id,
        name: branch.name,
        city: branch.city,
        latitude: branch.latitude,
        longitude: branch.longitude,
        radiusMeters: branch.radiusMeters,
        isActive: branch.isActive,
      },
    };
  }

  async updateBranchLocation(
    branchId: number,
    customerId: number | string | undefined,
    data: { latitude?: number; longitude?: number; radiusMeters?: number },
  ) {
    const numCustomerId = customerId ? Number(customerId) : NaN;
    const branch = await this.prisma.branchGeofence.findUnique({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException(`Branch with ID ${branchId} not found`);
    }
    if (!isNaN(numCustomerId) && numCustomerId > 0 && branch.customerId !== numCustomerId) {
      throw new ForbiddenException('You do not have access to update this branch location');
    }

    if (data.latitude !== undefined && (data.latitude < -90 || data.latitude > 90)) {
      throw new BadRequestException('Latitude must be between -90 and 90');
    }
    if (data.longitude !== undefined && (data.longitude < -180 || data.longitude > 180)) {
      throw new BadRequestException('Longitude must be between -180 and 180');
    }
    if (data.radiusMeters !== undefined && data.radiusMeters <= 0) {
      throw new BadRequestException('Radius must be greater than 0 meters');
    }

    const updated = await this.prisma.branchGeofence.update({
      where: { id: branchId },
      data: {
        ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
        ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
        ...(data.radiusMeters !== undefined ? { radiusMeters: data.radiusMeters } : {}),
      },
    });

    return {
      success: true,
      message: 'Branch location updated successfully',
      data: updated,
    };
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
