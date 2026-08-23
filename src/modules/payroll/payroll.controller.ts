import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@Controller('admin/payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('calculate')
  async calculate(
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; month: number; year: number; departmentId?: string | number }
  ) {
    const customerId = body.customerId || currentCustomer;
    return this.payrollService.calculatePayroll(customerId, body.month, body.year, body.departmentId);
  }

  @Post('preview')
  async preview(
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; month: number; year: number; departmentId?: string | number }
  ) {
    const customerId = body.customerId || currentCustomer;
    return this.payrollService.previewPayroll(customerId, body.month, body.year, body.departmentId);
  }

  @Post('approve')
  async approve(
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; payrollId: string | number }
  ) {
    const customerId = body.customerId || currentCustomer;
    return this.payrollService.approvePayroll(customerId, body.payrollId);
  }

  @Post('generate')
  async generate(
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; payrollId: string | number }
  ) {
    const customerId = body.customerId || currentCustomer;
    return this.payrollService.generatePayroll(customerId, body.payrollId);
  }

  @Post('disburse')
  async disburse(
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; payrollId: string | number }
  ) {
    const customerId = body.customerId || currentCustomer;
    return this.payrollService.disbursePayroll(customerId, body.payrollId);
  }

  @Get()
  async findAll(
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const customerId = customerIdQuery || currentCustomer;
    return this.payrollService.getPayrolls(customerId);
  }

  @Get('slips')
  async findSlips(
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const customerId = customerIdQuery || currentCustomer;
    return this.payrollService.getSalarySlips(customerId);
  }

  @Get('slips/:id')
  async findSlipById(
    @Param('id') id: string,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const customerId = customerIdQuery || currentCustomer;
    return this.payrollService.getSalarySlipById(customerId, id);
  }

  @Get('slips/:id/download')
  async downloadSlip(
    @Param('id') id: string,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const customerId = customerIdQuery || currentCustomer;
    const slip = await this.payrollService.getSalarySlipById(customerId, id);
    return {
      message: 'Download salary slip PDF',
      slip,
      downloadUrl: `/downloads/slips/${id}.pdf`,
    };
  }

  @Get('history')
  async getHistory(
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const customerId = customerIdQuery || currentCustomer;
    return this.payrollService.getPayrollHistory(customerId);
  }

  @Get('structures')
  async getStructures(
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const customerId = customerIdQuery || currentCustomer;
    return this.payrollService.getSalaryStructures(customerId);
  }

  @Post('structures')
  async saveStructure(
    @CurrentCustomer() currentCustomer: any,
    @Body() body: any
  ) {
    const customerId = body.customerId || currentCustomer;
    return this.payrollService.saveSalaryStructure(customerId, body);
  }

  @Delete('structures/:id')
  async deleteStructure(
    @Param('id') id: string,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const customerId = customerIdQuery || currentCustomer;
    return this.payrollService.deleteSalaryStructure(customerId, id);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const customerId = customerIdQuery || currentCustomer;
    return this.payrollService.getPayrollById(customerId, id);
  }
}


