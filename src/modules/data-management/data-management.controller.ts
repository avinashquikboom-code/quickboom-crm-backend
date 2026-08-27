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
}
