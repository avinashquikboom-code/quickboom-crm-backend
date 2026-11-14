import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { isUserSuperAdmin } from '../../common/utils/role.util';

const MONTH_NAMES = [
  '',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

@Injectable()
export class DeductionsService {
  private readonly logger = new Logger(DeductionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationService?: NotificationService,
  ) {}

  private async resolveCustomerId(customerId?: number | string): Promise<number> {
    const parsed = Number(customerId);
    if (!isNaN(parsed) && parsed > 0) return parsed;
    const defaultCust = await this.prisma.customer.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return defaultCust ? defaultCust.id : 1;
  }

  private actorId(user: any): number | null {
    const id = Number(user?.id || user?.userId || user?.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  private actorName(user: any): string | null {
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    return name || user?.name || user?.email || null;
  }

  private formatRow(row: any) {
    const employee = row.employee || {};
    return {
      ...row,
      employeeName:
        `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Employee',
      employeeCode: employee.employeeCode || String(row.employeeId),
      department: employee.department?.name || 'General',
      designation: employee.designation?.name || 'Staff',
      payrollMonthName: MONTH_NAMES[row.payrollMonth] || `Month ${row.payrollMonth}`,
    };
  }

  /**
   * Create employee penalty/deduction records.
   * Each selected employee receives the FULL entered amount (never divided).
   * All employee IDs are re-validated on the server within the caller's tenant.
   */
  async create(customerId: number | string | undefined, body: any, user: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    const rawIds: any[] = Array.isArray(body?.employeeIds)
      ? body.employeeIds
      : body?.employeeId
        ? [body.employeeId]
        : [];
    const employeeIds = [...new Set(rawIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))];
    if (!employeeIds.length) {
      throw new BadRequestException('Select at least one employee.');
    }

    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Deduction amount must be greater than zero.');
    }

    const reason = String(body?.reason || '').trim();
    if (!reason) {
      throw new BadRequestException('A deduction reason is required.');
    }

    const month = Number(body?.payrollMonth ?? body?.month);
    const year = Number(body?.payrollYear ?? body?.year);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('A valid payroll month (1-12) is required.');
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('A valid payroll year is required.');
    }

    // Server-side eligibility validation: employees must belong to this tenant and be active.
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, customerId: numCustomerId },
      select: { id: true, status: true, firstName: true, lastName: true, employeeCode: true },
    });
    const foundIds = new Set(employees.map((e) => e.id));
    const missing = employeeIds.filter((id) => !foundIds.has(id));
    if (missing.length) {
      throw new BadRequestException(`Invalid employee selection: ${missing.join(', ')}`);
    }
    const inactive = employees.filter((e) => String(e.status).toUpperCase() !== 'ACTIVE');
    if (inactive.length) {
      const names = inactive.map((e) => `${e.firstName} ${e.lastName}`.trim() || e.employeeCode);
      throw new BadRequestException(`Cannot apply deductions to inactive employees: ${names.join(', ')}`);
    }

    const creatorId = this.actorId(user);
    const creatorName = this.actorName(user);
    const perEmployee = Math.round(amount * 100) / 100;

    const created = await this.prisma.$transaction(async (tx) => {
      const rows: any[] = [];
      for (const emp of employees) {
        rows.push(
          await tx.employeeDeduction.create({
            data: {
              customerId: numCustomerId,
              employeeId: emp.id,
              amount: perEmployee,
              reason,
              payrollMonth: month,
              payrollYear: year,
              status: 'PENDING',
              createdById: creatorId,
              createdByName: creatorName,
            },
            include: { employee: { include: { department: true, designation: true } } },
          }),
        );
      }
      return rows;
    });

    // Non-blocking notifications to affected employees only.
    if (this.notificationService) {
      for (const row of created) {
        this.notificationService
          .sendDeductionNotification(row.employeeId, {
            title: 'Salary Deduction Recorded',
            body: `A deduction of ₹${perEmployee} (${reason}) has been recorded for ${MONTH_NAMES[month]} ${year}, pending approval.`,
            type: 'DEDUCTION_CREATED',
            deductionId: row.id,
            status: 'PENDING',
            amount: perEmployee,
          })
          .catch((err) => this.logger.error(`Deduction create notification failed: ${err?.message}`));
      }
    }

    return {
      success: true,
      count: created.length,
      perEmployeeAmount: perEmployee,
      totalAmount: Math.round(perEmployee * created.length * 100) / 100,
      data: created.map((row) => this.formatRow(row)),
    };
  }

  async list(customerId: number | string | undefined, query: any, user: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 200);
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId };

    if (query?.employeeId) where.employeeId = Number(query.employeeId);
    if (query?.status) {
      const status = String(query.status).toUpperCase();
      if (['PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'REVERSED'].includes(status)) {
        where.status = status;
      }
    }
    if (query?.month) where.payrollMonth = Number(query.month);
    if (query?.year) where.payrollYear = Number(query.year);
    if (query?.departmentId) where.employee = { ...(where.employee || {}), departmentId: Number(query.departmentId) };
    if (query?.designationId) where.employee = { ...(where.employee || {}), designationId: Number(query.designationId) };
    if (query?.search && String(query.search).trim()) {
      const s = String(query.search).trim();
      where.employee = {
        ...(where.employee || {}),
        OR: [
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
          { employeeCode: { contains: s, mode: 'insensitive' } },
        ],
      };
    }
    if (query?.from || query?.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) {
        const end = new Date(query.to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [rows, total, aggregates] = await Promise.all([
      this.prisma.employeeDeduction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { employee: { include: { department: true, designation: true } } },
      }),
      this.prisma.employeeDeduction.count({ where }),
      this.prisma.employeeDeduction.groupBy({
        by: ['status'],
        where: { customerId: numCustomerId },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const summary = {
      total: aggregates.reduce((s, a) => s + a._count._all, 0),
      pending: aggregates.find((a) => a.status === 'PENDING')?._count._all || 0,
      approved: aggregates.find((a) => a.status === 'APPROVED')?._count._all || 0,
      applied: aggregates.find((a) => a.status === 'APPLIED')?._count._all || 0,
      rejected: aggregates.find((a) => a.status === 'REJECTED')?._count._all || 0,
      reversed: aggregates.find((a) => a.status === 'REVERSED')?._count._all || 0,
      totalDeductedAmount: Math.round(
        ((aggregates.find((a) => a.status === 'APPLIED')?._sum.amount || 0) +
          (aggregates.find((a) => a.status === 'APPROVED')?._sum.amount || 0)) * 100,
      ) / 100,
    };

    const data = rows.map((row) => this.formatRow(row));
    const totalPages = Math.ceil(total / limit) || 1;
    return {
      data,
      items: data,
      summary,
      pagination: { page, pageSize: limit, total, totalPages },
      meta: { page, limit, total, totalPages },
    };
  }

  private async findOwned(customerId: number, id: number | string) {
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId <= 0) {
      throw new BadRequestException('A valid deduction id is required.');
    }
    const deduction = await this.prisma.employeeDeduction.findFirst({
      where: { id: numId, customerId },
      include: { employee: { include: { department: true, designation: true } } },
    });
    if (!deduction) throw new NotFoundException('Deduction record not found.');
    return deduction;
  }

  async approve(customerId: number | string | undefined, id: number | string, user: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const deduction = await this.findOwned(numCustomerId, id);
    if (deduction.status !== 'PENDING') {
      throw new BadRequestException(`Only pending deductions can be approved (current: ${deduction.status}).`);
    }

    // Statutory guard: deduction must not exceed the employee's payable salary for the period.
    const structure = await this.prisma.salaryStructure.findFirst({
      where: { customerId: numCustomerId, employeeId: deduction.employeeId, status: 'ACTIVE' },
    });
    const monthlySalary = Number(structure?.grossSalary ?? structure?.basicSalary ?? 0);
    const period = { month: deduction.payrollMonth, year: deduction.payrollYear };
    const approvedTotal = await this.prisma.employeeDeduction.aggregate({
      where: {
        customerId: numCustomerId,
        employeeId: deduction.employeeId,
        payrollMonth: period.month,
        payrollYear: period.year,
        status: { in: ['APPROVED', 'APPLIED'] },
      },
      _sum: { amount: true },
    });
    const prospective = (approvedTotal._sum.amount || 0) + deduction.amount;
    if (monthlySalary > 0 && prospective > monthlySalary) {
      throw new BadRequestException(
        `Deduction exceeds the employee's monthly salary (₹${monthlySalary}). Total for ${MONTH_NAMES[period.month]} ${period.year} would be ₹${prospective}.`,
      );
    }

    const updated = await this.prisma.employeeDeduction.update({
      where: { id: deduction.id },
      data: { status: 'APPROVED', approvedById: this.actorId(user), approvedAt: new Date() },
      include: { employee: { include: { department: true, designation: true } } },
    });

    if (this.notificationService) {
      this.notificationService
        .sendDeductionNotification(deduction.employeeId, {
          title: 'Deduction Approved',
          body: `A deduction of ₹${deduction.amount} (${deduction.reason}) was approved for ${MONTH_NAMES[deduction.payrollMonth]} ${deduction.payrollYear}.`,
          type: 'DEDUCTION_APPROVED',
          deductionId: deduction.id,
          status: 'APPROVED',
          amount: deduction.amount,
        })
        .catch((err) => this.logger.error(`Deduction approve notification failed: ${err?.message}`));
    }

    return { success: true, data: this.formatRow(updated) };
  }

  async reject(customerId: number | string | undefined, id: number | string, body: any, user: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const deduction = await this.findOwned(numCustomerId, id);
    if (deduction.status !== 'PENDING') {
      throw new BadRequestException(`Only pending deductions can be rejected (current: ${deduction.status}).`);
    }
    const updated = await this.prisma.employeeDeduction.update({
      where: { id: deduction.id },
      data: {
        status: 'REJECTED',
        rejectedById: this.actorId(user),
        rejectedAt: new Date(),
        rejectionReason: String(body?.reason || body?.rejectionReason || '').trim() || null,
      },
      include: { employee: { include: { department: true, designation: true } } },
    });
    return { success: true, data: this.formatRow(updated) };
  }

  /**
   * Reverse an approved/applied deduction. The record is kept (never deleted)
   * so the full who/when audit trail is preserved. Finalized payroll is not
   * silently modified: applied deductions on PAID payroll cannot be reversed.
   */
  async reverse(customerId: number | string | undefined, id: number | string, body: any, user: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const deduction = await this.findOwned(numCustomerId, id);
    if (!['APPROVED', 'APPLIED'].includes(deduction.status)) {
      throw new BadRequestException(`Only approved or applied deductions can be reversed (current: ${deduction.status}).`);
    }
    const reason = String(body?.reason || body?.reversalReason || '').trim();
    if (!reason) {
      throw new BadRequestException('A reversal reason is required.');
    }

    if (deduction.status === 'APPLIED' && deduction.payrollItemId) {
      const item = await this.prisma.payrollItem.findUnique({
        where: { id: deduction.payrollItemId },
        include: { payroll: true },
      });
      if (item && ['PAID', 'GENERATED'].includes(String(item.payroll?.status))) {
        throw new BadRequestException(
          'This deduction is already part of a finalized payroll. Reversal must be issued as a correction in the next payroll run.',
        );
      }
    }

    const updated = await this.prisma.employeeDeduction.update({
      where: { id: deduction.id },
      data: {
        status: 'REVERSED',
        reversedById: this.actorId(user),
        reversedAt: new Date(),
        reversalReason: reason,
      },
      include: { employee: { include: { department: true, designation: true } } },
    });

    if (this.notificationService) {
      this.notificationService
        .sendDeductionNotification(deduction.employeeId, {
          title: 'Deduction Reversed',
          body: `The deduction of ₹${deduction.amount} (${deduction.reason}) for ${MONTH_NAMES[deduction.payrollMonth]} ${deduction.payrollYear} was reversed.`,
          type: 'DEDUCTION_REVERSED',
          deductionId: deduction.id,
          status: 'REVERSED',
          amount: deduction.amount,
        })
        .catch((err) => this.logger.error(`Deduction reversal notification failed: ${err?.message}`));
    }

    return { success: true, data: this.formatRow(updated) };
  }

  async remove(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const deduction = await this.findOwned(numCustomerId, id);
    if (deduction.status !== 'PENDING') {
      throw new BadRequestException('Only pending deductions can be deleted. Use reversal for approved/applied records.');
    }
    await this.prisma.employeeDeduction.delete({ where: { id: deduction.id } });
    return { success: true };
  }

  /** Employee self-service: own deductions only. */
  async mine(customerId: number | string | undefined, user: any, query: any) {
    if (!user) throw new ForbiddenException('Access denied');
    if (isUserSuperAdmin(user)) {
      return this.list(customerId, query, user);
    }
    const numCustomerId = await this.resolveCustomerId(customerId || user?.customerId);
    const employee = await this.prisma.employee.findFirst({
      where: {
        customerId: numCustomerId,
        OR: [
          { userId: Number(user.id) || 0 },
          ...(user?.email ? [{ email: { equals: String(user.email).trim().toLowerCase(), mode: 'insensitive' as const } }] : []),
        ],
      },
      select: { id: true },
    });
    if (!employee) {
      return { data: [], items: [], summary: {}, pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };
    }
    return this.list(numCustomerId, { ...(query || {}), employeeId: employee.id, search: undefined }, user);
  }
}
