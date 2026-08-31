import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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
    @Query('customerId') customerIdQuery?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const customerId = customerIdQuery || currentCustomer;
    return this.payrollService.getPayrolls(customerId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
    });
  }

  @Get('slips')
  async findSlips(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const customerId = customerIdQuery || currentCustomer;
    return this.payrollService.getSalarySlips(customerId, {
      user,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
    });
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


