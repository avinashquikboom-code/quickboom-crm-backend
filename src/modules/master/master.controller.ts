import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MasterService } from './master.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Master Data Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('master')
export class MasterController {
  constructor(private readonly masterService: MasterService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get overview statistics across all master data modules' })
  @ApiQuery({ name: 'customerId', required: false })
  async getSummary(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.masterService.getMasterSummary(targetCustomerId);
  }

  @Get('employee-types')
  @ApiOperation({ summary: 'Get existing employee types with workforce distribution' })
  @ApiQuery({ name: 'customerId', required: false })
  async getEmployeeTypes(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.masterService.getEmployeeTypes(targetCustomerId);
  }

  @Get('work-types')
  @ApiOperation({ summary: 'Get supported work and creative task types with item counts' })
  @ApiQuery({ name: 'customerId', required: false })
  async getWorkTypes(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.masterService.getWorkTypes(targetCustomerId);
  }

  @Get('activity-types')
  @ApiOperation({ summary: 'Get calendar and CRM activity types' })
  @ApiQuery({ name: 'customerId', required: false })
  async getActivityTypes(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.masterService.getActivityTypes(targetCustomerId);
  }

  @Get('task-statuses')
  @ApiOperation({ summary: 'Get task and work statuses with synchronization mapping' })
  @ApiQuery({ name: 'customerId', required: false })
  async getTaskStatuses(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.masterService.getTaskStatuses(targetCustomerId);
  }

  @Get('lead-sources')
  @ApiOperation({ summary: 'Get lead sources and lead distribution' })
  @ApiQuery({ name: 'customerId', required: false })
  async getLeadSources(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.masterService.getLeadSources(targetCustomerId);
  }

  @Get('expense-categories')
  @ApiOperation({ summary: 'Get HRM claim expense categories and policy limits' })
  @ApiQuery({ name: 'customerId', required: false })
  async getExpenseCategories(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.masterService.getExpenseCategories(targetCustomerId);
  }

  @Get('loan-types')
  @ApiOperation({ summary: 'Get company loan types and schemes' })
  @ApiQuery({ name: 'customerId', required: false })
  async getLoanTypes(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.masterService.getLoanTypes(targetCustomerId);
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Get supported payment methods and gateway settings' })
  @ApiQuery({ name: 'customerId', required: false })
  async getPaymentMethods(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (customerIdQuery || customerId) : user?.customerId;
    return this.masterService.getPaymentMethods(targetCustomerId);
  }

  @Post('items')
  @ApiOperation({ summary: 'Create a new master item record' })
  async createItem(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() dto: any,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (dto.customerId || customerId) : user?.customerId;
    return this.masterService.createMasterItem(targetCustomerId, dto);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Update an existing master item record' })
  async updateItem(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? (dto.customerId || customerId) : user?.customerId;
    return this.masterService.updateMasterItem(id, targetCustomerId, dto);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Delete a master item record' })
  async deleteItem(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const targetCustomerId = isSuperAdmin ? customerId : user?.customerId;
    return this.masterService.deleteMasterItem(id, targetCustomerId);
  }
}

