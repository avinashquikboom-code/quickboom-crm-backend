import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('api/v1/admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('live')
  async getLive(@Query('tenantId') tenantIdQuery?: string, @Query('officeId') officeId?: string) {
    const tenantId = tenantIdQuery || 'default-tenant';
    return this.dashboardService.getLiveMetrics(tenantId, officeId);
  }

  @Get('offices')
  async getOffices(@Query('tenantId') tenantIdQuery?: string) {
    const tenantId = tenantIdQuery || 'default-tenant';
    return this.dashboardService.getOffices(tenantId);
  }
}
