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
      planName: item.plan?.name ?? null,
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

  /**
   * Automates sending the customer's calendar schedule, RFC 5545 .ics invitation,
   * and appointment PDF to Customer.email upon confirmed successful plan payment.
   *
   * Enforces strict idempotency, customer email validation, safe error handling,
   * dynamic branding, and assigned employee resolution.
   */
  async sendPlanPurchaseCalendarScheduleEmail(params: {
    customerId: number;
    subscriptionId: number;
    planId?: number;
    paymentId?: string | number;
  }): Promise<{ success: boolean; skipped?: boolean; reason?: string; emailLogId?: number }> {
    const { customerId, subscriptionId } = params;
    this.logger.log(`[PLAN_CALENDAR_EMAIL] Initiating calendar email automation for customerId=${customerId}, subscriptionId=${subscriptionId}`);

    try {
      // 1. Retrieve customer details
      const customer = await this.prisma.customer.findUnique({
        where: { id: Number(customerId) },
        include: {
          assignedEmployeeRel: true,
        },
      });

      if (!customer) {
        this.logger.warn(`[PLAN_CALENDAR_EMAIL] Customer #${customerId} not found`);
        return { success: false, reason: 'CUSTOMER_NOT_FOUND' };
      }

      // Check if customer has associated lead for mobile BPO timeline linkage
      const lead = await this.prisma.lead.findFirst({
        where: { customerId: Number(customerId), deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      // 2. Resolve Plan
      const sub = await this.prisma.customerSubscription.findUnique({
        where: { id: Number(subscriptionId) },
        include: { plan: true },
      });

      let plan = sub?.plan;
      if (!plan && params.planId) {
        plan = await this.prisma.plan.findUnique({ where: { id: Number(params.planId) } });
      }

      const planName = plan?.name || 'Customer Plan';
      const planId = plan?.id || params.planId || 0;

      // 3. Ensure monthly schedules are generated/retrieved for this subscription
      try {
        await this.generateSchedulesForSubscription(subscriptionId);
      } catch (genErr: any) {
        this.logger.warn(`[PLAN_CALENDAR_EMAIL] Schedule generation notice: ${genErr?.message}`);
      }

      // Retrieve primary upcoming schedule for this subscription
      const schedule = await this.prisma.monthlySchedule.findFirst({
        where: {
          customerId: Number(customerId),
          subscriptionId: Number(subscriptionId),
          deletedAt: null,
        },
        orderBy: [{ year: 'asc' }, { month: 'asc' }, { startDate: 'asc' }],
        include: {
          assignedEmployee: true,
          plan: true,
        },
      });

      const appointmentId = schedule?.id || 0;
      const identifierKey = `PLAN_PURCHASE_CALENDAR_SCHEDULE:${customerId}:${planId}:${appointmentId}`;

      // 4. Idempotency Check: Don't send duplicate emails for the same purchase / calendar event
      if (this.prisma.emailLog) {
        const existingSent = await this.prisma.emailLog.findFirst({
          where: {
            customerId: Number(customerId),
            planId: planId || undefined,
            appointmentId: appointmentId || undefined,
            eventType: 'PLAN_PURCHASE_CALENDAR_SCHEDULE',
            status: 'SENT',
          },
        });

        if (existingSent) {
          this.logger.log(
            `[PLAN_CALENDAR_EMAIL_IDEMPOTENT] Calendar schedule email already sent for customer #${customerId}, plan #${planId}, appointment #${appointmentId}. Skipping duplicate.`,
          );
          return {
            success: true,
            skipped: true,
            emailLogId: existingSent.id,
            reason: 'DUPLICATE_PREVENTED',
          };
        }
      }

      // 5. Customer Email Validation
      // Use customer's actual registered email address (Customer.email)
      const rawEmail = (customer.email || '').trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const isEmailValid = rawEmail && emailRegex.test(rawEmail);

      if (!isEmailValid) {
        this.logger.warn(
          `[PLAN_CALENDAR_EMAIL_INVALID] Customer #${customerId} (${customer.name}) has no valid registered email: "${rawEmail}". Payment remains successful.`,
        );

        let failedLogId: number | undefined;
        if (this.prisma.emailLog) {
          const failedLog = await this.prisma.emailLog.create({
            data: {
              customerId: Number(customerId),
              leadId: lead?.id || null,
              appointmentId: appointmentId || null,
              planId: planId || null,
              channel: 'EMAIL',
              identifierKey,
              recipientEmail: rawEmail || 'MISSING_CUSTOMER_EMAIL',
              subject: `Your Scheduled Appointment for ${planName} Plan`,
              renderedContent: 'Customer registered email is missing or invalid. Automated calendar schedule email skipped.',
              eventType: 'PLAN_PURCHASE_CALENDAR_SCHEDULE',
              status: 'FAILED',
              errorMessage: 'Customer registered email is missing or invalid',
              sentAt: new Date(),
            },
          }).catch((err) => {
            this.logger.warn(`[EMAIL_LOG_FAILED_WARN] Failed recording missing email status: ${err?.message}`);
            return null;
          });
          failedLogId = failedLog?.id;
        }

        return {
          success: false,
          skipped: false,
          reason: 'MISSING_OR_INVALID_CUSTOMER_EMAIL',
          emailLogId: failedLogId,
        };
      }

      const customerEmail = rawEmail;
      const customerName = customer.name || customer.companyName || 'Valued Customer';
      const companyName = customer.companyName || customer.name || 'QUIKBOOM Digital Marketing Agency';

      // 6. Assigned Employee Resolution
      // Use existing customer / schedule assigned employee relationship
      let assignedEmployeeName = '';
      let assignedEmployeeEmail = '';

      if (schedule?.assignedEmployee) {
        assignedEmployeeName = `${schedule.assignedEmployee.firstName || ''} ${schedule.assignedEmployee.lastName || ''}`.trim();
        assignedEmployeeEmail = schedule.assignedEmployee.email || '';
      } else if (customer.assignedEmployeeRel) {
        assignedEmployeeName = `${customer.assignedEmployeeRel.firstName || ''} ${customer.assignedEmployeeRel.lastName || ''}`.trim();
        assignedEmployeeEmail = customer.assignedEmployeeRel.email || '';
      } else if (customer.assignedEmployee) {
        const emp = await this.prisma.employee.findFirst({
          where: {
            customerId: Number(customerId),
            OR: [
              { firstName: { contains: customer.assignedEmployee, mode: 'insensitive' } },
              { lastName: { contains: customer.assignedEmployee, mode: 'insensitive' } },
            ],
          },
        });
        if (emp) {
          assignedEmployeeName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
          assignedEmployeeEmail = emp.email || '';
        }
      }

      if (!assignedEmployeeName) {
        assignedEmployeeName = `${companyName} Account Executive`;
      }
      if (!assignedEmployeeEmail) {
        const smtpConfig = await this.prisma.integrationSetting.findFirst({
          where: { provider: 'SMTP', isEnabled: true, deletedAt: null },
        }).catch(() => null);
        const configJson = (smtpConfig?.config as any) || {};
        assignedEmployeeEmail = configJson.fromEmail || 'support@quikboom.com';
      }

      // 7. Schedule Date & Time Resolution
      const scheduleStartDate = schedule?.startDate ? new Date(schedule.startDate) : new Date();
      // Schedule default appointment time: 10:00 AM IST on schedule date
      const appointmentStart = new Date(scheduleStartDate);
      if (appointmentStart.getHours() === 0 && appointmentStart.getMinutes() === 0) {
        appointmentStart.setHours(10, 0, 0, 0);
      }
      const appointmentEnd = new Date(appointmentStart.getTime() + 60 * 60 * 1000); // 1 hour duration

      const timezone = BUSINESS_TIMEZONE; // Asia/Kolkata
      const appointmentDateStr = appointmentStart.toLocaleDateString('en-IN', {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const startTimeStr = '10:00 AM';
      const endTimeStr = '11:00 AM';
      const appointmentTitle = schedule?.title || `${planName} - Strategy & Kickoff Consultation`;
      const location = customer.city
        ? `${customer.city}, ${customer.state || 'India'}`
        : 'Online Video Conference / QuikBoom Office';
      const meetingLink = 'https://meet.google.com/qbm-crm-sync';

      // 8. Generate iCalendar (.ics) event
      const icsUid = `qb-schedule-${appointmentId || subscriptionId}-${customerId}@${customer.domain || 'quikboom.com'}`;
      const icsContent = generateICalendarInvite({
        uid: icsUid,
        title: appointmentTitle,
        description: `Your ${planName} appointment with ${assignedEmployeeName}.\\nMeeting Link: ${meetingLink}\\nNotes: ${schedule?.notes || 'Subscription plan active schedule'}`,
        location,
        url: meetingLink,
        startDate: appointmentStart,
        endDate: appointmentEnd,
        timezone,
        organizerName: assignedEmployeeName,
        organizerEmail: assignedEmployeeEmail,
        attendeeName: customerName,
        attendeeEmail: customerEmail,
        status: 'CONFIRMED',
      });

      // 9. Generate Calendar Appointment PDF (reuse existing generator)
      let pdfBuffer: Buffer | null = null;
      try {
        pdfBuffer = await generateCalendarAppointmentPdfBuffer({
          appointmentNo: `SCH-${appointmentId || subscriptionId}`,
          customerName,
          companyName,
          eventTitle: appointmentTitle,
          date: appointmentDateStr,
          time: `${startTimeStr} - ${endTimeStr}`,
          duration: '60 minutes',
          location,
          assignedEmployeeName,
          assignedEmployeeEmail,
          customerEmail,
          customerPhone: customer.phone || undefined,
          notes: schedule?.notes || `Auto-generated schedule for ${planName}`,
        });
      } catch (pdfErr: any) {
        this.logger.warn(`[PLAN_CALENDAR_EMAIL] PDF generation warning: ${pdfErr?.message}`);
      }

      // 10. Resolve Email Template & Render
      let template: any = null;
      if (this.emailTemplateService) {
        template = await this.emailTemplateService.findByKey('PLAN_PURCHASE_CALENDAR_SCHEDULE', customerId);
      }

      const templateVariables = {
        customerName,
        customerEmail,
        planName,
        appointmentTitle,
        appointmentDate: appointmentDateStr,
        date: appointmentDateStr,
        startTime: startTimeStr,
        endTime: endTimeStr,
        timezone,
        location,
        meetingLink,
        assignedEmployeeName,
        assignedEmployeeEmail,
        companyName,
      };

      const rendered = renderEmailTemplate(
        {
          subject: template?.subject || 'Your Scheduled Appointment for {{planName}} Plan – {{companyName}}',
          body: template?.body || '',
        },
        templateVariables,
      );

      // 11. Prepare attachments: appointment.ics (text/calendar) + PDF document
      const attachments: any[] = [
        {
          filename: 'appointment.ics',
          content: Buffer.from(icsContent, 'utf-8'),
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        },
      ];

      if (pdfBuffer) {
        attachments.push({
          filename: `Appointment-SCH-${appointmentId || subscriptionId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        });
      }

      // 12. Dispatch email via EmailService
      if (this.emailService) {
        const sendResult = await this.emailService.sendEmail(
          {
            to: customerEmail,
            subject: rendered.subject,
            html: rendered.body,
            text: rendered.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
            recordType: 'customer',
            recordId: customerId,
            leadId: lead?.id,
            appointmentId: appointmentId || undefined,
            planId: planId || undefined,
            channel: 'EMAIL',
            identifierKey,
            eventType: 'PLAN_PURCHASE_CALENDAR_SCHEDULE',
            templateId: template?.id,
            attachments,
            icalEvent: {
              filename: 'appointment.ics',
              method: 'REQUEST',
              content: icsContent,
            },
          },
          { customerId },
        );

        this.logger.log(
          `[PLAN_CALENDAR_EMAIL_SUCCESS] Calendar schedule email successfully sent to ${customerEmail} (messageId: ${sendResult.messageId})`,
        );

        return {
          success: true,
          skipped: false,
          emailLogId: (sendResult as any)?.emailLogId,
        };
      }

      return { success: true };
    } catch (err: any) {
      this.logger.error(`[PLAN_CALENDAR_EMAIL_FAILED] Error sending calendar schedule email: ${err?.message}`, err?.stack);

      // Safe error recording in EmailLog without throwing or breaking payment confirmation
      if (this.prisma.emailLog) {
        await this.prisma.emailLog.create({
          data: {
            customerId: Number(customerId),
            planId: params.planId ? Number(params.planId) : null,
            channel: 'EMAIL',
            recipientEmail: 'FAILED_SEND',
            subject: 'Scheduled Appointment',
            renderedContent: 'Failed to send calendar invitation due to internal error',
            eventType: 'PLAN_PURCHASE_CALENDAR_SCHEDULE',
            status: 'FAILED',
            errorMessage: err?.message || 'Unknown calendar email error',
            sentAt: new Date(),
          },
        }).catch(() => null);
      }

      return {
        success: false,
        reason: err?.message || 'INTERNAL_ERROR',
      };
    }
  }
}
