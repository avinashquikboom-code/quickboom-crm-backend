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
import { CustomerService } from './customer.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  UpdateCustomerProfileDto,
} from './dto/customer.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Customers & Tenant Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get profile of current authenticated customer' })
  async getMe(@CurrentUser() user: any) {
    return this.customerService.getMe(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update profile of current authenticated customer' })
  async updateMe(@CurrentUser() user: any, @Body() dto: UpdateCustomerProfileDto) {
    return this.customerService.updateMe(user, dto);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get profile of current authenticated customer (alias)' })
  async getProfile(@CurrentUser() user: any) {
    return this.customerService.getMe(user);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get Customer KPI summary metrics' })
  async getMetrics() {
    return this.customerService.getMetrics();
  }

  @Get()
  @ApiOperation({ summary: 'Get all customers with advanced filtering, search, sorting and pagination' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'source', required: false })
  @ApiQuery({ name: 'assignedEmployee', required: false })
  @ApiQuery({ name: 'company', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'sortOrder', required: false })
  async findAll(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('isActive') isActive?: string,
    @Query('source') source?: string,
    @Query('assignedEmployee') assignedEmployee?: string,
    @Query('company') company?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    const activeBool = isActive !== undefined ? isActive === 'true' : undefined;
    return this.customerService.findAll({
      search,
      status,
      isActive: activeBool,
      source,
      assignedEmployee,
      company,
      dateFrom,
      dateTo,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      sortBy,
      sortOrder,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single customer details' })
  async findOne(@Param('id') id: string) {
    return this.customerService.findOne(id);
  }

  @Get(':id/activities')
  @ApiOperation({ summary: 'Get customer activities and audit history' })
  async getCustomerActivities(@Param('id') id: string) {
    return this.customerService.getCustomerActivities(id);
  }

  @Get(':id/tasks')
  @ApiOperation({ summary: 'Get customer tasks' })
  async getCustomerTasks(@Param('id') id: string) {
    return this.customerService.getCustomerTasks(id);
  }

  @Get(':id/visits')
  @ApiOperation({ summary: 'Get customer visits' })
  async getCustomerVisits(@Param('id') id: string) {
    return this.customerService.getCustomerVisits(id);
  }

  @Get(':id/deals')
  @ApiOperation({ summary: 'Get customer deals' })
  async getCustomerDeals(@Param('id') id: string) {
    return this.customerService.getCustomerDeals(id);
  }

  @Get(':id/plan')
  @ApiOperation({ summary: 'Get current plan and customization details for customer' })
  async getCustomerPlan(@Param('id') id: string) {
    return this.customerService.getCustomerPlan(id);
  }

  @Get(':id/plan/history')
  @ApiOperation({ summary: 'Get customer subscription assignment history' })
  async getCustomerPlanHistory(@Param('id') id: string) {
    return this.customerService.getCustomerPlanHistory(id);
  }

  @Post(':id/customize-plan')
  @ApiOperation({ summary: 'Customize and assign subscription plan for customer' })
  async customizePlan(@Param('id') id: string, @Body() dto: any) {
    return this.customerService.customizeCustomerPlan(id, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create new customer' })
  async create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update customer' })
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customerService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate / soft-delete customer' })
  async remove(@Param('id') id: string) {
    return this.customerService.remove(id);
  }
}
