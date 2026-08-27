import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IntegrationSettingsService } from './integration-settings.service';

@ApiTags('Public Settings & Payment Config')
@Controller('settings')
export class PublicSettingsController {
  constructor(
    private readonly integrationSettingsService: IntegrationSettingsService,
  ) {}

  @Get('payment')
  @ApiOperation({
    summary:
      'Get dynamic public payment configuration from database (single source of truth for Mobile & Web clients)',
  })
  async getPublicPaymentConfig() {
    const paymentSettings = await this.integrationSettingsService.getPaymentSettings();
    const data = paymentSettings.data;

    return {
      success: true,
      data: {
        razorpayEnabled: data.razorpayEnabled,
        enableRazorpay: data.razorpayEnabled,
        offlinePaymentEnabled: data.offlinePaymentEnabled,
        enableOfflinePayment: data.offlinePaymentEnabled,
        paymentMode: data.paymentMode,
        razorpayKeyId: data.razorpayEnabled
          ? (data.paymentMode === 'LIVE' ? data.razorpayLiveKeyId : data.razorpayTestKeyId)
          : null,
      },
    };
  }
}
