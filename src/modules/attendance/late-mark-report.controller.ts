import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { LateMarkReportService, assertLateReportPeriod } from './late-mark-report.service';
import { getBusinessDate } from '../../common/utils/timezone.util';

@ApiTags('Late Mark Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('admin/late-mark-reports')
export class LateMarkReportController {
  constructor(private readonly reports: LateMarkReportService) {}

  @Get('daily')
  daily(@CurrentCustomer() customerId: number, @Query('date') date?: string, @Query('search') search?: string, @Query('department') department?: string) {
    assertLateReportPeriod(date);
    return this.reports.daily(Number(customerId), date || getBusinessDate(), { search, department });
  }

  @Get('weekly')
  weekly(@CurrentCustomer() customerId: number, @Query('date') date?: string, @Query('search') search?: string, @Query('department') department?: string) {
    assertLateReportPeriod(date);
    return this.reports.weekly(Number(customerId), date || getBusinessDate(), { search, department });
  }

  @Get('monthly')
  monthly(@CurrentCustomer() customerId: number, @Query('year') year?: string, @Query('month') month?: string, @Query('search') search?: string, @Query('department') department?: string) {
    const now = new Date();
    return this.reports.monthly(Number(customerId), Number(year) || now.getFullYear(), Number(month) || now.getMonth() + 1, { search, department });
  }

  @Get('employee/:employeeId')
  employee(@CurrentCustomer() customerId: number, @Param('employeeId') employeeId: string, @Query('from') from?: string, @Query('to') to?: string) {
    const today = new Date().toISOString().slice(0, 10);
    return this.reports.employee(Number(customerId), Number(employeeId), from || today, to || today);
  }

  @Get('email-settings')
  emailSettings(@CurrentCustomer() customerId: number) {
    return this.reports.settings(Number(customerId));
  }

  @Patch('email-settings')
  saveEmailSettings(@CurrentCustomer() customerId: number, @Body() body: Record<string, unknown>) {
    return this.reports.saveSettings(Number(customerId), body);
  }

  @Get('email-history')
  emailHistory(@CurrentCustomer() customerId: number) {
    return this.reports.history(Number(customerId));
  }

  @Post('email-history/:id/retry')
  retry(@CurrentCustomer() customerId: number, @Param('id') id: string) {
    return this.reports.retry(Number(customerId), Number(id));
  }

  @Post('email-preview')
  preview(@CurrentCustomer() customerId: number, @Body() body: { kind?: 'DAILY' | 'WEEKLY' | 'MONTHLY'; date?: string }) {
    return this.reports.preview(Number(customerId), body.kind || 'DAILY', body.date || new Date().toISOString().slice(0, 10));
  }

  @Get('export')
  csv(@CurrentCustomer() customerId: number, @Query('kind') kind: 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'DAILY', @Query('date') date?: string, @Query('year') year?: string, @Query('month') month?: string) {
    return this.reports.csv(Number(customerId), kind || 'DAILY', date || new Date().toISOString().slice(0, 10), year ? Number(year) : undefined, month ? Number(month) : undefined);
  }
}
