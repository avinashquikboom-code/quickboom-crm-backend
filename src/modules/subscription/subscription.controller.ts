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
  Req,
  Headers,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { PlanAccessService } from './plan-access.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { RoleType } from '@prisma/client';

import { InstallmentService } from './installment.service';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Subscriptions & Plans')
@Controller()
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly planAccessService: PlanAccessService,
    private readonly installmentService: InstallmentService,
  ) {}

  // ==========================================
  // Advance Payment & Installment Endpoints
  // ==========================================

  @Get('subscriptions/installments')
  @Get('customer/installments')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current customer installment schedule and outstanding balance' })
  async getMyInstallments(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Headers('x-customer-id') headerCustomerId?: string,
  ) {
    const rawCustId =
      customerIdStr ??
      req?.customerId ??
      user?.customerId ??
      headerCustomerId ??
      req?.headers?.['x-customer-id'];

    const customerId = rawCustId ? Number(String(rawCustId).replace(/[^0-9]/g, '')) : null;
    if (!customerId || isNaN(customerId)) {
      return {
        success: false,
        message: 'No customer organization associated with current user',
      };
    }
    const summary = await this.installmentService.getCustomerInstallmentSummary(customerId);
    return {
      success: true,
      data: summary,
    };
  }

  @Post('subscriptions/installments/:id/pay')
  @Post('customer/installments/:id/pay')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pay or renew an installment for authenticated customer' })
  async payMyInstallment(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: { paymentMethod?: string; transactionId?: string; orderId?: string },
  ) {
    const customerId = user?.customerId;
    if (!customerId) {
      throw new ForbiddenException('No customer organization associated with current user');
    }
    return this.installmentService.payInstallment(customerId, id, {
      paymentMethod: dto.paymentMethod,
      transactionId: dto.transactionId,
      orderId: dto.orderId,
    });
  }

  @Get('admin/customers/:customerId/installments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get installment breakdown for specific customer (Admin)' })
  async getAdminCustomerInstallments(
    @CurrentUser() user: any,
    @Param('customerId') custId: string,
  ) {
    if (!isUserSuperAdmin(user) && user?.customerId !== Number(custId)) {
      throw new ForbiddenException('Admin permissions required');
    }
    const summary = await this.installmentService.getCustomerInstallmentSummary(custId);
    return {
      success: true,
      data: summary,
    };
  }

  @Post('admin/customers/:customerId/installments/:id/pay')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record manual installment payment for customer (Admin)' })
  async recordAdminInstallmentPayment(
    @CurrentUser() user: any,
    @Param('customerId') custId: string,
    @Param('id') id: string,
    @Body() dto: { paymentMethod?: string; transactionId?: string; orderId?: string; notes?: string },
  ) {
    if (!isUserSuperAdmin(user)) {
      throw new ForbiddenException('Super Admin permissions required');
    }
    return this.installmentService.payInstallment(custId, id, {
      paymentMethod: dto.paymentMethod || 'CASH',
      transactionId: dto.transactionId,
      orderId: dto.orderId,
      paidByAdmin: true,
      notes: dto.notes || 'Admin manual payment confirmation',
    });
  }

  @Get('subscriptions/current')
  @Get('customer/subscriptions/current')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current customer subscription and installment status' })
  async getCurrentSubscription(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Headers('x-customer-id') headerCustomerId?: string,
  ) {
    const rawCustId =
      customerIdStr ??
      req?.customerId ??
      user?.customerId ??
      headerCustomerId ??
      req?.headers?.['x-customer-id'];

    const customerId = rawCustId ? Number(String(rawCustId).replace(/[^0-9]/g, '')) : null;
    if (!customerId || isNaN(customerId)) {
      throw new ForbiddenException('No customer organization associated with current user');
    }
    return this.installmentService.getCurrentSubscription(customerId);
  }

  @Get('subscriptions/renewal-status')
  @Get('customer/subscriptions/renewal-status')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get installment renewal status' })
  async getRenewalStatus(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Headers('x-customer-id') headerCustomerId?: string,
  ) {
    const rawCustId =
      customerIdStr ??
      req?.customerId ??
      user?.customerId ??
      headerCustomerId ??
      req?.headers?.['x-customer-id'];

    const customerId = rawCustId ? Number(String(rawCustId).replace(/[^0-9]/g, '')) : null;
    if (!customerId || isNaN(customerId)) {
      throw new ForbiddenException('No customer organization associated with current user');
    }
    return this.installmentService.getRenewalStatus(customerId);
  }

  @Post('subscriptions/:subscriptionId/renew')
  @Post('customer/subscriptions/:subscriptionId/renew')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pay or renew existing installment' })
  async renewExistingInstallment(
    @CurrentUser() user: any,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: { installmentId: number | string; paymentMethod?: string },
  ) {
    const customerId = user?.customerId;
    if (!customerId) {
      throw new ForbiddenException('No customer organization associated with current user');
    }
    return this.installmentService.renewExistingInstallment(customerId, subscriptionId, dto);
  }

  @Post('subscriptions/new-plan')
  @Post('customer/subscriptions/new-plan')
  @Post('subscriptions/start-new-plan')
  @Post('customer/start-new-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start a completely new plan (full price) when prior renewal has failed' })
  async startNewPlanCustomer(
    @CurrentUser() user: any,
    @Body() dto: {
      planId?: number | string;
      billingCycle?: string;
      customPrice?: number;
      totalInstallments?: number;
      paymentMethod?: string;
      transactionId?: string;
      orderNumber?: string;
    },
  ) {
    const customerId = user?.customerId;
    if (!customerId) {
      throw new ForbiddenException('No customer organization associated with current user');
    }
    const result = await this.installmentService.startNewPlan(customerId, {
      ...dto,
      planId: dto.planId ? Number(dto.planId) : undefined,
    });

    return {
      success: true,
      message: 'New plan created successfully.',
      data: {
        subscriptionId: String(result.newSubscriptionId),
        planId: String(result.summary.planId),
        planName: result.summary.planName,
        planValue: result.summary.originalPlanValue,
        status: result.summary.planStatus,
        startDate: new Date().toISOString(),
        expiryDate: result.summary.nextDueDate
          ? new Date(result.summary.nextDueDate).toISOString()
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    };
  }

  @Post('admin/customers/:customerId/start-new-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start a completely new plan for customer (Admin)' })
  async startNewPlanAdmin(
    @CurrentUser() user: any,
    @Param('customerId') custId: string,
    @Body() dto: {
      planId?: number;
      billingCycle?: string;
      customPrice?: number;
      totalInstallments?: number;
      paymentMethod?: string;
      transactionId?: string;
      orderNumber?: string;
    },
  ) {
    if (!isUserSuperAdmin(user)) {
      throw new ForbiddenException('Super Admin permissions required');
    }
    return this.installmentService.startNewPlan(custId, {
      ...dto,
      paymentMethod: dto.paymentMethod || 'CASH',
    });
  }

  @Post('admin/installments/evaluate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Evaluate installment expiry across all active installments (Admin / Cron)' })
  async evaluateInstallmentBuffers(@CurrentUser() user: any) {
    if (!isUserSuperAdmin(user)) {
      throw new ForbiddenException('Super Admin permissions required');
    }
    return this.installmentService.evaluateAllActiveInstallments();
  }

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
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active effective plan and usage for authenticated customer' })
  async getEffectivePlan(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const customerId = customerIdStr || req?.customerId || user?.customerId;
    if (!customerId) {
      return {
        success: true,
        data: null,
        message: 'No customer organization associated with current user',
      };
    }
    try {
      const plan = await this.planAccessService.getEffectivePlan(customerId);
      const upcomingPlan = plan?.upcomingPlan || null;
      const isCurrentActive = Boolean(plan && (plan.isActive || plan.status === 'ACTIVE') && plan.subscriptionId);

      const currentPlanData = isCurrentActive
        ? {
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
          }
        : null;

      return {
        success: true,
        data: currentPlanData,
        currentPlan: currentPlanData,
        upcomingPlan,
        effectivePlan: currentPlanData,
        message: currentPlanData
          ? undefined
          : upcomingPlan
          ? 'Upcoming plan scheduled'
          : 'No active subscription found',
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
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get purchase and order history for authenticated customer' })
  async getCustomerOrders(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const customerId = customerIdStr || req?.customerId || user?.customerId;
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

  // ==========================================
  // Customer Subscription Lifecycle (Admin)
  // ==========================================

  @Get('admin/customers/:customerId/subscriptions')
  @Get('admin/customers/:customerId/subscriptions/history')
  @Get('customers/:customerId/subscriptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all customer subscriptions (current & history) for Admin' })
  async getAdminCustomerSubscriptions(@Param('customerId') customerId: string) {
    return this.subscriptionService.getAdminCustomerSubscriptions(customerId);
  }

  @Get('admin/customers/:customerId/subscriptions/current')
  @Get('customers/:customerId/subscriptions/current')
  @Get('admin/customers/:customerId/subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current customer subscription for Admin' })
  async getAdminCustomerCurrentSubscription(@Param('customerId') customerId: string) {
    const res = await this.subscriptionService.getAdminCustomerSubscriptions(customerId);
    return {
      success: true,
      data: res.currentSubscription,
    };
  }

  @Post('admin/customers/:customerId/subscriptions')
  @Post('admin/customers/:customerId/subscription')
  @Post('customers/:customerId/subscriptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually create/activate a plan subscription for a customer (Admin)' })
  async createAdminCustomerSubscription(
    @Param('customerId') customerId: string,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.subscriptionService.createOrActivateCustomerSubscription(
      customerId,
      dto,
      user?.id,
    );
  }

  @Post('admin/subscriptions/:subscriptionId/activate')
  @Patch('admin/subscriptions/:subscriptionId/activate')
  @Post('subscriptions/:subscriptionId/activate')
  @Patch('subscriptions/:subscriptionId/activate')
  @Post('admin/subscriptions/:id/activate')
  @Patch('admin/subscriptions/:id/activate')
  @Post('subscriptions/:id/activate')
  @Patch('subscriptions/:id/activate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activate a customer subscription (Admin)' })
  async activateSubscription(
    @Param() params: any,
    @CurrentUser() user: any,
  ) {
    const subscriptionId = params.subscriptionId || params.id;
    return this.subscriptionService.activateCustomerSubscription(subscriptionId, user?.id);
  }

  @Post('admin/subscriptions/:subscriptionId/deactivate')
  @Patch('admin/subscriptions/:subscriptionId/deactivate')
  @Post('subscriptions/:subscriptionId/deactivate')
  @Patch('subscriptions/:subscriptionId/deactivate')
  @Post('admin/subscriptions/:id/deactivate')
  @Patch('admin/subscriptions/:id/deactivate')
  @Post('subscriptions/:id/deactivate')
  @Patch('subscriptions/:id/deactivate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate a customer subscription (Admin)' })
  async deactivateSubscription(
    @Param() params: any,
    @CurrentUser() user: any,
  ) {
    const subscriptionId = params.subscriptionId || params.id;
    return this.subscriptionService.deactivateCustomerSubscription(subscriptionId, user?.id);
  }

  @Post('admin/subscriptions/:subscriptionId/change-plan')
  @Patch('admin/subscriptions/:subscriptionId/change-plan')
  @Post('subscriptions/:subscriptionId/change-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change customer subscription plan (Admin)' })
  async changeSubscriptionPlan(
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.subscriptionService.changeCustomerPlan(subscriptionId, dto, user?.id);
  }

  @Post('admin/subscriptions/:subscriptionId/renew')
  @Patch('admin/subscriptions/:subscriptionId/renew')
  @Post('subscriptions/:subscriptionId/renew')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Renew a customer subscription (Admin)' })
  async renewSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.subscriptionService.renewCustomerSubscription(subscriptionId, dto, user?.id);
  }

  @Post([
    'admin/subscriptions/bulk-delete',
    'subscriptions/bulk-delete',
    'admin/subscriptions/bulk',
    'subscriptions/bulk',
  ])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk soft-delete customer subscriptions (Admin) via POST' })
  async bulkDeleteSubscriptions(
    @Body() dto: { ids?: (number | string)[]; subscriptionIds?: (number | string)[] },
    @Query('ids') queryIds: string | string[],
    @CurrentUser() user: any,
  ) {
    let ids = dto?.ids || dto?.subscriptionIds;
    if ((!ids || !Array.isArray(ids) || ids.length === 0) && queryIds) {
      if (Array.isArray(queryIds)) {
        ids = queryIds;
      } else if (typeof queryIds === 'string') {
        ids = queryIds.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return this.subscriptionService.bulkDeleteCustomerSubscriptions(ids as any, user);
  }

  @Delete([
    'admin/subscriptions/bulk',
    'subscriptions/bulk',
    'admin/subscriptions/bulk-delete',
    'subscriptions/bulk-delete',
  ])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk soft-delete customer subscriptions (Admin) via DELETE' })
  async bulkDeleteSubscriptionsViaDelete(
    @Body() dto: { ids?: (number | string)[]; subscriptionIds?: (number | string)[] },
    @Query('ids') queryIds: string | string[],
    @CurrentUser() user: any,
  ) {
    let ids = dto?.ids || dto?.subscriptionIds;
    if ((!ids || !Array.isArray(ids) || ids.length === 0) && queryIds) {
      if (Array.isArray(queryIds)) {
        ids = queryIds;
      } else if (typeof queryIds === 'string') {
        ids = queryIds.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return this.subscriptionService.bulkDeleteCustomerSubscriptions(ids as any, user);
  }

  @Delete(['admin/subscriptions/:subscriptionId', 'subscriptions/:subscriptionId'])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a customer subscription (Admin)' })
  async deleteSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser() user: any,
  ) {
    return this.subscriptionService.deleteCustomerSubscription(subscriptionId, user);
  }

  // ==========================================
  // Offline Payment Requests (Admin)
  // ==========================================

  @Get([
    'admin/subscriptions/offline-requests',
    'admin/offline-requests',
    'admin/payments/offline-requests',
  ])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all offline payment requests for Admin review' })
  async getAdminOfflinePaymentRequests(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.subscriptionService.getAdminOfflinePaymentRequests({
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Post([
    'admin/subscriptions/offline-requests/:id/approve',
    'admin/offline-requests/:id/approve',
    'admin/payments/offline-requests/:id/approve',
  ])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve an offline payment request and activate subscription' })
  async approveOfflinePaymentRequest(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.subscriptionService.approveOfflinePaymentRequest(id, user?.id);
  }

  @Post([
    'admin/subscriptions/offline-requests/:id/reject',
    'admin/offline-requests/:id/reject',
    'admin/payments/offline-requests/:id/reject',
  ])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject an offline payment request' })
  async rejectOfflinePaymentRequest(
    @Param('id') id: string,
    @Body() dto: { reason?: string },
    @CurrentUser() user: any,
  ) {
    return this.subscriptionService.rejectOfflinePaymentRequest(id, user?.id, dto?.reason);
  }

  @Post([
    'admin/subscriptions/offline-requests/bulk-delete',
    'admin/offline-requests/bulk-delete',
    'admin/payments/offline-requests/bulk-delete',
    'admin/subscriptions/offline-requests/bulk',
    'admin/offline-requests/bulk',
    'admin/payments/offline-requests/bulk',
  ])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk delete offline payment requests (Admin/Super Admin) via POST' })
  async bulkDeleteOfflinePaymentRequests(
    @Body() dto: { ids?: (number | string)[]; requestIds?: (number | string)[] },
    @Query('ids') queryIds: string | string[],
    @CurrentUser() user: any,
  ) {
    let ids = dto?.ids || dto?.requestIds;
    if ((!ids || !Array.isArray(ids) || ids.length === 0) && queryIds) {
      if (Array.isArray(queryIds)) {
        ids = queryIds;
      } else if (typeof queryIds === 'string') {
        ids = queryIds.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return this.subscriptionService.bulkDeleteOfflinePaymentRequests(ids || [], user);
  }

  @Delete([
    'admin/subscriptions/offline-requests/bulk',
    'admin/offline-requests/bulk',
    'admin/payments/offline-requests/bulk',
    'admin/subscriptions/offline-requests/bulk-delete',
    'admin/offline-requests/bulk-delete',
    'admin/payments/offline-requests/bulk-delete',
  ])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk delete offline payment requests (Admin/Super Admin) via DELETE' })
  async bulkDeleteOfflinePaymentRequestsViaDelete(
    @Body() dto: { ids?: (number | string)[]; requestIds?: (number | string)[] },
    @Query('ids') queryIds: string | string[],
    @CurrentUser() user: any,
  ) {
    let ids = dto?.ids || dto?.requestIds;
    if ((!ids || !Array.isArray(ids) || ids.length === 0) && queryIds) {
      if (Array.isArray(queryIds)) {
        ids = queryIds;
      } else if (typeof queryIds === 'string') {
        ids = queryIds.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return this.subscriptionService.bulkDeleteOfflinePaymentRequests(ids || [], user);
  }

  @Delete([
    'admin/subscriptions/offline-requests/:id',
    'admin/offline-requests/:id',
    'admin/payments/offline-requests/:id',
  ])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a single offline payment request (Admin/Super Admin)' })
  async deleteOfflinePaymentRequest(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.subscriptionService.deleteOfflinePaymentRequest(id, user);
  }
}


