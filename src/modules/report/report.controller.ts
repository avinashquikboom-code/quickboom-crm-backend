import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ReportService } from './report.service';

@ApiTags('Reports & Analytics')
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('attendance')
  @ApiOperation({ summary: 'Get aggregated attendance analytics report' })
  async getAttendance(@Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.reportService.getAttendanceReport(customerId);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get revenue analytics and invoices report' })
  async getRevenue(@Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.reportService.getRevenueReport(customerId);
  }

  @Get('work')
  @ApiOperation({ summary: 'Get work production analytics report' })
  async getWork(@Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.reportService.getWorkReport(customerId);
  }
}
