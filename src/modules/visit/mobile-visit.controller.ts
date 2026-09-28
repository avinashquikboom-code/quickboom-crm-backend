import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { VisitService } from './visit.service';
import { VisitStatus, LeadStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { isUserSuperAdmin } from '../../common/utils/role.util';

/**
 * Mobile-specific visit endpoints for employee field-visit management.
 * Employees can only see visits assigned to them, check-in (start) and complete them.
 */
@ApiTags('Mobile - Employee Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('mobile/visits')
export class MobileVisitController {
  constructor(
    private readonly visitService: VisitService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get visits assigned to authenticated employee' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'tab', required: false, description: 'upcoming | ongoing | completed' })
  async getMyVisits(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('status') status?: VisitStatus,
    @Query('tab') tab?: string,
  ) {
    // Resolve the authenticated employee
    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user?.id },
          { email: { equals: user?.email?.trim()?.toLowerCase(), mode: 'insensitive' } },
        ],
      },
    });

    if (!employee) {
      return { items: [], data: [], total: 0 };
    }

    const numCustomerId = Number(customerId) || employee.customerId;
    const where: any = {
      ...(numCustomerId > 0 ? {
        OR: [
          { customerId: numCustomerId },
          { customerId: employee.customerId },
        ],
      } : {}),
      AND: [
        {
          OR: [
            { employeeId: employee.id },
            { lead: { employeeId: employee.id } },
            { lead: { assignedToId: user.id } },
            { completedById: employee.id },
          ],
        },
      ],
    };

    // Tab → status mapping
    if (tab) {
      if (tab === 'upcoming') {
        where.AND.push({
          status: VisitStatus.SCHEDULED,
          OR: [
            { leadId: null },
            { lead: { status: { notIn: ['VISIT_DONE', 'WON', 'LOST'] } } },
          ],
        });
      } else if (tab === 'ongoing') {
        where.AND.push({ status: VisitStatus.IN_PROGRESS });
      } else if (tab === 'completed') {
        where.AND.push({
          OR: [
            { status: VisitStatus.COMPLETED },
            { lead: { status: 'VISIT_DONE' } },
            { lead: { stage: { key: 'VISIT_DONE' } } },
            { lead: { stage: { name: { equals: 'Visit Done', mode: 'insensitive' } } } },
          ],
        });
      }
    } else if (status && (status as string) !== 'ALL') {
      where.status = status;
    }

    const visits = await this.prisma.visit.findMany({
      where,
      orderBy: tab === 'completed' ? { updatedAt: 'desc' } : { date: 'asc' },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, phone: true } },
        company: { select: { id: true, name: true, city: true, address: true, phone: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        deal: { select: { id: true, title: true } },
        lead: {
          select: {
            id: true,
            title: true,
            companyName: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            address: true,
            city: true,
            value: true,
            category: true,
            status: true,
            employeeId: true,
            stage: { select: { key: true, name: true } },
          },
        },
      },
    });

    // ── When viewing upcoming / scheduled visits: ────────────────────────────
    // Ensure all leads assigned to this visitor in VISIT_SCHEDULED stage appear
    // in the Scheduled tab as per requirements and reference design.
    if (tab === 'upcoming') {
      const existingLeadIds = new Set(visits.map((v) => v.leadId).filter(Boolean));

      const unlinkedLeads = await this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          ...(numCustomerId > 0 ? { customerId: numCustomerId } : {}),
          OR: [
            { employeeId: employee.id },
            { assignedToId: user.id },
          ],
          AND: [
            {
              OR: [
                { status: LeadStatus.VISIT_SCHEDULED },
                { status: 'VISIT' as any },
                { stage: { key: { in: ['VISIT_SCHEDULED', 'VISIT'] } } },
                { stage: { name: { equals: 'Visit Scheduled', mode: 'insensitive' } } },
              ],
            },
            ...(existingLeadIds.size > 0 ? [{ id: { notIn: Array.from(existingLeadIds) as number[] } }] : []),
          ],
        },
        include: {
          stage: { select: { key: true, name: true } },
        },
      });

      for (const lead of unlinkedLeads) {
        let visit = await this.prisma.visit.findFirst({
          where: { leadId: lead.id },
          orderBy: { createdAt: 'desc' },
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, phone: true } },
            company: { select: { id: true, name: true, city: true, address: true, phone: true, email: true } },
            contact: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
            deal: { select: { id: true, title: true } },
            lead: {
              select: {
                id: true,
                title: true,
                companyName: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
                address: true,
                city: true,
                value: true,
                category: true,
                status: true,
                employeeId: true,
                stage: { select: { key: true, name: true } },
              },
            },
          },
        });

        if (!visit) {
          visit = await this.prisma.visit.create({
            data: {
              customerId: lead.customerId,
              leadId: lead.id,
              employeeId: employee.id,
              customerName: lead.companyName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title || 'Client',
              purpose: lead.category || lead.title || 'Field Visit & Demo',
              date: new Date(),
              time: '11:00 AM',
              location: lead.address || lead.city || 'Client Site',
              status: VisitStatus.SCHEDULED,
              notes: lead.workNotes || 'Scheduled lead assigned to visitor',
              scheduledById: employee.id,
              scheduledBy: 'Lead Assignment',
            },
            include: {
              employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, phone: true } },
              company: { select: { id: true, name: true, city: true, address: true, phone: true, email: true } },
              contact: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
              deal: { select: { id: true, title: true } },
              lead: {
                select: {
                  id: true,
                  title: true,
                  companyName: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                  email: true,
                  address: true,
                  city: true,
                  value: true,
                  category: true,
                  status: true,
                  employeeId: true,
                  stage: { select: { key: true, name: true } },
                },
              },
            },
          });
        }

        if (visit && visit.status === VisitStatus.SCHEDULED) {
          visits.push(visit);
        }
      }
    }

    const mapped = visits.map((v) => {
      const assignedEmpName = v.employee
        ? `${v.employee.firstName || ''} ${v.employee.lastName || ''}`.trim()
        : null;
      const leadName = v.lead
        ? (v.lead.companyName || `${v.lead.firstName || ''} ${v.lead.lastName || ''}`.trim() || v.lead.title)
        : null;

      const isLeadVisitDone =
        v.lead?.status === 'VISIT_DONE' ||
        v.lead?.stage?.key === 'VISIT_DONE' ||
        (v.lead?.stage?.name || '').toUpperCase().includes('VISIT DONE');
      const isCompleted = v.status === VisitStatus.COMPLETED || isLeadVisitDone;

      return {
        id: v.id,
        customer: v.customerName || leadName || v.company?.name || 'Unknown Customer',
        customerName: v.customerName || leadName,
        leadTitle: v.lead?.title,
        leadId: v.leadId,
        lead: v.lead,
        assignedEmployee: assignedEmpName,
        completedBy: isCompleted ? (v.completedBy || null) : null,
        completedById: v.completedById || null,
        scheduledBy: v.scheduledBy || null,
        employee: v.employee,
        location: v.location || v.company?.city || 'N/A',
        purpose: v.purpose,
        date: v.date ? new Date(v.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        scheduledDate: v.date,
        time: v.time || '',
        status: isCompleted ? VisitStatus.COMPLETED : v.status,
        tab: isCompleted
          ? 'completed'
          : v.status === VisitStatus.SCHEDULED
            ? 'upcoming'
            : 'ongoing',
        notes: v.notes,
        outcome: v.outcome,
        visitType: v.visitType,
        latitude: v.latitude,
        longitude: v.longitude,
        startedAt: v.startedAt || null,
        completedAt: v.completedAt || (isCompleted ? v.updatedAt : null),
        completedAtFormatted: (v.completedAt || (isCompleted ? v.updatedAt : null))
          ? new Date(v.completedAt || v.updatedAt).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : null,
        phone: v.contact?.phone || v.lead?.phone || v.company?.phone || null,
        email: v.contact?.email || v.lead?.email || v.company?.email || null,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        company: v.company,
        contact: v.contact,
      };
    });

    return { items: mapped, data: mapped, total: mapped.length };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single visit details assigned to employee' })
  async getVisitById(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
  ) {
    const numId = Number(id);
    const visit = await this.prisma.visit.findUnique({
      where: { id: numId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, phone: true } },
        company: { select: { id: true, name: true, city: true, address: true, phone: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        deal: { select: { id: true, title: true, amount: true } },
        lead: {
          select: {
            id: true,
            title: true,
            companyName: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            address: true,
            city: true,
            value: true,
            category: true,
            status: true,
            employeeId: true,
            stage: { select: { key: true, name: true } },
          },
        },
      },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user?.id },
          { email: { equals: user?.email?.trim()?.toLowerCase(), mode: 'insensitive' } },
        ],
      },
    });

    const isSuperAdmin = isUserSuperAdmin(user);
    const isAssigned =
      visit.employeeId === employee?.id ||
      visit.lead?.employeeId === employee?.id ||
      (visit.lead as any)?.assignedToId === user?.id ||
      visit.completedById === employee?.id;
    if (!isSuperAdmin && employee && !isAssigned) {
      throw new ForbiddenException('You do not have permission to view another employee\'s visit.');
    }

    const assignedEmpName = visit.employee
      ? `${visit.employee.firstName || ''} ${visit.employee.lastName || ''}`.trim()
      : null;
    const leadName = visit.lead
      ? (visit.lead.companyName || `${visit.lead.firstName || ''} ${visit.lead.lastName || ''}`.trim() || visit.lead.title)
      : null;

    const isLeadVisitDone =
      visit.lead?.status === 'VISIT_DONE' ||
      visit.lead?.stage?.key === 'VISIT_DONE' ||
      (visit.lead?.stage?.name || '').toUpperCase().includes('VISIT DONE');
    const isCompleted = visit.status === VisitStatus.COMPLETED || isLeadVisitDone;

    return {
      id: visit.id,
      customer: visit.customerName || leadName || visit.company?.name || 'Unknown Customer',
      customerName: visit.customerName || leadName,
      leadTitle: visit.lead?.title,
      leadId: visit.leadId,
      lead: visit.lead,
      assignedEmployee: assignedEmpName,
      completedBy: isCompleted ? (visit.completedBy || null) : null,
      completedById: visit.completedById || null,
      scheduledBy: visit.scheduledBy || null,
      scheduledById: visit.scheduledById || null,
      employee: visit.employee,
      location: visit.location || visit.company?.city || 'N/A',
      purpose: visit.purpose,
      date: visit.date ? new Date(visit.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      scheduledDate: visit.date,
      time: visit.time || '',
      status: isCompleted ? VisitStatus.COMPLETED : visit.status,
      tab: isCompleted
        ? 'completed'
        : visit.status === VisitStatus.SCHEDULED
          ? 'upcoming'
          : 'ongoing',
      notes: visit.notes,
      outcome: visit.outcome,
      visitType: visit.visitType,
      latitude: visit.latitude,
      longitude: visit.longitude,
      startedAt: visit.startedAt || null,
      completedAt: visit.completedAt || (isCompleted ? visit.updatedAt : null),
      completedAtFormatted: (visit.completedAt || (isCompleted ? visit.updatedAt : null))
        ? new Date(visit.completedAt || visit.updatedAt).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : null,
      phone: visit.contact?.phone || visit.lead?.phone || visit.company?.phone || null,
      email: visit.contact?.email || visit.lead?.email || visit.company?.email || null,
      company: visit.company,
      contact: visit.contact,
      deal: visit.deal,
      createdAt: visit.createdAt,
      updatedAt: visit.updatedAt,
    };
  }

  @Patch(':id/check-in')
  @ApiOperation({ summary: 'Employee GPS check-in to start a scheduled visit' })
  async checkIn(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() body: { latitude?: number; longitude?: number; address?: string },
  ) {
    const numId = Number(id);
    const visit = await this.prisma.visit.findUnique({
      where: { id: numId },
      include: { lead: { select: { employeeId: true } } },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user?.id },
          { email: { equals: user?.email?.trim()?.toLowerCase(), mode: 'insensitive' } },
        ],
      },
    });

    if (!employee) {
      throw new Error('Employee profile not found');
    }

    const isSuperAdmin = isUserSuperAdmin(user);
    const isAssigned =
      visit.employeeId === employee.id ||
      visit.lead?.employeeId === employee.id ||
      (visit.lead as any)?.assignedToId === user?.id;
    if (!isSuperAdmin && !isAssigned) {
      throw new ForbiddenException('You do not have permission to start another employee\'s visit.');
    }

    const data: any = {
      status: VisitStatus.IN_PROGRESS,
      startedAt: visit.startedAt || new Date(),
    };
    if (body?.latitude) data.latitude = body.latitude;
    if (body?.longitude) data.longitude = body.longitude;
    if (body?.address) data.location = body.address;

    const numCustomerId = Number(customerId) || employee.customerId || visit.customerId;
    const updated = await this.visitService.update(numCustomerId, id, data);

    if (visit.leadId) {
      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: visit.leadId,
          action: 'VISIT_STARTED',
          description: `Field Visit Started by ${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
          metadata: {
            visitId: visit.id,
            latitude: body?.latitude,
            longitude: body?.longitude,
            startedAt: data.startedAt,
          },
        },
      }).catch(() => {});
    }

    return updated;
  }

  @Patch(':id/requirement')
  @ApiOperation({ summary: 'Employee saves customer requirements for a visit' })
  async saveRequirement(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() body: {
      requirement?: string;
      services?: string;
      budget?: string | number;
      timeline?: string;
      notes?: string;
    },
  ) {
    const numId = Number(id);
    const visit = await this.prisma.visit.findUnique({
      where: { id: numId },
      include: { lead: true },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user?.id },
          { email: { equals: user?.email?.trim()?.toLowerCase(), mode: 'insensitive' } },
        ],
      },
    });

    const isSuperAdmin = isUserSuperAdmin(user);
    const isAssigned =
      visit.employeeId === employee?.id ||
      visit.lead?.employeeId === employee?.id ||
      (visit.lead as any)?.assignedToId === user?.id;
    if (!isSuperAdmin && employee && !isAssigned) {
      throw new ForbiddenException('You do not have permission to update another employee\'s visit.');
    }

    const numCustomerId = Number(customerId) || employee?.customerId || visit.customerId;

    // Build structured requirement string
    const requirementParts: string[] = [];
    if (body.requirement?.trim()) requirementParts.push(`Requirement: ${body.requirement.trim()}`);
    if (body.services?.trim()) requirementParts.push(`Required Services: ${body.services.trim()}`);
    if (body.budget !== undefined && body.budget !== null && String(body.budget).trim()) {
      requirementParts.push(`Budget: ${String(body.budget).trim()}`);
    }
    if (body.timeline?.trim()) requirementParts.push(`Expected Timeline: ${body.timeline.trim()}`);
    if (body.notes?.trim()) requirementParts.push(`Additional Notes: ${body.notes.trim()}`);

    const requirementSummary = requirementParts.join('\n');
    const existingNotes = visit.notes || '';
    const updatedNotes = requirementSummary
      ? (existingNotes ? `${existingNotes}\n\n--- Customer Requirement ---\n${requirementSummary}` : requirementSummary)
      : existingNotes;

    const updated = await this.visitService.update(numCustomerId, id, {
      notes: updatedNotes,
    });

    // If attached to a lead, update budget and record timeline
    if (visit.leadId) {
      const budgetNum = typeof body.budget === 'number' ? body.budget : parseFloat(String(body.budget || '0').replace(/[^0-9.]/g, ''));
      try {
        await this.prisma.lead.update({
          where: { id: visit.leadId },
          data: {
            ...(budgetNum > 0 ? { value: budgetNum } : {}),
            ...(body.services ? { category: body.services.slice(0, 100) } : {}),
          },
        });

        await this.prisma.leadActivityTimeline.create({
          data: {
            leadId: visit.leadId,
            action: 'REQUIREMENT_CAPTURED',
            description: `Field Visit Requirement recorded: ${body.requirement || body.services || 'Requirement Details'}`,
            metadata: {
              visitId: visit.id,
              services: body.services,
              budget: budgetNum,
              timeline: body.timeline,
              requirement: body.requirement,
            },
          },
        }).catch(() => {});
      } catch (_) {}
    }

    return updated;
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Employee marks a visit as completed with outcome notes' })
  async completeVisit(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() body: { notes?: string; outcome?: string; nextFollowUpDate?: string; rating?: number; feedback?: string },
  ) {
    const numId = Number(id);
    const visit = await this.prisma.visit.findUnique({
      where: { id: numId },
      include: { lead: { select: { employeeId: true } } },
    });

    if (!visit) {
      throw new NotFoundException(`Visit with ID ${id} not found`);
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: user?.id },
          { email: { equals: user?.email?.trim()?.toLowerCase(), mode: 'insensitive' } },
        ],
      },
    });

    const isSuperAdmin = isUserSuperAdmin(user);
    const isAssigned =
      visit.employeeId === employee?.id ||
      visit.lead?.employeeId === employee?.id ||
      (visit.lead as any)?.assignedToId === user?.id ||
      visit.completedById === employee?.id;
    if (!isSuperAdmin && employee && !isAssigned) {
      throw new ForbiddenException('You do not have permission to update another employee\'s visit.');
    }

    const numCustomerId = Number(customerId) || employee?.customerId || visit.customerId;

    const actingEmpName = employee
      ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
      : null;

    const finalOutcome = body?.outcome || body?.feedback || visit.outcome || 'Visit Done';
    let finalNotes = body?.notes || visit.notes || undefined;
    if (body?.feedback || body?.rating) {
      const reviewText = `[Customer Review: Rating ${body?.rating || 'N/A'}/5 - Feedback: ${body?.feedback || 'None'}]`;
      finalNotes = finalNotes ? `${finalNotes}\n${reviewText}` : reviewText;
    }

    const updated = await this.visitService.update(numCustomerId, id, {
      status: VisitStatus.COMPLETED,
      notes: finalNotes,
      outcome: finalOutcome,
      nextFollowUpDate: body?.nextFollowUpDate,
      completedById: employee?.id || undefined,
      completedBy: actingEmpName || 'Visitor',
    });

    if (visit.leadId) {
      try {
        const visitDoneStage = await this.prisma.leadStage.findFirst({
          where: {
            AND: [
              {
                OR: [
                  { key: 'VISIT_DONE' },
                  { key: 'VISIT' },
                  { name: { equals: 'Visit Done', mode: 'insensitive' } },
                ],
              },
              {
                OR: [
                  ...(numCustomerId > 0 ? [{ customerId: numCustomerId }] : []),
                  { customerId: null },
                ],
              },
            ],
            deletedAt: null,
          },
          orderBy: { customerId: 'desc' },
        });

        await this.prisma.lead.update({
          where: { id: visit.leadId },
          data: {
            status: 'VISIT_DONE',
            ...(visitDoneStage ? { stageId: visitDoneStage.id } : {}),
          },
        });

        await this.prisma.leadActivityTimeline.create({
          data: {
            leadId: visit.leadId,
            action: 'VISIT_COMPLETED',
            description: `Field Visit Completed by ${actingEmpName || 'Visitor'}: ${finalOutcome} - ${body?.notes || ''}`.trim(),
            metadata: {
              visitId: visit.id,
              outcome: finalOutcome,
              notes: body?.notes,
              rating: body?.rating,
              feedback: body?.feedback,
              completedById: employee?.id,
              completedByName: actingEmpName,
            },
          },
        }).catch(() => {});
      } catch (leadSyncErr: any) {
        // Non-blocking timeline / stage update log
      }
    }

    return updated;
  }
}

