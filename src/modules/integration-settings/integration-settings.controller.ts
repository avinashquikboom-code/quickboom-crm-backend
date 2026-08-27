import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IntegrationSettingsService } from './integration-settings.service';
import {
  UpdateIntegrationDto,
  TestIntegrationDto,
} from './dto/integration-settings.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Admin Integration & Gateway Settings')
@Controller('admin/settings/integrations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class IntegrationSettingsController {
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
        'Access denied: Only Administrators can view or manage integration settings',
      );
    }
  }

  @Get('payment')
  @ApiOperation({ summary: 'Get payment gateway and offline payment configuration for Admin Settings' })
  async getPaymentSettings(@CurrentUser() user: any) {
    this.checkAdminAccess(user);
    return this.integrationSettingsService.getPaymentSettings();
  }

  @Put('payment')
  @ApiOperation({ summary: 'Update payment gateway and offline payment settings in Database' })
  async updatePaymentSettings(
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    this.checkAdminAccess(user);
    const adminUserId = user?.id ? Number(user.id) : undefined;
    return this.integrationSettingsService.updatePaymentSettings(dto, adminUserId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all integration settings with masked secret values for Admin UI',
  })
  async getAllIntegrations(@CurrentUser() user: any) {
    this.checkAdminAccess(user);
    return this.integrationSettingsService.getAllIntegrationsMasked();
  }

  @Get(':provider')
  @ApiOperation({
    summary: 'Get specific provider integration configuration with masked secrets',
  })
  async getIntegration(
    @Param('provider') provider: string,
    @CurrentUser() user: any,
  ) {
    this.checkAdminAccess(user);
    return this.integrationSettingsService.getMaskedProviderConfig(provider);
  }

  @Put(':provider')
  @ApiOperation({
    summary:
      'Update third-party integration credentials & configuration (auto-encrypts secrets and invalidates runtime cache)',
  })
  async updateIntegration(
    @Param('provider') provider: string,
    @Body() dto: UpdateIntegrationDto,
    @CurrentUser() user: any,
  ) {
    this.checkAdminAccess(user);
    const adminUserId = user?.id ? Number(user.id) : undefined;
    return this.integrationSettingsService.updateIntegrationConfig(
      provider,
      dto,
      adminUserId,
    );
  }

  @Post(':provider/test')
  @ApiOperation({
    summary:
      'Test live connectivity with the third-party provider API using supplied or saved credentials',
  })
  async testIntegration(
    @Param('provider') provider: string,
    @Body() dto: TestIntegrationDto,
    @CurrentUser() user: any,
  ) {
    this.checkAdminAccess(user);
    return this.integrationSettingsService.testIntegration(provider, dto);
  }
}
