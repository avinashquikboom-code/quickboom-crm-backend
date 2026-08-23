import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ScheduleService } from './schedule.service';
import { ScheduleStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Customer Portal - Schedules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('customer/schedules')
export class CustomerScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get('calendar')
  @ApiOperation({ summary: 'Get current customer schedule calendar' })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getCalendar(
    @CurrentCustomer() customerId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: ScheduleStatus,
  ) {
    return this.scheduleService.getCalendar(customerId, {
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      from,
      to,
      status,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get current customer monthly schedules' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @Query('status') status?: ScheduleStatus,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.scheduleService.findAll(customerId, {
      status,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single schedule details for customer' })
  async findOne(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.scheduleService.findOne(customerId, id);
  }
}
