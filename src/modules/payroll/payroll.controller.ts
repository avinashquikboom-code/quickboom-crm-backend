import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@ApiTags('HRM - Payroll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
@Controller('admin/payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate monthly payroll for all active employees' })
  async calculate(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; month: number; year: number; departmentId?: string | number }
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (body.customerId || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.calculatePayroll(customerId, body.month, body.year, body.departmentId);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Preview estimated payroll before batch execution' })
  async preview(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; month: number; year: number; departmentId?: string | number }
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (body.customerId || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.previewPayroll(customerId, body.month, body.year, body.departmentId);
  }

  @Post('approve')
  @ApiOperation({ summary: 'Approve calculated payroll batch' })
  async approve(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; payrollId?: string | number }
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (body?.customerId || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.approvePayroll(customerId, body?.payrollId);
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate salary slips for approved payroll' })
  async generate(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; payrollId?: string | number; month?: number; year?: number; employeeId?: number }
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (body?.customerId || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.generatePayroll(customerId, body?.payrollId, {
      month: body?.month ? Number(body.month) : undefined,
      year: body?.year ? Number(body.year) : undefined,
      employeeId: body?.employeeId ? Number(body.employeeId) : undefined,
    });
  }

  @Post('items/:itemId/pay')
  @ApiOperation({ summary: 'Mark one employee payroll as paid and send the salary slip' })
  async payItem(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer: any,
    @Param('itemId') itemId: string,
    @Body() body: { customerId?: string | number },
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (body?.customerId || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.payPayrollItem(customerId, itemId, user);
  }

  @Post('disburse')
  @ApiOperation({ summary: 'Disburse payroll to employee bank accounts' })
  async disburse(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer: any,
    @Body() body: { customerId?: string | number; payrollId?: string | number }
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (body?.customerId || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.disbursePayroll(customerId, body?.payrollId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all payroll runs for company' })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (customerIdQuery || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.getPayrolls(customerId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
    });
  }

  @Get('slips')
  @RequirePermissions({ module: 'SALARY', action: 'VIEW' })
  @ApiOperation({ summary: 'Get salary slips list' })
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
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (customerIdQuery || currentCustomer) : (user?.customerId || currentCustomer);
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
  @RequirePermissions({ module: 'SALARY', action: 'VIEW' })
  @ApiOperation({ summary: 'Get salary slip by ID' })
  async findSlipById(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (customerIdQuery || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.getSalarySlipById(customerId, id);
  }

  @Get('slips/:id/download')
  @ApiOperation({ summary: 'Download salary slip PDF metadata' })
  async downloadSlip(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (customerIdQuery || currentCustomer) : (user?.customerId || currentCustomer);
    const slip = await this.payrollService.getSalarySlipById(customerId, id);
    return {
      message: 'Download salary slip PDF',
      slip,
      downloadUrl: `/downloads/slips/${id}.pdf`,
    };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get rolling 12-month payroll disbursement history' })
  async getHistory(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (customerIdQuery || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.getPayrollHistory(customerId);
  }

  @Get('structures')
  @ApiOperation({ summary: 'Get active employee salary structures' })
  async getStructures(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (customerIdQuery || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.getSalaryStructures(customerId);
  }

  @Post('structures')
  @ApiOperation({ summary: 'Save or update employee salary structure' })
  async saveStructure(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer: any,
    @Body() body: any
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (body?.customerId || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.saveSalaryStructure(customerId, body);
  }

  @Delete('structures/:id')
  @ApiOperation({ summary: 'Delete salary structure' })
  async deleteStructure(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (customerIdQuery || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.deleteSalaryStructure(customerId, id);
  }

  @Get('policy')
  @ApiOperation({ summary: 'Get payroll policy' })
  async getPolicy(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (customerIdQuery || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.getPayrollPolicy(customerId);
  }

  @Post('policy')
  @ApiOperation({ summary: 'Save or update payroll policy' })
  async savePolicy(
    @CurrentUser() user: any,
    @CurrentCustomer() currentCustomer: any,
    @Body() body: any
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (body?.customerId || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.savePayrollPolicy(customerId, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payroll run details by ID' })
  async findOne(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @CurrentCustomer() currentCustomer?: any,
    @Query('customerId') customerIdQuery?: string
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const customerId = isSuperAdmin ? (customerIdQuery || currentCustomer) : (user?.customerId || currentCustomer);
    return this.payrollService.getPayrollById(customerId, id);
  }
}


