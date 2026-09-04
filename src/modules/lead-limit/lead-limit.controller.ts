import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeadLimitService } from './lead-limit.service';
import { SetRoleLeadLimitDto, SetEmployeeLeadLimitDto } from './dto/lead-limit.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Lead Generation Limits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('lead-generation-limits')
export class LeadLimitController {
  constructor(private readonly leadLimitService: LeadLimitService) {}

  // ── EMPLOYEE SELF LIMIT API (MOBILE) ───────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Get effective lead generation limits and current usage for authenticated employee' })
  async getMyLimit(@CurrentCustomer() customerId: number, @CurrentUser() user: any) {
    return this.leadLimitService.getMyLeadLimit(customerId, user);
  }

  // ── ROLE-WISE LIMITS (ADMIN) ───────────────────────────────────────────────

  @Get('roles')
  @ApiOperation({ summary: 'List role-wise lead generation limits' })
  async getRoleLimits(@CurrentCustomer() customerId: number) {
    return this.leadLimitService.getRoleLimits(customerId);
  }

  @Post('roles')
  @ApiOperation({ summary: 'Create or update role-wise lead generation limit' })
  async setRoleLimit(
    @CurrentCustomer() customerId: number,
    @Body() dto: SetRoleLeadLimitDto,
  ) {
    return this.leadLimitService.upsertRoleLimit(customerId, dto);
  }

  // ── EMPLOYEE-WISE LIMITS & USAGE (ADMIN) ───────────────────────────────────

  @Get('employees')
  @ApiOperation({ summary: 'List all employees with their lead generation limits and real-time usage' })
  async getEmployeeLimits(@CurrentCustomer() customerId: number) {
    return this.leadLimitService.getEmployeeLimits(customerId);
  }

  @Get('employees/:employeeId')
  @ApiOperation({ summary: 'Get specific employee limit and current usage' })
  async getEmployeeLimit(
    @CurrentCustomer() customerId: number,
    @Param('employeeId', ParseIntPipe) employeeId: number,
  ) {
    return this.leadLimitService.getEmployeeLimitById(customerId, employeeId);
  }

  @Put('employees/:employeeId')
  @ApiOperation({ summary: 'Set or update custom lead generation limit for employee' })
  async setEmployeeLimit(
    @CurrentCustomer() customerId: number,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: SetEmployeeLeadLimitDto,
  ) {
    return this.leadLimitService.upsertEmployeeLimit(customerId, employeeId, dto);
  }

  @Post('employees/:employeeId')
  @ApiOperation({ summary: 'Alias for setting custom lead generation limit for employee' })
  async postEmployeeLimit(
    @CurrentCustomer() customerId: number,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: SetEmployeeLeadLimitDto,
  ) {
    return this.leadLimitService.upsertEmployeeLimit(customerId, employeeId, dto);
  }

  @Delete('employees/:employeeId')
  @ApiOperation({ summary: 'Clear custom employee limit override (reverts to role limit)' })
  async clearEmployeeLimit(
    @CurrentCustomer() customerId: number,
    @Param('employeeId', ParseIntPipe) employeeId: number,
  ) {
    return this.leadLimitService.clearEmployeeLimit(customerId, employeeId);
  }
}
