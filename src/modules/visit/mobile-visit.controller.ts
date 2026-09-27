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
import { VisitStatus } from '@prisma/client';
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
            ...(employee.userId ? [{ lead: { assignedToId: employee.userId } }] : []),
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
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        company: { select: { id: true, name: true, city: true } },
        contact: { select: { id: true, firstName: true, lastName: true, phone: true } },
        deal: { select: { id: true, title: true } },
        lead: {
          select: {
            id: true,
            title: true,
            companyName: true,
            firstName: true,
            lastName: true,
            status: true,
            stage: { select: { key: true, name: true } },
          },
        },
      },
    });

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
        assignedEmployee: assignedEmpName,
        completedBy: isCompleted ? (v.outcome || assignedEmpName) : null,
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
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        company: v.company,
        contact: v.contact,
      };
    });

    return { items: mapped, data: mapped, total: mapped.length };
  }

  @Patch(':id/check-in')
  @ApiOperation({ summary: 'Employee GPS check-in to start a scheduled visit' })
  async checkIn(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() body: { latitude?: number; longitude?: number; address?: string },
  ) {
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

    const data: any = { status: VisitStatus.IN_PROGRESS };
    if (body?.latitude) data.latitude = body.latitude;
    if (body?.longitude) data.longitude = body.longitude;
    if (body?.address) data.location = body.address;

    return this.visitService.update(customerId, id, data);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Employee marks a visit as completed with outcome notes' })
  async completeVisit(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() body: { notes?: string; outcome?: string; nextFollowUpDate?: string },
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
    const isAssigned = visit.employeeId === employee?.id || visit.lead?.employeeId === employee?.id;
    if (!isSuperAdmin && employee && !isAssigned) {
      throw new ForbiddenException('You do not have permission to update another employee\'s visit.');
    }

    const numCustomerId = Number(customerId) || employee?.customerId || visit.customerId;

    const updated = await this.visitService.update(numCustomerId, id, {
      status: VisitStatus.COMPLETED,
      notes: body?.notes,
      outcome: body?.outcome,
      nextFollowUpDate: body?.nextFollowUpDate,
      ...(employee?.id ? { employeeId: String(employee.id) } : {}),
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
            ...(employee?.id ? { employeeId: employee.id } : {}),
          },
        });

        await this.prisma.leadActivityTimeline.create({
          data: {
            leadId: visit.leadId,
            action: 'VISIT_COMPLETED',
            description: `Field Visit Completed: ${body?.outcome || 'Visit Done'} - ${body?.notes || ''}`.trim(),
            metadata: { visitId: visit.id, outcome: body?.outcome, notes: body?.notes },
          },
        }).catch(() => {});
      } catch (leadSyncErr: any) {
        // Non-blocking timeline / stage update log
      }
    }

    return updated;
  }
}
