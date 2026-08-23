import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    customerId: number | string,
    query: { status?: InvoiceStatus; page?: number; limit?: number; search?: string },
  ) {
    const numCustomerId = Number(customerId);
    if (!numCustomerId || Number.isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new UnauthorizedException('Customer context is required');
    }

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId, deletedAt: null };

    if (query.status && (query.status as string) !== 'ALL') {
      where.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { invoiceNo: { contains: q, mode: 'insensitive' } },
        { contact: { firstName: { contains: q, mode: 'insensitive' } } },
        { contact: { lastName: { contains: q, mode: 'insensitive' } } },
        { notes: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issueDate: 'desc' },
        include: {
          contact: true,
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    const formatted = items.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNo,
      invoiceNo: inv.invoiceNo,
      clientName: inv.contact
        ? `${inv.contact.firstName || ''} ${inv.contact.lastName || ''}`.trim()
        : 'Acme Enterprises',
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      amount: `₹${Number(inv.totalAmount || 0).toLocaleString('en-IN')}`,
      totalAmount: Number(inv.totalAmount || 0),
      subTotal: Number(inv.subTotal || 0),
      taxAmount: Number(inv.taxAmount || 0),
      status: inv.status,
      notes: inv.notes,
      contact: inv.contact,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: formatted,
      items: formatted,
      pagination: {
        page,
        pageSize: limit,
        limit,
        total,
        totalPages,
      },
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async findOne(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    if (!numCustomerId || Number.isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new UnauthorizedException('Customer context is required');
    }

    const numId = Number(id);
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: numId,
        customerId: numCustomerId,
        deletedAt: null,
      },
      include: {
        contact: true,
        items: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return invoice;
  }

  async create(customerId: number | string, dto: CreateInvoiceDto) {
    const numCustomerId = Number(customerId);
    if (!numCustomerId || Number.isNaN(numCustomerId) || numCustomerId <= 0) {
      throw new UnauthorizedException('Customer context is required');
    }

    // Verify contact belongs to the authenticated customer
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: Number(dto.contactId),
        customerId: numCustomerId,
        deletedAt: null,
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${dto.contactId} not found for this customer`);
    }

    return this.prisma.invoice.create({
      data: {
        customerId: numCustomerId,
        contactId: contact.id,
        invoiceNo: dto.invoiceNo,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        subTotal: Number(dto.subTotal) || 0,
        taxAmount: Number(dto.taxAmount) || 0,
        totalAmount: Number(dto.totalAmount) || 0,
        notes: dto.notes,
        status: InvoiceStatus.DRAFT,
      },
      include: {
        contact: true,
      },
    });
  }

  async update(customerId: number | string, id: number | string, dto: UpdateInvoiceDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.invoice.update({
      where: { id: numId },
      data: {
        ...(dto.status && { status: dto.status }),
      },
      include: {
        contact: true,
      },
    });
  }

  async remove(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.invoice.update({
      where: { id: numId },
      data: { deletedAt: new Date(), status: InvoiceStatus.CANCELLED },
    });
  }
}
