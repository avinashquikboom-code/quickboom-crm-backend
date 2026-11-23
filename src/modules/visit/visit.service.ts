import { Injectable, NotFoundException, UnauthorizedException, Logger, Optional, Inject, forwardRef, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';
import { VisitStatus } from '@prisma/client';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { EmailService } from '../email/email.service';
import { EmailTemplateService, renderEmailTemplate } from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NotificationService } from '../notification/notification.service';
import { generateCalendarAppointmentPdfBuffer } from '../../common/utils/calendar-pdf.util';
import { LeadRepository } from '../lead/lead.repository';
import { LeadService } from '../lead/lead.service';

@Injectable()
export class VisitService {
  private readonly logger = new Logger(VisitService.name);

  private async requireActiveFieldSalesExecutive(customerId: number, employeeId: number) {
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new BadRequestException('Select an active Field Sales Executive employee.');
    }
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId, status: 'ACTIVE', mobileLoginEnabled: true },
      include: { designation: true, user: { select: { isActive: true } } },
    });
    if (!employee || employee.user?.isActive === false || employee.designation?.name !== 'Field Sales Executive') {
      throw new BadRequestException('Selected employee must be an active Field Sales Executive belonging to this company.');
    }
    return employee;
  }

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly emailTemplateService?: EmailTemplateService,
    @Optional() private readonly whatsappService?: WhatsappService,
    @Optional() private readonly notificationService?: NotificationService,
    @Optional() private readonly leadRepository?: LeadRepository,
    @Optional() @Inject(forwardRef(() => LeadService)) private readonly leadService?: LeadService,
  ) {}

  private async resolveCustomerId(customerId?: number | string): Promise<number> {
    if (typeof customerId === 'number' && !isNaN(customerId)) {
      return customerId;
    }
    if (typeof customerId === 'string' && customerId.trim()) {
      const parsed = parseInt(customerId, 10);
      if (!isNaN(parsed)) return parsed;

      const foundCustomer = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { domain: { equals: customerId.trim(), mode: 'insensitive' } },
            { name: { equals: customerId.trim(), mode: 'insensitive' } },
          ],
          deletedAt: null,
        },
      });
      if (foundCustomer) return foundCustomer.id;
    }

    return undefined;
  }

  async getMetrics(customerId: number | string | undefined, user?: any) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const numCustomerId = await this.resolveCustomerId(customerId);
    const hasExplicitCustomer = numCustomerId !== undefined && numCustomerId > 0;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const baseWhere: any = {};
    if (isSuperAdmin) {
      if (hasExplicitCustomer) {
        baseWhere.customerId = numCustomerId;
      }
      // else: SUPER_ADMIN — no customerId filter, full platform view
    } else {
      const effectiveCustomerId = hasExplicitCustomer ? numCustomerId : (await this.resolveCustomerId(user?.customerId));
      if (!effectiveCustomerId || effectiveCustomerId <= 0) {
        throw new UnauthorizedException('User is not associated with any customer account');
      }
      baseWhere.customerId = effectiveCustomerId;
    }

    const [todayVisits, upcoming, completed, cancelled] = await Promise.all([
      this.prisma.visit.count({
        where: {
          ...baseWhere,
          date: { gte: startOfToday, lte: endOfToday },
        },
      }),
      this.prisma.visit.count({
        where: {
          ...baseWhere,
          status: 'SCHEDULED',
          date: { gte: endOfToday },
        },
      }),
      this.prisma.visit.count({
        where: {
          ...baseWhere,
          status: 'COMPLETED',
        },
      }),
      this.prisma.visit.count({
        where: {
          ...baseWhere,
          status: 'CANCELLED',
        },
      }),
    ]);

    return {
      today: todayVisits,
      upcoming,
      completed,
      cancelled,
    };
  }

  async findAll(
    customerId: number | string | undefined,
    status?: VisitStatus,
    page = 1,
    limit = 50,
    search?: string,
    employeeId?: string,
    companyId?: string,
    user?: any,
    date?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const numCustomerId = await this.resolveCustomerId(customerId);
    const hasExplicitCustomer = numCustomerId !== undefined && numCustomerId > 0;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (isSuperAdmin) {
      if (hasExplicitCustomer) {
        where.customerId = numCustomerId;
      }
      // else: SUPER_ADMIN — no customerId filter, full platform view
    } else {
      const effectiveCustomerId = hasExplicitCustomer ? numCustomerId : (await this.resolveCustomerId(user?.customerId));
      if (!effectiveCustomerId || effectiveCustomerId <= 0) {
        throw new UnauthorizedException('User is not associated with any customer account');
      }
      where.customerId = effectiveCustomerId;
    }

    if (status && (status as any) !== 'ALL') where.status = status;
    if (employeeId && employeeId !== 'ALL') where.employeeId = Number(employeeId);
    if (companyId && companyId !== 'ALL') where.companyId = Number(companyId);

    if (date && date.trim()) {
      const startOfDay = new Date(date);
      if (!isNaN(startOfDay.getTime())) {
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(startOfDay);
        endOfDay.setHours(23, 59, 59, 999);
        where.date = { gte: startOfDay, lte: endOfDay };
      }
    }

    if (search && search.trim()) {
      const s = search.trim();
      where.OR = [
        { customerName: { contains: s, mode: 'insensitive' } },
        { purpose: { contains: s, mode: 'insensitive' } },
        { location: { contains: s, mode: 'insensitive' } },
        { company: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [rawItems, total] = await Promise.all([
      this.prisma.visit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          company: { select: { id: true, name: true, city: true } },
          contact: { select: { id: true, firstName: true, lastName: true, phone: true } },
          deal: { select: { id: true, title: true, amount: true } },
          lead: { select: { id: true, title: true } },
          photos: { orderBy: { createdAt: 'desc' }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } } },
        },
      }),
      this.prisma.visit.count({ where }),
    ]);

    // Batch resolve completed employee details if completedById exists
    const completedByIds = [
      ...new Set(
        rawItems
          .map((v) => v.completedById)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      ),
    ];

    let completedEmpMap = new Map<number, { id: number; firstName: string; lastName: string; employeeCode: string }>();
    if (completedByIds.length > 0) {
      const emps = await this.prisma.employee.findMany({
        where: { id: { in: completedByIds } },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
      });
      completedEmpMap = new Map(emps.map((e) => [e.id, e]));
    }

    const items = rawItems.map((v) => {
      const empFromId = v.completedById ? completedEmpMap.get(v.completedById) : null;
      const empNameFromId = empFromId
        ? `${empFromId.firstName || ''} ${empFromId.lastName || ''}`.trim()
        : null;

      // Visited By is ONLY the employee who actually completed the visit when completed.
      // Must NOT be dummy string 'Visitor', must be the real employee name.
      const actualEmpName =
        v.completedBy && v.completedBy !== 'Visitor' && v.completedBy !== 'Field Sales Executive'
          ? v.completedBy
          : empNameFromId || null;

      const isCompleted = v.status === VisitStatus.COMPLETED;
      const finalVisitedByName = isCompleted ? actualEmpName : null;

      return {
        ...v,
        completedBy: finalVisitedByName,
        completedEmployee: isCompleted ? (empFromId || null) : null,
        visitedBy: finalVisitedByName
          ? {
              id: v.completedById || empFromId?.id || null,
              name: finalVisitedByName,
            }
          : null,
        assignedFieldSalesExecutive: v.employee
          ? {
              id: v.employee.id,
              name: `${v.employee.firstName || ''} ${v.employee.lastName || ''}`.trim(),
            }
          : null,
        assignedVisitor: v.employee
          ? {
              id: v.employee.id,
              name: `${v.employee.firstName || ''} ${v.employee.lastName || ''}`.trim(),
            }
          : null,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      data: items,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async findOne(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    const where: any = { id: numId };
    if (numCustomerId !== undefined && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const visit = await this.prisma.visit.findFirst({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true } },
        company: true,
        contact: true,
        deal: true,
        lead: true,
        photos: { orderBy: { createdAt: 'desc' }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } } },
      },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    let completedEmployee: any = null;
    if (visit.completedById) {
      completedEmployee = await this.prisma.employee.findUnique({
        where: { id: visit.completedById },
        select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true },
      });
    }

    const empNameFromId = completedEmployee
      ? `${completedEmployee.firstName || ''} ${completedEmployee.lastName || ''}`.trim()
      : null;

    const actualEmpName =
      visit.completedBy && visit.completedBy !== 'Visitor'
        ? visit.completedBy
        : empNameFromId || null;

    const isCompleted = visit.status === VisitStatus.COMPLETED;
    const finalVisitedByName = isCompleted ? actualEmpName : null;

    return {
      ...visit,
      completedBy: finalVisitedByName,
      completedEmployee: isCompleted ? completedEmployee : null,
      visitedBy: finalVisitedByName
        ? {
            id: visit.completedById || completedEmployee?.id || null,
            name: finalVisitedByName,
          }
        : null,
      assignedFieldSalesExecutive: visit.employee
        ? {
            id: visit.employee.id,
            name: `${visit.employee.firstName || ''} ${visit.employee.lastName || ''}`.trim(),
          }
        : null,
      assignedVisitor: visit.employee
        ? {
            id: visit.employee.id,
            name: `${visit.employee.firstName || ''} ${visit.employee.lastName || ''}`.trim(),
          }
        : null,
    };
  }

  async create(
    customerId: number | string | undefined,
    dto: CreateVisitDto,
    actingUserId?: number | string,
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    // Preserve legacy assignments when possible, then validate before creating.
    let employeeId = dto.employeeId ? Number(dto.employeeId) : undefined;
    if (!employeeId && dto.leadId) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: Number(dto.leadId) },
        select: { employeeId: true },
      });
      if (lead?.employeeId) {
        employeeId = Number(lead.employeeId);
      }
    }
    if (!employeeId) throw new BadRequestException('Select an active Field Sales Executive employee.');
    await this.requireActiveFieldSalesExecutive(numCustomerId, employeeId);

    const visitData = {
      customerId: numCustomerId,
      employeeId: employeeId,
      companyId: dto.companyId ? Number(dto.companyId) : undefined,
      contactId: dto.contactId ? Number(dto.contactId) : undefined,
      dealId: dto.dealId ? Number(dto.dealId) : undefined,
      leadId: dto.leadId ? Number(dto.leadId) : undefined,
      customerName: dto.customerName,
      purpose: dto.purpose,
      visitType: dto.visitType || 'CLIENT_MEETING',
      date: new Date(dto.date),
      time: dto.time || '10:00 AM',
      location: dto.location,
      latitude: dto.latitude,
      longitude: dto.longitude,
      status: dto.status || VisitStatus.SCHEDULED,
      notes: dto.notes,
      outcome: dto.outcome,
      nextFollowUpDate: dto.nextFollowUpDate ? new Date(dto.nextFollowUpDate) : undefined,
      scheduledBy: dto.scheduledBy,
      scheduledById: dto.scheduledById ? Number(dto.scheduledById) : (actingUserId ? Number(actingUserId) : undefined),
      completedBy: dto.completedBy,
      completedById: dto.completedById ? Number(dto.completedById) : undefined,
      startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
    };

    const visitInclude = {
      employee: true,
      company: true,
      contact: true,
      deal: true,
    };

    let visit: any;
    let linkedLead: any = null;
    let syncResult: 'MOVED' | 'SKIPPED' | 'NO_STAGE' | null = null;
    let leadBefore: any = null;

    if (dto.leadId && this.leadRepository) {
      const numLeadId = Number(dto.leadId);
      leadBefore = await this.prisma.lead.findUnique({
        where: { id: numLeadId },
        include: { stage: true },
      });
      const leadEmpId = leadBefore?.employeeId || visitData.scheduledById || employeeId;
      const syncUserId = visitData.scheduledById ? Number(visitData.scheduledById) : 0;
      const notes = `Field visit scheduled for ${dto.date ? String(dto.date).split('T')[0] : 'today'} at ${dto.time || '10:00 AM'} — ${dto.purpose || 'Client Visit'}`;

      const txResult = await this.prisma.$transaction(async (tx) => {
        const txRepo = new LeadRepository(tx as PrismaService);
        const savedVisit = await tx.visit.create({
          data: visitData,
          include: visitInclude,
        });

        if (leadEmpId) {
          await tx.lead.update({
            where: { id: numLeadId },
            data: { employeeId: Number(leadEmpId) },
          });
        }

        const existingScheduled = await tx.visit.findFirst({
          where: {
            leadId: numLeadId,
            customerId: numCustomerId,
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
            id: { not: savedVisit.id },
          },
        });
        if (existingScheduled) {
          await tx.visit.update({
            where: { id: existingScheduled.id },
            data: { status: 'CANCELLED' },
          });
        }

        await tx.leadActivityTimeline.create({
          data: {
            leadId: numLeadId,
            action: 'VISIT_SCHEDULED',
            description: notes,
            metadata: { visitId: savedVisit.id, employeeId, location: dto.location },
          },
        }).catch(() => null);

        const stageSync = await txRepo.transitionLeadToVisitScheduledAfterVisit(
          numCustomerId,
          numLeadId,
          syncUserId,
          notes,
          { inlineTransaction: true },
        );

        const lead = await txRepo.findOne(numCustomerId, numLeadId);
        return { visit: savedVisit, stageSync, lead };
      });

      visit = txResult.visit;
      syncResult = txResult.stageSync;
      linkedLead = txResult.lead;
    } else {
      visit = await this.prisma.visit.create({
        data: visitData,
        include: visitInclude,
      });
      if (dto.leadId && !this.leadRepository) {
        this.logger.warn('[VISIT_CREATE] LeadRepository unavailable — lead stage was not updated.');
      }
    }

    if (dto.leadId && leadBefore) {
      const numLeadId = Number(dto.leadId);
      const syncUserId = visitData.scheduledById ? Number(visitData.scheduledById) : 0;
      if (syncResult === 'NO_STAGE') {
        this.logger.error(
          `[VISIT_CREATE] Visit #${visit.id} saved for lead #${numLeadId} but Visit Scheduled stage is not configured for tenant ${numCustomerId}.`,
        );
      } else if (syncResult === 'MOVED' && this.leadService) {
        await this.leadService
          .syncStageAutomationsAfterVisitSchedule(numCustomerId, numLeadId, syncUserId, {
            stageId: leadBefore.stageId,
            stageName: leadBefore.stage?.name,
            status: leadBefore.status,
          })
          .catch((err) => this.logger.warn(`[VISIT_CREATE] Stage automation notify failed: ${err?.message}`));
      }
    }

    // Dispatch Calendar Appointment Email & WhatsApp with PDF (non-blocking)
    try {
      await this.sendAppointmentCommunications(visit);
    } catch (commErr: any) {
      this.logger.warn(`Non-fatal: Calendar appointment communications notice: ${commErr?.message}`);
    }

    // Sync Calendar Activity to Customer Team Member Task
    try {
      await this.syncVisitTeamTask(visit);
    } catch (taskErr: any) {
      this.logger.warn(`Non-fatal: Visit team task sync notice: ${taskErr?.message}`);
    }

    return linkedLead ? { ...visit, lead: linkedLead, leadStageSynced: syncResult === 'MOVED' } : visit;
  }

  /**
   * Helper to dispatch Calendar Appointment Email + WhatsApp and Calendar Appointment PDF
   */
  async sendAppointmentCommunications(visit: any) {
    if (!visit) return;

    try {
      const customerId = visit.customerId;
      let customer: any = null;
      if (customerId) {
        customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
          include: {
            users: { where: { deletedAt: null }, select: { email: true, phone: true }, take: 1 },
          },
        });
      }

      const clientName =
        visit.customerName ||
        (visit.contact?.firstName ? `${visit.contact.firstName || ''} ${visit.contact.lastName || ''}`.trim() : null) ||
        customer?.name ||
        customer?.companyName ||
        'Valued Client';

      const clientEmail = visit.contact?.email || customer?.email || customer?.users?.[0]?.email;
      const clientPhone = visit.contact?.phone || customer?.phone || customer?.users?.[0]?.phone;
      const companyName = customer?.companyName || customer?.name || 'QUIKBOOM Digital Marketing Agency';

      const employeeName = visit.employee
        ? `${visit.employee.firstName || ''} ${visit.employee.lastName || ''}`.trim()
        : 'QuickBoom Representative';
      const employeeEmail = visit.employee?.email;
      const employeePhone = visit.employee?.phone;

      const eventTitle = visit.purpose || visit.visitType || 'Client Consultation & Strategy Meeting';
      const visitDate = visit.date instanceof Date ? visit.date.toLocaleDateString('en-IN') : String(visit.date);
      const visitTime = visit.time || '10:00 AM';
      const visitLocation = visit.location || 'Online Video Conference / QuikBoom HQ';
      const appointmentNo = `APT-${visit.id}`;

      // Generate Calendar Appointment PDF buffer
      let pdfBuffer: Buffer | null = null;
      try {
        pdfBuffer = await generateCalendarAppointmentPdfBuffer({
          appointmentNo,
          customerName: clientName,
          companyName,
          eventTitle,
          date: visitDate,
          time: visitTime,
          location: visitLocation,
          assignedEmployeeName: employeeName,
          assignedEmployeeEmail: employeeEmail,
          assignedEmployeePhone: employeePhone,
          customerEmail: clientEmail,
          customerPhone: clientPhone,
          notes: visit.notes,
        });
      } catch (pdfErr: any) {
        this.logger.warn(`Non-fatal: Failed to generate calendar appointment PDF: ${pdfErr?.message}`);
      }

      // 1. Dispatch Email with PDF attachment
      if (clientEmail && this.emailService && this.emailTemplateService) {
        try {
          const template = await this.emailTemplateService.findByKey('CALENDAR_SCHEDULED', customerId);
          const rendered = renderEmailTemplate(
            {
              subject: template?.subject || 'Meeting Scheduled: {{eventTitle}} with {{companyName}}',
              body: template?.body || '',
            },
            {
              customerName: clientName,
              eventTitle,
              date: visitDate,
              time: visitTime,
              location: visitLocation,
              assignedTo: employeeName,
              companyName,
            },
          );

          await this.emailService.sendEmail({
            to: clientEmail,
            subject: rendered.subject,
            html: rendered.body,
            text: rendered.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
            recordType: 'visit',
            recordId: visit.id,
            eventType: 'CALENDAR_SCHEDULED',
            templateId: template?.id,
            attachments: pdfBuffer
              ? [{ filename: `Appointment-${appointmentNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
              : undefined,
          });
          this.logger.log(`[EMAIL] Calendar appointment confirmation sent to ${clientEmail}`);
        } catch (emailErr: any) {
          this.logger.warn(`[EMAIL] Calendar appointment email notice: ${emailErr?.message}`);
        }
      }

      // 2. Dispatch WhatsApp message + PDF Document
      if (this.whatsappService && clientPhone) {
        try {
          await this.whatsappService.sendCalendarScheduledMessage({
            to: clientPhone,
            customerId,
            customerName: clientName,
            eventTitle,
            date: visitDate,
            time: visitTime,
            location: visitLocation,
            assignedEmployee: employeeName,
            pdfBuffer: pdfBuffer || undefined,
          });
          this.logger.log(`[WHATSAPP] Calendar appointment message sent to ${clientPhone}`);
        } catch (waErr: any) {
          this.logger.warn(`[WHATSAPP] Calendar appointment WhatsApp notice: ${waErr?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`[APPOINTMENT_COMMUNICATION_ERROR] ${err?.message}`);
    }
  }

  async update(customerId: number | string | undefined, id: number | string, dto: UpdateVisitDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    const existingVisit = await this.findOne(numCustomerId, numId);
    const wasCompleted = existingVisit?.status === VisitStatus.COMPLETED;

    const data: any = {};
    if (dto.employeeId !== undefined) {
      const employeeId = Number(dto.employeeId);
      await this.requireActiveFieldSalesExecutive(numCustomerId, employeeId);
      data.employeeId = employeeId;
    }
    if (dto.customerName) data.customerName = dto.customerName;
    if (dto.purpose) data.purpose = dto.purpose;
    if (dto.date) data.date = new Date(dto.date);
    if (dto.time) data.time = dto.time;
    if (dto.location) data.location = dto.location;
    if (dto.status) data.status = dto.status;
    if (dto.notes) data.notes = dto.notes;
    if (dto.outcome) data.outcome = dto.outcome;
    if (dto.nextFollowUpDate) data.nextFollowUpDate = new Date(dto.nextFollowUpDate);
    if (dto.completedBy) data.completedBy = dto.completedBy;
    if (dto.completedById) data.completedById = Number(dto.completedById);
    if (dto.scheduledBy) data.scheduledBy = dto.scheduledBy;
    if (dto.scheduledById) data.scheduledById = Number(dto.scheduledById);
    if (dto.startedAt) {
      data.startedAt = new Date(dto.startedAt);
    } else if (dto.status === VisitStatus.IN_PROGRESS) {
      data.startedAt = new Date();
    }
    if (dto.latitude !== undefined) data.latitude = Number(dto.latitude);
    if (dto.longitude !== undefined) data.longitude = Number(dto.longitude);

    if (dto.status === VisitStatus.COMPLETED) {
      data.completedAt = new Date();
    }

    const updated = await this.prisma.visit.update({
      where: { id: numId },
      data,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        company: true,
        contact: true,
        deal: true,
      },
    });

    let completedEmployee: any = null;
    if (updated.completedById) {
      completedEmployee = await this.prisma.employee.findUnique({
        where: { id: updated.completedById },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
      });
    }

    const empNameFromId = completedEmployee
      ? `${completedEmployee.firstName || ''} ${completedEmployee.lastName || ''}`.trim()
      : null;

    const actualEmpName =
      updated.completedBy && updated.completedBy !== 'Visitor'
        ? updated.completedBy
        : empNameFromId || null;

    const isCompleted = updated.status === VisitStatus.COMPLETED;
    const finalVisitedByName = isCompleted ? actualEmpName : null;

    if (
      isCompleted &&
      !wasCompleted &&
      this.notificationService &&
      numCustomerId &&
      numCustomerId > 0
    ) {
      const leadId = (updated as any).leadId ?? existingVisit?.leadId;
      let leadName: string | null = null;
      if (leadId) {
        const lead = await this.prisma.lead.findFirst({
          where: { id: Number(leadId), deletedAt: null },
          select: { firstName: true, lastName: true, companyName: true, title: true },
        });
        if (lead) {
          const fullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
          leadName = fullName || lead.companyName || lead.title || null;
        }
      }
      try {
        await this.notificationService.sendVisitCompletedNotification({
          customerId: numCustomerId,
          visitId: numId,
          leadId: leadId ? Number(leadId) : null,
          visitorName: finalVisitedByName || updated.employee
            ? `${updated.employee?.firstName || ''} ${updated.employee?.lastName || ''}`.trim()
            : null,
          leadName,
        });
      } catch (notifErr: any) {
        this.logger.warn(`[FCM] Visit completed push skipped: ${notifErr?.message}`);
      }
    }

    // Sync updated visit status / time to customer team task
    try {
      await this.syncVisitTeamTask(updated);
    } catch (taskErr: any) {
      this.logger.warn(`Non-fatal: Visit team task sync notice: ${taskErr?.message}`);
    }

    return {
      ...updated,
      completedBy: finalVisitedByName,
      completedEmployee: isCompleted ? completedEmployee : null,
      visitedBy: finalVisitedByName
        ? {
            id: updated.completedById || completedEmployee?.id || null,
            name: finalVisitedByName,
          }
        : null,
      assignedFieldSalesExecutive: updated.employee
        ? {
            id: updated.employee.id,
            name: `${updated.employee.firstName || ''} ${updated.employee.lastName || ''}`.trim(),
          }
        : null,
      assignedVisitor: updated.employee
        ? {
            id: updated.employee.id,
            name: `${updated.employee.firstName || ''} ${updated.employee.lastName || ''}`.trim(),
          }
        : null,
    };
  }

  async remove(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.visit.delete({
      where: { id: numId },
    });
  }

  /**
   * Synchronize calendar activity / visit with team member tasks.
   * If customer is assigned to a team, auto-assigns task to eligible team member
   * (lead, selected member, or round-robin) and tracks status & schedule changes.
   */
  async syncVisitTeamTask(visit: any) {
    if (!visit || !visit.customerId) return;

    try {
      const numCustomerId = Number(visit.customerId);
      const visitTag = `[VISIT-#${visit.id}]`;

      // 1. Check for existing linked task
      const existingTask = await this.prisma.task.findFirst({
        where: {
          customerId: numCustomerId,
          notes: { contains: visitTag },
          deletedAt: null,
        },
      });

      // Handle visit status updates / rescheduling on existing task
      if (existingTask) {
        const updateData: any = {};
        if (visit.date) {
          updateData.dueDate = new Date(visit.date);
          updateData.dueAt = new Date(visit.date);
        }
        if (visit.time) {
          updateData.dueTime = visit.time;
        }
        if (visit.status === 'COMPLETED' && existingTask.status !== ('COMPLETED' as any)) {
          updateData.status = 'COMPLETED' as any;
          updateData.completedAt = new Date();
        } else if (visit.status === 'CANCELLED' && existingTask.status !== ('CANCELLED' as any)) {
          updateData.status = 'CANCELLED' as any;
        }

        if (Object.keys(updateData).length > 0) {
          await this.prisma.task.update({
            where: { id: existingTask.id },
            data: updateData,
          });
        }
        return existingTask;
      }

      // If visit is cancelled, do not create a new task
      if (visit.status === 'CANCELLED') return;

      // 2. Identify customer and customer's assigned team
      const customer = await this.prisma.customer.findUnique({
        where: { id: numCustomerId },
        include: {
          assignedTeam: {
            include: {
              leader: { select: { id: true, firstName: true, lastName: true } },
              members: {
                include: {
                  employee: { select: { id: true, firstName: true, lastName: true, status: true } },
                },
              },
            },
          },
        },
      });

      if (!customer || !customer.assignedTeam) {
        // Customer has no team assigned yet
        return;
      }

      const team = customer.assignedTeam;
      const activeMembers = (team.members || [])
        .map((m: any) => m.employee)
        .filter((emp: any) => emp && emp.status !== 'INACTIVE');

      // 3. Determine task assignee
      let targetEmployeeId = visit.employeeId ? Number(visit.employeeId) : null;
      const isEmployeeInTeam = activeMembers.some((m: any) => m.id === targetEmployeeId);

      if (!targetEmployeeId || !isEmployeeInTeam) {
        if (team.leaderId) {
          targetEmployeeId = team.leaderId;
        } else if (activeMembers.length > 0) {
          // Round-robin / lowest active task count
          const memberIds = activeMembers.map((m: any) => m.id);
          const taskCounts = await this.prisma.task.groupBy({
            by: ['employeeId'],
            where: {
              employeeId: { in: memberIds },
              status: { in: ['PENDING' as any, 'IN_PROGRESS' as any] },
              deletedAt: null,
            },
            _count: true,
          });

          const countMap = new Map<number, number>();
          memberIds.forEach((id: number) => countMap.set(id, 0));
          taskCounts.forEach((tc: any) => {
            if (tc.employeeId) countMap.set(tc.employeeId, tc._count);
          });

          let minCount = Infinity;
          let chosenId = memberIds[0];
          for (const [empId, cnt] of countMap.entries()) {
            if (cnt < minCount) {
              minCount = cnt;
              chosenId = empId;
            }
          }
          targetEmployeeId = chosenId;
        }
      }

      // 4. Create Task Number & Task Record
      const count = await this.prisma.task.count({ where: { customerId: numCustomerId } });
      const taskNumber = `TSK-${(count + 1001).toString()}`;
      const activityLabel = visit.visitType ? visit.visitType.replace(/_/g, ' ') : 'Client Meeting';
      const taskTitle = `${activityLabel}: ${visit.customerName || customer.name || 'Customer'}`;
      const taskDesc = `Scheduled calendar activity: ${visit.purpose || 'Client Consultation'}\nLocation: ${visit.location || 'HQ / On-site'}\nCustomer: ${visit.customerName || customer.name}\nAssigned Team: ${team.name}`;
      const dueDate = visit.date ? new Date(visit.date) : new Date();

      const created = await this.prisma.task.create({
        data: {
          customerId: numCustomerId,
          createdById: visit.scheduledById ? Number(visit.scheduledById) : 1,
          taskNumber,
          title: taskTitle,
          description: taskDesc,
          priority: 'MEDIUM' as any,
          status: 'PENDING' as any,
          dueDate,
          dueTime: visit.time || '10:00 AM',
          dueAt: dueDate,
          category: 'Calendar Activity',
          employeeId: targetEmployeeId || undefined,
          notes: `${visitTag}[TEAM-#${team.id}] ${visit.notes || ''}`.trim(),
        },
      });

      // 5. Audit history for task creation
      await (this.prisma as any).taskHistory.create({
        data: {
          taskId: created.id,
          action: 'TASK_CREATED',
          performedById: visit.scheduledById ? Number(visit.scheduledById) : 1,
          performedByName: 'Calendar Sync',
          newStatus: 'PENDING',
          newEmployeeId: targetEmployeeId,
          comment: `Task generated from calendar activity (${activityLabel}) and distributed to Team "${team.name}".`,
        },
      }).catch(() => null);

      return created;
    } catch (err: any) {
      this.logger.warn(`Failed to sync calendar visit with team tasks: ${err?.message}`);
    }
  }
}
