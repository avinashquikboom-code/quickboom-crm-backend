import { WorkRecordGuard } from './work-record.guard';
import { Body, Controller, Get, Param, Patch, Post, Query, Req, Logger, UseGuards, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { WorkService } from './work.service';
import { CreateWorkDto, UpdateWorkDto, SubmitWorkDto, AssignWorkDto } from './dto/work.dto';
import { WorkStatus, WorkType, TaskStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserAdmin, isUserSuperAdmin } from '../../common/utils/account.util';

import { parseCalendarMonthYear } from './calendar-query.util';

@ApiTags('Work & SSM Management')
@UseGuards(JwtAuthGuard, WorkRecordGuard)
@Controller('works')
export class WorkController {
  private readonly logger = new Logger(WorkController.name);

  constructor(
    private readonly workService: WorkService,
  ) {}

  // ==========================================
  // STANDARD WORK ENDPOINTS
  // ==========================================

  @Get()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all scheduled work items' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'editorId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'workType', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: string,
    @Query('employeeId') employeeId?: string,
    @Query('editorId') editorId?: string,
    @Query('status') status?: WorkStatus,
    @Query('workType') workType?: WorkType,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.workService.findAll(customerId, {
      viewerEmployeeId: isUserAdmin(user) ? undefined : user.employee.id,
      status,
      workType,
      employeeId,
      editorId,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Post('activity/complete')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark activity as completed' })
  async completeActivity(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() body: { activityScheduleId: number },
  ) {
    const custId = customerId || undefined || undefined;
    return this.workService.completeActivity(body.activityScheduleId, custId);
  }

  @Post('activity/skip')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Skip an activity' })
  async skipActivity(@Body() body: { activityScheduleId: number }) {
    return this.workService.skipActivity(body.activityScheduleId);
  }

  @Get('employee/calendar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get calendar scheduled activities for authenticated employee' })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'teamId', required: false })
  @ApiQuery({ name: 'workType', required: false })
  async getEmployeeCalendar(
    @CurrentUser() user: any,
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('status') status?: WorkStatus,
    @Query('customerId') customerId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('teamId') teamId?: string,
    @Query('workType') workType?: string,
  ) {
    const authEmpId = await this.workService.resolveEmployeeIdForUser(user);
    const roleLabel = user?.role || (Array.isArray(user?.roles) ? user.roles.join(',') : 'UNKNOWN');
    if (!authEmpId) {
      this.logger.warn(
        `[EMPLOYEE_CALENDAR_REQUEST] userId=${user?.id ?? 'none'} role=${roleLabel} resolvedEmployeeId=none`,
      );
      throw new NotFoundException('No employee profile is linked to this account');
    }
    const canViewCalendar = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'TENANT_ADMIN'].includes(String(user?.accountType || user?.role || '').toUpperCase());
    const period = parseCalendarMonthYear(month, year);
    this.logger.log(
      `[EMPLOYEE_CALENDAR_REQUEST] userId=${user?.id ?? 'none'} role=${roleLabel} ` +
      `resolvedEmployeeId=${authEmpId} employeeUserId=${user?.employee?.userId ?? 'none'} ` +
      `tenantId=${'none'} ` +
      `parsedMonth=${period.month ?? 'none'} parsedYear=${period.year ?? 'none'} ` +
      `date=${date || startDate || 'none'} dateFrom=${dateFrom || startDate || 'none'} dateTo=${dateTo || endDate || 'none'}`,
    );
    // Employees without the calendar module still receive rows assigned to them.
    const targetQueryEmpId = employeeId
      ? await this.workService.resolveCanonicalEmployeeId(employeeId)
      : undefined;
    const isTargetSameAsAuth = !targetQueryEmpId || targetQueryEmpId === authEmpId;
    const lookingAtAnotherEmployee = !isTargetSameAsAuth;
    if (lookingAtAnotherEmployee && !canViewCalendar) {
      throw new ForbiddenException(
        'Access denied: another employee calendar requires an administrator account',
      );
    }

    const rangeStart = dateFrom || startDate;
    const rangeEnd = dateTo || endDate;
    const multiDayRange = Boolean(rangeStart && rangeEnd && rangeStart !== rangeEnd);
    const effectiveTargetEmpId = targetQueryEmpId || authEmpId;
    return this.workService.getEmployeeCalendar(effectiveTargetEmpId, {
      date: multiDayRange ? undefined : (date || rangeStart),
      dateFrom: multiDayRange ? rangeStart : (startDate || dateFrom),
      dateTo: multiDayRange ? rangeEnd : (endDate || dateTo),
      month: period.month,
      year: period.year,
      status,
      
      employeeId: targetQueryEmpId,
      teamId: teamId ? parseInt(teamId, 10) : undefined,
      workType,
    }, {
      allTenantCustomers: canViewCalendar,
      assignedOnly: !canViewCalendar,
    });
  }

  @Get('production/metrics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get supervisory production metrics for Production Manager' })
  async getProductionMetrics(
    @CurrentUser() user: any,
    @Query('customerId') customerId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('teamId') teamId?: string,
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const authEmpId = await this.workService.resolveEmployeeIdForUser(user);
    if (!authEmpId) {
      return { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0, today: 0, overdue: 0 };
    }
    const canViewCalendar = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'TENANT_ADMIN'].includes(String(user?.accountType || user?.role || '').toUpperCase());
    const period = parseCalendarMonthYear(month, year);
    return this.workService.getProductionMetrics(authEmpId, {
      
      employeeId: employeeId ? parseInt(employeeId, 10) : undefined,
      teamId: teamId ? parseInt(teamId, 10) : undefined,
      date,
      dateFrom,
      dateTo,
      month: period.month,
      year: period.year,
    }, {
      allTenantCustomers: canViewCalendar,
      assignedOnly: !canViewCalendar,
    });
  }

  @Get('production/filter-options')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get supervisory filter options for Production Manager' })
  async getProductionFilterOptions(@CurrentUser() user: any) {
    const authEmpId = await this.workService.resolveEmployeeIdForUser(user);
    if (!authEmpId) {
      return { customers: [], employees: [], teams: [], statuses: [] };
    }
    return this.workService.getProductionFilterOptions(authEmpId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get single work item with multi-step tasks' })
  async findOne(
    @Param('id') id: string,
    @CurrentCustomer() customerId: string,
  ) {
    return this.workService.findOne(customerId, id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new scheduled work deliverable' })
  async create(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateWorkDto,
  ) {
    const employeeId = await this.workService.resolveEmployeeIdForUser(user);
    const isAdmin = isUserAdmin(user) || isUserSuperAdmin(user);

    if (!isAdmin) {
      if (dto.companyId !== undefined)
        throw new ForbiddenException('Only administrators can link calendar work to CRM companies');
      if (!employeeId) throw new ForbiddenException('Active employee profile required');
      return this.workService.create(undefined, { ...dto, teamId: undefined, assignedToId: employeeId, editorId: undefined });
    }

    return this.workService.create(customerId, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update work item details' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWorkDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    if (dto.companyId !== undefined && !isUserAdmin(user) && !isUserSuperAdmin(user))
      throw new ForbiddenException('Only administrators can link calendar work to CRM companies');
    const employeeId = await this.workService.resolveEmployeeIdForUser(user);
    const custId = req?.headers?.['x-customer-id'] || undefined || undefined;
    return this.workService.update(custId, id, dto, employeeId ?? undefined);
  }

  @Post(':id/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Employee / Editor submit completed deliverable for review' })
  async submitWork(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery: string,
    @Body() dto: SubmitWorkDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const custId = customerIdQuery || undefined || undefined;
    if (!isUserAdmin(user)) {
      const employeeId = await this.workService.resolveEmployeeIdForUser(user);
      await this.workService.assertEmployeeAssignedToWork(employeeId, Number(id));
    }
    return this.workService.submitWork(customerIdQuery, id, dto, user?.id);
  }

  @Post(':id/assign')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin assign employee or editor to work' })
  async assignTeam(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery: string,
    @Body() dto: AssignWorkDto,
  ) {
    return this.workService.assignTeam(customerIdQuery, id, dto);
  }

  @Patch(':id/reschedule')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Customer reschedule work with automatic dependency recalculation' })
  async rescheduleWork(
    @Param('id') id: string,
    @CurrentCustomer() customerId: string,
    @Body() dto: { scheduledDate: string; scheduledTime?: string; notes?: string },
    @Req() req: any,
  ) {
    const authCustId = customerId;
    return this.workService.rescheduleWork(authCustId, id, dto);
  }

  @Post(':id/rework')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Customer request rework for completed work item' })
  async requestRework(
    @Param('id') id: string,
    @CurrentCustomer() customerId: string,
    @Body() dto: { reason?: string },
    @Req() req: any,
  ) {
    const authCustId = customerId;
    return this.workService.requestRework(authCustId, id, dto);
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Customer or Admin approves deliverable / level' })
  async approveWork(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const custId = customerIdQuery || undefined || undefined;
    return this.workService.approveWork(custId, id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel schedule and release reserved quota' })
  async cancelWork(
    @Param('id') id: string,
    @CurrentCustomer() customerId: string,
  ) {
    return this.workService.cancelWork(customerId, id);
  }

  @Patch(':id/tasks/:taskId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update task progress state' })
  async updateTaskStatus(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Query('customerId') customerIdQuery: string,
    @Body('status') status: TaskStatus,
  ) {
    return this.workService.updateTaskStatus(customerIdQuery, id, taskId, status);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update work item status' })
  async updateWorkStatus(
    @Param('id') id: string,
    @Body('status') status: WorkStatus,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const employeeId = await this.workService.resolveEmployeeIdForUser(user);
    const custId = req?.headers?.['x-customer-id'] || undefined || undefined;
    return this.workService.update(custId, id, { status } as any, employeeId ?? undefined);
  }

  @Post(':id/updates')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit progress update from employee or production manager' })
  async submitWorkUpdate(
    @Param('id') id: string,
    @Body() body: { notes?: string; status?: WorkStatus },
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const employeeId = await this.workService.resolveEmployeeIdForUser(user);
    const custId = req?.headers?.['x-customer-id'] || undefined || undefined;
    return this.workService.update(
      custId,
      id,
      {
        notes: body.notes,
        status: body.status,
      } as any,
      employeeId ?? undefined,
    );
  }
}
