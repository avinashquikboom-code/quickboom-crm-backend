import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateShiftDto,
  UpdateShiftDto,
  UpdateShiftGuidanceDto,
  AssignEmployeesToShiftDto,
} from './dto/shift.dto';

@Injectable()
export class ShiftService {
  private readonly logger = new Logger(ShiftService.name);

  constructor(private prisma: PrismaService) {}

  private async resolveCustomerId(customerId?: number | string | null): Promise<number> {
    if (typeof customerId === 'number' && !isNaN(customerId) && customerId > 0) return customerId;
    if (typeof customerId === 'string' && !isNaN(Number(customerId)) && Number(customerId) > 0) {
      return Number(customerId);
    }
    const firstCustomer = await this.prisma.customer.findFirst({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return firstCustomer?.id || 1;
  }

  async getMetrics(customerId?: number | string | null, isSuperAdmin = false) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    this.logger.log(`[SHIFT_METRICS_DEBUG] queryStarted: true, customerId: ${numCustomerId}`);

    const [total, active, nightShifts, rotationalShifts, assignedEmployees] = await Promise.all([
      this.prisma.shift.count({ where: { customerId: numCustomerId, deletedAt: null } }),
      this.prisma.shift.count({ where: { customerId: numCustomerId, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.shift.count({ where: { customerId: numCustomerId, isNightShift: true, deletedAt: null } }),
      this.prisma.shift.count({ where: { customerId: numCustomerId, isRotational: true, deletedAt: null } }),
      this.prisma.employee.count({
        where: { customerId: numCustomerId, shiftId: { not: null }, status: 'ACTIVE' },
      }),
    ]);

    const result = {
      total,
      active,
      nightShifts,
      rotationalShifts,
      assignedEmployees,
    };
    this.logger.log(`[SHIFT_METRICS_DEBUG] result: ${JSON.stringify(result)}`);
    return result;
  }

  async findAll(
    customerId?: number | string | null,
    query: { status?: string; search?: string; type?: string } = {},
    isSuperAdmin = false,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    this.logger.log(`[SHIFT_DEBUG] request: GET /shifts, customerId: ${numCustomerId}`);

    const where: any = { customerId: numCustomerId, deletedAt: null };

    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    if (query.type === 'NIGHT') {
      where.isNightShift = true;
    } else if (query.type === 'ROTATIONAL') {
      where.isRotational = true;
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
      ];
    }

    const shifts = await this.prisma.shift.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        guidance: true,
        _count: {
          select: { employees: true },
        },
      },
    });

    const results = shifts.map((s) => ({
      ...s,
      employeeCount: s._count?.employees || 0,
    }));
    this.logger.log(`[SHIFT_DEBUG] database: connected, queryStarted: true, resultCount: ${results.length}`);
    return results;
  }

