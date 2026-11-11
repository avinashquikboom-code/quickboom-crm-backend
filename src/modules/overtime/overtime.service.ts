import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  hourlyRateFromSalary,
  istDateTime,
  overtimeAmount,
  overtimeWindow,
  rangesOverlap,
  weekBounds,
} from './overtime.calculator';
import {
  ApproveOvertimeDto,
  CancelOvertimeDto,
  CreateOvertimeDto,
  OvertimeQueryDto,
  RejectOvertimeDto,
  UpdateOvertimeSettingsDto,
} from './dto/overtime.dto';

const requestInclude = {
  employee: {
    include: {
      department: { select: { id: true, name: true } },
      designation: { select: { id: true, name: true } },
      salaryStructures: { where: { status: 'ACTIVE' as const }, orderBy: { effectiveFrom: 'desc' as const }, take: 1 },
    },
  },
  shift: { select: { id: true, name: true, code: true, startTime: true, endTime: true, durationHours: true, isNightShift: true, guidance: { select: { overtimeRule: true } } } },
  attendance: { select: { id: true, date: true, punchIn: true, punchOut: true, workingHours: true, workingMinutes: true, breakDuration: true, status: true } },
  payroll: { select: { id: true, month: true, year: true, status: true } },
  payrollItem: { select: { id: true, overtime: true, status: true } },
  history: { orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class OvertimeService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCustomerId(customerId?: number | string): Promise<number> {
    const parsed = Number(customerId);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    const customer = await this.prisma.customer.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
    if (!customer) throw new NotFoundException('No customer is available for this overtime request.');
    return customer.id;
  }

  private actor(user: any) {
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.name || user?.email || 'Administrator';
    return { id: user?.id ? Number(user.id) : null, name };
  }

  private isEmployee(user: any) {
    const role = String(user?.role || user?.roleType || '').toUpperCase();
    return role === 'EMPLOYEE';
  }

  private assertReviewer(user: any) {
    if (this.isEmployee(user)) throw new ForbiddenException('Employees cannot approve, reject, or review overtime requests.');
  }

  async getSettings(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const [policy, salary] = await Promise.all([
      this.prisma.overtimePolicy.findUnique({ where: { customerId: numCustomerId } }),
      this.prisma.salaryPolicy.findFirst({ where: { customerId: numCustomerId, isActive: true }, orderBy: { updatedAt: 'desc' } }),
    ]);
    return this.settingsView(policy, salary);
  }

  async updateSettings(customerId: number | string | undefined, dto: UpdateOvertimeSettingsDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const policy = await this.prisma.overtimePolicy.upsert({
      where: { customerId: numCustomerId },
      create: {
        customerId: numCustomerId,
        enabled: dto.enabled ?? true,
        maxDailyMinutes: dto.maxDailyMinutes ?? 240,
        maxWeeklyMinutes: dto.maxWeeklyMinutes ?? 720,
        weekendMultiplier: dto.weekendMultiplier ?? 2,
        holidayMultiplier: dto.holidayMultiplier ?? 2,
        nightShiftMultiplier: dto.nightShiftMultiplier ?? 1.5,
        approvalRequired: dto.approvalRequired ?? true,
        autoCalculate: dto.autoCalculate ?? false,
        applicableEmployeeTypes: dto.applicableEmployeeTypes ?? [],
      },
      update: {
        enabled: dto.enabled,
        maxDailyMinutes: dto.maxDailyMinutes,
        maxWeeklyMinutes: dto.maxWeeklyMinutes,
        weekendMultiplier: dto.weekendMultiplier,
        holidayMultiplier: dto.holidayMultiplier,
        nightShiftMultiplier: dto.nightShiftMultiplier,
        approvalRequired: dto.approvalRequired,
        autoCalculate: dto.autoCalculate,
        applicableEmployeeTypes: dto.applicableEmployeeTypes,
      },
    });
    let salary = await this.prisma.salaryPolicy.findFirst({ where: { customerId: numCustomerId, isActive: true }, orderBy: { updatedAt: 'desc' } });
    if (salary && (dto.enabled !== undefined || dto.regularMultiplier !== undefined)) {
      salary = await this.prisma.salaryPolicy.update({
        where: { id: salary.id },
        data: {
          overtimeEnabled: dto.enabled ?? salary.overtimeEnabled,
          overtimeMultiplier: dto.regularMultiplier ?? salary.overtimeMultiplier,
        },
      });
    }
    return this.settingsView(policy, salary);
  }

  private settingsView(policy: any, salary: any) {
    return {
      enabled: policy?.enabled ?? salary?.overtimeEnabled ?? true,
      maxDailyMinutes: policy?.maxDailyMinutes ?? 240,
      maxWeeklyMinutes: policy?.maxWeeklyMinutes ?? 720,
      regularMultiplier: salary?.overtimeMultiplier ?? 1.5,
      weekendMultiplier: policy?.weekendMultiplier ?? 2,
      holidayMultiplier: policy?.holidayMultiplier ?? 2,
      nightShiftMultiplier: policy?.nightShiftMultiplier ?? 1.5,
      approvalRequired: policy?.approvalRequired ?? true,
      autoCalculate: policy?.autoCalculate ?? false,
      applicableEmployeeTypes: policy?.applicableEmployeeTypes ?? [],
      overtimeCalculationMethod: salary?.overtimeCalculationMethod ?? 'HOURLY_BASE',
      workingDaysPerMonth: salary?.workingDaysPerMonth ?? 30,
      salaryPolicyId: salary?.id ?? null,
    };
  }

  async findAll(user: any, customerId: number | string | undefined, query: OvertimeQueryDto = {}) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = await this.whereFor(user, numCustomerId, query);
    const sortBy = query.sortBy || 'overtimeDate';
    const sortOrder = query.sortOrder || 'desc';
    const [total, rows] = await Promise.all([
      this.prisma.overtimeRequest.count({ where }),
      this.prisma.overtimeRequest.findMany({
        where,
        include: requestInclude,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const rules = await this.rules(numCustomerId);
    return {
      data: rows.map((row) => this.present(row, rules)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getSummary(user: any, customerId?: number | string, query: OvertimeQueryDto = {}) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const where = await this.whereFor(user, numCustomerId, { ...query, status: undefined, payrollStatus: undefined });
    const rows = await this.prisma.overtimeRequest.findMany({
      where,
      select: { status: true, totalMinutes: true, approvedMinutes: true, calculatedAmount: true, payrollStatus: true },
    });
    const sum = (items: typeof rows, field: 'totalMinutes' | 'approvedMinutes' | 'calculatedAmount') =>
      items.reduce((total, row) => total + (Number(row[field]) || 0), 0);
    const approved = rows.filter((row) => row.status === 'APPROVED');
    const payrollPending = approved.filter((row) => row.payrollStatus === 'READY_FOR_PAYROLL');
    return {
      totalRequests: rows.length,
      pending: rows.filter((row) => row.status === 'PENDING').length,
      approved: approved.length,
      rejected: rows.filter((row) => row.status === 'REJECTED').length,
      cancelled: rows.filter((row) => row.status === 'CANCELLED').length,
      totalRequestedHours: Math.round((sum(rows, 'totalMinutes') / 60) * 100) / 100,
      totalApprovedHours: Math.round((sum(approved, 'approvedMinutes') / 60) * 100) / 100,
      compensationAmount: Math.round(sum(approved, 'calculatedAmount') * 100) / 100,
      payrollPendingAmount: Math.round(sum(payrollPending, 'calculatedAmount') * 100) / 100,
    };
  }

  async findOne(user: any, customerId: number | string | undefined, id: number) {
    const row = await this.loadOwned(user, customerId, id);
    const rules = await this.rules(row.customerId);
    return this.present(row, rules);
  }

  async preview(user: any, customerId: number | string | undefined, id: number, approvedMinutes?: number) {
    const row = await this.loadOwned(user, customerId, id);
    const minutes = approvedMinutes || row.totalMinutes;
    if (minutes > row.totalMinutes) throw new BadRequestException('Approved minutes cannot exceed the requested duration.');
    const rules = await this.rules(row.customerId);
    const pay = await this.compensation(row, minutes, rules);
    return { approvedMinutes: minutes, ...pay };
  }

  async create(user: any, customerId: number | string | undefined, dto: CreateOvertimeDto, ownOnly = false) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const employeeId = await this.resolveEmployeeId(user, numCustomerId, dto.employeeId, ownOnly);
    const rules = await this.rules(numCustomerId);
    if (!rules.enabled) throw new BadRequestException('Overtime is disabled for this company.');
    if (!dto.reason?.trim()) throw new BadRequestException('A reason is required.');
    const window = overtimeWindow(dto.overtimeDate, dto.startTime, dto.endTime);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId: numCustomerId },
      include: { shift: true, salaryStructures: { where: { status: 'ACTIVE' as const }, orderBy: { effectiveFrom: 'desc' as const }, take: 1 } },
    });
    if (!employee) throw new NotFoundException('Employee was not found for this company.');
    if (rules.applicableEmployeeTypes.length && !rules.applicableEmployeeTypes.includes(employee.employeeType)) {
      throw new BadRequestException('This employee type is not eligible for overtime.');
    }
    const shiftId = dto.shiftId ? Number(dto.shiftId) : employee.shiftId;
    const shift = shiftId
      ? await this.prisma.shift.findFirst({ where: { id: shiftId, customerId: numCustomerId, deletedAt: null } })
      : employee.shift;
    if (shiftId && !shift) throw new BadRequestException('Shift does not belong to this company.');
    if (ownOnly && window.startAt.getTime() < Date.now() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Overtime must be requested at least 24 hours before the overtime start time.');
    }
    this.assertShiftWindow(dto.overtimeType, shift, window);
    if (dto.attendanceId) {
      const attendance = await this.prisma.attendance.findFirst({ where: { id: Number(dto.attendanceId), customerId: numCustomerId, employeeId } });
      if (!attendance) throw new BadRequestException('Attendance record does not belong to this employee.');
    }
    await this.assertLimits(numCustomerId, employeeId, window.date, window.startAt, window.totalMinutes, rules);
    const autoApprove = rules.autoCalculate && !rules.approvalRequired;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.overtimeRequest.create({
        data: {
          customerId: numCustomerId,
          employeeId,
          attendanceId: dto.attendanceId ? Number(dto.attendanceId) : null,
          shiftId: shiftId || null,
          overtimeDate: window.startAt,
          startTime: dto.startTime.trim(),
          endTime: dto.endTime.trim(),
          startAt: window.startAt,
          endAt: window.endAt,
          totalMinutes: window.totalMinutes,
          overtimeType: dto.overtimeType as any,
          reason: dto.reason.trim(),
          employeeNotes: dto.employeeNotes?.trim() || null,
          status: autoApprove ? 'APPROVED' : 'PENDING',
          payrollStatus: autoApprove ? 'READY_FOR_PAYROLL' : 'NOT_PROCESSED',
        },
      });
      await tx.overtimeApproval.create({
        data: { customerId: numCustomerId, overtimeRequestId: row.id, action: 'SUBMIT', fromStatus: 'PENDING', toStatus: row.status, actorId: this.actor(user).id, actorName: this.actor(user).name, notes: dto.employeeNotes?.trim() || null },
      });
      await this.audit(tx, numCustomerId, user, 'CREATE', row.id, 'Overtime request submitted');
      return row;
    });
    if (autoApprove) return this.approve(user, numCustomerId, created.id, { approvedMinutes: created.totalMinutes });
    return this.findOne(user, numCustomerId, created.id);
  }

  async approve(user: any, customerId: number | string | undefined, id: number, dto: ApproveOvertimeDto) {
    this.assertReviewer(user);
    const numCustomerId = await this.resolveCustomerId(customerId);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.overtimeRequest.findFirst({ where: { id, customerId: numCustomerId, deletedAt: null }, include: requestInclude });
      if (!current) throw new NotFoundException('Overtime request was not found.');
      if (current.status !== 'PENDING') throw new ConflictException('Only a pending overtime request can be approved.');
      const minutes = dto.approvedMinutes ?? current.totalMinutes;
      if (minutes <= 0 || minutes > current.totalMinutes) throw new BadRequestException('Approved minutes must be between 1 and the requested duration.');
      const rules = await this.rules(numCustomerId);
      const pay = await this.compensation(current, minutes, rules);
      const actor = this.actor(user);
      const updatedCount = await tx.overtimeRequest.updateMany({
        where: { id, customerId: numCustomerId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          approvedMinutes: minutes,
          approvedById: actor.id,
          approvedByName: actor.name,
          approvedAt: new Date(),
          managerNotes: dto.managerNotes?.trim() || current.managerNotes,
          overtimeRate: pay.hourlyRate,
          multiplier: pay.multiplier,
          calculatedAmount: pay.amount,
          payrollStatus: 'READY_FOR_PAYROLL',
        },
      });
      if (updatedCount.count !== 1) throw new ConflictException('This overtime request was already reviewed.');
      await tx.overtimeApproval.create({
        data: { customerId: numCustomerId, overtimeRequestId: id, action: 'APPROVE', fromStatus: 'PENDING', toStatus: 'APPROVED', actorId: actor.id, actorName: actor.name, notes: dto.managerNotes?.trim() || null },
      });
      await this.audit(tx, numCustomerId, user, 'APPROVE', id, 'Overtime request approved');
      const row = await tx.overtimeRequest.findFirst({ where: { id }, include: requestInclude });
      if (row?.employee?.userId) {
        await tx.notification.create({
          data: {
            customerId: numCustomerId,
            userId: row.employee.userId,
            title: 'Overtime approved',
            message: `Your overtime on ${String(row.overtimeDate).slice(0, 10)} from ${row.startTime} to ${row.endTime} is approved.`,
            type: 'OVERTIME_APPROVED',
            data: { overtimeRequestId: row.id },
          },
        }).catch(() => undefined);
      }
      return this.present(row, rules);
    });
  }

  async reject(user: any, customerId: number | string | undefined, id: number, dto: RejectOvertimeDto) {
    this.assertReviewer(user);
    if (!dto.rejectionReason?.trim()) throw new BadRequestException('A rejection reason is required.');
    const numCustomerId = await this.resolveCustomerId(customerId);
    const actor = this.actor(user);
    return this.prisma.$transaction(async (tx) => {
      const updatedCount = await tx.overtimeRequest.updateMany({
        where: { id, customerId: numCustomerId, status: 'PENDING', deletedAt: null },
        data: {
          status: 'REJECTED',
          rejectionReason: dto.rejectionReason.trim(),
          rejectedById: actor.id,
          rejectedByName: actor.name,
          rejectedAt: new Date(),
          managerNotes: dto.managerNotes?.trim() || undefined,
          payrollStatus: 'NOT_PROCESSED',
          calculatedAmount: null,
        },
      });
      if (updatedCount.count !== 1) throw new ConflictException('Only a pending overtime request can be rejected.');
      await tx.overtimeApproval.create({
        data: { customerId: numCustomerId, overtimeRequestId: id, action: 'REJECT', fromStatus: 'PENDING', toStatus: 'REJECTED', actorId: actor.id, actorName: actor.name, notes: dto.rejectionReason.trim() },
      });
      await this.audit(tx, numCustomerId, user, 'REJECT', id, 'Overtime request rejected');
      const row = await tx.overtimeRequest.findFirst({ where: { id }, include: requestInclude });
      return this.present(row, await this.rules(numCustomerId));
    });
  }

  async start(user: any, customerId: number | string | undefined, id: number) {
    const row = await this.loadOwned(user, customerId, id);
    if (row.status !== 'APPROVED') throw new BadRequestException('Overtime can start only after admin approval.');
    if (row.actualStartAt) throw new ConflictException('Overtime has already started.');
    const now = new Date();
    if (now.getTime() < row.startAt.getTime() || now.getTime() > row.endAt.getTime()) {
      throw new BadRequestException('Overtime can be marked only inside the approved window.');
    }
    this.assertShiftWindow(row.overtimeType, row.shift, { date: row.startAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), startAt: row.startAt, endAt: row.endAt });
    await this.prisma.overtimeRequest.update({ where: { id: row.id }, data: { actualStartAt: now } });
    await this.prisma.overtimeApproval.create({
      data: { customerId: row.customerId, overtimeRequestId: row.id, action: 'START', fromStatus: 'APPROVED', toStatus: 'APPROVED', actorId: this.actor(user).id, actorName: this.actor(user).name, notes: 'Overtime started' },
    });
    return this.findOne(user, row.customerId, row.id);
  }

  async end(user: any, customerId: number | string | undefined, id: number) {
    const row = await this.loadOwned(user, customerId, id);
    if (!row.actualStartAt || row.actualEndAt) throw new ConflictException('Overtime is not currently in progress.');
    const now = new Date();
    if (now.getTime() < row.actualStartAt.getTime()) throw new BadRequestException('Overtime end time is before the recorded start.');
    if (now.getTime() > row.endAt.getTime()) {
      throw new BadRequestException('The approved overtime window has ended. An admin must correct a missed overtime check-out.');
    }
    const actualMinutes = Math.max(1, Math.round((now.getTime() - row.actualStartAt.getTime()) / 60000));
    await this.prisma.overtimeRequest.update({ where: { id: row.id }, data: { actualEndAt: now, actualMinutes } });
    await this.prisma.overtimeApproval.create({
      data: { customerId: row.customerId, overtimeRequestId: row.id, action: 'END', fromStatus: 'APPROVED', toStatus: 'APPROVED', actorId: this.actor(user).id, actorName: this.actor(user).name, notes: `Overtime ended after ${actualMinutes} minutes` },
    });
    return this.findOne(user, row.customerId, row.id);
  }

  async cancel(user: any, customerId: number | string | undefined, id: number, dto: CancelOvertimeDto = {}) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const current = await this.loadOwned(user, numCustomerId, id);
    if (this.isEmployee(user) && current.employeeId !== (await this.ownEmployeeId(user, numCustomerId))) {
      throw new ForbiddenException('You can cancel only your own overtime request.');
    }
    if (!['PENDING', 'APPROVED'].includes(current.status) || ['PROCESSED', 'PAID'].includes(current.payrollStatus)) {
      throw new ConflictException('This overtime request can no longer be cancelled.');
    }
    const actor = this.actor(user);
    const updatedCount = await this.prisma.overtimeRequest.updateMany({
      where: { id, customerId: numCustomerId, status: current.status, payrollStatus: { notIn: ['PROCESSED', 'PAID'] } },
      data: { status: 'CANCELLED', managerNotes: dto.managerNotes?.trim() || current.managerNotes, payrollStatus: 'NOT_PROCESSED', calculatedAmount: current.status === 'APPROVED' ? current.calculatedAmount : null },
    });
    if (updatedCount.count !== 1) throw new ConflictException('This overtime request was updated by someone else.');
    await this.prisma.overtimeApproval.create({
      data: { customerId: numCustomerId, overtimeRequestId: id, action: 'CANCEL', fromStatus: current.status, toStatus: 'CANCELLED', actorId: actor.id, actorName: actor.name, notes: dto.managerNotes?.trim() || null },
    });
    await this.audit(this.prisma, numCustomerId, user, 'CANCEL', id, 'Overtime request cancelled');
    return this.findOne(user, numCustomerId, id);
  }

  private async whereFor(user: any, customerId: number, query: OvertimeQueryDto): Promise<Prisma.OvertimeRequestWhereInput> {
    const where: Prisma.OvertimeRequestWhereInput = { customerId, deletedAt: null };
    if (this.isEmployee(user)) where.employeeId = await this.ownEmployeeId(user, customerId);
    if (query.departmentId || query.designationId) {
      where.employee = {
        departmentId: query.departmentId ? Number(query.departmentId) : undefined,
        designationId: query.designationId ? Number(query.designationId) : undefined,
      };
    }
    if (query.overtimeType) where.overtimeType = query.overtimeType as any;
    if (query.status === 'COMPLETED') where.actualEndAt = { not: null };
    else if (query.status === 'IN_PROGRESS') {
      where.actualStartAt = { not: null };
      where.actualEndAt = null;
    } else if (query.status) where.status = query.status as any;
    if (query.payrollStatus) where.payrollStatus = query.payrollStatus as any;
    if (query.dateFrom || query.dateTo) {
      where.overtimeDate = {
        gte: query.dateFrom ? istDateTime(String(query.dateFrom).slice(0, 10), '00:00') : undefined,
        lte: query.dateTo ? istDateTime(String(query.dateTo).slice(0, 10), '23:59') : undefined,
      };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      const numeric = Number(search);
      where.OR = [
        { employee: { firstName: { contains: search, mode: 'insensitive' } } },
        { employee: { lastName: { contains: search, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: search, mode: 'insensitive' } } },
        ...(Number.isInteger(numeric) && numeric > 0 ? [{ employeeId: numeric }, { id: numeric }] : []),
      ];
    }
    return where;
  }

  private async loadOwned(user: any, customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const where: Prisma.OvertimeRequestWhereInput = { id: Number(id), customerId: numCustomerId, deletedAt: null };
    if (this.isEmployee(user)) where.employeeId = await this.ownEmployeeId(user, numCustomerId);
    const row = await this.prisma.overtimeRequest.findFirst({ where, include: requestInclude });
    if (!row) throw new NotFoundException('Overtime request was not found.');
    return row;
  }

  private async resolveEmployeeId(user: any, customerId: number, requestedId: number | undefined, ownOnly: boolean) {
    if (ownOnly || this.isEmployee(user)) return this.ownEmployeeId(user, customerId);
    if (!requestedId) throw new BadRequestException('Employee ID is required.');
    return Number(requestedId);
  }

  private async ownEmployeeId(user: any, customerId: number) {
    if (user?.employee?.id) return Number(user.employee.id);
    if (!user?.id) throw new ForbiddenException('Employee account is required to submit overtime.');
    const employee = await this.prisma.employee.findFirst({ where: { userId: Number(user.id), customerId }, select: { id: true } });
    if (!employee) throw new ForbiddenException('No employee profile is linked to this account.');
    return employee.id;
  }

  private async rules(customerId: number) {
    const [policy, salary] = await Promise.all([
      this.prisma.overtimePolicy.findUnique({ where: { customerId } }),
      this.prisma.salaryPolicy.findFirst({ where: { customerId, isActive: true }, orderBy: { updatedAt: 'desc' } }),
    ]);
    return this.settingsView(policy, salary);
  }

  private assertShiftWindow(type: string, shift: { startTime?: string | null; endTime?: string | null } | null, window: { date: string; startAt: Date; endAt: Date }) {
    if (type !== 'BEFORE_SHIFT' && type !== 'AFTER_SHIFT') return;
    if (!shift?.startTime || !shift?.endTime) throw new BadRequestException('An assigned shift is required for before-shift or after-shift overtime.');
    const shiftStart = istDateTime(window.date, shift.startTime);
    let shiftEnd = istDateTime(window.date, shift.endTime);
    if (shiftEnd.getTime() <= shiftStart.getTime()) shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60 * 1000);
    if (type === 'BEFORE_SHIFT' && !(window.endAt.getTime() <= shiftStart.getTime() && window.startAt.getTime() < shiftStart.getTime())) {
      throw new BadRequestException('Before-shift overtime must finish when the shift starts and cannot include regular shift hours.');
    }
    if (type === 'AFTER_SHIFT' && window.startAt.getTime() < shiftEnd.getTime()) {
      throw new BadRequestException('After-shift overtime must start when the shift ends and cannot include regular shift hours.');
    }
  }

  private async assertLimits(customerId: number, employeeId: number, date: string, startAt: Date, minutes: number, rules: { maxDailyMinutes: number; maxWeeklyMinutes: number }) {
    const day = overtimeWindow(date, '00:00', '23:59');
    const week = weekBounds(date);
    const existing = await this.prisma.overtimeRequest.findMany({
      where: { customerId, employeeId, deletedAt: null, status: { in: ['PENDING', 'APPROVED'] }, overtimeDate: { gte: week.start, lte: week.end } },
      select: { startAt: true, endAt: true, totalMinutes: true, overtimeDate: true },
    });
    if (existing.some((row) => rangesOverlap(startAt, new Date(startAt.getTime() + minutes * 60000), row.startAt, row.endAt))) {
      throw new ConflictException('An overtime request already covers this time.');
    }
    const sameDay = existing.filter((row) => row.overtimeDate >= day.startAt && row.overtimeDate <= day.endAt).reduce((sum, row) => sum + row.totalMinutes, 0);
    if (sameDay + minutes > rules.maxDailyMinutes) throw new BadRequestException(`Daily overtime limit is ${rules.maxDailyMinutes} minutes.`);
    const weekTotal = existing.reduce((sum, row) => sum + row.totalMinutes, 0);
    if (weekTotal + minutes > rules.maxWeeklyMinutes) throw new BadRequestException(`Weekly overtime limit is ${rules.maxWeeklyMinutes} minutes.`);
  }

  private async compensation(row: any, minutes: number, rules: any) {
    const structure = row.employee?.salaryStructures?.[0] || await this.prisma.salaryStructure.findFirst({
      where: { employeeId: row.employeeId, customerId: row.customerId, status: 'ACTIVE' as const },
      orderBy: { effectiveFrom: 'desc' },
    });
    const shiftHours = row.shift?.durationHours || 8;
    const hourlyRate = hourlyRateFromSalary(structure?.basicSalary || 0, rules.workingDaysPerMonth, shiftHours);
    const multiplier = row.overtimeType === 'WEEKEND'
      ? rules.weekendMultiplier
      : row.overtimeType === 'HOLIDAY'
        ? rules.holidayMultiplier
        : row.overtimeType === 'NIGHT_SHIFT'
          ? rules.nightShiftMultiplier
          : rules.regularMultiplier;
    return { hourlyRate: Math.round(hourlyRate * 100) / 100, multiplier, amount: overtimeAmount(minutes, hourlyRate, multiplier), method: rules.overtimeCalculationMethod };
  }

  private present(row: any, rules: any) {
    const multiplier = row.multiplier ?? (row.overtimeType === 'WEEKEND' ? rules.weekendMultiplier : row.overtimeType === 'HOLIDAY' ? rules.holidayMultiplier : row.overtimeType === 'NIGHT_SHIFT' ? rules.nightShiftMultiplier : rules.regularMultiplier);
    const structure = row.employee?.salaryStructures?.[0];
    const hourlyRate = row.overtimeRate ?? hourlyRateFromSalary(structure?.basicSalary || 0, rules.workingDaysPerMonth, row.shift?.durationHours || 8);
    const estimatedAmount = row.calculatedAmount ?? overtimeAmount(row.totalMinutes, hourlyRate, multiplier);
    const { salaryStructures, ...employee } = row.employee || {};
    return {
      ...row,
      employee: row.employee ? employee : null,
      approvalStatus: row.status,
      employeeName: row.employee ? `${row.employee.firstName} ${row.employee.lastName}`.trim() : '',
      employeeCode: row.employee?.employeeCode || '',
      department: row.employee?.department?.name || '',
      designation: row.employee?.designation?.name || '',
      requestedHours: Math.round((row.totalMinutes / 60) * 100) / 100,
      approvedHours: row.approvedMinutes ? Math.round((row.approvedMinutes / 60) * 100) / 100 : null,
      actualHours: row.actualMinutes ? Math.round((row.actualMinutes / 60) * 100) / 100 : null,
      sessionStatus: row.actualEndAt ? 'COMPLETED' : row.actualStartAt ? 'IN_PROGRESS' : row.status,
      estimatedAmount,
      compensation: {
        hourlyRate: Math.round(hourlyRate * 100) / 100,
        multiplier,
        amount: estimatedAmount,
        method: rules.overtimeCalculationMethod,
      },
    };
  }

  private async audit(db: any, customerId: number, user: any, action: string, id: number, description: string) {
    if (!db.auditLog?.create) return;
    await db.auditLog.create({
      data: {
        customerId,
        userId: user?.id ? Number(user.id) : null,
        userName: this.actor(user).name,
        userRole: user?.role || null,
        action,
        module: 'Overtime',
        description,
        entityType: 'OvertimeRequest',
        entityId: String(id),
        status: 'SUCCESS',
      },
    }).catch(() => undefined);
  }
}
