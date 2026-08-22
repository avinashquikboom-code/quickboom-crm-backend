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
import { CreateLeaveDto, RejectLeaveDto } from './dto/leave.dto';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';
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

    return this.leaveService.getLeaveRequests(targetCustomerId, {
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 100,
    });
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
    return this.leaveService.createLeave(targetCustomerId, dto);
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

  // =========================================================
  // 3. PUBLIC HOLIDAYS
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
}
