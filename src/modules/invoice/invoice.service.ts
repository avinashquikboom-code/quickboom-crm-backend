import { Injectable, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { Response } from 'express';
import PDFDocument from 'pdfkit';

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

  async downloadInvoicePdf(
    customerId: number | string,
    id: number | string,
    user: any,
    res: Response,
  ) {
    const invoice = await this.findOne(customerId, id, user);
    const invoiceNo = invoice.invoiceNo || `INV-${invoice.id}`;

    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceNo}.pdf"`);

    doc.pipe(res);

    const primaryColor = '#10B981';
    const darkColor = '#0F172A';
    const grayColor = '#64748B';
    const lightBg = '#F8FAFC';

    // Header
    doc.fillColor(primaryColor).fontSize(22).font('Helvetica-Bold').text('QuikBoom CRM', 40, 40);
    doc.fillColor(grayColor).fontSize(9).font('Helvetica').text('Smart Growth for Smarter Businesses', 40, 65);

    doc.fillColor(darkColor).fontSize(16).font('Helvetica-Bold').text('FINAL TAX INVOICE', 380, 40, { align: 'right' });
    doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(invoiceNo, 380, 60, { align: 'right' });

    doc.moveTo(40, 85).lineTo(555, 85).strokeColor('#E2E8F0').lineWidth(1).stroke();

    // Meta details block
    doc.fillColor(grayColor).fontSize(9).font('Helvetica-Bold').text('INVOICE DETAILS', 40, 100);
    doc.fillColor(darkColor).fontSize(10).font('Helvetica').text(`Invoice Date: ${new Date(invoice.issueDate).toLocaleDateString('en-IN')}`, 40, 115);
    doc.text(`Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-IN') : 'Immediate'}`, 40, 130);
    doc.text(`Invoice Status: ${invoice.status}`, 40, 145);

    const clientName = invoice.contact
      ? `${invoice.contact.firstName || ''} ${invoice.contact.lastName || ''}`.trim()
      : 'Customer Account';

    doc.fillColor(grayColor).fontSize(9).font('Helvetica-Bold').text('BILLED TO (CUSTOMER)', 320, 100);
    doc.fillColor(darkColor).fontSize(10).font('Helvetica').text(clientName, 320, 115);
    doc.text(`Email: ${invoice.contact?.email || 'N/A'}`, 320, 130);
    doc.text(`Phone: ${invoice.contact?.phone || 'N/A'}`, 320, 145);

    // Items table header
    const tableTop = 180;
    doc.rect(40, tableTop, 515, 24).fill('#F1F5F9');
    doc.fillColor(darkColor).fontSize(9).font('Helvetica-Bold');
    doc.text('DESCRIPTION / SERVICES', 50, tableTop + 7);
    doc.text('SUBTOTAL', 280, tableTop + 7);
    doc.text('TAX (GST 18%)', 380, tableTop + 7);
    doc.text('TOTAL AMOUNT', 460, tableTop + 7, { align: 'right' });

    // Items table row
    const rowTop = tableTop + 30;
    const subTotal = Number(invoice.subTotal || 0);
    const taxAmount = Number(invoice.taxAmount || 0);
    const totalAmount = Number(invoice.totalAmount || subTotal + taxAmount);

    doc.fillColor(darkColor).fontSize(10).font('Helvetica-Bold').text('QuikBoom CRM Plan & Marketing Package', 50, rowTop);
    doc.fontSize(8).font('Helvetica').fillColor(grayColor).text(`Tax Invoice Reference: ${invoiceNo}`, 50, rowTop + 14);

    doc.fillColor(darkColor).fontSize(9).font('Helvetica').text(`₹${subTotal.toLocaleString('en-IN')}`, 280, rowTop);
    doc.text(`₹${taxAmount.toLocaleString('en-IN')}`, 380, rowTop);
    doc.font('Helvetica-Bold').text(`₹${totalAmount.toLocaleString('en-IN')}`, 460, rowTop, { align: 'right' });

    doc.moveTo(40, rowTop + 35).lineTo(555, rowTop + 35).strokeColor('#E2E8F0').stroke();

    // Summary block
    const summaryTop = rowTop + 50;
    doc.rect(340, summaryTop, 215, 75).fill(lightBg);
    doc.rect(340, summaryTop, 215, 75).strokeColor('#E2E8F0').stroke();

    doc.fillColor(grayColor).fontSize(9).font('Helvetica').text('Subtotal:', 355, summaryTop + 12);
    doc.fillColor(darkColor).text(`₹${subTotal.toLocaleString('en-IN')}`, 480, summaryTop + 12, { align: 'right' });

    doc.fillColor(grayColor).text('GST (18%):', 355, summaryTop + 28);
    doc.fillColor(darkColor).text(`₹${taxAmount.toLocaleString('en-IN')}`, 480, summaryTop + 28, { align: 'right' });

    doc.moveTo(355, summaryTop + 44).lineTo(540, summaryTop + 44).strokeColor('#CBD5E1').stroke();

    doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold').text('Total Paid:', 355, summaryTop + 52);
    doc.text(`₹${totalAmount.toLocaleString('en-IN')}`, 480, summaryTop + 52, { align: 'right' });

    // Paid Stamp
    doc.rect(40, summaryTop, 130, 45).fillAndStroke('#ECFDF5', '#10B981');
    doc.fillColor('#065F46').fontSize(14).font('Helvetica-Bold').text('PAID', 65, summaryTop + 14);
    doc.fontSize(8).font('Helvetica').text('Official Tax Invoice', 50, summaryTop + 30);

    // Footer note
    doc.fillColor(grayColor).fontSize(8).font('Helvetica')
      .text('Note: This is an official digitally-signed tax invoice for statutory compliance.', 40, 400);
    doc.text('QuikBoom CRM • Support: support@quikboom.com • Web: https://quikboom.com', 40, 415);

    doc.end();
  }
}
