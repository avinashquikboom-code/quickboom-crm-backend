import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { CreateOrderDto, RenewSubscriptionDto } from './dto/subscription.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@ApiTags('Subscriptions & Plans')
@Controller('api/v1')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Get all available subscription plans with monthly and yearly pricing' })
  async getPlans() {
    return this.subscriptionService.getPlans();
  }

  @Get('subscriptions/current')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current tenant subscription status' })
  async getCurrentSubscription(@CurrentTenant() tenantId: string) {
    return this.subscriptionService.getCurrentSubscription(tenantId);
  }

  @Get('subscriptions/orders')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tenant purchase and order history' })
  async getTenantOrders(@CurrentTenant() tenantId: string) {
    return this.subscriptionService.getTenantOrders(tenantId);
  }

  @Post('subscriptions/order')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new plan subscription order' })
  async createOrder(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.subscriptionService.createOrder(tenantId, dto);
  }

  @Post('subscriptions/renew')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Renew current tenant subscription' })
  async renewSubscription(
    @CurrentTenant() tenantId: string,
    @Body() dto: RenewSubscriptionDto,
  ) {
    return this.subscriptionService.renewSubscription(tenantId, dto);
  }
}
