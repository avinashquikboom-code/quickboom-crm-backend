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
import { ClaimService } from './claim.service';
import { CreateClaimDto, UpdateClaimDto, ApproveClaimDto, RejectClaimDto, PayClaimDto } from './dto/claim.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClaimStatus } from '@prisma/client';

@ApiTags('HRM Expense Claims')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('claims')
export class ClaimController {
  constructor(private readonly claimService: ClaimService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Get summary metrics for employee expense claims' })
  async getMetrics(@CurrentCustomer() customerId: any) {
    return this.claimService.getMetrics(customerId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all employee claims with category and status filtering' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ClaimStatus })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: ClaimStatus,
    @Query('category') category?: string,
    @Query('employeeId') employeeId?: string,
    @Query('search') search?: string,
  ) {
    return this.claimService.findAll(customerId, {
      user,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
      category,
      employeeId: employeeId ? Number(employeeId) : undefined,
      search,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single claim details' })
  async findOne(@CurrentCustomer() customerId: any, @Param('id') id: string) {
    return this.claimService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Submit a new employee expense claim' })
  async create(
    @CurrentUser() user: any,
    @CurrentCustomer() customerId: any,
    @Body() dto: CreateClaimDto,
  ) {
    return this.claimService.create(customerId, dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update claim details' })
  async update(
    @CurrentCustomer() customerId: any,
    @Param('id') id: string,
    @Body() dto: UpdateClaimDto,
  ) {
    return this.claimService.update(customerId, id, dto);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve reimbursement claim' })
  async approve(
    @CurrentCustomer() customerId: any,
    @Param('id') id: string,
    @Body() dto: ApproveClaimDto,
    @CurrentUser() user: any,
  ) {
    return this.claimService.approve(customerId, id, dto, user);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject expense claim' })
  async reject(
    @CurrentCustomer() customerId: any,
    @Param('id') id: string,
    @Body() dto: RejectClaimDto,
    @CurrentUser() user: any,
  ) {
    return this.claimService.reject(customerId, id, dto, user);
  }

  @Patch(':id/pay')
  @ApiOperation({ summary: 'Mark approved claim as paid/reimbursed' })
  async markAsPaid(
    @CurrentCustomer() customerId: any,
    @Param('id') id: string,
    @Body() dto: PayClaimDto,
  ) {
    return this.claimService.markAsPaid(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete claim record' })
  async remove(@CurrentCustomer() customerId: any, @Param('id') id: string) {
    return this.claimService.remove(customerId, id);
  }
}
