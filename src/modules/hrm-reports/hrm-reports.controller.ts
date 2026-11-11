import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { HrmReportsService } from './hrm-reports.service';

@ApiTags('HRM Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
@Controller('admin/hrm/reports')
export class HrmReportsController {
  constructor(private readonly reports: HrmReportsService) {}

  @Get('settings')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'VIEW' })
  settings(@CurrentCustomer() customerId: number) {
    return this.reports.getSettings(customerId);
  }

  @Patch('settings')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'EDIT' })
  updateSettings(@CurrentCustomer() customerId: number, @Body() body: Record<string, unknown>) {
    return this.reports.updateSettings(customerId, body);
  }

  @Get('commissions')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'VIEW' })
  commissions(@CurrentCustomer() customerId: number, @Query() query: Record<string, string>) {
    return this.reports.commissionReport(customerId, query);
  }

  @Post('cycle')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'CREATE' })
  openCycle(@CurrentCustomer() customerId: number, @Body() body: { year?: number; month?: number }) {
    return this.reports.openCurrentCycle(customerId, body?.year, body?.month);
  }

  @Get('dashboard')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'VIEW' })
  dashboard(@CurrentCustomer() customerId: number, @Query() query: Record<string, string>) {
    return this.reports.dashboard(customerId, query);
  }

  @Post('generate')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'CREATE' })
  generate(@CurrentCustomer() customerId: number, @Body() body: Record<string, unknown>) {
    return this.reports.generate(customerId, body);
  }

  @Get('deliveries')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'VIEW' })
  deliveries(@CurrentCustomer() customerId: number, @Query() query: Record<string, string>) {
    return this.reports.dashboard(customerId, query);
  }

  @Post('retry/:deliveryId')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'EDIT' })
  retry(@CurrentCustomer() customerId: number, @Param('deliveryId') deliveryId: string) {
    return this.reports.retry(customerId, Number(deliveryId));
  }

  @Get('download/:reportId')
  @RequirePermissions({ module: 'ATTENDANCE', action: 'VIEW' })
  download(@CurrentUser() user: any, @CurrentCustomer() customerId: number, @Param('reportId') reportId: string) {
    return this.reports.download(customerId, Number(reportId), user);
  }

  @Get('salary/:employeeId')
  @RequirePermissions({ module: 'PAYROLL', action: 'VIEW' })
  employeeSalary(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number,
    @Param('employeeId') employeeId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    return this.reports.employeeSalarySummary(
      customerId,
      Number(employeeId),
      year ? Number(year) : now.getFullYear(),
      month ? Number(month) : now.getMonth() + 1,
      user,
    );
  }
}

@ApiTags('My HRM Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('hrm')
export class MyHrmReportsController {
  constructor(private readonly reports: HrmReportsService) {}

  @Get('my-salary-summary')
  mySalarySummary(@CurrentUser() user: any, @Query('year') year?: string, @Query('month') month?: string) {
    return this.reports.mySalarySummary(user, year ? Number(year) : undefined, month ? Number(month) : undefined);
  }

  @Get('my-salary-summary/history')
  mySalaryHistory(@CurrentUser() user: any) {
    return this.reports.mySalaryHistory(user);
  }

  @Get('my-commission')
  myCommission(@CurrentUser() user: any, @Query('year') year?: string, @Query('month') month?: string) {
    return this.reports.myCommission(user, year ? Number(year) : undefined, month ? Number(month) : undefined);
  }

  @Get('team/commissions')
  teamCommissions(@CurrentUser() user: any, @Query('year') year?: string, @Query('month') month?: string) {
    return this.reports.teamCommissions(user, year ? Number(year) : undefined, month ? Number(month) : undefined);
  }

  @Get('my-reports')
  mine(@CurrentUser() user: any) {
    return this.reports.myReports(user);
  }

  @Get('my-reports/:reportId/download')
  download(@CurrentUser() user: any, @Param('reportId') reportId: string) {
    return this.reports.download(user?.customerId, Number(reportId), user);
  }

  @Get('team/leaves')
  team(@CurrentUser() user: any) {
    return this.reports.teamLeaves(user);
  }

  @Get('team/attendance-leaves')
  teamAttendanceLeaves(@CurrentUser() user: any, @Query('year') year?: string, @Query('month') month?: string) {
    return this.reports.teamAttendanceAndLeaves(user, year ? Number(year) : undefined, month ? Number(month) : undefined);
  }
}
