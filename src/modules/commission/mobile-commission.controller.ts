import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommissionWalletService } from './commission-wallet.service';

@ApiTags('Mobile Commission Wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('mobile/commission')
export class MobileCommissionController {
  constructor(private readonly wallet: CommissionWalletService) {}

  @Get('wallet')
  walletBalance(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string) {
    return this.wallet.wallet(Number(customerId), Number(userId));
  }

  @Get('earnings')
  earnings(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string, @Query() query: any) {
    return this.wallet.earnings(Number(customerId), Number(userId), query);
  }

  @Get('summary')
  summary(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string, @Query() query: any) {
    return this.wallet.earnings(Number(customerId), Number(userId), query);
  }

  @Get('rules')
  rules(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string) {
    return this.wallet.rules(Number(customerId), Number(userId));
  }

  @Get('transactions')
  transactions(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string, @Query() query: any) {
    return this.wallet.transactions(Number(customerId), Number(userId), query);
  }

  @Get('withdrawals')
  listWithdrawals(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string) {
    return this.wallet.withdrawals(Number(customerId), Number(userId));
  }

  @Post('withdrawals')
  createWithdrawal(@CurrentCustomer() customerId: string, @CurrentUser('id') userId: string, @Body() body: any) {
    return this.wallet.requestWithdrawal(Number(customerId), Number(userId), body);
  }

  @Get('quota')
  quota(@CurrentCustomer() customerId: string, @CurrentUser() user: any) {
    return this.wallet.quota(Number(customerId), user);
  }
}
