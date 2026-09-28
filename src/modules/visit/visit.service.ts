import { Injectable, NotFoundException, UnauthorizedException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/visit.dto';
import { VisitStatus } from '@prisma/client';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { EmailService } from '../email/email.service';
import { EmailTemplateService, renderEmailTemplate } from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { generateCalendarAppointmentPdfBuffer } from '../../common/utils/calendar-pdf.util';

@Injectable()
export class VisitService {
  private readonly logger = new Logger(VisitService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly emailTemplateService?: EmailTemplateService,
    @Optional() private readonly whatsappService?: WhatsappService,
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

    if (search && search.trim()) {
      const s = search.trim();
      where.OR = [
        { customerName: { contains: s, mode: 'insensitive' } },
        { purpose: { contains: s, mode: 'insensitive' } },
        { location: { contains: s, mode: 'insensitive' } },
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
        v.completedBy && v.completedBy !== 'Visitor'
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
      assignedVisitor: visit.employee
        ? {
            id: visit.employee.id,
            name: `${visit.employee.firstName || ''} ${visit.employee.lastName || ''}`.trim(),
          }
        : null,
    };
  }

  async create(customerId: number | string | undefined, dto: CreateVisitDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);

    // Fallback employee if not specified
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
    if (!employeeId) {
      const emp = await this.prisma.employee.findFirst({ where: { customerId: numCustomerId } });
      employeeId = emp?.id;
    }

    if (!employeeId) {
      const emp = await this.prisma.employee.create({
        data: {
          customerId: numCustomerId,
          employeeCode: `EMP-${Date.now().toString().slice(-4)}`,
          firstName: 'CRM',
          lastName: 'Executive',
          email: `rep_${Date.now()}@quikboom.com`,
        },
      });
      employeeId = emp.id;
    }

    const visit = await this.prisma.visit.create({
      data: {
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
        scheduledById: dto.scheduledById ? Number(dto.scheduledById) : undefined,
        completedBy: dto.completedBy,
        completedById: dto.completedById ? Number(dto.completedById) : undefined,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
      },
      include: {
        employee: true,
        company: true,
        contact: true,
        deal: true,
      },
    });

    // If linked to a lead, sync the lead stage to VISIT_SCHEDULED and assign employee
    if (dto.leadId) {
      try {
        const numLeadId = Number(dto.leadId);
        const visitScheduledStage = await this.prisma.leadStage.findFirst({
          where: {
            AND: [
              {
                OR: [
                  { key: 'VISIT_SCHEDULED' },
                  { key: 'VISIT' },
                  { name: { equals: 'Visit Scheduled', mode: 'insensitive' } },
                ],
              },
              {
                OR: [
                  ...(numCustomerId && numCustomerId > 0 ? [{ customerId: numCustomerId }] : []),
                  { customerId: null },
                ],
              },
            ],
            deletedAt: null,
          },
          orderBy: { customerId: 'desc' },
        });

        await this.prisma.lead.update({
          where: { id: numLeadId },
          data: {
            status: 'VISIT_SCHEDULED',
            ...(visitScheduledStage ? { stageId: visitScheduledStage.id } : {}),
            ...(employeeId ? { employeeId } : {}),
          },
        });

        await this.prisma.leadActivityTimeline.create({
          data: {
            leadId: numLeadId,
            action: 'VISIT_SCHEDULED',
            description: `Field Visit Scheduled for ${dto.date ? String(dto.date).split('T')[0] : 'today'} at ${dto.time || '10:00 AM'} - ${dto.purpose || 'Client Visit'}`,
            metadata: { visitId: visit.id, employeeId, location: dto.location },
          },
        }).catch(() => {});
      } catch (leadSyncErr: any) {
        this.logger.warn(`Could not sync lead stage on visit create: ${leadSyncErr?.message}`);
      }
    }

    // Dispatch Calendar Appointment Email & WhatsApp with PDF (non-blocking)
    try {
      await this.sendAppointmentCommunications(visit);
    } catch (commErr: any) {
      this.logger.warn(`Non-fatal: Calendar appointment communications notice: ${commErr?.message}`);
    }

    return visit;
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
    await this.findOne(numCustomerId, numId);

    const data: any = {};
    if (dto.employeeId) data.employeeId = Number(dto.employeeId);
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
}
