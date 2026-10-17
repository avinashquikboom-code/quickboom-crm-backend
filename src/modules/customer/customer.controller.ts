import { CustomerBillingAccess } from '../../common/decorators/customer-billing.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsInt, Min, IsString, MinLength, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CustomerService } from './customer.service';
class CustomerAccountDto {
  @IsString() @MinLength(10) @MaxLength(128) password: string;
}
class LinkCustomerUserDto {
  @IsInt() @Min(1) userId: number;
}
@CustomerBillingAccess()
@Controller()
@UseGuards(JwtAuthGuard)
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}
  @Get('customers') list(
    @CurrentUser() user: any,
    @Query('search') search?: string,
  ) {
    return this.customers.list(user, search);
  }
  @Get('customers/me') me(@CurrentUser() user: any) {
    return this.customers
      .authorize(user)
      .then((c) => this.customers.detail(user, c.id));
  }
  @Get('customers/:id') detail(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.customers.detail(user, id);
  }
  @Patch('customers/:id/user') link(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LinkCustomerUserDto,
  ) {
    return this.customers.linkUser(id, dto.userId, user);
  }
  @Post('customers/:id/account') account(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CustomerAccountDto,
  ) {
    return this.customers.createAccount(id, dto.password, user);
  }
  @Get('subscriptions/quote/:planId') quote(
    @Param('planId', ParseIntPipe) id: number,
    @Query('billingCycle') cycle?: string,
  ) {
    return this.customers.quote(id, cycle);
  }
  @Post('subscriptions/:id/cancel') cancel(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.customers.cancel(id, user);
  }
}
