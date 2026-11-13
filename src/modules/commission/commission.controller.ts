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
import { CommissionWalletService } from './commission-wallet.service';
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
  constructor(
    private readonly commissionService: CommissionService,
    private readonly walletService: CommissionWalletService,
  ) {}

  @Get('wallet/me')
  @ApiOperation({ summary: 'Employee commission wallet balance' })
  wallet(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string) {
    return this.walletService.wallet(Number(customerId), Number(userId));
  }

  @Get('wallet/earnings')
  earnings(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string, @Query() query: any) {
    return this.walletService.earnings(Number(customerId), Number(userId), query);
  }

  @Get('wallet/transactions')
  walletTransactions(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string, @Query() query: any) {
    return this.walletService.transactions(Number(customerId), Number(userId), query);
  }

  @Get('wallet/rules')
  walletRules(@CurrentCustomer() customerId: string) {
    return this.walletService.rules(Number(customerId));
  }

  @Get('wallet/quota')
  walletQuota(@CurrentCustomer() customerId: string, @CurrentUser() user: any) {
    return this.walletService.quota(Number(customerId), Number(user.id), user);
  }

  @Post('wallet/withdrawals')
  requestWithdrawal(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string, @Body() body: any) {
    return this.walletService.requestWithdrawal(Number(customerId), Number(userId), body);
  }

  @Get('wallet/withdrawals')
  myWithdrawals(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string) {
    return this.walletService.myWithdrawals(Number(customerId), Number(userId));
  }

  @Get('admin/wallet/dashboard')
  @RequirePermissions({ module: 'COMMISSION', action: 'VIEW' })
  adminWalletDashboard(@CurrentCustomer() customerId: string) {
    return this.walletService.adminDashboard(Number(customerId));
  }

  @Get('admin/wallet/employees')
  @RequirePermissions({ module: 'COMMISSION', action: 'VIEW' })
  adminWalletEmployees(@CurrentCustomer() customerId: string) {
    return this.walletService.adminEmployees(Number(customerId));
  }

  @Get('admin/wallet/rules')
  @RequirePermissions({ module: 'COMMISSION', action: 'VIEW' })
  adminRules(@CurrentCustomer() customerId: string) {
    return this.walletService.listSlabs(Number(customerId));
  }

  @Post('admin/wallet/rules')
  @RequirePermissions({ module: 'COMMISSION', action: 'MANAGE' })
  createRule(@CurrentCustomer() customerId: string, @Body() body: any) {
    return this.walletService.upsertSlab(Number(customerId), body);
  }

  @Get('admin/wallet/withdrawals')
  @RequirePermissions({ module: 'COMMISSION', action: 'VIEW' })
  adminWithdrawals(@CurrentCustomer() customerId: string, @Query('status') status?: string) {
    return this.walletService.listWithdrawals(Number(customerId), status);
  }

  @Patch('admin/wallet/withdrawals/:id/approve')
  @RequirePermissions({ module: 'COMMISSION', action: 'MANAGE' })
  approveWithdrawal(@CurrentCustomer() customerId: string, @Param('id', ParseIntPipe) id: number, @CurrentUser('id') userId: string, @Body() body: any) {
    return this.walletService.setWithdrawalStatus(Number(customerId), id, 'APPROVED', Number(userId), body || {});
  }

  @Patch('admin/wallet/withdrawals/:id/reject')
  @RequirePermissions({ module: 'COMMISSION', action: 'MANAGE' })
  rejectWithdrawal(@CurrentCustomer() customerId: string, @Param('id', ParseIntPipe) id: number, @CurrentUser('id') userId: string, @Body() body: any) {
    return this.walletService.setWithdrawalStatus(Number(customerId), id, 'REJECTED', Number(userId), body || {});
  }

  @Patch('admin/wallet/withdrawals/:id/paid')
  @RequirePermissions({ module: 'COMMISSION', action: 'MANAGE' })
  payWithdrawal(@CurrentCustomer() customerId: string, @Param('id', ParseIntPipe) id: number, @CurrentUser('id') userId: string, @Body() body: any) {
    return this.walletService.setWithdrawalStatus(Number(customerId), id, 'PAID', Number(userId), body || {});
  }

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
