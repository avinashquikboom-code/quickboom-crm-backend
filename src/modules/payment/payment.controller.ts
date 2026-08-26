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
} from './dto/payment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Payments & Razorpay')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('razorpay/order')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Razorpay Order for customer plan purchase' })
  async createRazorpayOrder(
    @CurrentUser() user: any,
    @Body() dto: CreateRazorpayOrderDto,
  ) {
    return this.paymentService.createRazorpayOrder(user, dto);
  }

  @Post('razorpay/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify Razorpay payment signature & activate subscription with schedules' })
  async verifyRazorpayPayment(
    @CurrentUser() user: any,
    @Body() dto: VerifyRazorpayPaymentDto,
  ) {
    return this.paymentService.verifyRazorpayPayment(user, dto);
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated customer purchase and payment transaction history' })
  async getPaymentHistory(@CurrentUser() user: any) {
    return this.paymentService.getPaymentHistory(user);
  }
}
