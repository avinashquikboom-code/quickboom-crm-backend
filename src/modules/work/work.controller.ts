import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { WorkService } from './work.service';
import { CreateWorkDto, UpdateWorkDto, SubmitWorkDto, ReviewWorkDto, AssignWorkDto } from './dto/work.dto';
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
  @ApiOperation({ summary: 'Get all scheduled work items' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'editorId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'workType', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @Query('customerId') customerIdQuery?: string,
    @Query('employeeId') employeeId?: string,
    @Query('editorId') editorId?: string,
    @Query('status') status?: WorkStatus,
    @Query('workType') workType?: WorkType,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.workService.findAll(customerIdQuery, {
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
  @ApiOperation({ summary: 'Get scheduled calendar events' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getCalendar(
    @Query('customerId') customerIdQuery?: string,
    @Query('employeeId') employeeId?: string,
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('status') status?: WorkStatus,
  ) {
    return this.workService.getCalendar(customerIdQuery, {
      date,
      dateFrom,
      dateTo,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      employeeId,
      status,
    });
  }

  @Get('customer/calendar')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get calendar events for authenticated customer' })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getCustomerCalendar(
    @CurrentCustomer() customerId: string,
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('status') status?: WorkStatus,
  ) {
    return this.workService.getCalendar(customerId, {
      date,
      dateFrom,
      dateTo,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      status,
    });
  }

  @Get('customer/usage')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated customer service quotas & plan usage' })
  async getCustomerUsage(@CurrentCustomer() customerId: string) {
    if (!customerId) {
      throw new ForbiddenException('Authenticated customer context required');
    }
    return this.workService.getCustomerUsage(customerId);
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

  @Post('customer/auto-generate')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Automatically generate schedules for authenticated customer' })
  async generateCustomerSchedules(@CurrentCustomer() customerId: string) {
    if (!customerId) {
      throw new ForbiddenException('Authenticated customer context required');
    }
    return this.workService.generatePlanSchedules(customerId);
  }

  @Post(':id/reschedule')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Customer reschedule existing schedule' })
  async rescheduleWork(
    @Param('id') id: string,
    @CurrentCustomer() customerId: string,
    @Body() dto: { scheduledDate: string; scheduledTime?: string; notes?: string },
  ) {
    if (!customerId) {
      throw new ForbiddenException('Authenticated customer context required');
    }
    return this.workService.rescheduleWork(customerId, id, dto);
  }

  @Patch(':id/reschedule')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Customer reschedule existing schedule (PATCH)' })
  async rescheduleWorkPatch(
    @Param('id') id: string,
    @CurrentCustomer() customerId: string,
    @Body() dto: { scheduledDate: string; scheduledTime?: string; notes?: string },
  ) {
    if (!customerId) {
      throw new ForbiddenException('Authenticated customer context required');
    }
    return this.workService.rescheduleWork(customerId, id, dto);
  }

  @Post('customer-schedule')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Customer create new calendar schedule with plan limit validation' })
  async createCustomerSchedule(
    @CurrentCustomer() customerId: string,
    @Body() dto: CreateWorkDto,
  ) {
    if (!customerId) {
      throw new ForbiddenException('Authenticated customer context required');
    }
    return this.workService.create(customerId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single work item with multi-step tasks' })
  async findOne(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery?: string,
  ) {
    return this.workService.findOne(customerIdQuery, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new scheduled work deliverable' })
  async create(
    @Query('customerId') customerIdQuery: string,
    @Body() dto: CreateWorkDto,
  ) {
    return this.workService.create(customerIdQuery, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update work item details' })
  async update(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery: string,
    @Body() dto: UpdateWorkDto,
  ) {
    return this.workService.update(customerIdQuery, id, dto);
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

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Customer approve deliverable and complete schedule' })
  async approveWork(
    @Param('id') id: string,
    @CurrentCustomer() customerId: string,
  ) {
    if (!customerId) {
      throw new ForbiddenException('Authenticated customer context required');
    }
    return this.workService.approveWork(customerId, id);
  }

  @Post(':id/revision')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Customer request revision on deliverable' })
  async requestRevision(
    @Param('id') id: string,
    @CurrentCustomer() customerId: string,
    @Body() dto: ReviewWorkDto,
  ) {
    if (!customerId) {
      throw new ForbiddenException('Authenticated customer context required');
    }
    return this.workService.requestRevision(customerId, id, dto);
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

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel schedule and release reserved quota' })
  async cancelWork(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery?: string,
    @CurrentCustomer() currentCustomerId?: string,
  ) {
    const targetCustomer = customerIdQuery || currentCustomerId;
    return this.workService.cancelWork(targetCustomer, id);
  }

  @Patch(':id/tasks/:taskId/status')
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
