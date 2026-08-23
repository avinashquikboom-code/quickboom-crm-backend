import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId: number | string, status?: InvoiceStatus, page = 1, limit = 50) {
    const numCustomerId = Number(customerId);
    const skip = (page - 1) * limit;
    const where: any = { customerId: numCustomerId, deletedAt: null };

    if (status) where.status = status;

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
      clientName: inv.contact ? `${inv.contact.firstName} ${inv.contact.lastName}` : 'Acme Enterprises',
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      amount: `₹${Number(inv.totalAmount).toLocaleString('en-IN')}`,
      status: inv.status,
      notes: inv.notes,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: formatted,
      items: formatted,
      pagination: {
        page,
        pageSize: limit,
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
    const numId = Number(id);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: numId, customerId: numCustomerId, deletedAt: null },
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
    return this.prisma.invoice.create({
      data: {
        customerId: numCustomerId,
        contactId: Number(dto.contactId),
        invoiceNo: dto.invoiceNo,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        subTotal: dto.subTotal,
        taxAmount: dto.taxAmount,
        totalAmount: dto.totalAmount,
        notes: dto.notes,
        status: InvoiceStatus.DRAFT,
      },
    });
  }

  async update(customerId: number | string, id: number | string, dto: UpdateInvoiceDto) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.invoice.update({
      where: { id: numId },
      data: dto as any,
    });
  }

  async remove(customerId: number | string, id: number | string) {
    const numId = Number(id);
    await this.findOne(customerId, numId);
    return this.prisma.invoice.update({
      where: { id: numId },
      data: { deletedAt: new Date(), status: InvoiceStatus.CANCELLED },
    });
  }
}
