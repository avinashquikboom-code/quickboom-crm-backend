import { CustomerBillingAccess } from '../../common/decorators/customer-billing.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  IsInt,
  Min,
  IsString,
  MinLength,
  MaxLength,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsBoolean,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CustomerService } from './customer.service';
export class BulkDeleteCustomersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[];

  @IsOptional()
  @IsBoolean()
  cancelSubscriptions?: boolean;
}
export class LinkCustomerCompanyDto {
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  companyId: number | null;
}
export class AssignCustomerTeamDto {
  @ValidateIf((_object, value) => value !== null)
  @IsInt() @Min(1) teamId: number | null;
}
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
  @Post(['customers/bulk-delete', 'customers/bulk'])
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  bulkDelete(
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteCustomersDto,
    @Query('cancelSubscriptions') cancelQuery?: string,
  ) {
    const cancel = dto?.cancelSubscriptions ?? (cancelQuery === undefined || cancelQuery === 'true' || cancelQuery === '1');
    const ids = dto?.ids || [];
    return this.customers.bulkRemove(ids, user, cancel);
  }
  // Nest method decorators overwrite each other; keep compatibility on its own handler.
  @Delete(['customers/bulk-delete', 'customers/bulk'])
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  bulkDeleteViaDelete(
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteCustomersDto,
    @Query('cancelSubscriptions') cancelQuery?: string,
  ) {
    return this.bulkDelete(user, dto, cancelQuery);
  }
  @Patch('customers/:id/assign-team')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  assignTeam(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignCustomerTeamDto) {
    return this.customers.assignTeam(id, dto.teamId, user);
  }
  @Patch('customers/:id/company')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  linkCompany(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LinkCustomerCompanyDto,
  ) {
    return this.customers.linkCrmCompany(id, dto.companyId, user);
  }
  @Delete('customers/:id') remove(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('cancelSubscriptions') cancelQuery?: string,
  ) {
    const cancel = cancelQuery === undefined || cancelQuery === 'true' || cancelQuery === '1';
    return this.customers.remove(id, user, cancel);
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
