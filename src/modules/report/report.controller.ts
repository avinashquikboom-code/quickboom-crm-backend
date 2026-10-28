import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ReportService } from './report.service';
import { QueryReportDto, ExportReportDto } from './dto/report.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('Reports & Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  private resolveCustomerId(
    user: any,
    customerParam: number | string | undefined,
    queryCustomerId?: number | string,
  ): number {
    const isSuperAdmin = isUserSuperAdmin(user);
    const target = isSuperAdmin
      ? (queryCustomerId || customerParam || user?.customerId)
      : (user?.customerId || customerParam);

    const num = Number(target);
    if (!num || isNaN(num)) {
      if (isSuperAdmin) return 1; // Default fallback for super-admin platform overview
      throw new ForbiddenException('Customer context required for reports');
    }
    return num;
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get live aggregated summary statistics across workforce, attendance, leaves, payroll and visits' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Start date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'End date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Super Admin target customerId' })
  async getSummary(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query() query: QueryReportDto,
  ) {
    const targetCustomer = this.resolveCustomerId(user, customerId, query.customerId);
    return this.reportService.getSummaryReport(targetCustomer, query);
  }

  @Get('data')
  @ApiOperation({ summary: 'Get paginated report dataset for a specific module with date range and filters' })
  @ApiQuery({ name: 'type', required: false, enum: ['ATTENDANCE', 'PAYROLL', 'LEAVES', 'EMPLOYEES', 'VISITS', 'REVENUE'] })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'branch', required: false })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  async getReportData(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query() query: QueryReportDto,
  ) {
    const targetCustomer = this.resolveCustomerId(user, customerId, query.customerId);
    return this.reportService.getReportData(targetCustomer, query);
  }

  @Get('attendance')
  @ApiOperation({ summary: 'Get aggregated attendance analytics report (legacy compatibility)' })
  async getAttendance(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomer = this.resolveCustomerId(user, customerId, customerIdQuery);
    const summary = await this.reportService.getSummaryReport(targetCustomer);
    return summary.attendance;
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get revenue analytics and invoices report' })
  async getRevenue(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomer = this.resolveCustomerId(user, customerId, customerIdQuery);
    const summary = await this.reportService.getSummaryReport(targetCustomer);
    return summary.revenue;
  }

  @Post('export')
  @ApiOperation({ summary: 'Export reports as structured CSV/PDF datasets' })
  async exportReport(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Body() body: ExportReportDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const targetCustomer = this.resolveCustomerId(user, customerId, customerIdQuery);
    return this.reportService.exportReport(targetCustomer, body);
  }
}
