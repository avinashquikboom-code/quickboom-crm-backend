import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  IntegrationSettingsService,
  IntegrationProvider,
} from './integration-settings.service';
import { SendFirebaseTestNotificationDto } from './dto/firebase-test-notification.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Admin Firebase FCM Integration')
@Controller('admin/integrations/firebase')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FirebaseIntegrationController {
  constructor(
    private readonly integrationSettingsService: IntegrationSettingsService,
  ) {}

  private checkAdminAccess(user: any) {
    if (isUserSuperAdmin(user)) return;

    const userRoles: string[] = Array.isArray(user?.roles)
      ? user.roles.map((r: any) => String(r).toUpperCase().replace(/[\s_]+/g, ''))
      : user?.role
      ? [String(user.role).toUpperCase().replace(/[\s_]+/g, '')]
      : [];

    const isCompanyAdmin = userRoles.some(
      (r) =>
        r === 'SUPERADMIN' ||
        r === 'COMPANYADMIN' ||
        r === 'CUSTOMERADMIN' ||
        r === 'TENANTADMIN' ||
        r === 'ADMIN',
    );

    if (!isCompanyAdmin) {
      throw new ForbiddenException(
        'Access denied: Only Administrators can view or manage Firebase integration settings',
      );
    }
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get Firebase Cloud Messaging integration status for Admin Panel',
  })
  async getStatus(@CurrentUser() user: any) {
    this.checkAdminAccess(user);
    const masked = await this.integrationSettingsService.getMaskedProviderConfig(
      IntegrationProvider.FIREBASE,
    );
    const config = await this.integrationSettingsService.getFirebaseConfig();

    const creds = masked?.credentials || {};
    const hasAnyCred = Boolean(
      config.projectId ||
        config.clientEmail ||
        config.privateKey ||
        config.messagingSenderId ||
        config.apiKey ||
        config.appId ||
        config.vapidKey ||
        creds.projectId ||
        creds.clientEmail ||
        creds.privateKey,
    );
    const hasEnv = Boolean(
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    );
    const isFullyConfigured = Boolean(
      config.projectId &&
      (config.clientEmail || hasEnv) &&
      (config.privateKey || hasEnv)
    );

    let status = 'NOT CONFIGURED';
    if (masked?.config?.lastTestResult === 'FAILED') {
      status = 'CONNECTION ERROR';
    } else if (isFullyConfigured) {
      status = 'CONNECTED';
    } else if (hasAnyCred) {
      status = 'PARTIALLY CONFIGURED';
    }

    return {
      success: true,
      provider: 'Firebase Cloud Messaging',
      connected: isFullyConfigured && config.isEnabled,
      status,
      isEnabled: config.isEnabled,
      projectId: config.projectId,
      source: masked.source || 'NONE',
      lastTestedAt: masked.config?.lastTestedAt || null,
      lastTestResult: masked.config?.lastTestResult || null,
    };
  }

  @Post('test')
  @ApiOperation({
    summary: 'Test live Firebase Admin SDK connection without exposing secrets',
  })
  async testConnection(
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    this.checkAdminAccess(user);
    return this.integrationSettingsService.testIntegration(
      IntegrationProvider.FIREBASE,
      dto,
    );
  }

  @Post('test-notification')
  @ApiOperation({
    summary: 'Send an FCM test push notification to targeted recipient',
  })
  async sendTestNotification(
    @Body() dto: SendFirebaseTestNotificationDto,
    @CurrentUser() user: any,
  ) {
    this.checkAdminAccess(user);
    const adminUserId = user?.id ? Number(user.id) : undefined;
    return this.integrationSettingsService.sendFirebaseTestNotification(dto, adminUserId);
  }

  @Delete()
  @ApiOperation({
    summary: 'Disconnect Firebase integration and invalidate active instances',
  })
  async disconnect(@CurrentUser() user: any) {
    this.checkAdminAccess(user);
    const adminUserId = user?.id ? Number(user.id) : undefined;
    return this.integrationSettingsService.disconnectIntegration(
      IntegrationProvider.FIREBASE,
      adminUserId,
    );
  }

  @Patch('status')
  @ApiOperation({
    summary: 'Enable or disable Firebase Cloud Messaging integration',
  })
  async updateStatus(
    @Body() body: { isEnabled: boolean },
    @CurrentUser() user: any,
  ) {
    this.checkAdminAccess(user);
    const isEnabled = Boolean(body?.isEnabled);
    const adminUserId = user?.id ? Number(user.id) : undefined;

    return this.integrationSettingsService.updateIntegrationConfig(
      IntegrationProvider.FIREBASE,
      { isEnabled },
      adminUserId,
    );
  }
}
