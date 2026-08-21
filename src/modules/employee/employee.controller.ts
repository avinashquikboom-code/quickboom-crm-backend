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
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EmployeeService } from './employee.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleType } from '@prisma/client';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of employees' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.employeeService.findAll({
      customerId: targetCustomerId,
      isSuperAdmin,
      search,
      status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Get('hrm/leaves')
  @ApiOperation({ summary: 'Get employee leave requests' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async getLeaves(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.employeeService.getLeaves(targetCustomerId, isSuperAdmin);
  }

  @Get('hrm/remote-requests')
  @ApiOperation({ summary: 'Get remote work requests' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async getRemoteRequests(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.employeeService.getRemoteRequests(targetCustomerId, isSuperAdmin);
  }

  @Get('hrm/attendance')
  @ApiOperation({ summary: 'Get employee attendance logs' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async getAttendance(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.employeeService.getAttendance(targetCustomerId, isSuperAdmin);
  }

  @Get('hrm/live-attendance')
  @ApiOperation({ summary: 'Get real-time employee attendance, breaks, and leave live data' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async getLiveAttendance(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.employeeService.getLiveAttendance(targetCustomerId, isSuperAdmin);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single employee details' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.employeeService.findOne({
      id,
      customerId: targetCustomerId,
      isSuperAdmin,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create new employee' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!targetCustomerId) {
      throw new BadRequestException('customerId is required to create an employee');
    }

    return this.employeeService.create({
      customerId: targetCustomerId,
      dto,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee details' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.employeeService.update({
      id,
      customerId: targetCustomerId,
      isSuperAdmin,
      dto,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate employee' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.employeeService.remove({
      id,
      customerId: targetCustomerId,
      isSuperAdmin,
    });
  }
}
