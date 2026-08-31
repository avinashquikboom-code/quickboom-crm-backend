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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('HRM - Shifts & Guidance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('shifts')
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Get shift overview and workforce allocation metrics' })
  @ApiQuery({ name: 'customerId', required: false })
  async getMetrics(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.shiftService.getMetrics(targetCustomerId, isSuperAdmin);
  }

  @Get()
  @ApiOperation({ summary: 'Get all company shifts with guidance rules' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.shiftService.findAll(targetCustomerId, { status, search, type }, isSuperAdmin);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get shift details, assigned employees, and shift guidance' })
  @ApiQuery({ name: 'customerId', required: false })
  async findOne(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.shiftService.findOne(targetCustomerId, id, isSuperAdmin);
  }

  @Post()
  @ApiOperation({ summary: 'Create new shift with timing rules and guidance' })
  async create(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: CreateShiftDto,
  ) {
    const targetCustomerId = customerId || user?.customerId;
    return this.shiftService.create(targetCustomerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update shift timing and parameters' })
  async update(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateShiftDto,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? customerId : user?.customerId;
    return this.shiftService.update(targetCustomerId, id, dto, isSuperAdmin);
  }

  @Patch(':id/guidance')
  @ApiOperation({ summary: 'Update shift guidance rules (overtime, breaks, allowances)' })
  async updateGuidance(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateShiftGuidanceDto,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? customerId : user?.customerId;
    return this.shiftService.updateGuidance(targetCustomerId, id, dto, isSuperAdmin);
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign employees or entire department to shift' })
  async assignEmployees(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() dto: AssignEmployeesToShiftDto,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? customerId : user?.customerId;
    return this.shiftService.assignEmployees(targetCustomerId, id, dto, isSuperAdmin);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate shift' })
  async delete(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? customerId : user?.customerId;
    return this.shiftService.delete(targetCustomerId, id, isSuperAdmin);
  }
}
