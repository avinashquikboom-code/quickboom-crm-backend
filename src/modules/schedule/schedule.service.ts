import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dto';
import { ScheduleStatus } from '@prisma/client';
import { generateMonthlyScheduleIntervals } from '../../common/utils/subscription-date.util';

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Automatically generate monthly schedules for a Customer Subscription.
   * Uses anchor-date arithmetic and guarantees duplicate protection.
   */
  async generateSchedulesForSubscription(subscriptionId: number, options?: { force?: boolean }) {
    const sub = await this.prisma.customerSubscription.findUnique({
      where: { id: Number(subscriptionId) },
      include: {
        customer: true,
        plan: true,
      },
    });

    if (!sub) {
      throw new NotFoundException(`Subscription with ID ${subscriptionId} not found`);
    }

    const durationMonths = sub.duration || Math.max(
      1,
      Math.round(
        (new Date(sub.endDate).getTime() - new Date(sub.startDate).getTime()) /
          (1000 * 60 * 60 * 24 * 30),
      ),
    );

    const intervals = generateMonthlyScheduleIntervals(
      sub.startDate,
      durationMonths,
      sub.plan?.name || 'Customer Plan',
    );

    // Resolve assigned employee from customer
    let defaultEmployeeId: number | null = null;
    if (sub.customer?.assignedEmployee) {
      const emp = await this.prisma.employee.findFirst({
        where: {
          customerId: sub.customerId,
          OR: [
            { firstName: { contains: sub.customer.assignedEmployee, mode: 'insensitive' } },
            { lastName: { contains: sub.customer.assignedEmployee, mode: 'insensitive' } },
          ],
        },
      });
      if (emp) defaultEmployeeId = emp.id;
    }

    const createdOrUpdated = [];

    for (const interval of intervals) {
      const existing = await this.prisma.monthlySchedule.findFirst({
        where: {
          customerId: sub.customerId,
          subscriptionId: sub.id,
          month: interval.month,
          year: interval.year,
        },
      });

      if (existing) {
        if (options?.force && existing.status === ScheduleStatus.PLANNED) {
          const updated = await this.prisma.monthlySchedule.update({
            where: { id: existing.id },
            data: {
              startDate: interval.startDate,
              endDate: interval.endDate,
              title: interval.title,
              planId: sub.planId,
            },
          });
          createdOrUpdated.push(updated);
        } else {
          createdOrUpdated.push(existing);
        }
      } else {
        const created = await this.prisma.monthlySchedule.create({
          data: {
            customerId: sub.customerId,
            subscriptionId: sub.id,
            planId: sub.planId,
            month: interval.month,
            year: interval.year,
            startDate: interval.startDate,
            endDate: interval.endDate,
            status: ScheduleStatus.PLANNED,
            title: interval.title,
            assignedEmployeeId: defaultEmployeeId,
            notes: `Auto-generated schedule for ${sub.plan?.name || 'Plan'}`,
          },
        });
        createdOrUpdated.push(created);
      }
    }

    return {
      success: true,
      message: `Generated ${createdOrUpdated.length} monthly schedules for ${sub.customer.name}`,
      schedules: createdOrUpdated,
    };
  }

  /**
   * Handle plan cancellation: keep completed history, mark future planned as CANCELLED.
   */
  async handleSubscriptionCancellation(subscriptionId: number) {
    const now = new Date();
    await this.prisma.monthlySchedule.updateMany({
      where: {
        subscriptionId: Number(subscriptionId),
        startDate: { gte: now },
        status: ScheduleStatus.PLANNED,
      },
      data: {
        status: ScheduleStatus.CANCELLED,
        notes: 'Cancelled due to plan termination',
      },
    });
  }

  /**
   * List monthly schedules with search, filters, pagination, and multi-tenant scoping.
   */
  async findAll(
    scopedCustomerId?: number | string,
    query: {
      customerId?: number | string;
      employeeId?: number | string;
      planId?: number | string;
      status?: ScheduleStatus;
      month?: number;
      year?: number;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    // Tenant scoping
    if (scopedCustomerId && !isNaN(Number(scopedCustomerId)) && Number(scopedCustomerId) > 0) {
      where.customerId = Number(scopedCustomerId);
    } else if (query.customerId && !isNaN(Number(query.customerId)) && Number(query.customerId) > 0) {
      where.customerId = Number(query.customerId);
    }

    if (query.employeeId && !isNaN(Number(query.employeeId))) {
      where.assignedEmployeeId = Number(query.employeeId);
    }

    if (query.planId && !isNaN(Number(query.planId))) {
      where.planId = Number(query.planId);
    }

    if (query.status && (query.status as string) !== 'ALL') {
      where.status = query.status;
    }

    if (query.month && Number(query.month) > 0) {
      where.month = Number(query.month);
    }

    if (query.year && Number(query.year) > 0) {
      where.year = Number(query.year);
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { notes: { contains: s, mode: 'insensitive' } },
        { customer: { name: { contains: s, mode: 'insensitive' } } },
        { plan: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.monthlySchedule.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { startDate: 'desc' }],
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          plan: { select: { id: true, name: true, code: true } },
          assignedEmployee: { select: { id: true, firstName: true, lastName: true, email: true } },
          subscription: { select: { id: true, status: true, startDate: true, endDate: true } },
        },
      }),
      this.prisma.monthlySchedule.count({ where }),
    ]);

    const formatted = items.map((item) => ({
      id: item.id,
      customerId: item.customerId,
      customerName: item.customer?.name || 'N/A',
      planId: item.planId,
      planName: item.plan?.name || 'Standard Plan',
      subscriptionId: item.subscriptionId,
      month: item.month,
      year: item.year,
      monthYear: `${item.year}-${String(item.month).padStart(2, '0')}`,
      startDate: item.startDate,
      endDate: item.endDate,
      status: item.status,
      title: item.title || `${item.customer?.name || 'Customer'} - ${item.plan?.name || 'Plan'}`,
      notes: item.notes,
      assignedEmployeeId: item.assignedEmployeeId,
      assignedEmployee: item.assignedEmployee
        ? `${item.assignedEmployee.firstName || ''} ${item.assignedEmployee.lastName || ''}`.trim()
        : 'Unassigned',
      employee: item.assignedEmployee,
      customer: item.customer,
      createdAt: item.createdAt,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: formatted,
      items: formatted,
      pagination: {
        page,
        pageSize: limit,
        limit,
        total,
        totalPages,
      },
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Calendar query returning schedule items for month / date range.
   */
  async getCalendar(
    scopedCustomerId?: number | string,
    query: {
      from?: string;
      to?: string;
      month?: number;
      year?: number;
      customerId?: number | string;
      employeeId?: number | string;
      status?: ScheduleStatus;
    } = {},
  ) {
    const where: any = { deletedAt: null };

    if (scopedCustomerId && !isNaN(Number(scopedCustomerId)) && Number(scopedCustomerId) > 0) {
      where.customerId = Number(scopedCustomerId);
    } else if (query.customerId && !isNaN(Number(query.customerId)) && Number(query.customerId) > 0) {
      where.customerId = Number(query.customerId);
    }

    if (query.employeeId && !isNaN(Number(query.employeeId))) {
      where.assignedEmployeeId = Number(query.employeeId);
    }

    if (query.status && (query.status as string) !== 'ALL') {
      where.status = query.status;
    }

    if (query.month && query.year) {
      where.month = Number(query.month);
      where.year = Number(query.year);
    } else if (query.from || query.to) {
      where.startDate = {};
      if (query.from) where.startDate.gte = new Date(query.from);
      if (query.to) where.startDate.lte = new Date(query.to);
    }

    const items = await this.prisma.monthlySchedule.findMany({
      where,
      orderBy: { startDate: 'asc' },
      include: {
        customer: { select: { id: true, name: true } },
        plan: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return items.map((item) => ({
      id: item.id,
      title: item.title || `${item.customer?.name} - ${item.plan?.name}`,
      customerId: item.customerId,
      customerName: item.customer?.name || 'Customer',
      planName: item.plan?.name || 'Plan',
      status: item.status,
      assignedEmployee: item.assignedEmployee
        ? `${item.assignedEmployee.firstName || ''} ${item.assignedEmployee.lastName || ''}`.trim()
        : 'Unassigned',
      startDate: item.startDate,
      endDate: item.endDate,
      month: item.month,
      year: item.year,
      notes: item.notes,
    }));
  }

  async findOne(scopedCustomerId: number | string | undefined, id: number | string) {
    const numId = Number(id);
    const where: any = { id: numId, deletedAt: null };

    if (scopedCustomerId && !isNaN(Number(scopedCustomerId)) && Number(scopedCustomerId) > 0) {
      where.customerId = Number(scopedCustomerId);
    }

    const item = await this.prisma.monthlySchedule.findFirst({
      where,
      include: {
        customer: true,
        plan: true,
        assignedEmployee: true,
        subscription: true,
      },
    });

    if (!item) {
      throw new NotFoundException(`Schedule with ID ${id} not found`);
    }

    return item;
  }

  async create(scopedCustomerId: number | string | undefined, dto: CreateScheduleDto) {
    const targetCustomerId = scopedCustomerId ? Number(scopedCustomerId) : Number(dto.customerId);
    if (!targetCustomerId || isNaN(targetCustomerId)) {
      throw new BadRequestException('Customer ID is required');
    }

    return this.prisma.monthlySchedule.create({
      data: {
        customerId: targetCustomerId,
        subscriptionId: dto.subscriptionId ? Number(dto.subscriptionId) : undefined,
        planId: dto.planId ? Number(dto.planId) : undefined,
        month: Number(dto.month),
        year: Number(dto.year),
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        status: dto.status || ScheduleStatus.PLANNED,
        assignedEmployeeId: dto.assignedEmployeeId ? Number(dto.assignedEmployeeId) : undefined,
        title: dto.title,
        notes: dto.notes,
      },
      include: {
        customer: true,
        plan: true,
        assignedEmployee: true,
      },
    });
  }

  async update(scopedCustomerId: number | string | undefined, id: number | string, dto: UpdateScheduleDto) {
    await this.findOne(scopedCustomerId, id);

    return this.prisma.monthlySchedule.update({
      where: { id: Number(id) },
      data: {
        ...(dto.status && { status: dto.status }),
        ...(dto.assignedEmployeeId !== undefined && { assignedEmployeeId: dto.assignedEmployeeId ? Number(dto.assignedEmployeeId) : null }),
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate && { endDate: new Date(dto.endDate) }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        customer: true,
        plan: true,
        assignedEmployee: true,
      },
    });
  }

  async remove(scopedCustomerId: number | string | undefined, id: number | string) {
    await this.findOne(scopedCustomerId, id);

    return this.prisma.monthlySchedule.update({
      where: { id: Number(id) },
      data: {
        deletedAt: new Date(),
        status: ScheduleStatus.CANCELLED,
      },
    });
  }
}
