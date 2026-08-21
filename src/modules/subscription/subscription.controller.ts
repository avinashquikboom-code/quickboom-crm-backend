import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { CreateOrderDto, RenewSubscriptionDto } from './dto/subscription.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Subscriptions & Plans')
@Controller()
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

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
