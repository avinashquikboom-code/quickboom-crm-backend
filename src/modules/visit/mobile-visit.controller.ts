import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { VisitService } from './visit.service';
import { VisitStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

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
      employeeId: employee.id,
      customerId: numCustomerId,
    };

    // Tab → status mapping
    if (tab) {
      if (tab === 'upcoming') {
        where.status = VisitStatus.SCHEDULED;
      } else if (tab === 'ongoing') {
        where.status = VisitStatus.IN_PROGRESS;
      } else if (tab === 'completed') {
        where.status = VisitStatus.COMPLETED;
      }
    } else if (status && (status as string) !== 'ALL') {
      where.status = status;
    }

    const visits = await this.prisma.visit.findMany({
      where,
      orderBy: { date: 'asc' },
      include: {
        company: { select: { id: true, name: true, city: true } },
        contact: { select: { id: true, firstName: true, lastName: true, phone: true } },
        deal: { select: { id: true, title: true } },
        lead: { select: { id: true, title: true } },
      },
    });

    const mapped = visits.map((v) => ({
      id: v.id,
      customer: v.customerName || v.company?.name || 'Unknown Customer',
      customerName: v.customerName,
      location: v.location || v.company?.city || 'N/A',
      purpose: v.purpose,
      date: v.date ? new Date(v.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '',
      time: v.time || '',
      status: v.status,
      tab: v.status === VisitStatus.SCHEDULED
        ? 'upcoming'
        : v.status === VisitStatus.IN_PROGRESS
          ? 'ongoing'
          : 'completed',
      notes: v.notes,
      outcome: v.outcome,
      visitType: v.visitType,
      latitude: v.latitude,
      longitude: v.longitude,
      completedAt: v.completedAt,
      company: v.company,
      contact: v.contact,
    }));

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
    return this.visitService.update(customerId, id, {
      status: VisitStatus.COMPLETED,
      notes: body?.notes,
      outcome: body?.outcome,
      nextFollowUpDate: body?.nextFollowUpDate,
    });
  }
}
