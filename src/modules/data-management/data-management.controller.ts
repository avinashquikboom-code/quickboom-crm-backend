import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RoleType } from '@prisma/client';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DataManagementService } from './data-management.service';
import {
  ModuleResetDto,
  ResetAllDto,
  EmployeeModuleResetDto,
  EmployeeResetAllDto,
  BulkDeleteBinDto,
} from './dto/data-management.dto';

@ApiTags('Admin Data Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard, RolesGuard)
@Roles(RoleType.SUPER_ADMIN)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('admin/data-management')
export class DataManagementController {
  constructor(private readonly dataManagementService: DataManagementService) {}

  /**
   * GET /api/v1/admin/data-management/summary
   * Real database counts of all transactional & master records
   */
  @Get('summary')
  @ApiOperation({ summary: 'Get real database record counts for all customer modules' })
  async getSummary(@CurrentCustomer() customerId: string) {
    return this.dataManagementService.getSummary(customerId);
  }

  /**
   * GET /api/v1/admin/data-management/history
   * Audit log history of previous data resets
   */
  @Get('history')
  @ApiOperation({ summary: 'Get data reset audit history' })
  async getHistory(@CurrentCustomer() customerId: string) {
    return this.dataManagementService.getResetHistory(customerId);
  }

  /**
   * POST /api/v1/admin/data-management/reset/module
   * Reset single module transactional data
   */
  @Post('reset/module')
  @ApiOperation({ summary: 'Reset a specific module transactional data' })
  async resetModule(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: ModuleResetDto,
  ) {
    return this.dataManagementService.resetModule(
      customerId,
      userId,
      userRole,
      dto,
    );
  }

  /**
   * POST /api/v1/admin/data-management/reset/all
   * Reset all transactional data while preserving master data
   */
  @Post('reset/all')
  @ApiOperation({ summary: 'Reset all transactional customer data' })
  async resetAll(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: ResetAllDto,
  ) {
    return this.dataManagementService.resetAllTransactional(
      customerId,
      userId,
      userRole,
      dto,
    );
  }

  /**
   * GET /api/v1/admin/data-management/employees/:employeeId/summary
   * Individual employee transactional record summary
   */
  @Get('employees/:employeeId/summary')
  @ApiOperation({ summary: 'Get employee transactional record counts' })
  async getEmployeeSummary(
    @CurrentCustomer() customerId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.dataManagementService.getEmployeeSummary(customerId, employeeId);
  }

  /**
   * POST /api/v1/admin/data-management/employees/:employeeId/reset/module
   * Reset single module for an employee
   */
  @Post('employees/:employeeId/reset/module')
  @ApiOperation({ summary: 'Reset specific module records for single employee' })
  async resetEmployeeModule(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: EmployeeModuleResetDto,
  ) {
    return this.dataManagementService.resetEmployeeModule(
      customerId,
      userId,
      userRole,
      employeeId,
      dto,
    );
  }

  /**
   * POST /api/v1/admin/data-management/employees/:employeeId/reset/all
   * Reset all transactional data for an employee
   */
  @Post('employees/:employeeId/reset/all')
  @ApiOperation({ summary: 'Reset all transactional records for single employee' })
  async resetEmployeeAll(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: EmployeeResetAllDto,
  ) {
    return this.dataManagementService.resetEmployeeAllTransactional(
      customerId,
      userId,
      userRole,
      employeeId,
      dto,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER-WISE RESET ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/data-management/customers/:customerId/summary
   * Get transactional summary for a specific customer
   */
  @Get('customers/:customerId/summary')
  @ApiOperation({ summary: 'Get live customer record summary for data reset' })
  async getCustomerSummary(@Param('customerId') customerId: string) {
    return this.dataManagementService.getCustomerSummary(customerId);
  }

  /**
   * POST /api/v1/admin/data-management/customers/:customerId/reset
   * Reset all application data for a specific customer
   */
  @Post('customers/:customerId/reset')
  @ApiOperation({ summary: 'Reset all application data for a specific customer' })
  async resetCustomer(
    @Param('customerId') customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: ResetAllDto,
  ) {
    return this.dataManagementService.resetCustomerData(
      customerId,
      userId,
      userRole,
      dto,
    );
  }

  /**
   * POST /api/v1/admin/data-management/reset/customer
   * Alias: Reset all application data for a specific customer (body contains customerId)
   */
  @Post('reset/customer')
  @ApiOperation({ summary: 'Reset all application data for a customer' })
  async resetCustomerBody(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: { customerId: string | number; confirmation?: string; reason?: string },
  ) {
    return this.dataManagementService.resetCustomerData(
      dto.customerId,
      userId,
      userRole,
      dto,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BIN / TRASH ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/admin/data-management/bin
   * List all soft-deleted / archived records currently in the Bin
   */
  @Get('bin')
  @ApiOperation({ summary: 'List all records in the Bin (soft-deleted customers and employees)' })
  async getBin() {
    return this.dataManagementService.getBinItems();
  }

  /**
   * POST /api/v1/admin/data-management/bin/customer/:id/restore
   * Restore a soft-deleted customer from the Bin back to active status
   */
  @Post('bin/customer/:id/restore')
  @ApiOperation({ summary: 'Restore a customer from the Bin back to active status' })
  async restoreCustomer(@Param('id') id: string) {
    return this.dataManagementService.restoreCustomerFromBin(id);
  }

  /**
   * DELETE /api/v1/admin/data-management/bin/customer/:id
   * Permanently delete a customer from the Bin (irreversible)
   */
  @Delete('bin/customer/:id')
  @ApiOperation({ summary: 'Permanently delete a customer from the Bin (irreversible)' })
  async deleteCustomerPermanently(@Param('id') id: string) {
    return this.dataManagementService.deleteCustomerPermanently(id);
  }

  /**
   * POST /api/v1/admin/data-management/bin/employee/:id/restore
   * Restore a soft-deleted employee from the Bin back to active status
   */
  @Post('bin/employee/:id/restore')
  @ApiOperation({ summary: 'Restore an employee from the Bin back to active status' })
  async restoreEmployee(@Param('id') id: string) {
    return this.dataManagementService.restoreEmployeeFromBin(id);
  }

  /**
   * DELETE /api/v1/admin/data-management/bin/employee/:id
   * Permanently delete an employee from the Bin (irreversible)
   */
  @Delete('bin/employee/:id')
  @ApiOperation({ summary: 'Permanently delete an employee from the Bin (irreversible)' })
  async deleteEmployeePermanently(@Param('id') id: string) {
    return this.dataManagementService.deleteEmployeePermanently(id);
  }

  /**
   * DELETE /api/v1/admin/data-management/bin/bulk
   * Permanently delete multiple items from the Bin (irreversible)
   */
  @Delete('bin/bulk')
  @Post(['bin/bulk', 'bin/bulk-delete'])
  @ApiOperation({ summary: 'Permanently delete multiple items (customers and/or employees) from the Bin (irreversible)' })
  async deleteBinBulk(@Body() dto: BulkDeleteBinDto) {
    return this.dataManagementService.deleteBinBulk(dto);
  }
}

