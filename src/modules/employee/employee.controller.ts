import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EmployeeService } from './employee.service';
import { WorkService } from '../work/work.service';
import { WorkStatus } from '@prisma/client';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin, isUserAdmin } from '../../common/utils/role.util';
import { userHasModulePermission } from '../../common/guards/permissions.guard';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('employees')
export class EmployeeController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly workService: WorkService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of employees master data' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'branch', required: false })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'designation', required: false })
  @ApiQuery({ name: 'employmentType', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'excludeAdmins', required: false })
  @ApiQuery({ name: 'bpoOnly', required: false, description: 'Filter only BPO eligible employees' })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('branch') branch?: string,
    @Query('department') department?: string,
    @Query('designation') designation?: string,
    @Query('employmentType') employmentType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('excludeAdmins') excludeAdmins?: string,
    @Query('bpoOnly') bpoOnly?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.employeeService.findAll({
      customerId: targetCustomerId,
      isSuperAdmin,
      search,
      status,
      branch,
      department,
      designation,
      employmentType,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      excludeAdmins: excludeAdmins !== 'false',
      bpoOnly: bpoOnly === 'true',
    });
  }

  @Get('next-id')
  @ApiOperation({ summary: 'Preview the next auto-generated Employee ID' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'prefix', required: false, description: 'ID Prefix e.g. QB' })
  async getNextId(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('prefix') prefix?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    const defaultPrefix = process.env.EMPLOYEE_ID_PREFIX || 'EMP';
    return this.employeeService.getNextEmployeeCode(targetCustomerId, prefix || defaultPrefix);
  }

  @Get('profile/me')
  @ApiOperation({ summary: 'Get current authenticated employee full profile' })
  async getMyProfile(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    return this.employeeService.getMyProfile(user, customerId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Alias to get current authenticated employee profile' })
  async getMe(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
  ) {
    return this.employeeService.getMyProfile(user, customerId);
  }

  @Get('me/permissions')
  @ApiOperation({ summary: 'Get current authenticated employee canonical effective permissions' })
  async getMyPermissions(@CurrentUser() user: any) {
    const userId = user?.id || user?.userId;
    if (!userId) {
      throw new ForbiddenException('User session invalid');
    }
    return this.employeeService.getMyEffectivePermissions(userId);
  }

  @Get('permissions/me')
  @ApiOperation({ summary: 'Alias to get current authenticated employee canonical effective permissions' })
  async getMyPermissionsAlias(@CurrentUser() user: any) {
    const userId = user?.id || user?.userId;
    if (!userId) {
      throw new ForbiddenException('User session invalid');
    }
    return this.employeeService.getMyEffectivePermissions(userId);
  }

  @Get('me/calendar')
  @ApiOperation({ summary: 'Get calendar scheduled activities for current authenticated employee' })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  async getMyCalendar(
    @CurrentUser() user: any,
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('status') status?: WorkStatus,
    @Query('customerId') customerId?: string,
  ) {
    const employeeId = await this.workService.resolveEmployeeIdForUser(user);
    if (!employeeId) {
      return [];
    }
    if (!userHasModulePermission(user, 'CALENDAR', 'VIEW')) {
      throw new ForbiddenException(
        'Access denied: Missing required permission [CALENDAR:VIEW]',
      );
    }

    return this.workService.getEmployeeCalendar(employeeId, {
      date: date || startDate,
      dateFrom: startDate || dateFrom,
      dateTo: endDate || dateTo,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      status,
      customerId: customerId ? parseInt(customerId, 10) : undefined,
    }, { allTenantCustomers: true });
  }

  @Get('hrm/offices')
  @ApiOperation({ summary: 'Get list of real branches/offices for filtering' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async getOffices(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.employeeService.getOffices(targetCustomerId, isSuperAdmin);
  }

  @Get('hrm/leaves')
  @ApiOperation({ summary: 'Get employee leave requests' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async getLeaves(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.employeeService.getLeaves(user, targetCustomerId, isSuperAdmin);
  }

  @Get('hrm/remote-requests')
  @ApiOperation({ summary: 'Get remote work requests' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async getRemoteRequests(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.employeeService.getRemoteRequests(user, targetCustomerId, isSuperAdmin);
  }

  @Get('hrm/attendance')
  @ApiOperation({ summary: 'Get employee attendance logs' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'branch', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getAttendance(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('date') date?: string,
    @Query('branch') branch?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.employeeService.getAttendance(user, targetCustomerId, isSuperAdmin, {
      date,
      branch,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('hrm/live-attendance')
  @ApiOperation({ summary: 'Get real-time employee attendance, breaks, and leave live data' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  @ApiQuery({ name: 'branch', required: false })
  @ApiQuery({ name: 'date', required: false })
  async getLiveAttendance(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('branch') branch?: string,
    @Query('date') date?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.employeeService.getLiveAttendance(targetCustomerId, isSuperAdmin, branch, date);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single employee details with attendance, breaks, and leaves' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
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
    const isSuperAdmin = isUserSuperAdmin(user);
    let targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId || user?.customerId) : user?.customerId;

    if (!targetCustomerId && isSuperAdmin) {
      targetCustomerId = await this.employeeService.resolveDefaultCustomerId();
    }

    if (!targetCustomerId) {
      throw new BadRequestException('customerId is required to create an employee');
    }

    return this.employeeService.create({
      customerId: targetCustomerId,
      dto,
      bypassUserLimit: isUserAdmin(user),
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
    const isSuperAdmin = isUserSuperAdmin(user);
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
    const isSuperAdmin = isUserSuperAdmin(user);
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

  @Get(':id/permissions')
  @ApiOperation({ summary: 'Get employee role permissions and individual overrides' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async getPermissions(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.employeeService.getEmployeePermissions({
      employeeId: id,
      customerId: targetCustomerId,
      isSuperAdmin,
    });
  }

  @Put(':id/permissions')
  @ApiOperation({ summary: 'Update individual employee module/permission overrides' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async updatePermissions(
    @Param('id') id: string,
    @Body() body: { overrides: Array<{ moduleKey: string; override: 'INHERIT' | 'ALLOW' | 'DENY' | 'DEFAULT' }> },
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    if (!body || !Array.isArray(body.overrides)) {
      throw new BadRequestException('Request body must contain overrides array');
    }

    return this.employeeService.updateEmployeePermissions({
      employeeId: id,
      customerId: targetCustomerId,
      isSuperAdmin,
      actorUser: user,
      overrides: body.overrides,
    });
  }

  @Delete(':id/permissions')
  @ApiOperation({ summary: 'Reset employee module/permission overrides to role defaults' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async resetPermissions(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.employeeService.resetEmployeePermissions({
      employeeId: id,
      customerId: targetCustomerId,
      isSuperAdmin,
      actorUser: user,
    });
  }

  @Post(':id/permissions/reset')
  @ApiOperation({ summary: 'Reset employee module/permission overrides to role defaults (POST alias)' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async resetPermissionsPost(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.employeeService.resetEmployeePermissions({
      employeeId: id,
      customerId: targetCustomerId,
      isSuperAdmin,
      actorUser: user,
    });
  }

  @Post(':id/permissions/restrict-all')
  @ApiOperation({ summary: 'Restrict all modules for individual employee to DENY' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Optional customerId for SUPER_ADMIN only' })
  async restrictAllPermissions(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.employeeService.restrictAllEmployeePermissions({
      employeeId: id,
      customerId: targetCustomerId,
      isSuperAdmin,
      actorUser: user,
    });
  }
}

