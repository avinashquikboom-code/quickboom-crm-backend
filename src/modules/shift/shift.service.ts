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
  UnassignEmployeesDto,
  QueryShiftHistoryDto,
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
          gracePeriodMinutes: dto.gracePeriodMinutes ?? 0,
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
          punchInRule: dto.guidance?.punchInRule || 'Punch-in permitted 30 mins before shift start. Lateness starts at shift start.',
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

  async assignEmployees(
    customerId: number | string | null,
    id: number | string,
    dto: AssignEmployeesToShiftDto,
    user?: any,
    isSuperAdmin = false,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId, isSuperAdmin);

    const changedById = user?.id || null;
    const changedByName = user
      ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        user.name ||
        user.email ||
        'Admin'
      : 'Admin';

    // Collect all employee IDs to assign
    const targetEmployeeIds = new Set<number>();
    if (dto.employeeIds && Array.isArray(dto.employeeIds)) {
      dto.employeeIds.map(Number).filter((n) => !isNaN(n) && n > 0).forEach((id) => targetEmployeeIds.add(id));
    }

    if (dto.departmentId) {
      const deptEmployees = await this.prisma.employee.findMany({
        where: { customerId: numCustomerId, departmentId: Number(dto.departmentId) },
        select: { id: true },
      });
      deptEmployees.forEach((e) => targetEmployeeIds.add(e.id));
    }

    const employeeIdList = Array.from(targetEmployeeIds);
    if (employeeIdList.length === 0) {
      return this.findOne(numCustomerId, numId, isSuperAdmin);
    }

    // Fetch existing employee records to track previous shifts
    const existingEmployees = await this.prisma.employee.findMany({
      where: { customerId: numCustomerId, id: { in: employeeIdList } },
      select: { id: true, shiftId: true },
    });

    const effectiveDate = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    const reasonText = dto.reason?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      for (const emp of existingEmployees) {
        if (emp.shiftId !== numId) {
          // Update employee shift
          await tx.employee.update({
            where: { id: emp.id },
            data: { shiftId: numId },
          });

          // Create history record
          await tx.shiftAssignmentHistory.create({
            data: {
              customerId: numCustomerId,
              employeeId: emp.id,
              shiftId: numId,
              previousShiftId: emp.shiftId,
              newShiftId: numId,
              changedById,
              changedByName,
              effectiveFrom: effectiveDate,
              reason: reasonText || (emp.shiftId ? 'Shift changed by administrator' : 'Initial shift assignment'),
            },
          });
        }
      }
    });

    return this.findOne(numCustomerId, numId, isSuperAdmin);
  }

  async unassignEmployees(
    customerId: number | string | null,
    id: number | string | null,
    dto: UnassignEmployeesDto,
    user?: any,
    isSuperAdmin = false,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = id ? Number(id) : null;
    if (numId) {
      await this.findOne(numCustomerId, numId, isSuperAdmin);
    }

    const changedById = user?.id || null;
    const changedByName = user
      ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        user.name ||
        user.email ||
        'Admin'
      : 'Admin';

    const employeeIds = (dto.employeeIds || []).map(Number).filter((n) => !isNaN(n) && n > 0);
    if (employeeIds.length === 0) {
      return { count: 0 };
    }

    const where: any = { customerId: numCustomerId, id: { in: employeeIds } };
    if (numId) {
      where.shiftId = numId;
    }

    const existingEmployees = await this.prisma.employee.findMany({
      where,
      select: { id: true, shiftId: true },
    });

    const reasonText = dto.reason?.trim() || 'Unassigned from shift';
    const effectiveDate = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const emp of existingEmployees) {
        if (emp.shiftId !== null) {
          await tx.employee.update({
            where: { id: emp.id },
            data: { shiftId: null },
          });

          await tx.shiftAssignmentHistory.create({
            data: {
              customerId: numCustomerId,
              employeeId: emp.id,
              shiftId: null,
              previousShiftId: emp.shiftId,
              newShiftId: null,
              changedById,
              changedByName,
              effectiveFrom: effectiveDate,
              reason: reasonText,
            },
          });
        }
      }
    });

    return { count: existingEmployees.length };
  }

  async getShiftHistory(
    customerId: number | string | null,
    query: QueryShiftHistoryDto = {},
    isSuperAdmin = false,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId };

    if (query.employeeId) {
      where.employeeId = Number(query.employeeId);
    }

    if (query.shiftId) {
      const sId = Number(query.shiftId);
      where.OR = [
        { shiftId: sId },
        { previousShiftId: sId },
        { newShiftId: sId },
      ];
    }

    if (query.startDate || query.endDate) {
      where.effectiveFrom = {};
      if (query.startDate) {
        where.effectiveFrom.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.effectiveFrom.lte = end;
      }
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      const searchConditions: any[] = [
        { reason: { contains: q, mode: 'insensitive' } },
        { changedByName: { contains: q, mode: 'insensitive' } },
        { employee: { firstName: { contains: q, mode: 'insensitive' } } },
        { employee: { lastName: { contains: q, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: q, mode: 'insensitive' } } },
        { previousShift: { name: { contains: q, mode: 'insensitive' } } },
        { previousShift: { code: { contains: q, mode: 'insensitive' } } },
        { newShift: { name: { contains: q, mode: 'insensitive' } } },
        { newShift: { code: { contains: q, mode: 'insensitive' } } },
      ];

      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchConditions }];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    const [total, records] = await Promise.all([
      this.prisma.shiftAssignmentHistory.count({ where }),
      this.prisma.shiftAssignmentHistory.findMany({
        where,
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          employee: {
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
          previousShift: {
            select: {
              id: true,
              name: true,
              code: true,
              startTime: true,
              endTime: true,
              durationHours: true,
              isNightShift: true,
            },
          },
          newShift: {
            select: {
              id: true,
              name: true,
              code: true,
              startTime: true,
              endTime: true,
              durationHours: true,
              isNightShift: true,
            },
          },
          shift: {
            select: {
              id: true,
              name: true,
              code: true,
              startTime: true,
              endTime: true,
              durationHours: true,
              isNightShift: true,
            },
          },
        },
      }),
    ]);

    return {
      data: records,
      rows: records, // For convenience / backward compatibility
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getEmployeeShiftHistory(
    customerId: number | string | null,
    employeeId: number | string,
    isSuperAdmin = false,
  ) {
    return this.getShiftHistory(
      customerId,
      { employeeId: Number(employeeId), limit: 100 },
      isSuperAdmin,
    );
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
