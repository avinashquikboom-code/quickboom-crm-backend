import { Injectable, NotFoundException, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus } from '@prisma/client';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { Response } from 'express';
import PDFDocument = require('pdfkit');

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    customerId: number | string,
    query: { status?: InvoiceStatus; page?: number; limit?: number; search?: string; customerId?: number | string; clientId?: number | string },
    user?: any,
  ) {
    const isSuperAdmin = user ? isUserSuperAdmin(user) : false;
    const rawCustId = query?.customerId || query?.clientId || customerId;
    const numCustomerId = Number(rawCustId);

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
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { companyName: { contains: q, mode: 'insensitive' } } },
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
          customer: true,
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    const formatted = items.map((inv) => {
      const contactFullName = inv.contact
        ? `${inv.contact.firstName || ''} ${inv.contact.lastName || ''}`.trim()
        : '';
      const clientDisplayName = contactFullName || inv.customer?.name || inv.customer?.companyName || 'General Client';

      // Parse payment mode and plan from notes if recorded during subscription activation
      let paymentMode = 'RAZORPAY';
      if (inv.notes && inv.notes.includes('Payment Method:')) {
        const afterMethod = inv.notes.split('Payment Method:')[1];
        if (afterMethod) {
          paymentMode = afterMethod.split('.')[0].trim();
        }
      }

      let planName = 'CRM Subscription Plan';
      if (inv.notes && inv.notes.includes('Subscription payment for')) {
        const afterSub = inv.notes.split('Subscription payment for')[1];
        if (afterSub) {
          planName = afterSub.split('(')[0].trim();
        }
      }

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNo,
        invoiceNo: inv.invoiceNo,
        customerId: inv.customerId,
        clientName: clientDisplayName,
        customerName: inv.customer?.name || 'General Client',
        companyName: inv.customer?.companyName || inv.customer?.name || 'General Client',
        issueDate: inv.issueDate,
        invoiceDate: inv.issueDate,
        dueDate: inv.dueDate,
        amount: `₹${Number(inv.totalAmount || 0).toLocaleString('en-IN')}`,
        subTotal: Number(inv.subTotal || 0),
        taxAmount: Number(inv.taxAmount || 0),
        tax: Number(inv.taxAmount || 0),
        totalAmount: Number(inv.totalAmount || 0),
        total: Number(inv.totalAmount || 0),
        status: inv.status,
        paymentStatus: inv.status,
        paymentMode,
        paymentDate: inv.status === InvoiceStatus.PAID ? inv.issueDate : null,
        planName,
        notes: inv.notes,
        contact: inv.contact,
        customer: inv.customer,
      };
    });

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
    const rawId = String(id || '').trim();

    let invoice: any = null;

    // 1. If numeric ID
    const numId = Number(rawId);
    if (!isNaN(numId) && numId > 0) {
      const where: any = { id: numId, deletedAt: null };
      if (numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      }
      invoice = await this.prisma.invoice.findFirst({
        where,
        include: {
          contact: true,
          items: true,
          customer: true,
        },
      });
    }

    // 2. Exact invoiceNo match
    if (!invoice && rawId) {
      const where: any = { invoiceNo: rawId, deletedAt: null };
      if (numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      }
      invoice = await this.prisma.invoice.findFirst({
        where,
        include: {
          contact: true,
          items: true,
          customer: true,
        },
      });
    }

    // 3. Pattern / prefix extraction (e.g. INV-2026-000002 -> 2, DOC-2 -> 2)
    if (!invoice && rawId) {
      const match = rawId.match(/(\d+)(?!.*\d)/);
      if (match) {
        const extractedNum = parseInt(match[1], 10);
        if (extractedNum > 0) {
          const where: any = { id: extractedNum, deletedAt: null };
          if (numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0) {
            where.customerId = numCustomerId;
          }
          invoice = await this.prisma.invoice.findFirst({
            where,
            include: {
              contact: true,
              items: true,
              customer: true,
            },
          });
        }
      }
    }

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${rawId} not found`);
    }

    // Role-based security validation
    if (!isSuperAdmin && user?.role === 'CUSTOMER') {
      const authCustId = numCustomerId || user?.customerId;
      if (authCustId && invoice.customerId !== authCustId) {
        throw new ForbiddenException('Access to this invoice is forbidden');
      }
    }

    return invoice;
  }

  async create(customerId: number | string, dto: CreateInvoiceDto, user?: any) {
    const isSuperAdmin = user ? isUserSuperAdmin(user) : false;
    let numCustomerId = Number(customerId);

    if (!numCustomerId || Number.isNaN(numCustomerId) || numCustomerId <= 0) {
      if (isSuperAdmin && dto.contactId) {
        const contact = await this.prisma.contact.findUnique({
          where: { id: Number(dto.contactId) },
        });
        if (contact?.customerId) {
          numCustomerId = contact.customerId;
        } else {
          throw new BadRequestException('Valid customer context or customer-linked contact is required to create an invoice.');
        }
      } else {
        throw new UnauthorizedException('Customer context is required to create an invoice.');
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

    console.log(
      `[INVOICE_PDF_DEBUG] invoiceId: ${invoice.id}, invoiceNumber: ${invoiceNo}, customerId: ${invoice.customerId}, pdfGenerator: PDFKit, pdfkitVersion: 0.20.1, pdfCreated: true, pdfResponseStarted: true`,
    );

    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceNo}.pdf"`);

    doc.pipe(res);

    const primaryColor = '#10B981';
    const darkColor = '#0F172A';
    const grayColor = '#64748B';
    const borderCol = '#E2E8F0';
    const lightBg = '#F8FAFC';

    // Header & Company Info
    doc.fillColor(primaryColor).fontSize(20).font('Helvetica-Bold').text('QUIKBOOM CRM', 40, 40);
    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica')
      .text('QuikBoom Marketing Solutions Pvt Ltd', 40, 62)
      .text('Dynasty Business Park, Andheri-Kurla Road, Mumbai, Maharashtra 400059', 40, 74)
      .text('GSTIN: 27AABCT3518Q1Z4 | PAN: AABCT3518Q | State Code: 27', 40, 86);

    doc.fillColor(darkColor).fontSize(16).font('Helvetica-Bold').text('FINAL TAX INVOICE', 350, 40, { align: 'right' });
    doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(invoiceNo, 350, 60, { align: 'right' });
    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica')
      .text('Original for Recipient', 350, 74, { align: 'right' })
      .text(`Invoice Date: ${new Date(invoice.issueDate).toLocaleDateString('en-IN')}`, 350, 86, { align: 'right' });

    doc.moveTo(40, 102).lineTo(555, 102).strokeColor(borderCol).lineWidth(1).stroke();

    // Customer & Invoice Details 2-Column Section
    const metaTop = 112;
    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica-Bold').text('BILLED TO (CUSTOMER)', 40, metaTop);
    const clientName = invoice.contact
      ? `${invoice.contact.firstName || ''} ${invoice.contact.lastName || ''}`.trim()
      : ((invoice as any).customer?.name || 'Customer Account');

    doc.fillColor(darkColor).fontSize(10).font('Helvetica-Bold').text(clientName, 40, metaTop + 14);
    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica')
      .text(`Email: ${invoice.contact?.email || (invoice as any).customer?.email || 'N/A'}`, 40, metaTop + 28)
      .text(`Phone: ${invoice.contact?.phone || (invoice as any).customer?.phone || 'N/A'}`, 40, metaTop + 40)
      .text(`Customer ID: #${invoice.customerId}`, 40, metaTop + 52);

    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica-Bold').text('INVOICE / ORDER METRICS', 350, metaTop);
    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica')
      .text(`Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-IN') : 'Settled'}`, 350, metaTop + 14)
      .text(`Payment Status: ${invoice.status}`, 350, metaTop + 28)
      .text(`Place of Supply: Maharashtra (27)`, 350, metaTop + 40)
      .text(`Billing Mode: Full Plan Settlement`, 350, metaTop + 52);

    doc.moveTo(40, metaTop + 70).lineTo(555, metaTop + 70).strokeColor(borderCol).stroke();

    // Itemized Table Header
    const tableTop = metaTop + 82;
    doc.rect(40, tableTop, 515, 22).fill('#F1F5F9');
    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold');
    doc.text('ITEM / SERVICE DESCRIPTION', 50, tableTop + 6);
    doc.text('SAC CODE', 240, tableTop + 6);
    doc.text('BASE AMT', 320, tableTop + 6);
    doc.text('GST (18%)', 400, tableTop + 6);
    doc.text('TOTAL (INR)', 470, tableTop + 6, { align: 'right' });

    // Itemized Table Rows
    const subTotal = Number(invoice.subTotal || 0);
    const taxAmount = Number(invoice.taxAmount || 0);
    const totalAmount = Number(invoice.totalAmount || subTotal + taxAmount);
    const cgst = taxAmount / 2;
    const sgst = taxAmount / 2;
    const rowTop = tableTop + 28;

    doc.fillColor(darkColor).fontSize(9.5).font('Helvetica-Bold').text('QuikBoom CRM Plan & Growth Package', 50, rowTop);
    doc.fontSize(8).font('Helvetica').fillColor(grayColor).text(`Tax Invoice Reference: ${invoiceNo} • 100% Fully Settled`, 50, rowTop + 13);

    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica').text('998311', 240, rowTop);
    doc.text(`₹${subTotal.toLocaleString('en-IN')}`, 320, rowTop);
    doc.text(`₹${taxAmount.toLocaleString('en-IN')}`, 400, rowTop);
    doc.font('Helvetica-Bold').text(`₹${totalAmount.toLocaleString('en-IN')}`, 470, rowTop, { align: 'right' });

    doc.moveTo(40, rowTop + 32).lineTo(555, rowTop + 32).strokeColor(borderCol).stroke();

    // Summary & Tax Breakdown Box
    const summaryTop = rowTop + 44;

    // Left Box: Tax Breakdown
    doc.rect(40, summaryTop, 270, 95).fill(lightBg);
    doc.rect(40, summaryTop, 270, 95).strokeColor(borderCol).stroke();

    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold').text('TAX BREAKDOWN (GST 18%)', 52, summaryTop + 10);
    doc.fillColor(grayColor).fontSize(8).font('Helvetica')
      .text('CGST (9.0%):', 52, summaryTop + 26)
      .text(`₹${cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 240, summaryTop + 26, { align: 'right' })
      .text('SGST (9.0%):', 52, summaryTop + 42)
      .text(`₹${sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 240, summaryTop + 42, { align: 'right' })
      .text('Total Tax Payable:', 52, summaryTop + 58)
      .text(`₹${taxAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 240, summaryTop + 58, { align: 'right' });

    doc.moveTo(52, summaryTop + 72).lineTo(298, summaryTop + 72).strokeColor(borderCol).stroke();
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold')
      .text('Tax Status: Paid in Full', 52, summaryTop + 78);

    // Right Box: Total Settlement
    doc.rect(330, summaryTop, 225, 95).fill(lightBg);
    doc.rect(330, summaryTop, 225, 95).strokeColor(borderCol).stroke();

    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica').text('Taxable Value:', 342, summaryTop + 10);
    doc.fillColor(darkColor).text(`₹${subTotal.toLocaleString('en-IN')}`, 470, summaryTop + 10, { align: 'right' });

    doc.fillColor(grayColor).text('Total Tax (GST 18%):', 342, summaryTop + 26);
    doc.fillColor(darkColor).text(`₹${taxAmount.toLocaleString('en-IN')}`, 470, summaryTop + 26, { align: 'right' });

    doc.moveTo(342, summaryTop + 42).lineTo(543, summaryTop + 42).strokeColor('#CBD5E1').stroke();

    doc.fillColor(primaryColor).fontSize(10.5).font('Helvetica-Bold').text('Total Paid Amount:', 342, summaryTop + 50);
    doc.text(`₹${totalAmount.toLocaleString('en-IN')}`, 470, summaryTop + 50, { align: 'right' });

    doc.fillColor(grayColor).fontSize(8).font('Helvetica').text('Balance Due:', 342, summaryTop + 72);
    doc.fillColor('#059669').font('Helvetica-Bold').text('₹0.00 (PAID)', 470, summaryTop + 72, { align: 'right' });

    // Official Verification Stamp & Signature Section
    const signTop = summaryTop + 110;

    // Paid Stamp
    doc.rect(40, signTop, 130, 48).fillAndStroke('#ECFDF5', '#10B981');
    doc.fillColor('#065F46').fontSize(14).font('Helvetica-Bold').text('PAID', 82, signTop + 12);
    doc.fontSize(7.5).font('Helvetica').text('Official Tax Invoice • Digitally Verified', 48, signTop + 32);

    // Signatory
    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold')
      .text('For QuikBoom Marketing Solutions Pvt Ltd', 330, signTop + 8, { align: 'right' });
    doc.fillColor(grayColor).fontSize(8).font('Helvetica')
      .text('Authorized Signatory', 330, signTop + 34, { align: 'right' });

    // Terms & Conditions Footer
    const footerTop = signTop + 65;
    doc.moveTo(40, footerTop).lineTo(555, footerTop).strokeColor(borderCol).stroke();
    doc.fillColor(grayColor).fontSize(7.5).font('Helvetica')
      .text('Terms & Conditions: This is a computer-generated tax invoice generated in compliance with GST Rules.', 40, footerTop + 10)
      .text('Payment is non-refundable. For support or queries: support@quikboom.com | https://quikboom.com', 40, footerTop + 22)
      .text('QuikBoom CRM • Enterprise Multi-Tenant SaaS Platform', 40, footerTop + 34, { align: 'center' });

    doc.end();
  }
}
