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
import { ShiftService } from './shift.service';
import {
  CreateShiftDto,
  UpdateShiftDto,
  UpdateShiftGuidanceDto,
  AssignEmployeesToShiftDto,
} from './dto/shift.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('HRM - Shifts & Guidance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('shifts')
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Get shift overview and workforce allocation metrics' })
  async getMetrics(@CurrentCustomer() customerId: string) {
    return this.shiftService.getMetrics(customerId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all company shifts with guidance rules' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'type', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    return this.shiftService.findAll(customerId, { status, search, type });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get shift details, assigned employees, and shift guidance' })
  async findOne(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.shiftService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new shift with timing rules and guidance' })
  async create(
    @CurrentCustomer() customerId: string,
    @Body() dto: CreateShiftDto,
  ) {
    return this.shiftService.create(customerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update shift timing and parameters' })
  async update(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateShiftDto,
  ) {
    return this.shiftService.update(customerId, id, dto);
  }

  @Patch(':id/guidance')
  @ApiOperation({ summary: 'Update shift guidance rules (overtime, breaks, allowances)' })
  async updateGuidance(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateShiftGuidanceDto,
  ) {
    return this.shiftService.updateGuidance(customerId, id, dto);
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign employees or entire department to shift' })
  async assignEmployees(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: AssignEmployeesToShiftDto,
  ) {
    return this.shiftService.assignEmployees(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate shift' })
  async delete(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.shiftService.delete(customerId, id);
  }
}
