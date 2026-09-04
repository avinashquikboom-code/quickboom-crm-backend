import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Post,
  Query,
  Req,
  Logger,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { WorkService } from './work.service';
import { WorkPermissionService } from './work-permission.service';
import { CreateWorkDto, UpdateWorkDto, SubmitWorkDto, AssignWorkDto } from './dto/work.dto';
import { WorkStatus, WorkType, TaskStatus, WorkAccessRequestStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

function mapWorkTypeToModule(workType?: WorkType | string): string {
  if (!workType) return 'video_edit';
  const wt = String(workType).toUpperCase();
  if (wt.includes('VIDEO') || wt.includes('EDIT')) return 'video_edit';
  if (wt.includes('POST') || wt.includes('GRAPHIC')) return 'post_design';
  if (wt.includes('STORY')) return 'story_design';
  if (wt.includes('REEL') || wt.includes('SHOOT')) return 'reel_shoot';
  return 'video_edit';
}

@ApiTags('Work & SSM Management')
@Controller('works')
export class WorkController {
  constructor(
    private readonly workService: WorkService,
    private readonly workPermissionService: WorkPermissionService,
  ) {}

  // ==========================================
  // WORK MODULE PERMISSIONS & ACCESS REQUESTS
  // ==========================================

  @Get('permissions/modules')
  @ApiOperation({ summary: 'Get list of standard work modules' })
  getWorkModules() {
    return this.workPermissionService.getWorkModules();
  }

  @Get('permissions/roles')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all role work module permissions for current customer' })
  async getRoleWorkPermissions(
    @CurrentCustomer() customerId: string,
    @Req() req: any,
  ) {
    const custId = customerId || req?.user?.customerId || req?.customerId;
    return this.workPermissionService.getRoleWorkPermissions(Number(custId));
  }

  @Put('permissions/roles/:roleName')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update work module permissions for a specific role' })
  async updateRoleWorkPermissions(
    @CurrentCustomer() customerId: string,
    @Param('roleName') roleName: string,
    @Body() body: { permissions: Record<string, boolean> },
    @Req() req: any,
  ) {
    const custId = customerId || req?.user?.customerId || req?.customerId;
    return this.workPermissionService.updateRoleWorkPermissions(
      Number(custId),
      roleName,
      body.permissions || {},
    );
  }

  @Get('permissions/overrides/employees')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all employees with their module access overrides' })
  async getEmployeesWithOverrides(
    @CurrentCustomer() customerId: string,
    @Req() req: any,
  ) {
    const custId = customerId || req?.user?.customerId || req?.customerId;
    return this.workPermissionService.getEmployeesWithOverrides(Number(custId));
  }

  @Get('permissions/overrides/employee/:employeeId')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get module access overrides for a specific employee' })
  async getEmployeeOverrides(
    @CurrentCustomer() customerId: string,
    @Param('employeeId') employeeId: string,
    @Req() req: any,
  ) {
    const custId = customerId || req?.user?.customerId || req?.customerId;
    return this.workPermissionService.getEmployeeOverrides(Number(custId), Number(employeeId));
  }

  @Put('permissions/overrides/employee/:employeeId')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update module access overrides for a specific employee' })
  async updateEmployeeOverrides(
    @CurrentCustomer() customerId: string,
    @Param('employeeId') employeeId: string,
    @Body() body: { overrides: Record<string, any> },
    @Req() req: any,
  ) {
    const custId = customerId || req?.user?.customerId || req?.customerId;
    return this.workPermissionService.updateEmployeeOverrides(
      Number(custId),
      Number(employeeId),
      body.overrides || {},
    );
  }

  @Get('my-permissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get effective work module permissions for authenticated employee' })
  async getMyPermissions(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: string,
    @Req() req: any,
  ) {
    const custId = customerId || user?.customerId || req?.user?.customerId || req?.customerId;
    const employeeId = user?.employeeId || user?.employee?.id;
    const userId = user?.id || user?.sub;

    return this.workPermissionService.getEmployeeEffectivePermissions(Number(custId), {
      employeeId: employeeId ? Number(employeeId) : undefined,
      userId: userId ? Number(userId) : undefined,
      email: user?.email,
    });
  }

  @Post('access-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Employee submit access request for a work module' })
  async submitAccessRequest(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: string,
    @Body() body: { workModule: string; reason?: string },
    @Req() req: any,
  ) {
    const custId = customerId || user?.customerId || req?.user?.customerId || req?.customerId;
    const employeeId = user?.employeeId || user?.employee?.id;

    // Resolve employee id if not directly in user token
    let resolvedEmployeeId = employeeId ? Number(employeeId) : null;
    if (!resolvedEmployeeId) {
      const perms = await this.workPermissionService.getEmployeeEffectivePermissions(
        Number(custId),
        { userId: user?.id, email: user?.email },
      );
      resolvedEmployeeId = perms.employeeId;
    }

    if (!resolvedEmployeeId) {
      throw new ForbiddenException('Only employees can submit work module access requests');
    }

    return this.workPermissionService.createAccessRequest(
      Number(custId),
      resolvedEmployeeId,
      body.workModule,
      body.reason,
    );
  }

  @Get('my-access-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Employee view their own access requests' })
  async getMyAccessRequests(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: string,
    @Req() req: any,
  ) {
    const custId = customerId || user?.customerId || req?.user?.customerId || req?.customerId;
    const employeeId = user?.employeeId || user?.employee?.id;

    let resolvedEmployeeId = employeeId ? Number(employeeId) : null;
    if (!resolvedEmployeeId) {
      const perms = await this.workPermissionService.getEmployeeEffectivePermissions(
        Number(custId),
        { userId: user?.id, email: user?.email },
      );
      resolvedEmployeeId = perms.employeeId;
    }

    if (!resolvedEmployeeId) {
      return [];
    }

    return this.workPermissionService.getMyAccessRequests(Number(custId), resolvedEmployeeId);
  }

  @Get('access-requests')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin view all employee work module access requests' })
  async getAllAccessRequests(
    @CurrentCustomer() customerId: string,
    @Req() req: any,
    @Query('status') status?: WorkAccessRequestStatus,
  ) {
    const custId = customerId || req?.user?.customerId || req?.customerId;
    return this.workPermissionService.getAllAccessRequests(Number(custId), status);
  }

  @Patch('access-requests/:id/approve')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin approve an employee work module access request' })
  async approveAccessRequest(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const custId = customerId || req?.user?.customerId || req?.customerId;
    return this.workPermissionService.approveAccessRequest(
      Number(custId),
      Number(id),
      user?.id,
    );
  }

  @Patch('access-requests/:id/reject')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin reject an employee work module access request' })
  async rejectAccessRequest(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const custId = customerId || req?.user?.customerId || req?.customerId;
    return this.workPermissionService.rejectAccessRequest(
      Number(custId),
      Number(id),
      body?.reason,
      user?.id,
    );
  }

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
      status,
      workType,
      employeeId,
      editorId,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Post('subscription/purchase')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Purchase a plan and auto-create activity schedules' })
  async purchaseSubscription(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() body: { planId: number },
  ) {
    const custId = customerId || req?.customerId || user?.customerId;
    return this.workService.purchaseSubscription(custId, body.planId);
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
    const custId = customerId || req?.customerId || user?.customerId;
    return this.workService.completeActivity(body.activityScheduleId, custId);
  }

  @Post('activity/skip')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Skip an activity' })
  async skipActivity(@Body() body: { activityScheduleId: number }) {
    return this.workService.skipActivity(body.activityScheduleId);
  }

  @Get('calendar/month')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get month calendar view' })
  @ApiQuery({ name: 'year', required: true })
  @ApiQuery({ name: 'month', required: true })
  async getMonthCalendar(
    @CurrentCustomer() customerId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.workService.getMonthCalendar(
      customerId,
      parseInt(year, 10),
      parseInt(month, 10),
    );
  }

  @Get('calendar')
  @Get('customer/calendar')
  @Get('admin/calendar')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get scheduled calendar events' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getCalendar(
    @CurrentCustomer() customerId: string,
    @Req() req: any,
    @Query('employeeId') employeeId?: string,
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('status') status?: WorkStatus,
  ) {
    const logger = new Logger('WorksController:getCalendar');
    const headerCustId = req?.headers ? req.headers['x-customer-id'] : undefined;
    const authUserId = req?.user?.id || req?.user?.email || 'UNKNOWN';
    const authCustId = req?.user?.customerId;
    const userRole = req?.user?.role || (Array.isArray(req?.user?.roles) ? req?.user?.roles.join(',') : 'UNKNOWN');
    const requestedCustomerCode = req?.query?.customerId || headerCustId || req?.customerExternalId || 'NONE';

    // Strict customer isolation: Normal customer users are bound to their authenticated customerId
    const effectiveCustomerId = (authCustId && Number(authCustId) > 0)
      ? Number(authCustId)
      : (customerId || headerCustId || req?.customerId);

    logger.log(`[CALENDAR_AUTH_DEBUG]
authenticatedUser: ${authUserId}
role: ${userRole}
authenticatedCustomerId: ${authCustId || 'NONE'}
requestedCustomerCode: ${requestedCustomerCode}
resolvedRequestedCustomerId: ${effectiveCustomerId || 'NONE'}
authorization: ALLOWED`);

    logger.log(
      `[CALENDAR_AUTH]\nauthenticatedUserId: ${authUserId}\nauthenticatedCustomerId: ${authCustId}\nrequestedCustomerIdentifier: ${requestedCustomerCode}\nresolvedCustomerId: ${effectiveCustomerId}`,
    );

    try {
      const result = await this.workService.getCalendar(effectiveCustomerId, {
        date,
        dateFrom: dateFrom || startDate,
        dateTo: dateTo || endDate,
        month: month ? parseInt(month, 10) : undefined,
        year: year ? parseInt(year, 10) : undefined,
        employeeId,
        status,
      });

      logger.log(`[CALENDAR_QUERY_DEBUG]
customerId: ${effectiveCustomerId || 'ALL'}
date: ${date || startDate || 'ALL'}
resultCount: ${Array.isArray(result) ? result.length : 0}`);

      logger.log(
        `[CALENDAR_RESULT]\ncount: ${Array.isArray(result) ? result.length : 0}\ndata: ${JSON.stringify(result)}`,
      );

      return result;
    } catch (err: any) {
      logger.error(`[CALENDAR_API] ERROR: ${err?.message}`, err?.stack);
      throw err;
    }
  }

  @Get('customer/usage/:customerId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get customer service quotas & plan usage (Admin)' })
  async getCustomerUsageAdmin(@Param('customerId') customerId: string) {
    return this.workService.getCustomerUsage(customerId);
  }

  @Post('auto-generate')
  @ApiOperation({ summary: 'Automatically generate plan deliverable schedules' })
  async generatePlanSchedules(
    @Query('customerId') customerIdQuery?: string,
  ) {
    if (!customerIdQuery) {
      throw new ForbiddenException('CustomerId required for schedule generation');
    }
    return this.workService.generatePlanSchedules(customerIdQuery);
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
    @Body() dto: CreateWorkDto,
  ) {
    return this.workService.create(customerId, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update work item details' })
  async update(
    @Param('id') id: string,
    @CurrentCustomer() customerId: string,
    @Body() dto: UpdateWorkDto,
  ) {
    return this.workService.update(customerId, id, dto);
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
    const custId = customerIdQuery || user?.customerId || req?.user?.customerId;
    const work = await this.workService.findOne(custId, id);
    if (work) {
      const moduleKey = mapWorkTypeToModule(work.workType);
      const employeeId = user?.employeeId || user?.employee?.id;
      if (employeeId) {
        await this.workPermissionService.checkPermission(Number(custId), Number(employeeId), moduleKey);
      }
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
    const authCustId = req.user?.customerId || customerId;
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
    const authCustId = req.user?.customerId || customerId;
    return this.workService.requestRework(authCustId, id, dto);
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
}
