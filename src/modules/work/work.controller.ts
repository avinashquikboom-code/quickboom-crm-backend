import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WorkService } from './work.service';
import { CreateWorkDto, UpdateWorkDto } from './dto/work.dto';
import { WorkStatus, WorkType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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
  @ApiOperation({ summary: 'Schedule new work item against plan entitlement' })
  async create(
    @Body() dto: CreateWorkDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.workService.create(customerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update work item status or internal progress' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWorkDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.workService.update(customerId, id, dto);
  }
}
