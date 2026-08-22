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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WorkService } from './work.service';
import { CreateWorkDto, UpdateWorkDto } from './dto/work.dto';
import { WorkStatus, WorkType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Work & SSM Management')
@Controller('works')
export class WorkController {
  constructor(private readonly workService: WorkService) {}

  @Get()
  @ApiOperation({ summary: 'Get all scheduled work items' })
  async findAll(
    @Query('customerId') customerIdQuery?: string,
    @Query('status') status?: WorkStatus,
    @Query('workType') workType?: WorkType,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.workService.findAll(
      customerId,
      status,
      workType,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Get scheduled calendar events' })
  async getCalendar(
    @Query('customerId') customerIdQuery?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.workService.getCalendar(customerId, dateFrom, dateTo);
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
    const customerId = customerIdQuery || 'default-customer';
    return this.workService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new scheduled work deliverable' })
  async create(
    @Query('customerId') customerIdQuery: string,
    @Body() dto: CreateWorkDto,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.workService.create(customerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update work item details' })
  async update(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery: string,
    @Body() dto: UpdateWorkDto,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.workService.update(customerId, id, dto);
  }

  @Patch(':id/tasks/:taskId/status')
  @ApiOperation({ summary: 'Update task progress state' })
  async updateTaskStatus(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Query('customerId') customerIdQuery: string,
    @Body('status') status: any,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.workService.updateTaskStatus(customerId, id, taskId, status);
  }
}
