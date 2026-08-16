import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DataManagementService } from './data-management.service';
import {
  ModuleResetDto,
  ResetAllDto,
  EmployeeModuleResetDto,
  EmployeeResetAllDto,
} from './dto/data-management.dto';

@ApiTags('Admin Data Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@Controller('admin/data-management')
export class DataManagementController {
  constructor(private readonly dataManagementService: DataManagementService) {}

  /**
   * GET /api/v1/admin/data-management/summary
   * Real database counts of all transactional & master records
   */
  @Get('summary')
  @ApiOperation({ summary: 'Get real database record counts for all tenant modules' })
  async getSummary(@CurrentTenant() tenantId: string) {
    return this.dataManagementService.getSummary(tenantId);
  }

  /**
   * GET /api/v1/admin/data-management/history
   * Audit log history of previous data resets
   */
  @Get('history')
  @ApiOperation({ summary: 'Get data reset audit history' })
  async getHistory(@CurrentTenant() tenantId: string) {
    return this.dataManagementService.getResetHistory(tenantId);
  }

  /**
   * POST /api/v1/admin/data-management/reset/module
   * Reset single module transactional data
   */
  @Post('reset/module')
  @ApiOperation({ summary: 'Reset a specific module transactional data' })
  async resetModule(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: ModuleResetDto,
  ) {
    return this.dataManagementService.resetModule(
      tenantId,
      userId,
      userRole || 'TENANT_ADMIN',
      dto,
    );
  }

  /**
   * POST /api/v1/admin/data-management/reset/all
   * Reset all transactional data while preserving master data
   */
  @Post('reset/all')
  @ApiOperation({ summary: 'Reset all transactional tenant data' })
  async resetAll(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: ResetAllDto,
  ) {
    return this.dataManagementService.resetAllTransactional(
      tenantId,
      userId,
      userRole || 'TENANT_ADMIN',
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
    @CurrentTenant() tenantId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.dataManagementService.getEmployeeSummary(tenantId, employeeId);
  }

  /**
   * POST /api/v1/admin/data-management/employees/:employeeId/reset/module
   * Reset single module for an employee
   */
  @Post('employees/:employeeId/reset/module')
  @ApiOperation({ summary: 'Reset specific module records for single employee' })
  async resetEmployeeModule(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: EmployeeModuleResetDto,
  ) {
    return this.dataManagementService.resetEmployeeModule(
      tenantId,
      userId,
      userRole || 'TENANT_ADMIN',
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
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: EmployeeResetAllDto,
  ) {
    return this.dataManagementService.resetEmployeeAllTransactional(
      tenantId,
      userId,
      userRole || 'TENANT_ADMIN',
      employeeId,
      dto,
    );
  }
}
