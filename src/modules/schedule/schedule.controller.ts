import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ScheduleService } from './schedule.service';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dto';
import { ScheduleStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Schedules & Delivery Calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('schedules')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get('calendar')
  @ApiOperation({ summary: 'Get schedule calendar entries by month/year or date range' })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getCalendar(
    @CurrentCustomer() customerId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: ScheduleStatus,
  ) {
    return this.scheduleService.getCalendar(customerId, {
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      from,
      to,
      employeeId,
      status,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of monthly delivery schedules' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'planId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @Query('employeeId') employeeId?: string,
    @Query('planId') planId?: string,
    @Query('status') status?: ScheduleStatus,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.scheduleService.findAll(customerId, {
      employeeId,
      planId,
      status,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single schedule details' })
  async findOne(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.scheduleService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom schedule item' })
  async create(
    @CurrentCustomer() customerId: string,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.scheduleService.create(customerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update schedule status, notes, or assigned employee' })
  async update(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.scheduleService.update(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete or archive schedule' })
  async remove(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.scheduleService.remove(customerId, id);
  }

  @Post('generate-subscription/:subscriptionId')
  @ApiOperation({ summary: 'Trigger automatic monthly schedule generation for subscription' })
  async generateForSubscription(
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.scheduleService.generateSchedulesForSubscription(Number(subscriptionId), { force: true });
  }
}
