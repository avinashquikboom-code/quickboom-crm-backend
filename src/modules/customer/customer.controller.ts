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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  UpdateCustomerProfileDto,
  AssignCustomerTeamDto,
} from './dto/customer.dto';
import { ResetCustomerDataDto } from './dto/reset-customer.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkService } from '../work/work.service';
import { AiCreditService } from '../ai-studio/ai-credit.service';
import { AdminAdjustCreditsDto } from '../ai-studio/dto/ai-studio.dto';
import { isUserSuperAdmin, isUserAdminOrStaff } from '../../common/utils/role.util';

/** Numeric PK only — prevents /customer/:id from capturing paths like /customer/influencers */
const NUMERIC_CUSTOMER_ID = ':id(\\d+)';

@ApiTags('Customers & Tenant Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller(['customers', 'customer'])
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly workService: WorkService,
    private readonly aiCreditService: AiCreditService,
  ) {}

  @Get(['calendar', '/customer/calendar'])
  @ApiOperation({ summary: 'Get customer scheduled activities from Work table' })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  async getCalendar(
    @CurrentUser() user: any,
    @Query('customerId') customerId?: string,
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    // Strict Customer Isolation: Customer JWT can ONLY access their own calendar.
    // Never trust client customerId query param if user is a customer.
    const isCustomer =
      user?.role === 'CUSTOMER' ||
      (user?.customerId && !user?.employee && !user?.roles?.some((r: any) => ['ADMIN', 'SUPER_ADMIN', 'COMPANY_ADMIN'].includes(r)));
    const targetCustId = isCustomer ? (user?.customerId || user?.id) : (customerId || user?.customerId || user?.id);

    return this.workService.getCalendar(targetCustId, {
      date: date || startDate,
      dateFrom: startDate,
      dateTo: endDate,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
    });
  }

  @Get(['me', '/customer/me'])
  @ApiOperation({ summary: 'Get profile of current authenticated customer' })
  async getMe(@CurrentUser() user: any) {
    return this.customerService.getMe(user);
  }

  @Patch(['me', '/customer/me'])
  @ApiOperation({ summary: 'Update profile of current authenticated customer' })
  async updateMe(@CurrentUser() user: any, @Body() dto: UpdateCustomerProfileDto) {
    return this.customerService.updateMe(user, dto);
  }

  @Get(['profile', '/customer/profile'])
  @ApiOperation({ summary: 'Get profile of current authenticated customer (alias)' })
  async getProfile(@CurrentUser() user: any) {
    return this.customerService.getMe(user);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get Customer KPI summary metrics' })
  async getMetrics() {
    return this.customerService.getMetrics();
  }

  @Get('resource-consumption')
  @Get('usage')
  @ApiOperation({ summary: 'Get Customer Resource Consumption analytics, breakdown, and KPI metrics' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'sortOrder', required: false })
  async getResourceConsumption(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    return this.customerService.getResourceConsumption({
      search,
      status,
      dateFrom,
      dateTo,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      sortBy,
      sortOrder,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all customers with advanced filtering, search, sorting and pagination' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'stage', required: false, description: 'Filter by lead stage key or name (e.g. FOLLOW_UP, FINAL_CALL)' })
  @ApiQuery({ name: 'source', required: false })
  @ApiQuery({ name: 'teamId', required: false, description: 'Filter by assigned Team ID' })
  @ApiQuery({ name: 'assignedEmployee', required: false })
  @ApiQuery({ name: 'company', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'sortOrder', required: false })
  @ApiQuery({ name: 'excludeAdmins', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('stage') stage?: string,
    @Query('isActive') isActive?: string,
    @Query('source') source?: string,
    @Query('teamId') teamId?: string,
    @Query('assignedTeamId') assignedTeamId?: string,
    @Query('assignedEmployee') assignedEmployee?: string,
    @Query('company') company?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('excludeAdmins') excludeAdmins?: string,
  ) {
    const activeBool = isActive !== undefined ? isActive === 'true' : undefined;
    return this.customerService.findAll({
      search,
      status,
      stage,
      isActive: activeBool,
      source,
      teamId: teamId || assignedTeamId,
      assignedEmployee,
      company,
      dateFrom,
      dateTo,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      sortBy,
      sortOrder,
      excludeAdmins: excludeAdmins !== 'false',
    }, user);
  }

  @Get(NUMERIC_CUSTOMER_ID)
  @ApiOperation({ summary: 'Get single customer details' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.customerService.findOne(id, user);
  }

  @Get(`${NUMERIC_CUSTOMER_ID}/activities`)
  @ApiOperation({ summary: 'Get customer activities and audit history' })
  async getCustomerActivities(@Param('id') id: string) {
    return this.customerService.getCustomerActivities(id);
  }

  @Get(`${NUMERIC_CUSTOMER_ID}/tasks`)
  @ApiOperation({ summary: 'Get customer tasks' })
  async getCustomerTasks(@Param('id') id: string) {
    return this.customerService.getCustomerTasks(id);
  }

  @Get(`${NUMERIC_CUSTOMER_ID}/visits`)
  @ApiOperation({ summary: 'Get customer visits' })
  async getCustomerVisits(@Param('id') id: string) {
    return this.customerService.getCustomerVisits(id);
  }

  @Get(`${NUMERIC_CUSTOMER_ID}/deals`)
  @ApiOperation({ summary: 'Get customer deals' })
  async getCustomerDeals(@Param('id') id: string) {
    return this.customerService.getCustomerDeals(id);
  }

  @Get(`${NUMERIC_CUSTOMER_ID}/plan`)
  @ApiOperation({ summary: 'Get current plan and customization details for customer' })
  async getCustomerPlan(@Param('id') id: string) {
    return this.customerService.getCustomerPlan(id);
  }

  @Get(`${NUMERIC_CUSTOMER_ID}/plan/history`)
  @ApiOperation({ summary: 'Get customer subscription assignment history' })
  async getCustomerPlanHistory(@Param('id') id: string) {
    return this.customerService.getCustomerPlanHistory(id);
  }

  @Post(`${NUMERIC_CUSTOMER_ID}/customize-plan`)
  @ApiOperation({ summary: 'Customize and assign subscription plan for customer' })
  async customizePlan(@Param('id') id: string, @Body() dto: any) {
    return this.customerService.customizeCustomerPlan(id, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create new customer' })
  async create(@Body() dto: CreateCustomerDto, @CurrentUser() user: any) {
    return this.customerService.create(dto, user);
  }

  @Patch(NUMERIC_CUSTOMER_ID)
  @ApiOperation({ summary: 'Update customer' })
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customerService.update(id, dto);
  }

  @Get([`${NUMERIC_CUSTOMER_ID}/assign-team`, `${NUMERIC_CUSTOMER_ID}/team`])
  @ApiOperation({ summary: 'Get assigned team for a customer' })
  async getAssignedTeam(@Param('id') id: string, @CurrentUser() user: any) {
    return this.customerService.getAssignedTeam(id, user);
  }

  @Patch([`${NUMERIC_CUSTOMER_ID}/assign-team`, `${NUMERIC_CUSTOMER_ID}/team`])
  @ApiOperation({ summary: 'Assign or reassign customer to an operating team' })
  async assignTeam(
    @Param('id') id: string,
    @Body() dto: AssignCustomerTeamDto,
    @CurrentUser() user: any,
  ) {
    const targetTeamId = dto.teamId !== undefined ? dto.teamId : dto.assignedTeamId;
    return this.customerService.assignTeam(id, targetTeamId, user);
  }

  @Delete(NUMERIC_CUSTOMER_ID)
  @ApiOperation({ summary: 'Permanently delete customer and all customer-owned data' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.customerService.remove(id, user);
  }

  @Get([`${NUMERIC_CUSTOMER_ID}/reset-summary`, `admin/customers/${NUMERIC_CUSTOMER_ID}/reset-summary`])
  @ApiOperation({ summary: 'Get summary of customer data that would be affected by reset' })
  async getResetSummary(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.customerService.getResetSummary(id, user);
  }

  @Post([`${NUMERIC_CUSTOMER_ID}/reset-data`, `admin/customers/${NUMERIC_CUSTOMER_ID}/reset-data`])
  @ApiOperation({ summary: 'Reset all customer transactional data while preserving customer account & master records' })
  async resetCustomerData(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: ResetCustomerDataDto,
  ) {
    return this.customerService.resetCustomerData(id, user, dto);
  }

  @Delete([`${NUMERIC_CUSTOMER_ID}/data`, `admin/customers/${NUMERIC_CUSTOMER_ID}/data`])
  @ApiOperation({ summary: 'Reset all customer transactional data (DELETE alias)' })
  async deleteCustomerData(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: ResetCustomerDataDto,
  ) {
    return this.customerService.resetCustomerData(id, user, dto);
  }

  @Get([`${NUMERIC_CUSTOMER_ID}/ai-credits`, `admin/customers/${NUMERIC_CUSTOMER_ID}/ai-credits`])
  @ApiOperation({ summary: 'Get customer AI credits wallet and ledger (Admin)' })
  async getAiCredits(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    if (!isUserAdminOrStaff(user) && !isUserSuperAdmin(user)) {
      throw new ForbiddenException('Only authorized Admin or Super Admin can view customer AI credits');
    }
    const data = await this.aiCreditService.getCustomerWalletAdmin(parseInt(id, 10));
    return { statusCode: 200, success: true, data };
  }

  @Post([`${NUMERIC_CUSTOMER_ID}/ai-credits/add`, `admin/customers/${NUMERIC_CUSTOMER_ID}/ai-credits/add`])
  @ApiOperation({ summary: 'Add AI credits to customer wallet (Admin)' })
  async addAiCredits(
    @Param('id') id: string,
    @Body() dto: AdminAdjustCreditsDto,
    @CurrentUser() user: any,
  ) {
    if (!isUserAdminOrStaff(user) && !isUserSuperAdmin(user)) {
      throw new ForbiddenException('Only authorized Admin or Super Admin can add AI credits');
    }
    const data = await this.aiCreditService.addCreditsAdmin(parseInt(id, 10), dto, user);
    return { statusCode: 200, success: true, message: data.message, data };
  }

  @Post([`${NUMERIC_CUSTOMER_ID}/ai-credits/reduce`, `admin/customers/${NUMERIC_CUSTOMER_ID}/ai-credits/reduce`])
  @ApiOperation({ summary: 'Reduce AI credits from customer wallet (Admin)' })
  async reduceAiCredits(
    @Param('id') id: string,
    @Body() dto: AdminAdjustCreditsDto,
    @CurrentUser() user: any,
  ) {
    if (!isUserAdminOrStaff(user) && !isUserSuperAdmin(user)) {
      throw new ForbiddenException('Only authorized Admin or Super Admin can reduce AI credits');
    }
    const data = await this.aiCreditService.reduceCreditsAdmin(parseInt(id, 10), dto, user);
    return { statusCode: 200, success: true, message: data.message, data };
  }
}

