import {
  BadRequestException,
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
import { CreateInvoiceDto, UpdateInvoiceDto, BulkDeleteInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { Response } from 'express';

@ApiTags('Invoices & Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller(['invoices', 'admin/invoices'])
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get()
  @ApiOperation({ summary: 'Get all invoices with filtering' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'clientId', required: false })
  async findAll(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Query('status') status?: InvoiceStatus | string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('customerId') queryCustomerId?: string,
    @Query('clientId') queryClientId?: string,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const explicitCustomer = queryCustomerId || queryClientId;
    // For SUPER_ADMIN without explicit customer query, do not restrict to any customer (show all platform invoices).
    // For normal customer or tenant admin, scope to their customerId.
    const targetCustomerId = explicitCustomer || (isSuperAdmin ? undefined : customerId);
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    console.log('[INVOICE_DEBUG]', {
      userId: user?.id,
      role: user?.role,
      isSuperAdmin,
      explicitCustomer,
      targetCustomerId: targetCustomerId || 'ALL_PLATFORM',
      page: pageNum,
      limit: limitNum,
      status,
    });

    const response = await this.invoiceService.findAll(
      targetCustomerId,
      {
        status: status as any,
        search,
        customerId: queryCustomerId || queryClientId,
        page: pageNum,
        limit: limitNum,
      },
      user,
    );

    console.log('[ADMIN_INVOICE_RESPONSE]', {
      status: 200,
      count: response?.data?.length || response?.items?.length || 0,
      total: response?.pagination?.total || response?.meta?.total || 0,
      summary: response?.summary,
    });

    return response;
  }

  @Get('customers/:customerId/invoices')
  @ApiOperation({ summary: 'Get invoices for specific customer' })
  async findCustomerInvoices(
    @Param('customerId') custId: string,
    @CurrentUser() user: any,
    @Query('status') status?: InvoiceStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.findAll(custId, user, status, search, page, limit, custId);
  }

  @Get('admin/customers/:customerId/invoices')
  @ApiOperation({ summary: 'Get invoices for specific customer (Admin alias)' })
  async findAdminCustomerInvoices(
    @Param('customerId') custId: string,
    @CurrentUser() user: any,
    @Query('status') status?: InvoiceStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.findAll(custId, user, status, search, page, limit, custId);
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

  /**
   * POST /api/v1/invoices/bulk-delete
   *
   * Bulk soft-delete selected invoices.  Accepts either:
   *   { "ids": [1, 2, 3] }           ← Admin Panel frontend
   *   { "invoiceIds": [1, 2, 3] }    ← alternative API consumers
   *
   * - Requires JWT + Admin/Super Admin role (enforced in service)
   * - Scoped to caller's tenant (enforced in service)
   * - Atomic Prisma transaction with per-invoice audit log entries
   *
   * NOTE: NestJS does NOT support stacking multiple @Post()/@Delete()
   * decorators on a single method — only the last applied decorator
   * survives.  This is the single, authoritative bulk-delete route.
   */
  @Post('bulk-delete')
  @ApiOperation({ summary: 'Bulk delete invoices by ID list (Admin only)' })
  async bulkRemove(
    @Body() dto: BulkDeleteInvoiceDto,
    @CurrentUser() user: any,
  ) {
    const resolvedIds = dto.resolvedIds;
    if (!resolvedIds || resolvedIds.length === 0) {
      throw new BadRequestException(
        'Request body must contain a non-empty "ids" or "invoiceIds" array',
      );
    }
    return this.invoiceService.bulkRemove(resolvedIds, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete invoice (Admin)' })
  async remove(
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.invoiceService.remove(customerId, id, user);
  }
}
