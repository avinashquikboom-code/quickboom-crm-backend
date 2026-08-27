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
    const rzpConfig = await this.integrationSettingsService.getRazorpayConfig();
    const rawConf = await this.integrationSettingsService.getIntegrationConfig('RAZORPAY');
    const config = rawConf?.config || {};

    const razorpayEnabled = Boolean(rzpConfig.isEnabled && rzpConfig.isConfigured);
    const offlinePaymentEnabled = Boolean(config.enableOfflinePayment ?? false);

    return {
      success: true,
      data: {
        razorpayEnabled,
        offlinePaymentEnabled,
        paymentMode: rzpConfig.environment,
        razorpayKeyId: rzpConfig.isEnabled ? rzpConfig.keyId : null,
      },
    };
  }
}
