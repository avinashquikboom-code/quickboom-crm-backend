import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import {
  CreateRazorpayOrderDto,
  VerifyRazorpayPaymentDto,
  SendPaymentReminderDto,
} from './dto/payment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Payments & Razorpay')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('config')
  @Get('settings')
  @ApiOperation({ summary: 'Get dynamic public payment configuration from database (single source of truth)' })
  async getPaymentConfig() {
    return this.paymentService.getPublicPaymentConfig();
  }

  @Post('razorpay/order')
  @Post('create-order')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Razorpay Order for customer plan purchase' })
  async createRazorpayOrder(
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: CreateRazorpayOrderDto,
  ) {
    const customerId = req?.customerId || user?.customerId;
    return this.paymentService.createRazorpayOrder(user, dto, customerId);
  }

  @Post('razorpay/verify')
  @Post('verify')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify Razorpay payment signature & activate subscription with schedules' })
  async verifyRazorpayPayment(
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: VerifyRazorpayPaymentDto,
  ) {
    const customerId = req?.customerId || user?.customerId;
    return this.paymentService.verifyRazorpayPayment(user, dto, customerId);
  }

  @Post('offline/order')
  @Post('offline/request')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create offline payment request (Bank Transfer / Cash) pending Admin approval' })
  async createOfflinePayment(
    @CurrentUser() user: any,
    @Req() req: any,
    @Body() dto: any,
  ) {
    const customerId = req?.customerId || user?.customerId;
    return this.paymentService.createOfflinePayment(user, dto, customerId);
  }

  @Post('razorpay/webhook')
  @ApiOperation({ summary: 'Razorpay webhook handler for server-to-server payment updates' })
  async handleWebhook(
    @Req() req: any,
    @Headers('x-razorpay-signature') signature: string,
    @Body() body: any,
  ) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    return this.paymentService.handleWebhook(rawBody, signature);
  }

  @Get('history')
  @Get('orders')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated customer purchase and payment transaction history' })
  async getPaymentHistory(@CurrentUser() user: any, @Req() req: any) {
    const customerId = req?.customerId || user?.customerId;
    return this.paymentService.getPaymentHistory(user, customerId);
  }

  @Post('remind')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send payment reminder notification to customer with remaining balance' })
  async sendPaymentReminder(@CurrentUser() user: any, @Body() dto: SendPaymentReminderDto) {
    return this.paymentService.sendPaymentReminder(user, dto);
  }
}

