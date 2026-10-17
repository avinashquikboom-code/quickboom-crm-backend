import { GoneException } from '@nestjs/common';
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
  Res,
  Headers,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { generateAgreementPdfBuffer } from '../../common/utils/agreement-pdf.util';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { PlanAccessService } from './plan-access.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { RoleType,  } from '@prisma/client';

import { InstallmentService } from './installment.service';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Subscriptions & Plans')
@Controller()
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly planAccessService: PlanAccessService,
    private readonly installmentService: InstallmentService,
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================
  // Advance Payment & Installment Endpoints
  // ==========================================

  @Get('subscriptions/installments')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current customer installment schedule and outstanding balance' })
  async getMyInstallments(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Headers('x-customer-id') headerCustomerId?: string,
  ) { throw new GoneException('Customer subscriptions have been removed'); }

  @Post('subscriptions/installments/:id/pay')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pay or renew an installment for authenticated customer' })
  async payMyInstallment(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: { paymentMethod?: string; transactionId?: string; orderId?: string },
  ) { throw new GoneException('Customer subscriptions have been removed'); }

  @Get('subscriptions/current')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current customer subscription and installment status' })
  async getCurrentSubscription(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Headers('x-customer-id') headerCustomerId?: string,
  ) { throw new GoneException('Customer subscriptions have been removed'); }

  @Get('subscriptions/renewal-status')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get installment renewal status' })
  async getRenewalStatus(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Headers('x-customer-id') headerCustomerId?: string,
  ) { throw new GoneException('Customer subscriptions have been removed'); }

  @Post('subscriptions/:subscriptionId/renew')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pay or renew existing installment' })
  async renewExistingInstallment(
    @CurrentUser() user: any,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: { installmentId: number | string; paymentMethod?: string },
  ) { throw new GoneException('Customer subscriptions have been removed'); }

  @Post('subscriptions/new-plan')
  @Post('subscriptions/start-new-plan')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_PLANS', action: 'CREATE' })
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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  @ApiOperation({ summary: 'Get all active subscription plans (Customer & Public)' })
  async getPlans() {
    return this.subscriptionService.getPlans(false);
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get single plan details (Customer & Public)' })
  async getPlanById(@Param('id') id: string) {
    return this.subscriptionService.getPlanById(id);
  }

  @Get('subscriptions/effective-plan')
  @UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_PLANS', action: 'VIEW' })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active effective plan and usage for authenticated customer' })
  async getEffectivePlan(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) { throw new GoneException('Customer subscriptions have been removed'); }

  @Get('subscriptions/orders')
  @UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
  @RequirePermissions({ module: 'CUSTOMER_ORDERS', action: 'VIEW' })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get purchase and order history for authenticated customer' })
  async getCustomerOrders(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) { throw new GoneException('Customer subscriptions have been removed'); }

  @Get('subscriptions/orders/:paymentId/agreement/download')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Download Service Agreement PDF for a paid order' })
  async downloadOrderAgreement(
    @Param('paymentId') paymentId: string,
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Res() res: Response,
  ) : Promise<never> {
throw new GoneException('Customer subscriptions and Lead functionality have been removed');
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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

  @Get('admin/subscriptions/expiring')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get subscriptions expiring soon (Admin)' })
  @ApiQuery({ name: 'days', required: false, description: 'Default is 10 days' })
  async getExpiringSubscriptions(@Query('days') days?: string) { throw new GoneException('Customer subscriptions have been removed'); }

  @Get('admin/subscriptions/expired')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get expired subscriptions (Admin)' })
  async getExpiredSubscriptions() { throw new GoneException('Customer subscriptions have been removed'); }

  @Post('admin/subscriptions/check-expiry')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Run idempotent daily plan expiry check & notification dispatcher (Admin / Cron)' })
  async runExpiryCheck() {
    return this.subscriptionService.runDailyExpiryCheck();
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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

  @Delete(['admin/subscriptions/:subscriptionId', 'subscriptions/:subscriptionId'])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a customer subscription (Admin)' })
  async deleteSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser() user: any,
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }

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
  ) { throw new GoneException('Customer subscriptions have been removed'); }
}


