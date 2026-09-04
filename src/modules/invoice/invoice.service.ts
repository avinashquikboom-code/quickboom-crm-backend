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

  async reconcileCustomerInvoices(customerId: number): Promise<void> {
    if (!customerId || isNaN(customerId) || customerId <= 0) return;
    try {
      // Find all successful or paid paymentHistory records for this customer
      const successfulPayments = await this.prisma.paymentHistory.findMany({
        where: {
          customerId,
          status: { in: ['SUCCESS', 'PAID'] },
        },
        include: {
          subscription: {
            include: { plan: true },
          },
          customer: true,
        },
      });

      if (!successfulPayments.length) return;

      // Find existing invoices for this customer
      const existingInvoices = await this.prisma.invoice.findMany({
        where: { customerId, deletedAt: null },
      });

      for (const p of successfulPayments) {
        const expectedInvoiceNo = p.orderNumber?.startsWith('INV-')
          ? p.orderNumber
          : (p.invoiceUrl?.startsWith('INV-')
              ? p.invoiceUrl
              : (p.orderNumber
                  ? p.orderNumber.replace('#QB-', 'INV-2026-')
                  : `INV-${p.createdAt.getFullYear()}-${String(p.id).padStart(6, '0')}`));

        // Check if matching invoice already exists
        const exists = existingInvoices.some((inv) =>
          inv.invoiceNo === expectedInvoiceNo ||
          (p.orderNumber && inv.invoiceNo === p.orderNumber) ||
          (p.orderNumber && inv.notes && inv.notes.includes(p.orderNumber)) ||
          (inv.notes && inv.notes.includes(`Order: ${p.id}`)) ||
          (inv.notes && inv.notes.includes('Subscription payment for') && Math.abs(inv.totalAmount - Number(p.totalAmount || 0)) < 1)
        );

        if (!exists) {
          // Find or create primary contact for the customer
          let contact = await this.prisma.contact.findFirst({
            where: { customerId, deletedAt: null },
          });
          if (!contact) {
            contact = await this.prisma.contact.create({
              data: {
                customerId,
                firstName: p.customer?.companyName || p.customer?.name || 'Customer',
                lastName: 'Billing',
                email: p.customer?.email || `billing-${customerId}@quikboom.com`,
                phone: p.customer?.phone || 'N/A',
              },
            });
          }

          const baseAmount = Number(p.amount) || Math.round((Number(p.totalAmount || 0) / 1.18) * 100) / 100;
          const taxAmount = Number(p.taxAmount) || Math.round((Number(p.totalAmount || 0) - baseAmount) * 100) / 100;
          const totalAmount = Number(p.totalAmount) || Math.round((baseAmount + taxAmount) * 100) / 100;
          const planName = p.planName || p.subscription?.plan?.name || 'CRM Subscription Plan';
          const cycle = p.billingCycle || p.subscription?.billingCycle || 'MONTHLY';
          const method = p.paymentMethod || 'RAZORPAY';

          await this.prisma.invoice.create({
            data: {
              customerId,
              contactId: contact.id,
              invoiceNo: expectedInvoiceNo,
              status: InvoiceStatus.PAID,
              issueDate: p.createdAt,
              dueDate: p.createdAt,
              subTotal: baseAmount,
              taxAmount: taxAmount,
              discount: 0,
              totalAmount: totalAmount,
              notes: `Subscription payment for ${planName} (${cycle} billing). Payment Method: ${method}. Total Paid: ₹${totalAmount}, Balance: ₹0. Order: ${p.orderNumber || p.id}`,
            },
          });
        }
      }
    } catch (err: any) {
      console.error('[RECONCILE_INVOICES_ERROR]', err?.message || err);
    }
  }

  async reconcileAllCustomerInvoices(): Promise<void> {
    try {
      const customersWithPayments = await this.prisma.paymentHistory.findMany({
        where: { status: { in: ['SUCCESS', 'PAID'] } },
        select: { customerId: true },
        distinct: ['customerId'],
      });

      for (const row of customersWithPayments) {
        if (row.customerId) {
          await this.reconcileCustomerInvoices(row.customerId);
        }
      }
    } catch (err: any) {
      console.error('[RECONCILE_ALL_INVOICES_ERROR]', err?.message || err);
    }
  }

  async findAll(
    customerId: number | string,
    query: { status?: InvoiceStatus | string; page?: number; limit?: number; search?: string; customerId?: number | string; clientId?: number | string },
    user?: any,
  ) {
    const isSuperAdmin = user ? isUserSuperAdmin(user) : false;
    const rawCustId = query?.customerId || query?.clientId || customerId;
    const numCustomerId = Number(rawCustId);

    const where: any = { deletedAt: null };

    if (numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
      // Auto-reconcile invoices for this customer
      await this.reconcileCustomerInvoices(numCustomerId);
    } else if (!isSuperAdmin) {
      throw new UnauthorizedException('Customer context is required');
    } else {
      // Platform-wide Super Admin view: auto-reconcile across all active customers with payments
      await this.reconcileAllCustomerInvoices();
    }

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    if (query.status && (query.status as string) !== 'ALL') {
      const rawStatus = (query.status as string).trim().toUpperCase();
      if (rawStatus === 'OVERDUE') {
        where.OR = [
          { status: InvoiceStatus.OVERDUE },
          {
            status: { in: [InvoiceStatus.PENDING, InvoiceStatus.SENT, InvoiceStatus.DRAFT] },
            dueDate: { lt: new Date() },
          },
        ];
      } else if (rawStatus === 'PENDING' || rawStatus === 'UNPAID') {
        where.status = {
          in: [InvoiceStatus.PENDING, InvoiceStatus.DRAFT, InvoiceStatus.SENT],
        };
      } else if (Object.values(InvoiceStatus).includes(rawStatus as InvoiceStatus)) {
        where.status = rawStatus as InvoiceStatus;
      }
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { invoiceNo: { contains: q, mode: 'insensitive' } },
        { contact: { firstName: { contains: q, mode: 'insensitive' } } },
        { contact: { lastName: { contains: q, mode: 'insensitive' } } },
        { contact: { email: { contains: q, mode: 'insensitive' } } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { companyName: { contains: q, mode: 'insensitive' } } },
        { notes: { contains: q, mode: 'insensitive' } },
      ];
    }

    console.log('[INVOICE_QUERY]', {
      queryParameters: query,
      resolvedCustomerCompany: numCustomerId || 'ALL_SUPER_ADMIN',
      databaseQuery: JSON.stringify(where),
    });

    let items: any[] = [];
    let total = 0;

    const summaryBaseWhere = numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0
      ? { customerId: numCustomerId, deletedAt: null }
      : { deletedAt: null };

    let totalInvoicesCount = 0;
    let paidInvoicesCount = 0;
    let pendingInvoicesCount = 0;
    let overdueInvoicesCount = 0;

    try {
      [items, total, totalInvoicesCount, paidInvoicesCount, pendingInvoicesCount, overdueInvoicesCount] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          skip,
          take: limit,
          orderBy: { issueDate: 'desc' },
          include: {
            contact: true,
            customer: true,
            items: true,
          },
        }),
        this.prisma.invoice.count({ where }),
        this.prisma.invoice.count({ where: summaryBaseWhere }),
        this.prisma.invoice.count({
          where: {
            ...summaryBaseWhere,
            status: InvoiceStatus.PAID,
          },
        }),
        this.prisma.invoice.count({
          where: {
            ...summaryBaseWhere,
            status: { in: [InvoiceStatus.PENDING, InvoiceStatus.DRAFT, InvoiceStatus.SENT] },
          },
        }),
        this.prisma.invoice.count({
          where: {
            ...summaryBaseWhere,
            OR: [
              { status: InvoiceStatus.OVERDUE },
              {
                status: { in: [InvoiceStatus.PENDING, InvoiceStatus.DRAFT, InvoiceStatus.SENT] },
                dueDate: { lt: new Date() },
              },
            ],
          },
        }),
      ]);
    } catch (err: any) {
      console.error('[INVOICE_ERROR]', {
        errorName: err?.name || 'Error',
        errorMessage: err?.message || String(err),
        prismaErrorCode: err?.code || null,
      });
      throw err;
    }

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
        items: inv.items || [],
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: formatted,
      items: formatted,
      summary: {
        totalInvoices: totalInvoicesCount,
        paidInvoices: paidInvoicesCount,
        pendingPayments: pendingInvoicesCount,
        pendingInvoices: pendingInvoicesCount,
        overdueInvoices: overdueInvoicesCount,
      },
      counts: {
        total: totalInvoicesCount,
        paid: paidInvoicesCount,
        pending: pendingInvoicesCount,
        overdue: overdueInvoicesCount,
      },
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

    if (numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0) {
      await this.reconcileCustomerInvoices(numCustomerId);
    }

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

    const contactFullName = invoice.contact
      ? `${invoice.contact.firstName || ''} ${invoice.contact.lastName || ''}`.trim()
      : '';
    const clientDisplayName = contactFullName || invoice.customer?.companyName || invoice.customer?.name || 'General Client';

    return {
      ...invoice,
      invoiceNumber: invoice.invoiceNo,
      clientName: clientDisplayName,
      customerName: invoice.customer?.name || 'General Client',
      companyName: invoice.customer?.companyName || invoice.customer?.name || 'General Client',
    };
  }

  async create(customerId: number | string, dto: CreateInvoiceDto, user?: any) {
    const isSuperAdmin = user ? isUserSuperAdmin(user) : false;
    let numCustomerId = Number(dto.customerId || customerId);

    if (!numCustomerId || Number.isNaN(numCustomerId) || numCustomerId <= 0) {
      if (dto.contactId) {
        const contact = await this.prisma.contact.findUnique({
          where: { id: Number(dto.contactId) },
        });
        if (contact?.customerId) {
          numCustomerId = contact.customerId;
        }
      }
    }

    if (!numCustomerId || Number.isNaN(numCustomerId) || numCustomerId <= 0) {
      if (!isSuperAdmin) {
        throw new UnauthorizedException('Customer context is required to create an invoice.');
      } else {
        throw new BadRequestException('Valid customer context or customer-linked contact is required to create an invoice.');
      }
    }

    // Role-based check: if normal customer, cannot create invoice for another customer
    if (!isSuperAdmin && user?.role === 'CUSTOMER') {
      const authCustId = Number(customerId || user?.customerId);
      if (authCustId && numCustomerId !== authCustId) {
        throw new ForbiddenException('Cannot create invoice for another customer');
      }
    }

    // Find contact or auto-create a primary contact for this customer
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

    if (!contactId) {
      let contact = await this.prisma.contact.findFirst({
        where: { customerId: numCustomerId, deletedAt: null },
      });
      if (!contact) {
        const customer = await this.prisma.customer.findUnique({ where: { id: numCustomerId } });
        contact = await this.prisma.contact.create({
          data: {
            customerId: numCustomerId,
            firstName: customer?.companyName || customer?.name || 'Customer',
            lastName: 'Billing',
            email: customer?.email || `billing-${numCustomerId}@quikboom.com`,
            phone: customer?.phone || 'N/A',
          },
        });
      }
      contactId = contact.id;
    }

    const totalAmount = Number(dto.totalAmount) || 0;
    const subTotal = Number(dto.subTotal) || Math.round((totalAmount / 1.18) * 100) / 100;
    const taxAmount = Number(dto.taxAmount) || Math.round((totalAmount - subTotal) * 100) / 100;
    const now = new Date();
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : now;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const invoiceNo = dto.invoiceNo || `INV-${issueDate.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const status = dto.status || InvoiceStatus.PENDING;

    return this.prisma.invoice.create({
      data: {
        customerId: numCustomerId,
        contactId: contactId,
        invoiceNo,
        issueDate,
        dueDate,
        subTotal,
        taxAmount,
        totalAmount,
        notes: dto.notes,
        status,
      },
      include: {
        contact: true,
        customer: true,
        items: true,
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

  async generateInvoicePdfBuffer(invoice: any, invoiceNo: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        console.log(`[PDF_GENERATION_START]\ndocumentId: ${invoiceNo}`);
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          console.log(`[PDF_GENERATION_COMPLETE]\ndocumentId: ${invoiceNo}\nbufferSize: ${pdfBuffer.length}`);
          console.log(`[PDF_GENERATION]\nstatus: SUCCESS\nbufferSize: ${pdfBuffer.length}`);
          resolve(pdfBuffer);
        });
        doc.on('error', (err) => {
          console.error(`[PDF_GENERATION_ERROR]\ndocumentId: ${invoiceNo}\nerror: ${err.message}`);
          console.error(`[PDF_ERROR]\ndocumentType: INVOICE\ndocumentId: ${invoiceNo}\nerror: ${err.message}`);
          reject(err);
        });

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
        doc.fillColor(grayColor).fontSize(8.5).font('Helvetica')
          .text('Authorized Signatory', 330, signTop + 34, { align: 'right' });

        // Terms & Conditions Footer
        const footerTop = signTop + 65;
        doc.moveTo(40, footerTop).lineTo(555, footerTop).strokeColor(borderCol).stroke();
        doc.fillColor(grayColor).fontSize(7.5).font('Helvetica')
          .text('Terms & Conditions: This is a computer-generated tax invoice generated in compliance with GST Rules.', 40, footerTop + 10)
          .text('Payment is non-refundable. For support or queries: support@quikboom.com | https://quikboom.com', 40, footerTop + 22)
          .text('QuikBoom CRM • Enterprise Multi-Tenant SaaS Platform', 40, footerTop + 34, { align: 'center' });

        doc.end();
      } catch (err: any) {
        console.error(`[PDF_GENERATION_ERROR]\ndocumentId: ${invoiceNo}\nerror: ${err.message}`);
        console.error(`[PDF_ERROR]\ndocumentType: INVOICE\ndocumentId: ${invoiceNo}\nerror: ${err.message}`);
        reject(err);
      }
    });
  }

  async downloadInvoicePdf(
    customerId: number | string,
    id: number | string,
    user: any,
    res: Response,
  ) {
    console.log(`[PDF_REQUEST]\ndocumentType: INVOICE\ndocumentId: ${id}`);
    try {
      const invoice = await this.findOne(customerId, id, user);
      const invoiceNo = invoice.invoiceNo || `INV-${invoice.id}`;
      const safeInvoiceNo = invoiceNo.replace(/[^a-zA-Z0-9_-]/g, '_');

      const pdfBuffer = await this.generateInvoicePdfBuffer(invoice, invoiceNo);

      if (!pdfBuffer || pdfBuffer.length === 0 || pdfBuffer.toString('utf8', 0, 5) !== '%PDF-') {
        throw new Error('Generated PDF document is invalid or empty');
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('Content-Disposition', `attachment; filename="${safeInvoiceNo}.pdf"`);

      console.log(`[PDF_RESPONSE]\nstatus: 200\ncontentType: application/pdf\nsize: ${pdfBuffer.length}`);

      return res.end(pdfBuffer);
    } catch (err: any) {
      console.error(`[PDF_ERROR]\ndocumentType: INVOICE\ndocumentId: ${id}\nerror: ${err.message}`);
      if (!res.headersSent) {
        res.status(err.status || 500).json({
          statusCode: err.status || 500,
          message: err.message || 'Unable to generate PDF invoice. Please try again.',
        });
      }
    }
  }
}
