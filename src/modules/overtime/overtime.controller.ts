import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OvertimeService } from './overtime.service';
import {
  ApproveOvertimeDto,
  CancelOvertimeDto,
  CreateOvertimeDto,
  OvertimeQueryDto,
  RejectOvertimeDto,
  UpdateOvertimeSettingsDto,
} from './dto/overtime.dto';

@ApiTags('Overtime Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller(['admin/hrm/overtime', 'overtime'])
export class OvertimeController {
  constructor(private readonly overtimeService: OvertimeService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Overtime request counts, hours, and payable amounts' })
  summary(@CurrentUser() user: any, @CurrentCustomer() customerId: number | string | undefined, @Query() query: OvertimeQueryDto) {
    return this.overtimeService.getSummary(user, customerId, query);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Overtime limits and multipliers, using the salary policy regular multiplier' })
  settings(@CurrentCustomer() customerId: number | string | undefined) {
    return this.overtimeService.getSettings(customerId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update overtime limits. Regular multiplier is saved on the active salary policy.' })
  updateSettings(@CurrentCustomer() customerId: number | string | undefined, @Body() dto: UpdateOvertimeSettingsDto) {
    return this.overtimeService.updateSettings(customerId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List overtime requests' })
  findAll(@CurrentUser() user: any, @CurrentCustomer() customerId: number | string | undefined, @Query() query: OvertimeQueryDto) {
    return this.overtimeService.findAll(user, customerId, query);
  }

  @Post('my')
  @ApiOperation({ summary: 'Employee submits an overtime request for their own profile' })
  createMine(@CurrentUser() user: any, @CurrentCustomer() customerId: number | string | undefined, @Body() dto: CreateOvertimeDto) {
    return this.overtimeService.create(user, customerId, dto, true);
  }

  @Post()
  @ApiOperation({ summary: 'Create an overtime request' })
  create(@CurrentUser() user: any, @CurrentCustomer() customerId: number | string | undefined, @Body() dto: CreateOvertimeDto) {
    return this.overtimeService.create(user, customerId, dto, false);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'Preview compensation for an approved duration' })
  preview(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Query('approvedMinutes') approvedMinutes?: string,
  ) {
    return this.overtimeService.preview(user, customerId, id, approvedMinutes ? Number(approvedMinutes) : undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Overtime request details' })
  findOne(@CurrentUser() user: any, @CurrentCustomer() customerId: number | string | undefined, @Param('id', ParseIntPipe) id: number) {
    return this.overtimeService.findOne(user, customerId, id);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a pending overtime request and calculate compensation' })
  approve(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveOvertimeDto,
  ) {
    return this.overtimeService.approve(user, customerId, id, dto);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a pending overtime request' })
  reject(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectOvertimeDto,
  ) {
    return this.overtimeService.reject(user, customerId, id, dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a pending or unpaid approved overtime request' })
  cancel(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: number | string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelOvertimeDto,
  ) {
    return this.overtimeService.cancel(user, customerId, id, dto);
  }
}
