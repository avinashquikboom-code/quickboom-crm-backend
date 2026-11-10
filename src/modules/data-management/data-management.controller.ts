import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  ValidationPipe,
  UsePipes,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RoleType } from '@prisma/client';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DataManagementService } from './data-management.service';
import { DataGovernanceService } from './data-governance.service';
import { availableModules, resolveModuleId } from './data-governance.catalog';
import {
  ModuleResetDto,
  ResetAllDto,
  EmployeeModuleResetDto,
  EmployeeResetAllDto,
  BulkDeleteBinDto,
  ResetPreviewDto,
  ExecuteResetDto,
  CreateBackupDto,
  RestoreBackupDto,
  CleanupPreviewDto,
  ExecuteCleanupDto,
  ImportLeadsDto,
} from './dto/data-management.dto';

@ApiTags('Admin Data Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard, RolesGuard)
@Roles(RoleType.SUPER_ADMIN)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('admin/data-management')
export class DataManagementController {
  constructor(
    private readonly dataManagementService: DataManagementService,
    private readonly governance: DataGovernanceService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Database size, table count, and tenant record totals' })
  overview(@CurrentCustomer() customerId: string) {
    return this.governance.overview(customerId);
  }

  @Get('modules')
  @ApiOperation({ summary: 'Reset modules mapped to real tables' })
  modules() {
    return this.governance.listModules();
  }

  @Post('reset/preview')
  @ApiOperation({ summary: 'Preview a tenant data reset without deleting records' })
  previewReset(@CurrentCustomer() customerId: string, @Body() dto: ResetPreviewDto) {
    return this.governance.previewReset(customerId, dto);
  }

  @Post('reset')
  @ApiOperation({ summary: 'Delete approved module data after backup, preview, and confirmation' })
  reset(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: ExecuteResetDto,
  ) {
    return this.governance.executeReset(customerId, userId, role, dto);
  }

  @Get('reset/history')
  @ApiOperation({ summary: 'Reset, backup, restore, cleanup, and import history' })
  resetHistory(@CurrentCustomer() customerId: string) {
    return this.governance.history(customerId);
  }

  @Post('backups')
  @ApiOperation({ summary: 'Create a verified tenant snapshot backup' })
  createBackup(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: CreateBackupDto,
  ) {
    return this.governance.createBackup(customerId, userId, role, dto);
  }

  @Get('backups')
  @ApiOperation({ summary: 'List verified backups for this tenant' })
  listBackups(@CurrentCustomer() customerId: string) {
    return this.governance.listBackups(customerId);
  }

  @Get('backups/:id/download')
  @ApiOperation({ summary: 'Download a verified backup' })
  async downloadBackup(@CurrentCustomer() customerId: string, @Param('id') id: string, @Res() res: Response) {
    const file = await this.governance.backupFile(customerId, id);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    file.stream.pipe(res);
  }

  @Post('backups/:id/verify')
  @ApiOperation({ summary: 'Recheck backup size, checksum, and tenant metadata' })
  verifyBackup(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.governance.verifyBackup(customerId, id);
  }

  @Post('backups/:id/restore/preview')
  @ApiOperation({ summary: 'Preview a verified backup restore' })
  previewRestore(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.governance.previewRestore(customerId, id);
  }

  @Post('backups/:id/restore')
  @ApiOperation({ summary: 'Restore a verified backup after creating a pre-restore backup' })
  restoreBackup(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body() dto: RestoreBackupDto,
  ) {
    return this.governance.executeRestore(customerId, userId, role, id, dto);
  }

  @Get('backups/:id')
  @ApiOperation({ summary: 'Backup metadata' })
  backup(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.governance.backupDetails(customerId, id);
  }

  @Post('cleanup/preview')
  @ApiOperation({ summary: 'Count records a cleanup operation would remove' })
  previewCleanup(@CurrentCustomer() customerId: string, @Body() dto: CleanupPreviewDto) {
    return this.governance.previewCleanup(customerId, dto.operation);
  }

  @Post('cleanup')
  @ApiOperation({ summary: 'Run an approved cleanup after confirmation' })
  cleanup(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: ExecuteCleanupDto,
  ) {
    return this.governance.executeCleanup(customerId, userId, role, dto);
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Status of a data-management operation' })
  job(@Param('id') id: string) {
    const job = this.governance.job(id);
    if (!job) throw new BadRequestException('Operation status is no longer available. Check reset history.');
    return job;
  }

  @Get('export')
  @ApiOperation({ summary: 'Export one supported module as CSV, Excel, or JSON' })
  async exportData(
    @CurrentCustomer() customerId: string,
    @Query('module') moduleName: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const file = await this.governance.exportModule(customerId, moduleName, format);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.body);
  }

  @Post('import/preview')
  @ApiOperation({ summary: 'Validate a lead CSV without writing records' })
  previewImport(@CurrentCustomer() customerId: string, @Body() dto: ImportLeadsDto) {
    return this.governance.previewImport(customerId, dto.csv);
  }

  @Post('import')
  @ApiOperation({ summary: 'Import valid lead rows' })
  importLeads(
    @CurrentCustomer() customerId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: ImportLeadsDto,
  ) {
    return this.governance.executeImport(customerId, userId, role, dto);
  }

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
    await this.governance.assertBackupCovers(this.tenantId(customerId), dto.backupId, [resolveModuleId(dto.module)]);
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
    await this.governance.assertBackupCovers(
      this.tenantId(customerId),
      dto.backupId,
      availableModules().map((item) => item.id),
    );
    return this.dataManagementService.resetAllTransactional(
      customerId,
      userId,
      userRole,
      dto,
    );
  }

  /**
   * GET /api/v1/admin/data-management/employees
   * List actual employees for Data Management (strictly excludes Super Admin & Admin)
   */
  @Get('employees')
  @ApiOperation({ summary: 'List actual employees for Data Management (strictly excludes Super Admin & Admin)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'page', required: false })
  async getEmployees(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @CurrentCustomer() customerId?: string,
  ) {
    return this.dataManagementService.getEmployees({
      search,
      limit: limit ? parseInt(limit, 10) : 20,
      page: page ? parseInt(page, 10) : 1,
      customerId,
    });
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
   * GET /api/v1/admin/data-management/customers
   * List real customer accounts for Data Management (strictly excludes Super Admin, Admin & system accounts)
   */
  @Get('customers')
  @ApiOperation({ summary: 'List real customer accounts for Data Management (strictly excludes Super Admin, Admin & system accounts)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'page', required: false })
  async getCustomers(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    return this.dataManagementService.getCustomers({
      search,
      limit: limit ? parseInt(limit, 10) : 20,
      page: page ? parseInt(page, 10) : 1,
    });
  }

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

  private tenantId(customerId: number | string | null | undefined) {
    const tenantId = Number(customerId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new BadRequestException('Select a tenant before managing data.');
    }
    return tenantId;
  }
}

