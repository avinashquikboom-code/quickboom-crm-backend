import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Response } from 'express';

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
    @CurrentUser() user: any,
    @Query('status') status?: InvoiceStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.invoiceService.findAll(
      customerId,
      {
        status,
        search,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
      },
      user,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single invoice details' })
  async findOne(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.invoiceService.findOne(customerId, id, user);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download final tax invoice PDF' })
  async downloadInvoice(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    return this.invoiceService.downloadInvoicePdf(customerId, id, user, res);
  }

  @Post()
  @ApiOperation({ summary: 'Create new invoice' })
  async create(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoiceService.create(customerId, dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update invoice status' })
  async update(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoiceService.update(customerId, id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel invoice' })
  async remove(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.invoiceService.remove(customerId, id, user);
  }
}
