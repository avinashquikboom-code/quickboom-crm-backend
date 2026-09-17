import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LoanService } from './loan.service';
import { CreateLoanDto, UpdateLoanDto, ApproveLoanDto, RejectLoanDto } from './dto/loan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LoanStatus } from '@prisma/client';

@ApiTags('HRM Loans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller(['loans', 'admin/loans'])
export class LoanController {
  constructor(private readonly loanService: LoanService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Get summary metrics for employee loans' })
  async getMetrics(@CurrentCustomer() customerId: any) {
    return this.loanService.getMetrics(customerId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all employee loans with filtering' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false, enum: LoanStatus })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: LoanStatus,
    @Query('employeeId') employeeId?: string,
    @Query('search') search?: string,
  ) {
    return this.loanService.findAll(customerId, {
      user,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
      employeeId: employeeId ? Number(employeeId) : undefined,
      search,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single loan details' })
  async findOne(@CurrentCustomer() customerId: any, @Param('id') id: string) {
    return this.loanService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new employee loan request' })
  async create(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Body() dto: CreateLoanDto,
  ) {
    return this.loanService.create(customerId, dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update loan details' })
  async update(
    @CurrentCustomer() customerId: any,
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ) {
    return this.loanService.update(customerId, id, dto);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve and activate employee loan' })
  async approve(
    @CurrentCustomer() customerId: any,
    @Param('id') id: string,
    @Body() dto: ApproveLoanDto,
    @CurrentUser() user: any,
  ) {
    return this.loanService.approve(customerId, id, dto, user);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject employee loan request' })
  async reject(
    @CurrentCustomer() customerId: any,
    @Param('id') id: string,
    @Body() dto: RejectLoanDto,
    @CurrentUser() user: any,
  ) {
    return this.loanService.reject(customerId, id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete loan record' })
  async remove(@CurrentCustomer() customerId: any, @Param('id') id: string) {
    return this.loanService.remove(customerId, id);
  }
}
