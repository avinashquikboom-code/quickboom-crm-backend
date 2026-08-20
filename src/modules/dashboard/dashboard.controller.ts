import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('api/v1/admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('live')
  async getLive(@Query('customerId') customerIdQuery?: string, @Query('officeId') officeId?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.dashboardService.getLiveMetrics(customerId, officeId);
  }

  @Get('offices')
  async getOffices(@Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.dashboardService.getOffices(customerId);
  }
}
