import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LeaveService } from './leave.service';
import {
  CreateLeaveDto,
  RejectLeaveDto,
  AdjustLeaveBalanceDto,
} from './dto/leave.dto';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';
import {
  UpsertAttendancePolicyDto,
  UpsertLeavePolicyDto,
  UpsertSalaryPolicyDto,
  UpsertClaimPolicyDto,
} from './dto/policy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Leaves & Workforce Availability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('leaves')
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  // =========================================================
  // 0. LEAVE TYPES
  // =========================================================
  @Get('types')
  @ApiOperation({ summary: 'Get all configured active leave types' })
  @ApiQuery({ name: 'customerId', required: false })
  async getLeaveTypes(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.getLeaveTypes(targetCustomerId);
  }

  @Get('leave-types')
  @ApiOperation({ summary: 'Alias for getLeaveTypes' })
  async getLeaveTypesAlias(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    return this.getLeaveTypes(user, customerId, customerIdQuery);
  }

  @Post('types')
  @ApiOperation({ summary: 'Create new Leave Type' })
  async createLeaveType(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.createLeaveType(targetCustomerId, dto);
  }

  @Patch('types/:id')
  @ApiOperation({ summary: 'Update existing Leave Type' })
  async updateLeaveType(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Body() dto: any,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.updateLeaveType(Number(id), targetCustomerId, dto);
  }

  @Delete('types/:id')
  @ApiOperation({ summary: 'Delete Leave Type with dependency safety check' })
  async deleteLeaveType(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id') id: string,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.deleteLeaveType(Number(id), targetCustomerId);
  }

  // =========================================================
  // 1. TODAY'S WORKFORCE AVAILABILITY
  // =========================================================
  @Get('availability')
  @ApiOperation({ summary: "Get today's live employee availability summary and roster" })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'officeId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'date', required: false })
  async getAvailability(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('search') search?: string,
    @Query('officeId') officeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.leaveService.getAvailability(targetCustomerId, {
      search,
      officeId,
      departmentId,
      status,
      date,
    });
  }

  // =========================================================
  // 2. LEAVE REQUESTS
  // =========================================================
  @Get('requests')
  @ApiOperation({ summary: 'Get filtered leave applications' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getLeaveRequests(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.leaveService.getLeaveRequests(user, targetCustomerId, {
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Alias for getLeaveRequests' })
  async getLeavesAlias(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.getLeaveRequests(user, customerId, customerIdQuery, status, search, page, limit);
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Get single leave request details' })
  async getLeaveRequestById(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.getLeaveRequestById(targetCustomerId, id);
  }

  @Post('requests')
  @ApiOperation({ summary: 'Submit new leave application' })
  async createLeave(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: CreateLeaveDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.createLeave(user, targetCustomerId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Alias for createLeave' })
  async createLeaveAlias(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: CreateLeaveDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    return this.createLeave(user, customerId, dto, customerIdQuery);
  }

  @Patch('requests/:id/approve')
  @ApiOperation({ summary: 'Approve a pending leave application' })
  async approveLeave(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.approveLeave(user, targetCustomerId, id);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Alias for approveLeave' })
  async approveLeaveAlias(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    return this.approveLeave(user, customerId, id, customerIdQuery);
  }

  @Patch('requests/:id/reject')
  @ApiOperation({ summary: 'Reject a leave application with reason' })
  async rejectLeave(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectLeaveDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.rejectLeave(user, targetCustomerId, id, dto);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Alias for rejectLeave' })
  async rejectLeaveAlias(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectLeaveDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    return this.rejectLeave(user, customerId, id, dto, customerIdQuery);
  }

  @Patch('requests/:id/cancel')
  @ApiOperation({ summary: 'Cancel an approved or pending leave application' })
  async cancelLeave(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.cancelLeave(user, targetCustomerId, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Alias for cancelLeave' })
  async cancelLeaveAlias(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    return this.cancelLeave(user, customerId, id, customerIdQuery);
  }

  // =========================================================
  // 3. EMPLOYEE-WISE LEAVE BALANCES
  // =========================================================
  @Get('balances')
  @ApiOperation({ summary: 'Get employee-wise leave balances across all configured leave types' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'officeId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'year', required: false })
  async getLeaveBalances(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('search') search?: string,
    @Query('officeId') officeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('year') year?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    if (!isSuperAdmin && !targetCustomerId) {
      throw new ForbiddenException('User does not belong to any customer');
    }

    return this.leaveService.getLeaveBalances(user, targetCustomerId, {
      search,
      officeId,
      departmentId,
      year,
    });
  }

  @Get('balances/:employeeId')
  @ApiOperation({ summary: 'Get single employee leave balance profile and history' })
  async getEmployeeBalanceDetails(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.getEmployeeBalanceDetails(targetCustomerId, employeeId);
  }

  @Post('balances/:employeeId/adjust')
  @ApiOperation({ summary: 'Adjust employee leave balance with mandatory audit reason' })
  async adjustLeaveBalance(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: AdjustLeaveBalanceDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.adjustLeaveBalance(user, targetCustomerId, employeeId, dto);
  }

  // =========================================================
  // 4. PUBLIC HOLIDAYS
  // =========================================================
  @Get('holidays')
  @ApiOperation({ summary: 'Get all declared public holidays' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'officeId', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  async getPublicHolidays(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
    @Query('search') search?: string,
    @Query('officeId') officeId?: string,
    @Query('year') year?: string,
    @Query('isActive') isActiveQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;

    const isActive =
      isActiveQuery !== undefined
        ? isActiveQuery === 'true' || isActiveQuery === '1'
        : undefined;

    return this.leaveService.getPublicHolidays(targetCustomerId, {
      search,
      officeId,
      year,
      isActive,
    });
  }

  @Get('holidays/:id')
  @ApiOperation({ summary: 'Get public holiday details by ID' })
  async getPublicHolidayById(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.getPublicHolidayById(targetCustomerId, id);
  }

  @Post('holidays')
  @ApiOperation({ summary: 'Declare a new public holiday' })
  async createPublicHoliday(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: CreateHolidayDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.createPublicHoliday(user, targetCustomerId, dto);
  }

  @Patch('holidays/:id')
  @ApiOperation({ summary: 'Update an existing public holiday' })
  async updatePublicHoliday(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHolidayDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.updatePublicHoliday(targetCustomerId, id, dto);
  }

  @Delete('holidays/:id')
  @ApiOperation({ summary: 'Delete a public holiday' })
  async deletePublicHoliday(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.deletePublicHoliday(targetCustomerId, id);
  }

  // =========================================================
  // 5. HR POLICIES
  // =========================================================
  @Get('policies')
  @ApiOperation({ summary: 'Get current active HR policies overview' })
  @ApiQuery({ name: 'customerId', required: false })
  async getPoliciesOverview(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.getPoliciesOverview(targetCustomerId);
  }

  @Post('policies/attendance')
  @ApiOperation({ summary: 'Create or update Attendance Policy' })
  async upsertAttendancePolicy(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: UpsertAttendancePolicyDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.upsertAttendancePolicy(user, targetCustomerId, dto);
  }

  @Post('policies/leave')
  @ApiOperation({ summary: 'Create or update Leave Policy' })
  async upsertLeavePolicy(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: UpsertLeavePolicyDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.upsertLeavePolicy(user, targetCustomerId, dto);
  }

  @Post('policies/salary')
  @ApiOperation({ summary: 'Create or update Salary Policy' })
  async upsertSalaryPolicy(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: UpsertSalaryPolicyDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.upsertSalaryPolicy(user, targetCustomerId, dto);
  }

  @Post('policies/claim')
  @ApiOperation({ summary: 'Create or update Claim / Expense Policy' })
  async upsertClaimPolicy(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: UpsertClaimPolicyDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.leaveService.upsertClaimPolicy(user, targetCustomerId, dto);
  }
}
