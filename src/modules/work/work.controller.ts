import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Logger,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { WorkService } from './work.service';
import { CreateWorkDto, UpdateWorkDto, SubmitWorkDto, AssignWorkDto } from './dto/work.dto';
import { WorkStatus, WorkType, TaskStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Work & SSM Management')
@Controller('works')
export class WorkController {
  constructor(private readonly workService: WorkService) {}

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
    const clientType = req?.headers ? req.headers['x-client-type'] : 'unknown';
    const authUserId = req?.user?.id || req?.user?.email || 'UNKNOWN';
    const authCustId = req?.user?.customerId;

    logger.log(
      `[WORKS_CALENDAR_START]\ncustomerId: ${customerId || headerCustId || authCustId || 'ALL'}\ndate: ${date || startDate || 'ALL'}\nuserId: ${authUserId}\nclientType: ${clientType}`,
    );

    logger.log(`[CALENDAR_API] REQUEST_START`);
    logger.log(`[CALENDAR_API] authenticatedUserId: ${authUserId}`);
    logger.log(`[CALENDAR_API] authenticatedCustomerId: ${authCustId}`);
    logger.log(`[CALENDAR_API] headerCustomerId: ${headerCustId}`);
    logger.log(`[CALENDAR_API] queryDate: ${date || startDate}`);
    logger.log(`[CALENDAR_API] resolvedCustomerId: ${customerId}`);

    try {
      logger.log(`[WORKS_CALENDAR_QUERY]`);
      const effectiveCustomerId = customerId || authCustId || headerCustId;
      logger.log(`[CALENDAR_API] effectiveCustomerId: ${effectiveCustomerId}`);
      const result = await this.workService.getCalendar(effectiveCustomerId, {
        date,
        dateFrom: dateFrom || startDate,
        dateTo: dateTo || endDate,
        month: month ? parseInt(month, 10) : undefined,
        year: year ? parseInt(year, 10) : undefined,
        employeeId,
        status,
      });
      logger.log(`[CALENDAR_API] DB_QUERY_END`);
      logger.log(`[WORKS_CALENDAR_RESULT]\ncount: ${Array.isArray(result) ? result.length : 0}`);
      logger.log(`[CALENDAR_API] RESULT_COUNT: ${Array.isArray(result) ? result.length : 0}`);
      logger.log(`[WORKS_CALENDAR_END]`);
      logger.log(`[CALENDAR_API] RESPONSE_SENT`);
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
  ) {
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
