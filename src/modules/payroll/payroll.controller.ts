import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { PayrollService } from './payroll.service';

@Controller('api/v1/admin/payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('calculate')
  async calculate(@Body() body: { tenantId?: string; month: number; year: number; departmentId?: string }) {
    const tenantId = body.tenantId || 'default-tenant';
    return this.payrollService.calculatePayroll(tenantId, body.month, body.year, body.departmentId);
  }

  @Post('preview')
  async preview(@Body() body: { tenantId?: string; month: number; year: number; departmentId?: string }) {
    const tenantId = body.tenantId || 'default-tenant';
    return this.payrollService.previewPayroll(tenantId, body.month, body.year, body.departmentId);
  }

  @Post('approve')
  async approve(@Body() body: { tenantId?: string; payrollId: string }) {
    const tenantId = body.tenantId || 'default-tenant';
    return this.payrollService.approvePayroll(tenantId, body.payrollId);
  }

  @Post('generate')
  async generate(@Body() body: { tenantId?: string; payrollId: string }) {
    const tenantId = body.tenantId || 'default-tenant';
    return this.payrollService.generatePayroll(tenantId, body.payrollId);
  }

  @Post('disburse')
  async disburse(@Body() body: { tenantId?: string; payrollId: string }) {
    const tenantId = body.tenantId || 'default-tenant';
    return this.payrollService.disbursePayroll(tenantId, body.payrollId);
  }

  @Get()
  async findAll(@Query('tenantId') tenantIdQuery?: string) {
    const tenantId = tenantIdQuery || 'default-tenant';
    return this.payrollService.getPayrolls(tenantId);
  }

  @Get('slips')
  async findSlips(@Query('tenantId') tenantIdQuery?: string) {
    const tenantId = tenantIdQuery || 'default-tenant';
    return this.payrollService.getSalarySlips(tenantId);
  }

  @Get('slips/:id')
  async findSlipById(@Param('id') id: string, @Query('tenantId') tenantIdQuery?: string) {
    const tenantId = tenantIdQuery || 'default-tenant';
    return this.payrollService.getSalarySlipById(tenantId, id);
  }

  @Get('slips/:id/download')
  async downloadSlip(@Param('id') id: string, @Query('tenantId') tenantIdQuery?: string) {
    const tenantId = tenantIdQuery || 'default-tenant';
    const slip = await this.payrollService.getSalarySlipById(tenantId, id);
    return {
      message: 'Download salary slip PDF',
      slip,
      downloadUrl: `/downloads/slips/${id}.pdf`,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Query('tenantId') tenantIdQuery?: string) {
    const tenantId = tenantIdQuery || 'default-tenant';
    return this.payrollService.getPayrollById(tenantId, id);
  }
}
