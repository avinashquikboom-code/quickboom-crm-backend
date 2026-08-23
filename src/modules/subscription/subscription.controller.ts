import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { PlanAccessService } from './plan-access.service';
import { CreateOrderDto, RenewSubscriptionDto } from './dto/subscription.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleType } from '@prisma/client';

@ApiTags('Subscriptions & Plans')
@Controller()
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly planAccessService: PlanAccessService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: 'Get all active subscription plans (Customer & Public)' })
  async getPlans() {
    return this.subscriptionService.getPlans(false);
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get single plan details (Customer & Public)' })
  async getPlanById(@Param('id') id: string) {
    return this.subscriptionService.getPlanById(id);
  }

  @Get('admin/plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all subscription plans including inactive (Admin)' })
  async getAdminPlans() {
    return this.subscriptionService.getPlans(true);
  }

  @Get('admin/plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get plan by ID (Admin)' })
  async getAdminPlanById(@Param('id') id: string) {
    return this.subscriptionService.getPlanById(id);
  }

  @Post('admin/plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new subscription plan (Admin)' })
  async createPlanAdmin(@Body() dto: any) {
    return this.subscriptionService.createPlan(dto);
  }

  @Patch('admin/plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update existing subscription plan (Admin)' })
  async updatePlanAdmin(@Param('id') id: string, @Body() dto: any) {
    return this.subscriptionService.updatePlan(id, dto);
  }

  @Delete('admin/plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate subscription plan (Admin)' })
  async deletePlanAdmin(@Param('id') id: string) {
    return this.subscriptionService.deletePlan(id);
  }

  @Post('plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new subscription plan' })
  async createPlan(@Body() dto: any) {
    return this.subscriptionService.createPlan(dto);
  }

  @Patch('plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update existing subscription plan' })
  async updatePlan(@Param('id') id: string, @Body() dto: any) {
    return this.subscriptionService.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate subscription plan' })
  async deletePlan(@Param('id') id: string) {
    return this.subscriptionService.deletePlan(id);
  }

  @Get('subscriptions/current')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current customer subscription status' })
  async getCurrentSubscription(@CurrentCustomer() customerId: string) {
    return this.subscriptionService.getCurrentSubscription(customerId);
  }

  @Get('subscriptions/effective-plan')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get customer resolved effective plan with limits and live usage' })
  async getEffectivePlan(@CurrentCustomer() customerId: string) {
    return this.planAccessService.getEffectivePlan(customerId);
  }

  @Get('admin/customers/:id/subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get customer subscription and effective limits (Admin)' })
  async getCustomerSubscriptionAdmin(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.planAccessService.getEffectivePlan(id);
  }

  @Patch('admin/customers/:id/subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Customize customer subscription limits, price, features (Admin)' })
  async updateCustomerSubscriptionAdmin(
    @Param('id') id: string,
    @Body() dto: {
      planId?: number;
      customUserLimit?: number;
      customLeadLimit?: number;
      customStorageLimit?: number | bigint;
      customFeatures?: any;
      customPrice?: number;
      status?: any;
      startDate?: string;
      endDate?: string;
    },
    @CurrentUser() user: any,
  ) {
    const isSuperAdmin = Boolean(user?.roles?.includes(RoleType.SUPER_ADMIN));
    if (!isSuperAdmin) {
      throw new ForbiddenException('Only Super Admins can customize customer plan limits');
    }

    const numCustomerId = Number(id);

    let sub = await this.subscriptionService['prisma'].customerSubscription.findFirst({
      where: { customerId: numCustomerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!sub) {
      const defaultPlan = await this.subscriptionService['prisma'].plan.findFirst({
        where: { deletedAt: null, isActive: true },
      });

      sub = await this.subscriptionService['prisma'].customerSubscription.create({
        data: {
          customerId: numCustomerId,
          planId: dto.planId || defaultPlan?.id || 1,
          status: dto.status || 'ACTIVE',
          startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
          endDate: dto.endDate ? new Date(dto.endDate) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          customUserLimit: dto.customUserLimit,
          customLeadLimit: dto.customLeadLimit,
          customStorageLimit: dto.customStorageLimit ? BigInt(dto.customStorageLimit) : null,
          customFeatures: dto.customFeatures,
          customPrice: dto.customPrice,
        },
      });
    } else {
      sub = await this.subscriptionService['prisma'].customerSubscription.update({
        where: { id: sub.id },
        data: {
          ...(dto.planId ? { planId: dto.planId } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.startDate ? { startDate: new Date(dto.startDate) } : {}),
          ...(dto.endDate ? { endDate: new Date(dto.endDate) } : {}),
          customUserLimit: dto.customUserLimit !== undefined ? dto.customUserLimit : sub.customUserLimit,
          customLeadLimit: dto.customLeadLimit !== undefined ? dto.customLeadLimit : sub.customLeadLimit,
          customStorageLimit: dto.customStorageLimit !== undefined ? (dto.customStorageLimit ? BigInt(dto.customStorageLimit) : null) : sub.customStorageLimit,
          customFeatures: dto.customFeatures !== undefined ? dto.customFeatures : sub.customFeatures,
          customPrice: dto.customPrice !== undefined ? dto.customPrice : sub.customPrice,
        },
      });
    }

    return this.planAccessService.getEffectivePlan(numCustomerId);
  }

  @Get('subscriptions/orders')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get customer purchase and order history' })
  async getCustomerOrders(@CurrentCustomer() customerId: string) {
    return this.subscriptionService.getCustomerOrders(customerId);
  }

  @Post('subscriptions/order')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new plan subscription order' })
  async createOrder(
    @CurrentCustomer() customerId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.subscriptionService.createOrder(customerId, dto);
  }

  @Get('customer/subscription')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current customer subscription details with days remaining & expiry dates' })
  async getCustomerSubscription(@CurrentCustomer() customerId: string) {
    return this.subscriptionService.getCurrentSubscription(customerId);
  }

  @Get('customer/subscription/status')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current customer plan status banner payload for mobile & dashboard' })
  async getCustomerSubscriptionStatus(@CurrentCustomer() customerId: string) {
    const sub = await this.subscriptionService.getCurrentSubscription(customerId);
    if (!sub) {
      return {
        hasSubscription: false,
        status: 'INACTIVE',
        message: 'No active plan found. Please purchase a subscription.',
      };
    }
    return {
      hasSubscription: true,
      planName: sub.planName,
      startDate: sub.startDate,
      purchaseDate: sub.startDate,
      expiryDate: sub.endDate,
      daysRemaining: sub.daysRemaining,
      status: sub.status,
      message: sub.statusMessage,
      isExpired: sub.isExpired,
    };
  }

  @Get('admin/subscriptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all customer subscriptions (Admin)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  async getAllSubscriptions(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.subscriptionService.getAllSubscriptions({
      search,
      status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('admin/subscriptions/expiring')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get subscriptions expiring soon (Admin)' })
  @ApiQuery({ name: 'days', required: false, description: 'Default is 10 days' })
  async getExpiringSubscriptions(@Query('days') days?: string) {
    const numDays = days ? parseInt(days, 10) : 10;
    return this.subscriptionService.getExpiringSubscriptions(numDays);
  }

  @Get('admin/subscriptions/expired')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get expired subscriptions (Admin)' })
  async getExpiredSubscriptions() {
    return this.subscriptionService.getExpiredSubscriptions();
  }

  @Post('admin/subscriptions/check-expiry')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Run idempotent daily plan expiry check & notification dispatcher (Admin / Cron)' })
  async runExpiryCheck() {
    return this.subscriptionService.runDailyExpiryCheck();
  }
}

