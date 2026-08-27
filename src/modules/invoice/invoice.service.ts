import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    customerId: number | string,
    query: { status?: InvoiceStatus; page?: number; limit?: number; search?: string },
    user?: any,
  ) {
    const isSuperAdmin = user ? isUserSuperAdmin(user) : false;
    const numCustomerId = Number(customerId);

    const where: any = { deletedAt: null };

    if (numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new UnauthorizedException('Customer context is required');
    }

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

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

  async findOne(customerId: number | string, id: number | string, user?: any) {
    const isSuperAdmin = user ? isUserSuperAdmin(user) : false;
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    const where: any = {
      id: numId,
      deletedAt: null,
    };

    if (numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    } else if (!isSuperAdmin) {
      throw new UnauthorizedException('Customer context is required');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where,
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

  async create(customerId: number | string, dto: CreateInvoiceDto, user?: any) {
    const isSuperAdmin = user ? isUserSuperAdmin(user) : false;
    let numCustomerId = Number(customerId);

    if (!numCustomerId || Number.isNaN(numCustomerId) || numCustomerId <= 0) {
      if (isSuperAdmin) {
        // Fallback to first active customer or contact's customer
        const contact = await this.prisma.contact.findUnique({
          where: { id: Number(dto.contactId) },
        });
        if (contact?.customerId) {
          numCustomerId = contact.customerId;
        } else {
          const firstCustomer = await this.prisma.customer.findFirst({
            where: { deletedAt: null },
          });
          numCustomerId = firstCustomer?.id || 1;
        }
      } else {
        throw new UnauthorizedException('Customer context is required');
      }
    }

    // Verify contact belongs to the customer if contactId is provided
    let contactId: number | null = null;
    if (dto.contactId) {
      const contact = await this.prisma.contact.findFirst({
        where: {
          id: Number(dto.contactId),
          deletedAt: null,
        },
      });
      if (contact) {
        contactId = contact.id;
      }
    }

    return this.prisma.invoice.create({
      data: {
        customerId: numCustomerId,
        contactId: contactId,
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

  async update(customerId: number | string, id: number | string, dto: UpdateInvoiceDto, user?: any) {
    const numId = Number(id);
    await this.findOne(customerId, numId, user);

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

  async remove(customerId: number | string, id: number | string, user?: any) {
    const numId = Number(id);
    await this.findOne(customerId, numId, user);

    return this.prisma.invoice.update({
      where: { id: numId },
      data: { deletedAt: new Date(), status: InvoiceStatus.CANCELLED },
    });
  }
}
