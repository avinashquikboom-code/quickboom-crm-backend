import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { GoogleMapsUsageService } from './google-maps-usage.service';

@ApiTags('Google Maps Usage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
@Controller('admin/google-maps')
export class GoogleMapsUsageController {
  constructor(private readonly usage: GoogleMapsUsageService) {}

  @Get('usage/overview')
  @RequirePermissions({ module: 'SETTINGS', action: 'VIEW' })
  overview(@CurrentCustomer() customerId: string, @Query() query: any) {
    return this.usage.overview(Number(customerId), query);
  }

  @Get('usage/daily')
  @RequirePermissions({ module: 'SETTINGS', action: 'VIEW' })
  daily(@CurrentCustomer() customerId: string, @Query() query: any) {
    return this.usage.history(Number(customerId), query);
  }

  @Get('usage/monthly')
  @RequirePermissions({ module: 'SETTINGS', action: 'VIEW' })
  monthly(@CurrentCustomer() customerId: string, @Query() query: any) {
    return this.usage.overview(Number(customerId), query);
  }

  @Get('usage/breakdown')
  @RequirePermissions({ module: 'SETTINGS', action: 'VIEW' })
  breakdown(@CurrentCustomer() customerId: string, @Query() query: any) {
    return this.usage.breakdown(Number(customerId), query);
  }

  @Get('usage/history')
  @RequirePermissions({ module: 'SETTINGS', action: 'VIEW' })
  history(@CurrentCustomer() customerId: string, @Query() query: any) {
    return this.usage.history(Number(customerId), query);
  }

  @Get('quotas')
  @RequirePermissions({ module: 'SETTINGS', action: 'VIEW' })
  quotas(@CurrentCustomer() customerId: string) {
    return this.usage.getQuota(Number(customerId));
  }

  @Put('quotas')
  @RequirePermissions({ module: 'SETTINGS', action: 'EDIT' })
  save(@CurrentCustomer() customerId: string, @Body() body: any) {
    return this.usage.saveQuota(Number(customerId), body);
  }

  @Get('alerts')
  @RequirePermissions({ module: 'SETTINGS', action: 'VIEW' })
  alerts(@CurrentCustomer() customerId: string) {
    return this.usage.alerts(Number(customerId));
  }

  @Post('alerts/test')
  @RequirePermissions({ module: 'SETTINGS', action: 'EDIT' })
  test(@CurrentCustomer() customerId: string) {
    return this.usage.testAlert(Number(customerId));
  }
}
