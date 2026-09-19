import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  IntegrationSettingsService,
  IntegrationProvider,
} from './integration-settings.service';
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

    return {
      success: true,
      provider: 'Firebase Cloud Messaging',
      connected: config.isConfigured && config.isEnabled,
      status: !config.isConfigured
        ? 'NOT_CONNECTED'
        : config.isEnabled
        ? 'CONNECTED'
        : 'DISABLED',
      isEnabled: config.isEnabled,
      projectId: config.projectId,
      source: masked.source,
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
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    this.checkAdminAccess(user);
    return this.integrationSettingsService.sendFirebaseTestNotification(dto);
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
