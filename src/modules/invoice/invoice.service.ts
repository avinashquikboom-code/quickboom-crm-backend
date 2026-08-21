import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(customerId: string, status?: InvoiceStatus, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const where: any = { customerId, deletedAt: null };

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

    return {
      items: formatted,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(customerId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, customerId, deletedAt: null },
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

  async create(customerId: string, dto: CreateInvoiceDto) {
    return this.prisma.invoice.create({
      data: {
        customerId,
        contactId: dto.contactId,
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

  async update(customerId: string, id: string, dto: UpdateInvoiceDto) {
    await this.findOne(customerId, id);
    return this.prisma.invoice.update({
      where: { id },
      data: dto,
    });
  }

  async remove(customerId: string, id: string) {
    await this.findOne(customerId, id);
    return this.prisma.invoice.update({
      where: { id },
      data: { deletedAt: new Date(), status: InvoiceStatus.CANCELLED },
    });
  }
}
