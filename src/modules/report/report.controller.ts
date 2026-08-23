import { Controller, Get, Post, Body, Query } from '@nestjs/common';
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

  @Post('export')
  @ApiOperation({ summary: 'Export reports as structured CSV/PDF datasets' })
  async exportReport(
    @Query('customerId') customerIdQuery: string,
    @Body() body: { reportType: string; format?: 'CSV' | 'PDF'; fromDate?: string; toDate?: string }
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.reportService.exportReport(customerId, body);
  }
}
