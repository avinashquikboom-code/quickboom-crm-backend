import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommissionService } from './commission.service';
import {
  CommissionFilterDto,
  UpdateCommissionStatusDto,
  UpsertEmployeeCommissionConfigDto,
  UpdateDesignationCommissionDto,
} from './dto/commission.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Commissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard, PermissionsGuard)
@Controller('commissions')
export class CommissionController {
  constructor(private readonly commissionService: CommissionService) {}

  /**
   * Admin: List all commissions with filters, pagination, and KPI summaries
   */
  @Get('admin')
  @RequirePermissions({ module: 'COMMISSION', action: 'VIEW' })
  @ApiOperation({ summary: 'Admin list all commissions with summary metrics' })
  async getAdminCommissions(
    @CurrentCustomer() customerId: string,
    @Query() query: CommissionFilterDto,
  ) {
    return this.commissionService.getAdminCommissions(Number(customerId), query);
  }

  /**
   * Admin: Update commission status (e.g. Mark as PAID, APPROVE, CANCEL)
   */
  @Patch(':id/status')
  @RequirePermissions({ module: 'COMMISSION', action: 'MANAGE' })
  @ApiOperation({ summary: 'Update commission status (e.g. Mark as PAID)' })
  async updateStatus(
    @CurrentCustomer() customerId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommissionStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.commissionService.updateCommissionStatus(
      Number(customerId),
      id,
      dto,
      user,
    );
  }

  /**
   * Admin: Get all designations with commission settings
   */
  @Get('configs/designations')
  @RequirePermissions({ module: 'COMMISSION', action: 'VIEW' })
  @ApiOperation({ summary: 'Get designation commission configuration' })
  async getDesignationConfigs(@CurrentCustomer() customerId: string) {
    return this.commissionService.getDesignationCommissionConfigs(Number(customerId));
  }

  /**
   * Admin: Update designation commission rate and eligibility
   */
  @Patch('configs/designations/:id')
  @RequirePermissions({ module: 'COMMISSION', action: 'MANAGE' })
  @ApiOperation({ summary: 'Update designation commission rate and eligibility' })
  async updateDesignationConfig(
    @CurrentCustomer() customerId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDesignationCommissionDto,
  ) {
    return this.commissionService.updateDesignationCommission(
      Number(customerId),
      id,
      dto,
    );
  }

  /**
   * Admin: Get employee-specific commission overrides
   */
  @Get('configs/employees')
  @RequirePermissions({ module: 'COMMISSION', action: 'VIEW' })
  @ApiOperation({ summary: 'Get employee commission configuration overrides' })
  async getEmployeeConfigs(@CurrentCustomer() customerId: string) {
    return this.commissionService.getEmployeeCommissionConfigs(Number(customerId));
  }

  /**
   * Admin: Upsert employee-specific commission configuration override
   */
  @Post('configs/employees')
  @RequirePermissions({ module: 'COMMISSION', action: 'MANAGE' })
  @ApiOperation({ summary: 'Upsert employee commission configuration override' })
  async upsertEmployeeConfig(
    @CurrentCustomer() customerId: string,
    @Body() dto: UpsertEmployeeCommissionConfigDto,
  ) {
    return this.commissionService.upsertEmployeeCommissionConfig(
      Number(customerId),
      dto,
    );
  }

  /**
   * Employee Mobile Self-Service: Get authenticated employee's commission records & dashboard
   */
  @Get('me')
  @ApiOperation({ summary: 'Get authenticated employee commission dashboard & records' })
  async getMyCommissions(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query() query: CommissionFilterDto,
  ) {
    return this.commissionService.getEmployeeCommissions(
      Number(customerId),
      Number(user.id),
      query,
    );
  }
}
