import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { PayrollService } from './payroll.service';

@Controller('admin/payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('calculate')
  async calculate(@Body() body: { customerId?: string; month: number; year: number; departmentId?: string }) {
    const customerId = body.customerId || 'default-customer';
    return this.payrollService.calculatePayroll(customerId, body.month, body.year, body.departmentId);
  }

  @Post('preview')
  async preview(@Body() body: { customerId?: string; month: number; year: number; departmentId?: string }) {
    const customerId = body.customerId || 'default-customer';
    return this.payrollService.previewPayroll(customerId, body.month, body.year, body.departmentId);
  }

  @Post('approve')
  async approve(@Body() body: { customerId?: string; payrollId: string }) {
    const customerId = body.customerId || 'default-customer';
    return this.payrollService.approvePayroll(customerId, body.payrollId);
  }

  @Post('generate')
  async generate(@Body() body: { customerId?: string; payrollId: string }) {
    const customerId = body.customerId || 'default-customer';
    return this.payrollService.generatePayroll(customerId, body.payrollId);
  }

  @Post('disburse')
  async disburse(@Body() body: { customerId?: string; payrollId: string }) {
    const customerId = body.customerId || 'default-customer';
    return this.payrollService.disbursePayroll(customerId, body.payrollId);
  }

  @Get()
  async findAll(@Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.payrollService.getPayrolls(customerId);
  }

  @Get('slips')
  async findSlips(@Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.payrollService.getSalarySlips(customerId);
  }

  @Get('slips/:id')
  async findSlipById(@Param('id') id: string, @Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.payrollService.getSalarySlipById(customerId, id);
  }

  @Get('slips/:id/download')
  async downloadSlip(@Param('id') id: string, @Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    const slip = await this.payrollService.getSalarySlipById(customerId, id);
    return {
      message: 'Download salary slip PDF',
      slip,
      downloadUrl: `/downloads/slips/${id}.pdf`,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Query('customerId') customerIdQuery?: string) {
    const customerId = customerIdQuery || 'default-customer';
    return this.payrollService.getPayrollById(customerId, id);
  }
}
