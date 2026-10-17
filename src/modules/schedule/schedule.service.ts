import { GoneException } from '@nestjs/common';
import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dto';
import { ScheduleStatus } from '@prisma/client';
import { generateMonthlyScheduleIntervals } from '../../common/utils/subscription-date.util';
import { EmailService } from '../email/email.service';
import { EmailTemplateService, renderEmailTemplate } from '../email/email-template.service';
import { generateICalendarInvite } from '../../common/utils/calendar-ics.util';
import { generateCalendarAppointmentPdfBuffer } from '../../common/utils/calendar-pdf.util';
import { BUSINESS_TIMEZONE } from '../../common/utils/timezone.util';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly emailTemplateService?: EmailTemplateService,
  ) {}

  /**
   * Automatically generate monthly schedules for a Customer Subscription.
   * Uses anchor-date arithmetic and guarantees duplicate protection.
   */
  async generateSchedulesForSubscription(subscriptionId: number, options?: { force?: boolean }) : Promise<never> {
throw new GoneException('This Customer/Lead operation has been removed');
  }

  /**
   * Handle plan cancellation: keep completed history, mark future planned as CANCELLED.
   */
  async handleSubscriptionCancellation(subscriptionId: number) {
    const now = new Date();
    await this.prisma.monthlySchedule.updateMany({
      where: {
        
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
      
    } else 

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
          
          plan: { select: { id: true, name: true, code: true } },
          assignedEmployee: { select: { id: true, firstName: true, lastName: true, email: true } },
          
        },
      }),
      this.prisma.monthlySchedule.count({ where }),
    ]);

    const formatted = items.map((item) => ({
      id: item.id,
      
      customerName: 'N/A',
      planId: item.planId,
      planName: item.plan?.name ?? null,
      
      month: item.month,
      year: item.year,
      monthYear: `${item.year}-${String(item.month).padStart(2, '0')}`,
      startDate: item.startDate,
      endDate: item.endDate,
      status: item.status,
      title: item.title || `${'Customer'} - ${item.plan?.name || 'Plan'}`,
      notes: item.notes,
      assignedEmployeeId: item.assignedEmployeeId,
      assignedEmployee: item.assignedEmployee
        ? `${item.assignedEmployee.firstName || ''} ${item.assignedEmployee.lastName || ''}`.trim()
        : 'Unassigned',
      employee: item.assignedEmployee,
      
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
      
    } else 

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
        
        plan: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return items.map((item) => ({
      id: item.id,
      title: item.title || `${undefined} - ${item.plan?.name}`,
      
      customerName: 'Customer',
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
      
    }

    const item = await this.prisma.monthlySchedule.findFirst({
      where,
      include: {
        
        plan: true,
        assignedEmployee: true,
        
      },
    });

    if (!item) {
      throw new NotFoundException(`Schedule with ID ${id} not found`);
    }

    const communications = this.prisma.emailLog
      ? await this.prisma.emailLog.findMany({
          where: { appointmentId: numId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            channel: true,
            eventType: true,
            recipientEmail: true,
            subject: true,
            status: true,
            errorMessage: true,
            providerMessageId: true,
            sentAt: true,
            createdAt: true,
          },
        })
      : [];

    return {
      ...item,
      communications,
    };
  }

  async create(scopedCustomerId: number | string | undefined, dto: CreateScheduleDto) {
    const targetCustomerId = scopedCustomerId ? Number(scopedCustomerId) : Number(undefined);
    

    return this.prisma.monthlySchedule.create({
      data: {
        
        
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

  /**
   * Automates sending the customer's calendar schedule, RFC 5545 .ics invitation,
   * and appointment PDF to Customer.email upon confirmed successful plan payment.
   *
   * Enforces strict idempotency, customer email validation, safe error handling,
   * dynamic branding, and assigned employee resolution.
   */
  async sendPlanPurchaseCalendarScheduleEmail(params: {
    customerId?: number;
    subscriptionId: number;
    planId?: number;
    paymentId?: string | number;
  }): Promise<{ success: boolean; skipped?: boolean; reason?: string; emailLogId?: number }> {
throw new GoneException('This Customer/Lead operation has been removed');
  }
}
