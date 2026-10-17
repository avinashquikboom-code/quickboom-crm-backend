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
import { VisitStatus,  } from '@prisma/client';
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

  private isVisitorEmployee(employee: any, user: any): boolean {
    const desigName = (employee?.designation?.name || '').toUpperCase();
    const roleName = (user?.role || '').toUpperCase();
    const roleTypeName = (user?.roleType || '').toUpperCase();
    return (
      employee?.designationId === 11 ||
      desigName.includes('VISIT') ||
      desigName.includes('FIELD') ||
      roleName.includes('VISITOR') ||
      roleName.includes('VISIT') ||
      roleTypeName.includes('VISITOR') ||
      roleTypeName.includes('VISIT')
    );
  }

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
      include: {
        designation: true,
      },
    });

    const isVisitorUser = this.isVisitorEmployee(employee, user);
    const isAdmin =
      isUserSuperAdmin(user) ||
      (user?.role && ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN'].includes(user.role));

    if (!employee && !isAdmin) {
      return { items: [], data: [], total: 0 };
    }

    const numCustomerId = Number(customerId) || undefined || 1;
    const where: any = {
      ...(numCustomerId > 0
        ? {
            OR: [
              
              ...([]),
            ],
          }
        : {}),
      ...(!isAdmin && !isVisitorUser && employee
        ? {
            AND: [
              {
                OR: [
                  { employeeId: employee.id },
                  
                  
                  { completedById: employee.id },
                ],
              },
            ],
          }
        : { AND: [] }),
    };

    // Tab → status mapping
    const normalizedTab = (tab || '').toLowerCase().trim();
    if (normalizedTab) {
      if (normalizedTab === 'upcoming' || normalizedTab === 'scheduled') {
        if (!where.AND) where.AND = [];
        where.AND.push({
          status: VisitStatus.SCHEDULED,
          OR: [
            
            
          ],
        });
      } else if (normalizedTab === 'ongoing' || normalizedTab === 'in_progress') {
        if (!where.AND) where.AND = [];
        where.AND.push({ status: VisitStatus.IN_PROGRESS });
      } else if (normalizedTab === 'completed' || normalizedTab === 'done') {
        if (!where.AND) where.AND = [];
        where.AND.push({
          OR: [
            { status: VisitStatus.COMPLETED },
            
            
            
          ],
        });
        if (!isAdmin && employee) {
          where.AND.push({
            OR: [
              { completedById: employee.id },
              { employeeId: employee.id },
            ],
          });
        }
      }
    } else if (status && (status as string) !== 'ALL') {
      where.status = status;
    }

    const visits = await this.prisma.visit.findMany({
      where,
      orderBy: normalizedTab === 'completed' || normalizedTab === 'done' ? { updatedAt: 'desc' } : { date: 'asc' },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, phone: true } },
        company: { select: { id: true, name: true, city: true, address: true, phone: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        deal: { select: { id: true, title: true } },
        
      },
    });

    const mapped = visits.map((v) => {
      const assignedEmpName = v.employee
        ? `${v.employee.firstName || ''} ${v.employee.lastName || ''}`.trim()
        : null;
      const leadName = null;

      const isLeadVisitDone =
        undefined === 'VISIT_DONE' ||
        undefined === 'VISIT_DONE' ||
        ('').toUpperCase().includes('VISIT DONE');
      const isCompleted = v.status === VisitStatus.COMPLETED || isLeadVisitDone;

      return {
        id: v.id,
        
        customerName: v.customerName || leadName,
        leadTitle: undefined,
        
        
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
        phone: v.contact?.phone || undefined || v.company?.phone || null,
        email: v.contact?.email || undefined || v.company?.email || null,
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
      include: { designation: true },
    });

    const isVisitorUser = this.isVisitorEmployee(employee, user);
    const isAdmin =
      isUserSuperAdmin(user) ||
      (user?.role && ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN'].includes(user.role));
    const isAssigned =
      !visit.employeeId ||
      visit.employeeId === employee?.id ||
      undefined === employee?.id ||
      (undefined as any)?.assignedToId === user?.id ||
      visit.completedById === employee?.id ||
      isVisitorUser;
    if (!isAdmin && employee && !isAssigned) {
      throw new ForbiddenException('You do not have permission to view another employee\'s visit.');
    }

    const assignedEmpName = visit.employee
      ? `${visit.employee.firstName || ''} ${visit.employee.lastName || ''}`.trim()
      : null;
    const leadName = null;

    const isLeadVisitDone =
      undefined === 'VISIT_DONE' ||
      undefined === 'VISIT_DONE' ||
      ('').toUpperCase().includes('VISIT DONE');
    const isCompleted = visit.status === VisitStatus.COMPLETED || isLeadVisitDone;

    return {
      id: visit.id,
      
      customerName: visit.customerName || leadName,
      leadTitle: undefined,
      
      
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
      phone: visit.contact?.phone || undefined || visit.company?.phone || null,
      email: visit.contact?.email || undefined || visit.company?.email || null,
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
      include: { designation: true },
    });

    if (!employee) {
      throw new Error('Employee profile not found');
    }

    const isVisitorUser = this.isVisitorEmployee(employee, user);
    const isSuperAdmin = isUserSuperAdmin(user);
    const isAdmin =
      isSuperAdmin ||
      (user?.role && ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN'].includes(user.role));
    const isAssigned =
      !visit.employeeId ||
      visit.employeeId === employee.id ||
      undefined === employee.id ||
      (undefined as any)?.assignedToId === user?.id ||
      isVisitorUser;
    if (!isAdmin && !isAssigned) {
      throw new ForbiddenException('You do not have permission to start another employee\'s visit.');
    }

    const data: any = {
      status: VisitStatus.IN_PROGRESS,
      startedAt: visit.startedAt || new Date(),
      employeeId: employee.id,
    };
    if (body?.latitude) data.latitude = body.latitude;
    if (body?.longitude) data.longitude = body.longitude;
    if (body?.address) data.location = body.address;

    const numCustomerId = Number(customerId) || undefined || undefined;
    const updated = await this.visitService.update(numCustomerId, id, data);

    

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
      include: { designation: true },
    });

    const isVisitorUser = this.isVisitorEmployee(employee, user);
    const isSuperAdmin = isUserSuperAdmin(user);
    const isAssigned =
      visit.employeeId === employee?.id ||
      undefined === employee?.id ||
      (undefined as any)?.assignedToId === user?.id ||
      isVisitorUser;
    if (!isSuperAdmin && employee && !isAssigned) {
      throw new ForbiddenException('You do not have permission to update another employee\'s visit.');
    }

    const numCustomerId = Number(customerId) || undefined || undefined;

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
    

    return updated;
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Employee marks a visit as completed with outcome notes' })
  async completeVisit(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() body: { notes?: string; outcome?: string; nextFollowUpDate?: string; rating?: number; feedback?: string; latitude?: number; longitude?: number },
  ) {
    const numId = Number(id);
    const visit = await this.prisma.visit.findUnique({
      where: { id: numId },
      
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
      include: { designation: true },
    });

    const isVisitorUser = this.isVisitorEmployee(employee, user);
    const isSuperAdmin = isUserSuperAdmin(user);
    const isAssigned =
      visit.employeeId === employee?.id ||
      undefined === employee?.id ||
      (undefined as any)?.assignedToId === user?.id ||
      visit.completedById === employee?.id ||
      isVisitorUser;
    if (!isSuperAdmin && employee && !isAssigned) {
      throw new ForbiddenException('You do not have permission to update another employee\'s visit.');
    }

    const numCustomerId = Number(customerId) || undefined || undefined;

    const actingEmpName = employee
      ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
      : (user?.firstName || user?.lastName ? `${user?.firstName || ''} ${user?.lastName || ''}`.trim() : null);

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
      completedBy: actingEmpName || undefined,
      ...(body?.latitude != null ? { latitude: Number(body.latitude) } : {}),
      ...(body?.longitude != null ? { longitude: Number(body.longitude) } : {}),
    });

    

    return updated;
  }
}

