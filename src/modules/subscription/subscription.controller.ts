import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoleType } from '@prisma/client';

@ApiTags('Subscriptions & Plans')
@Controller()
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly planAccessService: PlanAccessService,
  ) {}

  // ==========================================
  // Public & Customer Plan Endpoints
  // ==========================================

  @Get('plans')
  @Get('customer/plans')
  @ApiOperation({ summary: 'Get all active subscription plans (Customer & Public)' })
  async getPlans() {
    return this.subscriptionService.getPlans(false);
  }

  @Get('plans/:id')
  @Get('customer/plans/:id')
  @ApiOperation({ summary: 'Get single plan details (Customer & Public)' })
  async getPlanById(@Param('id') id: string) {
    return this.subscriptionService.getPlanById(id);
  }

  @Get('subscriptions/effective-plan')
  @Get('customer/subscription')
  @Get('customer/usage')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active effective plan and usage for authenticated customer' })
  async getEffectivePlan(@CurrentUser() user: any) {
    const customerId = user?.customerId;
    if (!customerId) {
      return {
        success: true,
        data: null,
        message: 'No customer organization associated with current user',
      };
    }
    try {
      const plan = await this.planAccessService.getEffectivePlan(customerId);
      if (!plan || !plan.isActive || !plan.subscriptionId) {
        return {
          success: true,
          data: null,
          effectivePlan: null,
          message: 'No active subscription found',
        };
      }
      return {
        success: true,
        data: {
          id: plan.planId,
          subscriptionId: plan.subscriptionId,
          name: plan.planName,
          code: plan.planCode,
          billingCycle: plan.billingCycle,
          price: plan.price,
          startDate: plan.startDate,
          endDate: plan.endDate,
          expiryDate: plan.endDate,
          isActive: plan.isActive,
          isExpired: plan.isExpired,
          remainingDays: Math.max(0, Math.ceil((new Date(plan.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
          usedDays: Math.max(0, Math.floor((Date.now() - new Date(plan.startDate).getTime()) / (1000 * 60 * 60 * 24))),
          totalDays: Math.max(1, Math.round((new Date(plan.endDate).getTime() - new Date(plan.startDate).getTime()) / (1000 * 60 * 60 * 24))),
          features: Array.isArray(plan.features) ? plan.features : [],
          quotas: {
            userLimit: plan.userLimit,
            leadLimit: plan.leadLimit,
            storageLimitBytes: Number(plan.storageLimitBytes),
            scheduleLimit: plan.scheduleLimit,
            usedSchedules: plan.usedSchedules,
            remainingSchedules: plan.remainingSchedules,
          },
          services: plan.services || [],
          usage: {
            currentUsers: plan.usage?.currentUsers || 0,
            currentLeads: plan.usage?.currentLeads || 0,
            currentStorageBytes: Number(plan.usage?.currentStorageBytes || 0),
            scheduledWorks: plan.usage?.scheduledWorks || 0,
          },
        },
      };
    } catch (err: any) {
      return {
        success: true,
        data: null,
        effectivePlan: null,
        message: err?.message || 'No active subscription found',
      };
    }
  }

  @Get('subscriptions/orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get purchase and order history for authenticated customer' })
  async getCustomerOrders(@CurrentUser() user: any) {
    const customerId = user?.customerId;
    if (!customerId) {
      return { success: true, data: [] };
    }
    return this.subscriptionService.getCustomerOrders(customerId);
  }

  // ==========================================
  // Admin Plan Management Endpoints
  // ==========================================

  @Get('admin/plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all subscription plans including inactive (Admin)' })
  async getAdminPlans() {
    return this.subscriptionService.getPlans(true);
  }

  @Get('admin/subscription-plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all subscription plans for Admin (Alias)' })
  async getAdminSubscriptionPlans() {
    return this.subscriptionService.getPlans(true);
  }

  @Get('admin/plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get plan by ID (Admin)' })
  async getAdminPlanById(@Param('id') id: string) {
    return this.subscriptionService.getPlanById(id);
  }

  @Get('admin/subscription-plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get plan by ID (Admin Alias)' })
  async getAdminSubscriptionPlanById(@Param('id') id: string) {
    return this.subscriptionService.getPlanById(id);
  }

  @Post('admin/plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new subscription plan (Admin)' })
  async createPlanAdmin(@Body() dto: any) {
    return this.subscriptionService.createPlan(dto);
  }

  @Post('admin/subscription-plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new subscription plan (Admin Alias)' })
  async createSubscriptionPlanAdmin(@Body() dto: any) {
    return this.subscriptionService.createPlan(dto);
  }

  @Put('admin/plans/:id')
  @Patch('admin/plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update existing subscription plan (Admin)' })
  async updatePlanAdmin(@Param('id') id: string, @Body() dto: any) {
    return this.subscriptionService.updatePlan(id, dto);
  }

  @Put('admin/subscription-plans/:id')
  @Patch('admin/subscription-plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update existing subscription plan (Admin Alias)' })
  async updateSubscriptionPlanAdmin(@Param('id') id: string, @Body() dto: any) {
    return this.subscriptionService.updatePlan(id, dto);
  }

  @Patch('admin/plans/:id/status')
  @Patch('admin/subscription-plans/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle plan active status (Admin)' })
  async updatePlanStatusAdmin(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.subscriptionService.updatePlanStatus(id, body.isActive);
  }

  @Delete('admin/plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate subscription plan (Admin)' })
  async deletePlanAdmin(@Param('id') id: string) {
    return this.subscriptionService.deletePlan(id);
  }

  @Delete('admin/subscription-plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate subscription plan (Admin Alias)' })
  async deleteSubscriptionPlanAdmin(@Param('id') id: string) {
    return this.subscriptionService.deletePlan(id);
  }

  // Feature endpoints
  @Get('admin/plans/:id/features')
  @Get('admin/subscription-plans/:id/features')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get features for a plan (Admin)' })
  async getPlanFeatures(@Param('id') id: string) {
    return this.subscriptionService.getPlanFeatures(id);
  }

  @Post('admin/plans/:id/features')
  @Post('admin/subscription-plans/:id/features')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add feature to plan (Admin)' })
  async addPlanFeature(@Param('id') id: string, @Body() body: { feature: string }) {
    return this.subscriptionService.addPlanFeature(id, body.feature);
  }

  @Put('admin/plans/:id/features/:featureId')
  @Put('admin/subscription-plans/:id/features/:featureId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update feature in plan (Admin)' })
  async updatePlanFeature(
    @Param('id') id: string,
    @Param('featureId') featureId: string,
    @Body() body: { feature: string },
  ) {
    return this.subscriptionService.updatePlanFeature(id, Number(featureId), body.feature);
  }

  @Delete('admin/plans/:id/features/:featureId')
  @Delete('admin/subscription-plans/:id/features/:featureId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete feature from plan (Admin)' })
  async deletePlanFeature(
    @Param('id') id: string,
    @Param('featureId') featureId: string,
  ) {
    return this.subscriptionService.deletePlanFeature(id, Number(featureId));
  }

  @Post('plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new subscription plan' })
  async createPlan(@Body() dto: any) {
    return this.subscriptionService.createPlan(dto);
  }

  @Put('plans/:id')
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

