import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserAdmin, isUserSuperAdmin } from '../../common/utils/role.util';
import { CouponService } from './coupon.service';

@ApiTags('Coupons')
@Controller()
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  private assertCouponAdmin(user: any) {
    if (!isUserSuperAdmin(user) && !isUserAdmin(user)) {
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Get('admin/coupons')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List package coupons' })
  list(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('discountType') discountType?: string,
    @Query('planId') planId?: string,
  ) {
    this.assertCouponAdmin(user);
    return this.couponService.list({ search, status, discountType, planId });
  }

  @Get('admin/coupons/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a package coupon and its redemptions' })
  getOne(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertCouponAdmin(user);
    return this.couponService.getOne(Number(id));
  }

  @Post('admin/coupons')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a package coupon' })
  create(@CurrentUser() user: any, @Body() dto: any) {
    this.assertCouponAdmin(user);
    return this.couponService.create(dto);
  }

  @Patch('admin/coupons/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a package coupon' })
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: any) {
    this.assertCouponAdmin(user);
    return this.couponService.update(Number(id), dto);
  }

  @Patch('admin/coupons/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activate or deactivate a package coupon' })
  setStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    this.assertCouponAdmin(user);
    return this.couponService.setActive(Number(id), body?.isActive !== false);
  }

  @Delete('admin/coupons/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a package coupon and keep redemption history' })
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertCouponAdmin(user);
    return this.couponService.remove(Number(id));
  }

  @Post('subscriptions/apply-coupon')
  @Post('customer/subscriptions/apply-coupon')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate a coupon and return the server-calculated price' })
  async apply(
    @CurrentCustomer() customerIdStr: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() body: any,
  ) {
    const customerId = Number(customerIdStr || req?.customerId || user?.customerId);
    if (!customerId || isNaN(customerId)) {
      throw new ForbiddenException('No customer organization associated with current user');
    }
    const planId = Number(body?.planId ?? body?.packageId);
    const quote = await this.couponService.quote({
      customerId,
      planId,
      couponCode: body?.couponCode,
      billingCycle: body?.billingCycle,
      paymentOption: body?.paymentOption,
    });
    return {
      success: true,
      data: {
        packageId: String(planId),
        planId: String(planId),
        ...quote,
      },
    };
  }
}