  async findOne(customerId?: number | string | null, id?: number | string, isSuperAdmin = false) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);

    if (isNaN(numId) || numId <= 0) {
      throw new BadRequestException('Invalid shift ID');
    }

    const where: any = { id: numId, deletedAt: null };
    if (!isSuperAdmin) {
      where.customerId = numCustomerId;
    }

    const shift = await this.prisma.shift.findFirst({
      where,
      include: {
        guidance: true,
        employees: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            department: { select: { id: true, name: true } },
            designation: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException(`Shift #${id} not found`);
    }

    return shift;
  }

  async create(customerId: number | string | null, dto: CreateShiftDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    // Verify code uniqueness for customer
    const cleanCode = dto.code ? dto.code.trim().toUpperCase() : 'SHIFT';
    const existing = await this.prisma.shift.findFirst({
      where: { customerId: numCustomerId, code: cleanCode, deletedAt: null },
    });

    if (existing) {
      throw new BadRequestException(`Shift with code "${cleanCode}" already exists`);
    }

    return this.prisma.$transaction(async (tx) => {
      const shift = await tx.shift.create({
        data: {
          customerId: numCustomerId,
          name: dto.name.trim(),
          code: cleanCode,
          startTime: dto.startTime || '09:30 AM',
          endTime: dto.endTime || '06:30 PM',
          durationHours: dto.durationHours ?? 9.0,
          gracePeriodMinutes: dto.gracePeriodMinutes ?? 15,
          halfDayThresholdHours: dto.halfDayThresholdHours ?? 4.5,
          breakDurationMinutes: dto.breakDurationMinutes ?? 60,
          isNightShift: dto.isNightShift ?? false,
          isRotational: dto.isRotational ?? false,
          workingDays: dto.workingDays ?? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
          color: dto.color || '#3B82F6',
          status: dto.status || 'ACTIVE',
          notes: dto.notes,
        },
      });

      // Create Shift Guidance
      await tx.shiftGuidance.create({
        data: {
          shiftId: shift.id,
          customerId: numCustomerId,
          overtimeRule: dto.guidance?.overtimeRule || 'Overtime commences after 9 hours of active shift work; calculated at 1.5x regular wage.',
          punchInRule: dto.guidance?.punchInRule || 'Punch-in permitted 30 mins before shift start. 15-minute grace period applies.',
          punchOutRule: dto.guidance?.punchOutRule || 'Early departure before shift completion requires supervisor half-day clearance.',
          breakPolicy: dto.guidance?.breakPolicy || '1-hour lunch break between 01:00 PM and 02:00 PM + two 15-minute relaxation periods.',
          nightShiftAllowance: dto.guidance?.nightShiftAllowance || (dto.isNightShift ? '₹250 per night shift allowance + complimentary company transport.' : 'N/A'),
          swapPolicy: dto.guidance?.swapPolicy || 'Shift swap requests must be submitted 24 hours in advance with mutual consent.',
          geofenceRequirement: dto.guidance?.geofenceRequirement || 'Mandatory GPS check-in within 150m of assigned office geofence.',
          emergencyContactProtocol: dto.guidance?.emergencyContactProtocol || 'Notify HR & Shift Supervisor immediately on emergency absence.',
          notes: dto.guidance?.notes,
        },
      });

      return tx.shift.findUnique({
        where: { id: shift.id },
        include: { guidance: true },
      });
    });
  }

  async update(customerId: number | string | null, id: number | string, dto: UpdateShiftDto, isSuperAdmin = false) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId, isSuperAdmin);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.shift.update({
        where: { id: numId },
        data: {
          name: dto.name ? dto.name.trim() : undefined,
          code: dto.code ? dto.code.trim().toUpperCase() : undefined,
          startTime: dto.startTime,
          endTime: dto.endTime,
          durationHours: dto.durationHours,
          gracePeriodMinutes: dto.gracePeriodMinutes,
          halfDayThresholdHours: dto.halfDayThresholdHours,
          breakDurationMinutes: dto.breakDurationMinutes,
          isNightShift: dto.isNightShift,
          isRotational: dto.isRotational,
          workingDays: dto.workingDays,
          color: dto.color,
          status: dto.status,
          notes: dto.notes,
        },
        include: { guidance: true },
      });

      if (dto.guidance) {
        await tx.shiftGuidance.upsert({
          where: { shiftId: numId },
          create: {
            shiftId: numId,
            customerId: numCustomerId,
            ...dto.guidance,
          },
          update: {
            ...dto.guidance,
          },
        });
      }

      return tx.shift.findUnique({
        where: { id: numId },
        include: { guidance: true, employees: true },
      });
    });
  }

  async updateGuidance(customerId: number | string | null, id: number | string, dto: UpdateShiftGuidanceDto, isSuperAdmin = false) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId, isSuperAdmin);

    return this.prisma.shiftGuidance.upsert({
      where: { shiftId: numId },
      create: {
        shiftId: numId,
        customerId: numCustomerId,
        ...dto,
      },
      update: {
        ...dto,
      },
    });
  }

  async assignEmployees(customerId: number | string | null, id: number | string, dto: AssignEmployeesToShiftDto, isSuperAdmin = false) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId, isSuperAdmin);

    if (dto.employeeIds && dto.employeeIds.length > 0) {
      await this.prisma.employee.updateMany({
        where: {
          customerId: numCustomerId,
          id: { in: dto.employeeIds.map(Number) },
        },
        data: { shiftId: numId },
      });
    }

    if (dto.departmentId) {
      await this.prisma.employee.updateMany({
        where: {
          customerId: numCustomerId,
          departmentId: Number(dto.departmentId),
        },
        data: { shiftId: numId },
      });
    }

    return this.findOne(numCustomerId, numId, isSuperAdmin);
  }

  async delete(customerId: number | string | null, id: number | string, isSuperAdmin = false) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId, isSuperAdmin);

    return this.prisma.shift.update({
      where: { id: numId },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });
  }
}
