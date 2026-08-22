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
import { CompanyService } from './company.service';
import { CreateCompanyDto, UpdateCompanyDto, CheckDuplicateCompanyDto } from './dto/company.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new client company / organization' })
  async create(@CurrentCustomer() customerId: string, @Body() dto: CreateCompanyDto) {
    return this.companyService.create(customerId, dto);
  }

  @Post('check-duplicate')
  @ApiOperation({ summary: 'Check if company already exists by name, phone, email, or Google Place ID' })
  async checkDuplicate(@CurrentCustomer() customerId: string, @Body() dto: CheckDuplicateCompanyDto) {
    return this.companyService.checkDuplicate(customerId, dto);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get summary metrics for company accounts' })
  async getMetrics(@CurrentCustomer() customerId: string) {
    return this.companyService.getMetrics(customerId);
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of companies' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'industry', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'assignedToId', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('industry') industry?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    return this.companyService.findAll(customerId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      search,
      industry,
      status,
      assignedToId,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get company details with contacts, deals, and visits' })
  async findOne(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.companyService.findOne(customerId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update company details' })
  async update(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companyService.update(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete company' })
  async remove(@CurrentCustomer() customerId: string, @Param('id') id: string) {
    return this.companyService.delete(customerId, id);
  }
}
