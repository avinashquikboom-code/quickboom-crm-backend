import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';

@ApiTags('Invoices & Payments')
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get()
  @ApiOperation({ summary: 'Get all invoices with filtering' })
  async findAll(
    @Query('customerId') customerIdQuery?: string,
    @Query('status') status?: InvoiceStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.invoiceService.findAll(
      customerId,
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single invoice details' })
  async findOne(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.invoiceService.findOne(customerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new invoice' })
  async create(
    @Body() dto: CreateInvoiceDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.invoiceService.create(customerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update invoice status' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.invoiceService.update(customerId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel invoice' })
  async remove(
    @Param('id') id: string,
    @Query('customerId') customerIdQuery?: string,
  ) {
    const customerId = customerIdQuery || 'default-customer';
    return this.invoiceService.remove(customerId, id);
  }
}
