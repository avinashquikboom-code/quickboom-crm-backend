import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CustomPlanService, parseCustomPlanOrderId } from './custom-plan.service';
import {
  CreateCustomPlanOptionDto,
  UpdateCustomPlanOptionDto,
  PreviewCustomPlanDto,
  CreateCustomPlanDto,
  VerifyCustomPlanPaymentDto,
} from './dto/custom-plan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Custom Plan Builder')
@Controller()
export class CustomPlanController {
  constructor(private readonly customPlanService: CustomPlanService) {}

  // ==========================================
  // CUSTOMER FACING ENDPOINTS
  // ==========================================

  @Get('custom-plan/services')
  @Get('custom-plan/options')
  @ApiOperation({ summary: 'Get all available configurable services and live pricing for Custom Plan builder' })
  async getAvailableServices() {
    return this.customPlanService.getAvailableOptions();
  }

  @Post('custom-plan/quote')
  @Post('custom-plan/preview')
  @ApiOperation({ summary: 'Calculate custom plan price breakdown & subtotal from database' })
  async previewCustomPlan(@Body() dto: PreviewCustomPlanDto) {
    const selections = dto.featureSelections || dto.items || [];
    const durationParam = dto.duration || dto.billingCycle || 1;
    return this.customPlanService.calculateCustomPlanPrice(selections, durationParam);
  }

  @Post('custom-plan/create-order')
  @Post('custom-plan/orders')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create custom plan order and Razorpay order' })
  async createCustomPlanOrder(
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: CreateCustomPlanDto,
  ) {
    const customerId = req?.customerId || user?.customerId;
    return this.customPlanService.createCustomPlanOrder(customerId, dto);
  }

  @Post('custom-plan/verify')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify Razorpay payment and activate custom plan subscription' })
  async verifyCustomPlanPayment(
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: VerifyCustomPlanPaymentDto,
    @Query('orderId') orderIdQuery?: string,
  ) {
    const customerId = req?.customerId || user?.customerId;
    const parsedOrderId = parseCustomPlanOrderId(
      dto.customPlanOrderId ?? dto.quoteId ?? dto.orderId ?? orderIdQuery,
    );
    if (parsedOrderId == null) {
      throw new BadRequestException(
        'Invalid Custom Plan order ID. Unable to verify payment.',
      );
    }
    return this.customPlanService.verifyAndActivateCustomPlan(customerId, parsedOrderId, dto);
  }

  @Get('custom-plan/history')
  @Get('customer/custom-plans')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated customer custom plan purchase history' })
  async getCustomerCustomPlans(@CurrentUser() user: any, @Req() req: any) {
    const customerId = req?.customerId || user?.customerId;
    return this.customPlanService.getCustomerCustomPlans(customerId);
  }

  // ==========================================
  // ADMIN CONFIGURATION & MANAGEMENT ENDPOINTS
  // ==========================================

  @Get('admin/custom-plan/options')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all custom plan options (Admin)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  async getAdminOptions(
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.customPlanService.getAdminOptions({ search, category });
  }

  @Post('admin/custom-plan/options')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new custom plan option (Admin)' })
  async createOption(@Body() dto: CreateCustomPlanOptionDto) {
    return this.customPlanService.createOption(dto);
  }

  @Patch('admin/custom-plan/options/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update custom plan option (Admin)' })
  async updateOption(
    @Param('id') id: string,
    @Body() dto: UpdateCustomPlanOptionDto,
  ) {
    return this.customPlanService.updateOption(id, dto);
  }

  @Delete('admin/custom-plan/options/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete or archive custom plan option (Admin)' })
  async deleteOption(@Param('id') id: string) {
    return this.customPlanService.deleteOption(id);
  }

  @Get('admin/custom-plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all custom plan orders (Admin)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getAdminCustomPlans(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customPlanService.getAdminCustomPlans({
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('admin/custom-plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get custom plan order details (Admin)' })
  async getAdminCustomPlanById(@Param('id') id: string) {
    return this.customPlanService.getAdminCustomPlanById(id);
  }
}
