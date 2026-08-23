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
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Invoices & Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get()
  @ApiOperation({ summary: 'Get all invoices with filtering' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @Query('status') status?: InvoiceStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.invoiceService.findAll(customerId, {
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single invoice details' })
  async findOne(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.invoiceService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new invoice' })
  async create(
    @CurrentCustomer() customerId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoiceService.create(customerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update invoice status' })
  async update(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoiceService.update(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel invoice' })
  async remove(
    @CurrentCustomer() customerId: string,
    @Param('id') id: string,
  ) {
    return this.invoiceService.remove(customerId, id);
  }
}
