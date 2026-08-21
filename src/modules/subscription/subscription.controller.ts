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
  @ApiOperation({ summary: 'Get all available subscription plans with monthly and yearly pricing' })
  async getPlans() {
    return this.subscriptionService.getPlans();
  }

  @Post('plans')
  @ApiOperation({ summary: 'Create new subscription plan' })
  async createPlan(@Body() dto: any) {
    return this.subscriptionService.createPlan(dto);
  }

  @Patch('plans/:id')
  @ApiOperation({ summary: 'Update existing subscription plan' })
  async updatePlan(@Param('id') id: string, @Body() dto: any) {
    return this.subscriptionService.updatePlan(id, dto);
  }

  @Delete('plans/:id')
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

  @Post('subscriptions/renew')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Renew current customer subscription' })
  async renewSubscription(
    @CurrentCustomer() customerId: string,
    @Body() dto: RenewSubscriptionDto,
  ) {
    return this.subscriptionService.renewSubscription(customerId, dto);
  }
}
