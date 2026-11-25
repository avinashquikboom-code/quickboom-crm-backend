import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Admin Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get unified Main Admin Dashboard summary with server-side filters' })
  async getSummary(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId?: number | string,
    @Query('customerId') customerIdQuery?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('departmentId') departmentId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('branchId') branchId?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const scopedCustomerId = customerIdQuery
      ? Number(customerIdQuery)
      : isSuperAdmin
        ? null
        : customerId
          ? Number(customerId)
          : null;

    return this.dashboardService.getUnifiedSummary({
      customerId: scopedCustomerId,
      fromDate: fromDate || dateFrom,
      toDate: toDate || dateTo,
      departmentId: departmentId ? Number(departmentId) : null,
      employeeId: employeeId ? Number(employeeId) : null,
      branchId: branchId ? Number(branchId) : null,
    });
  }

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

  @Get('super-admin')
  async getSuperAdmin() {
    return this.dashboardService.getSuperAdminMetrics();
  }
}
