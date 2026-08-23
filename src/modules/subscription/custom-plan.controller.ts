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
import { CustomPlanService } from './custom-plan.service';
import {
  PreviewCustomPlanDto,
  CreateCustomPlanDto,
  VerifyCustomPlanPaymentDto,
  CreateCustomPlanOptionDto,
  UpdateCustomPlanOptionDto,
} from './dto/custom-plan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Custom Plan Builder')
@Controller()
export class CustomPlanController {
  constructor(private readonly customPlanService: CustomPlanService) {}

  // ==========================================
  // CUSTOMER MOBILE / WEB ENDPOINTS
  // ==========================================

  @Get('customer/custom-plan/options')
  @ApiOperation({ summary: 'Get active configurable plan options for mobile builder' })
  async getAvailableOptions() {
    const data = await this.customPlanService.getAvailableOptions();
    return {
      success: true,
      data,
    };
  }

  @Post('customer/custom-plans/preview')
  @ApiOperation({ summary: 'Calculate live custom plan price breakdown (Subtotal, Discount, Tax, Total)' })
  async previewPrice(@Body() dto: PreviewCustomPlanDto) {
    const data = await this.customPlanService.calculateCustomPlanPrice(
      dto.featureSelections,
      dto.duration,
    );
    return {
      success: true,
      data,
    };
  }

  @Post('customer/custom-plans')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create custom plan order and initiate checkout' })
  async createCustomPlan(
    @CurrentCustomer() customerId: string,
    @Body() dto: CreateCustomPlanDto,
  ) {
    return this.customPlanService.createCustomPlanOrder(customerId, dto);
  }

  @Get('customer/custom-plans')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current customer custom plan order history' })
  async getCustomerCustomPlans(@CurrentCustomer() customerId: string) {
    const data = await this.customPlanService.getCustomerCustomPlans(customerId);
    return {
      success: true,
      data,
    };
  }

  @Post('customer/custom-plans/:id/payment')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify payment and activate custom plan with anchor dates & schedules' })
  async verifyPayment(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() paymentDto: VerifyCustomPlanPaymentDto,
  ) {
    return this.customPlanService.verifyAndActivateCustomPlan(customerId, id, paymentDto);
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
