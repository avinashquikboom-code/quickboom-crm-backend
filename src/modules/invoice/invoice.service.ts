import { Injectable, NotFoundException, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceDto, BulkDeleteInvoiceDto } from './dto/invoice.dto';
import { InvoiceStatus, WorkStatus } from '@prisma/client';
import { isUserSuperAdmin, isUserAdmin } from '../../common/utils/role.util';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');
import { formatInrCurrency } from '../receipt/receipt.service';
import {
  parseCalendarDateInput,
  resolveSubscriptionActivationDate,
  resolveSubscriptionExpiryDate,
  calculatePlanExpiry,
  utcCalendarDateKey,
} from '../../common/utils/subscription-date.util';
import {
  buildDefaultPlanLineItems,
  parseInvoiceItemsSnapshot,
  resolveInvoiceLineItems,
  withInvoiceItemsSnapshot,
} from '../../common/utils/invoice-items.util';
import { generateAgreementPdfBuffer } from '../../common/utils/agreement-pdf.util';

const INVOICE_ISSUER = Object.freeze({
  brand: 'QB SUITE',
  companyName: 'QUIK BOOM MARKETING AGENCY',
  address: [
    'FP 68, Gorwa Ankodia, 30MTRS, Canal Ring Road,',
    'near Shivanta Iris, Gorwa,',
    'Vadodara, Gujarat 391330',
  ].join('\n'),
  supportEmail: 'support@quikboom.in',
});

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  private parsePlanActivationFromNotes(notes?: string | null): Date | null {
    if (!notes) return null;
    const match = notes.match(/Plan activation:\s*(\d{4}-\d{2}-\d{2})/i);
    return match ? parseCalendarDateInput(match[1]) : null;
  }

  private toUtcCalendarDate(date: Date): Date {
    const d = new Date(date);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  }

  /**
   * First applicable calendar/service date for a purchased plan (customer Work or monthly schedule).
   */
  private async resolveFirstCalendarScheduleStartDate(
    customerId: number,
    subscriptionId?: number | null,
  ): Promise<Date | null> {
    if (!subscriptionId) return null;

    const firstWork = await this.prisma.work.findFirst({
      where: {
        customerId,
        subscriptionId,
        status: { not: WorkStatus.CANCELLED },
      },
      orderBy: { scheduledDate: 'asc' },
      select: { scheduledDate: true },
    });
    if (firstWork?.scheduledDate) {
      return this.toUtcCalendarDate(firstWork.scheduledDate);
    }

    const firstMonthly = await this.prisma.monthlySchedule.findFirst({
      where: {
        customerId,
        subscriptionId,
        deletedAt: null,
      },
      orderBy: { startDate: 'asc' },
      select: { startDate: true },
    });
    if (firstMonthly?.startDate) {
      return this.toUtcCalendarDate(firstMonthly.startDate);
    }

    return null;
  }

  /** Authoritative plan start/end for tax invoice (subscription), separate from issueDate (purchase). */
  async resolveInvoicePlanDates(inv: {
    invoiceNo: string;
    customerId: number;
    issueDate: Date;
    notes?: string | null;
  }): Promise<{ purchaseDate: Date; activationDate: Date; expiryDate: Date }> {
    const purchaseDate = new Date(inv.issueDate);
    let activationDate = this.parsePlanActivationFromNotes(inv.notes);
    let expiryDate: Date | null = null;

    const invPaymentIdMatch = inv.invoiceNo.match(/^INV-\d{4}-0*(\d+)$/i);
    const linkedPaymentId = invPaymentIdMatch ? Number(invPaymentIdMatch[1]) : null;

    const payment = await this.prisma.paymentHistory.findFirst({
      where: {
        customerId: inv.customerId,
        deletedAt: null,
        status: { in: ['SUCCESS', 'PAID'] },
        OR: [
          ...(linkedPaymentId ? [{ id: linkedPaymentId }] : []),
          { invoiceUrl: inv.invoiceNo },
        ],
      },
      include: { subscription: true },
      orderBy: { createdAt: 'desc' },
    });

    if (payment?.subscription) {
      const sub = payment.subscription;
      const durationMonths = sub.billingCycle === 'YEARLY' || payment.billingCycle === 'YEARLY' ? 12 : 1;

      activationDate = resolveSubscriptionActivationDate(payment.createdAt, sub.startDate);
      expiryDate = resolveSubscriptionExpiryDate(activationDate, durationMonths, sub.endDate);
    } else if (activationDate) {
      expiryDate = calculatePlanExpiry(activationDate, 1);
    }

    if (!activationDate) {
      activationDate = resolveSubscriptionActivationDate(purchaseDate, null);
    }
    if (!expiryDate) {
      expiryDate = calculatePlanExpiry(activationDate, 1);
    }

    return { purchaseDate, activationDate, expiryDate };
  }

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

      // ─────────────────────────────────────────────────────────────────────
      // CRITICAL: fetch ALL invoices — both live (deletedAt: null) AND
      // soft-deleted ones.  If we only fetch live invoices here and an admin
      // has manually deleted one, reconcile won't find a match and will
      // immediately recreate it, causing the invoice to reappear on every
      // list refresh.  By including deleted records in the existence check
      // we correctly honour the admin's deletion decision.
      // ─────────────────────────────────────────────────────────────────────
      const allInvoices = await this.prisma.invoice.findMany({
        where: { customerId },
        select: {
          id: true,
          invoiceNo: true,
          notes: true,
          totalAmount: true,
          deletedAt: true,
        },
      });

      for (const p of successfulPayments) {
        const expectedInvoiceNo = p.orderNumber?.startsWith('INV-')
          ? p.orderNumber
          : (p.invoiceUrl?.startsWith('INV-')
              ? p.invoiceUrl
              : (p.orderNumber
                  ? p.orderNumber.replace('#QB-', 'INV-2026-')
                  : `INV-${p.createdAt.getFullYear()}-${String(p.id).padStart(6, '0')}`));

        // Check if a matching invoice already exists (live OR previously deleted).
        // A deleted match means an admin intentionally removed it — do NOT recreate.
        const exists = allInvoices.some((inv) =>
          inv.invoiceNo === expectedInvoiceNo ||
          (p.orderNumber && inv.invoiceNo === p.orderNumber) ||
          (p.orderNumber && inv.notes && inv.notes.includes(p.orderNumber)) ||
          (inv.notes && inv.notes.includes(`Order: ${p.id}`)) ||
          (inv.notes &&
            inv.notes.includes('Subscription payment for') &&
            Math.abs(inv.totalAmount - Number(p.totalAmount || 0)) < 1)
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
          const planActivation = resolveSubscriptionActivationDate(
            p.createdAt,
            p.subscription?.startDate,
          );

          console.log('[RECONCILE_CREATING_INVOICE]', {
            customerId,
            paymentId: p.id,
            expectedInvoiceNo,
            reason: 'No existing invoice (live or deleted) found for this payment',
          });

          const notes = withInvoiceItemsSnapshot(
            `Subscription payment for ${planName} (${cycle} billing). Purchase: ${utcCalendarDateKey(p.createdAt)}. Plan activation: ${utcCalendarDateKey(planActivation)}. Payment Method: ${method}. Total Paid: ₹${totalAmount}, Balance: ₹0. Order: ${p.orderNumber || p.id}`,
            buildDefaultPlanLineItems(planName, baseAmount),
          );

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
              notes,
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
            items: { include: { product: true } },
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

    const formatted = await Promise.all(items.map(async (inv) => {
      const planDates = await this.resolveInvoicePlanDates(inv);
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
      const snapshot = parseInvoiceItemsSnapshot(inv.notes);
      if (snapshot?.planName) {
        planName = snapshot.planName;
      } else if (inv.notes && inv.notes.includes('Subscription payment for')) {
        const afterSub = inv.notes.split('Subscription payment for')[1];
        if (afterSub) {
          planName = afterSub.split('(')[0].trim();
        }
      }
      const lineItems = resolveInvoiceLineItems({ ...inv, planName });

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
        purchaseDate: planDates.purchaseDate,
        activationDate: planDates.activationDate,
        planStartDate: planDates.activationDate,
        expiryDate: planDates.expiryDate,
        planEndDate: planDates.expiryDate,
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
        lineItems: lineItems.items,
        planType: lineItems.planType,
      };
    }));

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
          items: { include: { product: true } },
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
          items: { include: { product: true } },
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
              items: { include: { product: true } },
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
    const planDates = await this.resolveInvoicePlanDates(invoice);

    const snapshot = parseInvoiceItemsSnapshot(invoice.notes);
    const planName = snapshot?.planName || this.resolveInvoicePlanName(invoice);
    const lineItems = resolveInvoiceLineItems({ ...invoice, planName });

    return {
      ...invoice,
      invoiceNumber: invoice.invoiceNo,
      clientName: clientDisplayName,
      customerName: invoice.customer?.name || 'General Client',
      companyName: invoice.customer?.companyName || invoice.customer?.name || 'General Client',
      purchaseDate: planDates.purchaseDate,
      activationDate: planDates.activationDate,
      planStartDate: planDates.activationDate,
      expiryDate: planDates.expiryDate,
      planEndDate: planDates.expiryDate,
      planName,
      lineItems: lineItems.items,
      planType: lineItems.planType,
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

  /**
   * Delete a single invoice (soft-delete)
   * Enforces role authorization and tenant isolation.
   * Preserves customer and unrelated financial data.
   */
  async remove(customerId: number | string, id: number | string, user?: any) {
    const numId = Number(id);
    if (!numId || isNaN(numId)) {
      throw new BadRequestException('Valid invoice ID is required');
    }

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const isSuperAdmin = isUserSuperAdmin(user);
    const isAdmin = isUserAdmin(user);
    if (!isSuperAdmin && !isAdmin) {
      throw new ForbiddenException('Admin or Super Admin permissions required to delete invoices');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: numId, deletedAt: null },
      include: { customer: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice #${id} not found or already deleted`);
    }

    // Tenant / Customer Isolation
    if (!isSuperAdmin) {
      const callerCustomerId = Number(user.customerId);
      if (!callerCustomerId || callerCustomerId !== invoice.customerId) {
        throw new ForbiddenException('Cross-tenant data access forbidden. You cannot delete invoices belonging to another organization');
      }
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: numId },
        data: { deletedAt: now, status: InvoiceStatus.CANCELLED },
      });

      try {
        await tx.auditLog.create({
          data: {
            action: 'DELETE_INVOICE',
            module: 'INVOICES',
            userId: user.id ? Number(user.id) : undefined,
            customerId: invoice.customerId,
            details: {
              invoiceId: invoice.id,
              invoiceNo: invoice.invoiceNo,
              totalAmount: invoice.totalAmount,
              deletedAt: now.toISOString(),
              deletedBy: user.email || user.name || user.id,
            },
          },
        });
      } catch (_) {}
    });

    return {
      success: true,
      message: 'Invoice deleted successfully',
      deletedId: numId,
    };
  }

  /**
   * Bulk delete invoices (atomic soft-delete)
   * Enforces role authorization and tenant isolation across ALL selected records.
   */
  async bulkRemove(rawIds: (number | string)[], user?: any) {
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new BadRequestException('An array of invoice IDs is required');
    }

    const numericIds = Array.from(
      new Set(
        rawIds
          .map((id) => Number(id))
          .filter((n) => !isNaN(n) && n > 0)
      )
    );

    if (numericIds.length === 0) {
      throw new BadRequestException('No valid invoice IDs provided');
    }

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const isSuperAdmin = isUserSuperAdmin(user);
    const isAdmin = isUserAdmin(user);
    if (!isSuperAdmin && !isAdmin) {
      throw new ForbiddenException('Admin or Super Admin permissions required to delete invoices');
    }

    const invoices = await this.prisma.invoice.findMany({
      where: {
        id: { in: numericIds },
        deletedAt: null,
      },
    });

    if (invoices.length === 0) {
      throw new NotFoundException('None of the selected invoices were found or they have already been deleted');
    }

    // Tenant / Customer Isolation for every record
    if (!isSuperAdmin) {
      const callerCustomerId = Number(user.customerId);
      const crossTenant = invoices.find((inv) => inv.customerId !== callerCustomerId);
      if (crossTenant || !callerCustomerId) {
        throw new ForbiddenException('Cross-tenant data access forbidden. One or more selected invoices belong to another organization');
      }
    }

    const foundIds = invoices.map((inv) => inv.id);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: { id: { in: foundIds } },
        data: {
          deletedAt: now,
          status: InvoiceStatus.CANCELLED,
        },
      });

      for (const inv of invoices) {
        try {
          await tx.auditLog.create({
            data: {
              action: 'BULK_DELETE_INVOICE',
              module: 'INVOICES',
              userId: user.id ? Number(user.id) : undefined,
              customerId: inv.customerId,
              details: {
                invoiceId: inv.id,
                invoiceNo: inv.invoiceNo,
                totalAmount: inv.totalAmount,
                deletedAt: now.toISOString(),
                deletedBy: user.email || user.name || user.id,
                bulkBatchSize: foundIds.length,
              },
            },
          });
        } catch (_) {}
      }
    });

    return {
      success: true,
      message: `${foundIds.length} ${foundIds.length === 1 ? 'invoice' : 'invoices'} deleted successfully.`,
      deletedCount: foundIds.length,
      deletedIds: foundIds,
    };
  }

  private resolveFontPaths(): { regular: string; bold: string } | null {
    const candidateDirs = [
      path.join(__dirname, '../../assets/fonts'),
      path.join(__dirname, '../assets/fonts'),
      path.join(process.cwd(), 'src/assets/fonts'),
      path.join(process.cwd(), 'dist/src/assets/fonts'),
      path.join(process.cwd(), 'dist/assets/fonts'),
      path.join(process.cwd(), 'assets/fonts'),
    ];

    for (const dir of candidateDirs) {
      const regular = path.join(dir, 'Roboto-Regular.ttf');
      const bold = path.join(dir, 'Roboto-Bold.ttf');
      if (fs.existsSync(regular) && fs.existsSync(bold)) {
        return { regular, bold };
      }
    }
    return null;
  }

  private resolveInvoicePlanName(invoice: any): string {
    const snapshot = parseInvoiceItemsSnapshot(invoice?.notes);
    if (snapshot?.planName) return snapshot.planName;

    const explicitPlanName = String(invoice?.planName || '').trim();
    if (explicitPlanName) return explicitPlanName;

    const notes = String(invoice?.notes || '');
    const subscriptionMatch = notes.match(
      /Subscription payment for\s+(.+?)(?:\s*\(|\.|$)/i,
    );
    return subscriptionMatch?.[1]?.trim() || 'QB Suite Plan & Growth Package';
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

        // Register Unicode Font supporting ₹ (U+20B9)
        const fontPaths = this.resolveFontPaths();
        let regularFont = 'Helvetica';
        let boldFont = 'Helvetica-Bold';

        if (fontPaths) {
          doc.registerFont('InvoiceFont', fontPaths.regular);
          doc.registerFont('InvoiceFont-Bold', fontPaths.bold);
          regularFont = 'InvoiceFont';
          boldFont = 'InvoiceFont-Bold';
        }

        const primaryColor = '#10B981';
        const darkColor = '#0F172A';
        const grayColor = '#64748B';
        const borderCol = '#E2E8F0';
        const lightBg = '#F8FAFC';

        const leftX = 40;
        const rightX = 310;
        const leftWidth = 245;
        const rightWidth = 245;

        // Header & Company Info
        doc
          .fillColor(primaryColor)
          .fontSize(20)
          .font(boldFont)
          .text(INVOICE_ISSUER.brand, leftX, 40, { width: leftWidth });
        doc
          .fillColor(darkColor)
          .fontSize(10)
          .font(boldFont)
          .text(INVOICE_ISSUER.companyName, leftX, 65, {
            width: leftWidth,
            lineGap: 1,
          });
        doc
          .fillColor(grayColor)
          .fontSize(8.5)
          .font(regularFont)
          .text(INVOICE_ISSUER.address, leftX, 82, {
            width: leftWidth,
            lineGap: 2,
          });

        doc
          .fillColor(darkColor)
          .fontSize(16)
          .font(boldFont)
          .text('FINAL TAX INVOICE', rightX, 40, {
            width: rightWidth,
            align: 'right',
          });
        doc
          .fillColor(primaryColor)
          .fontSize(10)
          .font(boldFont)
          .text(`Invoice Number: ${invoiceNo}`, rightX, 62, {
            width: rightWidth,
            align: 'right',
          });
        const purchaseDateLabel = new Date(invoice.issueDate).toLocaleDateString('en-IN');
        const planStartLabel = invoice.activationDate
          ? new Date(invoice.activationDate).toLocaleDateString('en-IN')
          : purchaseDateLabel;
        const planEndLabel = invoice.expiryDate
          ? new Date(invoice.expiryDate).toLocaleDateString('en-IN')
          : null;

        const invoiceStatus = String(invoice.status || 'ISSUED').toUpperCase();
        const isPaid = invoiceStatus === 'PAID';
        doc
          .fillColor(grayColor)
          .fontSize(8.5)
          .font(regularFont)
          .text(`Status / Type: ${invoiceStatus} • Original`, rightX, 77, {
            width: rightWidth,
            align: 'right',
          })
          .text(`Purchase Date: ${purchaseDateLabel}`, rightX, 90, {
            width: rightWidth,
            align: 'right',
          })
          .text(`Plan Start: ${planStartLabel}`, rightX, 103, {
            width: rightWidth,
            align: 'right',
          })
          .text(
            `Plan Validity: ${planStartLabel}${planEndLabel ? ` → ${planEndLabel}` : ''}`,
            rightX,
            116,
            { width: rightWidth, align: 'right' },
          );

        const headerBottom = 139;
        doc
          .moveTo(40, headerBottom)
          .lineTo(555, headerBottom)
          .strokeColor(borderCol)
          .lineWidth(1)
          .stroke();

        // Customer & Invoice Details 2-Column Section
        const metaTop = headerBottom + 12;
        doc
          .fillColor(grayColor)
          .fontSize(8.5)
          .font(boldFont)
          .text('BILLED TO (CUSTOMER)', leftX, metaTop);
        const clientName = invoice.contact
          ? `${invoice.contact.firstName || ''} ${invoice.contact.lastName || ''}`.trim()
          : ((invoice as any).customer?.name || 'Customer Account');
        const customerEmail =
          invoice.contact?.email || (invoice as any).customer?.email || 'N/A';
        const customerPhone =
          invoice.contact?.phone || (invoice as any).customer?.phone || 'N/A';
        const placeOfSupply =
          (invoice as any).customer?.state ||
          (invoice as any).customer?.city ||
          'N/A';
        const customerRows = [
          ['Customer Name:', clientName || 'Customer Account'],
          ['Email:', customerEmail],
          ['Phone:', customerPhone],
          ['Customer ID:', `#${invoice.customerId}`],
        ];
        const metricRows = [
          [
            'Due Date:',
            invoice.dueDate
              ? new Date(invoice.dueDate).toLocaleDateString('en-IN')
              : 'Settled',
          ],
          ['Payment Status:', invoiceStatus],
          ['Place of Supply:', placeOfSupply],
          ['Billing Mode:', 'Full Plan Settlement'],
        ];

        customerRows.forEach(([label, value], index) => {
          const y = metaTop + 16 + index * 15;
          doc
            .fillColor(grayColor)
            .fontSize(8)
            .font(regularFont)
            .text(label, leftX, y, { width: 70 });
          doc
            .fillColor(darkColor)
            .fontSize(index === 0 ? 9.5 : 8.5)
            .font(index === 0 ? boldFont : regularFont)
            .text(String(value), leftX + 74, y, {
              width: leftWidth - 74,
              ellipsis: true,
            });
        });

        doc
          .fillColor(grayColor)
          .fontSize(8.5)
          .font(boldFont)
          .text('INVOICE / ORDER METRICS', rightX, metaTop, {
            width: rightWidth,
          });
        metricRows.forEach(([label, value], index) => {
          const y = metaTop + 16 + index * 15;
          doc
            .fillColor(grayColor)
            .fontSize(8)
            .font(regularFont)
            .text(label, rightX, y, { width: 85 });
          doc
            .fillColor(darkColor)
            .fontSize(8.5)
            .text(String(value), rightX + 89, y, {
              width: rightWidth - 89,
              align: 'right',
              ellipsis: true,
            });
        });

        const metaBottom = metaTop + 82;
        doc
          .moveTo(40, metaBottom)
          .lineTo(555, metaBottom)
          .strokeColor(borderCol)
          .stroke();

        // Itemized Table Header
        const lineSnapshot = resolveInvoiceLineItems({
          ...invoice,
          planName: this.resolveInvoicePlanName(invoice),
        });
        let tableTop = metaBottom + 12;
        if (lineSnapshot.planType === 'CUSTOM' && lineSnapshot.planName) {
          doc
            .fillColor(darkColor)
            .fontSize(8.5)
            .font(boldFont)
            .text(`CUSTOM PLAN: ${lineSnapshot.planName}`, 40, tableTop, {
              width: 515,
            });
          tableTop += 16;
        }

        doc
          .fillColor(primaryColor)
          .fontSize(8)
          .font(boldFont)
          .text('ITEMS', 40, tableTop);
        tableTop += 14;

        doc.rect(40, tableTop, 515, 22).fill(primaryColor);
        doc.fillColor('#FFFFFF').fontSize(8).font(boldFont);
        doc.text('#', 48, tableTop + 7, { width: 22 });
        doc.text('PLAN NAME / ITEM DESCRIPTION', 74, tableTop + 7, { width: 230 });
        doc.text('QTY', 308, tableTop + 7, { width: 36, align: 'center' });
        doc.text('UNIT PRICE', 348, tableTop + 7, { width: 96, align: 'right' });
        doc.text('TOTAL', 448, tableTop + 7, { width: 98, align: 'right' });

        const subTotal = Number(invoice.subTotal || 0);
        const discount = Number(invoice.discount || 0);
        const taxAmount = Number(invoice.taxAmount || 0);
        const totalAmount = Number(invoice.totalAmount || subTotal - discount + taxAmount);
        const isTaxCharged = taxAmount > 0.005;
        const cgst = taxAmount / 2;
        const sgst = taxAmount / 2;
        const validityLine = planEndLabel
          ? `Validity: ${planStartLabel} → ${planEndLabel}`
          : `Invoice Reference: ${invoiceNo}`;

        let rowY = tableTop + 28;
        lineSnapshot.items.forEach((item, index) => {
          const nameHeight = doc
            .fontSize(9)
            .font(boldFont)
            .heightOfString(item.name, { width: 230, lineGap: 1 });
          const rowHeight = Math.max(22, nameHeight + 6);
          if (index % 2 === 1) {
            doc.rect(40, rowY - 4, 515, rowHeight).fill('#F8FAFC');
          }
          doc.fillColor(darkColor).fontSize(8.5).font(regularFont);
          doc.text(String(index + 1), 48, rowY, { width: 22 });
          doc
            .fontSize(9)
            .font(boldFont)
            .text(item.name, 74, rowY, { width: 230, lineGap: 1 });
          doc.fontSize(8.5).font(regularFont);
          doc.text(String(item.quantity), 308, rowY, { width: 36, align: 'center' });
          doc.text(formatInrCurrency(item.unitPrice), 348, rowY, {
            width: 96,
            align: 'right',
          });
          doc.font(boldFont).text(formatInrCurrency(item.total), 448, rowY, {
            width: 98,
            align: 'right',
          });
          rowY += rowHeight;
        });

        doc
          .fontSize(8)
          .font(regularFont)
          .fillColor(grayColor)
          .text(validityLine, 74, rowY + 2, { width: 230 });
        const rowBottom = rowY + 18;
        doc
          .moveTo(40, rowBottom)
          .lineTo(555, rowBottom)
          .strokeColor(borderCol)
          .stroke();

        // Summary & Tax Breakdown Box
        const summaryTop = rowBottom + 12;
        const summaryHeight = discount > 0.005 ? 110 : 95;

        // Left Box: Tax Breakdown
        doc.rect(40, summaryTop, 245, summaryHeight).fill(lightBg);
        doc.rect(40, summaryTop, 245, summaryHeight).strokeColor(borderCol).stroke();

        doc
          .fillColor(darkColor)
          .fontSize(8.5)
          .font(boldFont)
          .text(isTaxCharged ? 'TAX BREAKDOWN (GST 18%)' : 'TAX BREAKDOWN', 50, summaryTop + 10);
        if (isTaxCharged) {
          doc
            .fillColor(grayColor)
            .fontSize(8)
            .font(regularFont)
            .text('CGST (9.0%):', 50, summaryTop + 26)
            .text(formatInrCurrency(cgst), 160, summaryTop + 26, {
              width: 115,
              align: 'right',
            })
            .text('SGST (9.0%):', 50, summaryTop + 42)
            .text(formatInrCurrency(sgst), 160, summaryTop + 42, {
              width: 115,
              align: 'right',
            })
            .text('Total Tax Payable:', 50, summaryTop + 58)
            .text(formatInrCurrency(taxAmount), 160, summaryTop + 58, {
              width: 115,
              align: 'right',
            });
          doc
            .moveTo(50, summaryTop + 72)
            .lineTo(275, summaryTop + 72)
            .strokeColor(borderCol)
            .stroke();
          doc
            .fillColor(isPaid ? primaryColor : '#B45309')
            .fontSize(8.5)
            .font(boldFont)
            .text(
              isPaid ? 'Tax Status: Paid in Full' : 'Tax Status: Included in Balance Due',
              50,
              summaryTop + 78,
              { width: 225 },
            );
        } else {
          doc
            .fillColor(grayColor)
            .fontSize(8)
            .font(regularFont)
            .text('GST:', 50, summaryTop + 31)
            .fillColor(darkColor)
            .text(formatInrCurrency(0), 160, summaryTop + 31, {
              width: 115,
              align: 'right',
            });
          doc
            .fillColor(primaryColor)
            .fontSize(8.5)
            .font(boldFont)
            .text('GST is not charged or collected', 50, summaryTop + 57, {
              width: 225,
            });
        }

        // Right Box: Total Settlement
        doc.rect(310, summaryTop, 245, summaryHeight).fill(lightBg);
        doc.rect(310, summaryTop, 245, summaryHeight).strokeColor(borderCol).stroke();

        doc.fillColor(darkColor).fontSize(8.5).font(boldFont).text('PAYMENT SETTLEMENT', 320, summaryTop + 10);
        let settleY = summaryTop + 24;
        doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
          .text('Subtotal:', 320, settleY)
          .fillColor(darkColor).text(formatInrCurrency(subTotal), 430, settleY, { width: 115, align: 'right' });
        settleY += 14;
        if (discount > 0.005) {
          doc.fillColor(grayColor).text('Discount:', 320, settleY)
            .fillColor(darkColor).text(`- ${formatInrCurrency(discount)}`, 430, settleY, { width: 115, align: 'right' });
          settleY += 14;
        }
        doc.fillColor(grayColor).text(isTaxCharged ? 'Total Tax (GST 18%):' : 'Total Tax:', 320, settleY)
          .fillColor(darkColor).text(formatInrCurrency(taxAmount), 430, settleY, { width: 115, align: 'right' });
        settleY += 10;
        doc.moveTo(320, settleY).lineTo(545, settleY).strokeColor('#CBD5E1').stroke();
        settleY += 8;

        doc.fillColor(primaryColor).fontSize(10).font(boldFont).text('Grand Total:', 320, settleY);
        doc.text(formatInrCurrency(totalAmount), 430, settleY, { width: 115, align: 'right' });
        settleY += 16;

        doc.fillColor(grayColor).fontSize(8).font(regularFont).text(isPaid ? 'Total Paid:' : 'Balance Due:', 320, settleY);
        doc
          .fillColor(isPaid ? '#059669' : '#B45309')
          .font(boldFont)
          .text(
            isPaid ? `${formatInrCurrency(totalAmount)} (PAID)` : formatInrCurrency(totalAmount),
            430,
            settleY,
            { width: 115, align: 'right' },
          );

        // Official Verification Stamp & Signature Section
        const signTop = summaryTop + summaryHeight + 15;

        // Paid / status stamp
        doc
          .rect(40, signTop, 140, 48)
          .fillAndStroke(isPaid ? '#ECFDF5' : '#F8FAFC', isPaid ? '#10B981' : '#94A3B8');
        doc
          .fillColor(isPaid ? '#065F46' : darkColor)
          .fontSize(14)
          .font(boldFont)
          .text(isPaid ? 'PAID' : invoiceStatus, 48, signTop + 11, {
            width: 124,
            align: 'center',
          });
        doc
          .fontSize(7.5)
          .font(regularFont)
          .text('Official Invoice • Digitally Verified', 48, signTop + 31, {
            width: 124,
            align: 'center',
          });

        // Signatory
        doc.fillColor(darkColor).fontSize(8.5).font(boldFont)
          .text(`For ${INVOICE_ISSUER.companyName}`, 310, signTop + 8, { width: 245, align: 'right' });
        doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
          .text('Authorized Signatory', 310, signTop + 34, { width: 245, align: 'right' });

        // Terms & Conditions Footer
        const footerTop = signTop + 65;
        doc.moveTo(40, footerTop).lineTo(555, footerTop).strokeColor(borderCol).stroke();
        const taxTerms = isTaxCharged
          ? 'GST is charged and collected as detailed on this invoice.'
          : 'GST is not charged or collected on this invoice.';
        const terms =
          `Terms & Conditions: This is a computer-generated invoice. ${taxTerms} ` +
          'Payment once made is non-refundable. Services are provided as per the agreed plan package and validity. ' +
          `For support or billing queries, contact ${INVOICE_ISSUER.supportEmail}`;
        doc
          .fillColor(grayColor)
          .fontSize(7.5)
          .font(regularFont)
          .text(terms, 48, footerTop + 10, {
            width: 499,
            align: 'center',
            lineGap: 2,
          });
        const termsHeight = doc.heightOfString(terms, {
          width: 499,
          align: 'center',
          lineGap: 2,
        });
        doc
          .fillColor(grayColor)
          .fontSize(7.5)
          .font(boldFont)
          .text(
            `${INVOICE_ISSUER.brand} • ${INVOICE_ISSUER.companyName} • ${INVOICE_ISSUER.supportEmail}`,
            48,
            footerTop + 16 + termsHeight,
            { width: 499, align: 'center' },
          );

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
      const invoiceRecord = await this.findOne(customerId, id, user);
      const invoiceNo = invoiceRecord.invoiceNo || `INV-${invoiceRecord.id}`;
      const safeInvoiceNo = invoiceNo.replace(/[^a-zA-Z0-9_-]/g, '_');

      const pdfBuffer = await this.generateInvoicePdfBuffer(invoiceRecord, invoiceNo);

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

  async downloadAgreementPdf(customerId: string | number, id: string | number, user?: any) {
    const invoice = await this.findOne(customerId, id, user);
    
    let paymentId;
    if (invoice.notes) {
      const match = invoice.notes.match(/Order:?\s*#?\s*(?:ORD-(?:PAY|CUST)-)?(\d+)/i);
      if (match) {
        paymentId = Number(match[1]);
      }
    }
    
    if (!paymentId) {
      const payment = await this.prisma.paymentHistory.findFirst({
        where: {
          customerId: Number(customerId),
          OR: [
            { orderNumber: invoice.invoiceNo },
            { invoiceUrl: invoice.invoiceNo }
          ],
          status: { in: ['SUCCESS', 'PAID'] }
        }
      });
      if (payment) paymentId = payment.id;
    }
    
    if (!paymentId) {
       throw new BadRequestException('Cannot generate agreement: No associated payment found for this invoice.');
    }

    const paymentData = await this.prisma.paymentHistory.findUnique({
      where: { id: paymentId },
      include: { 
        customer: true,
        subscription: { include: { plan: true } }
      },
    });
    
    if (!paymentData || !paymentData.customer) {
      throw new BadRequestException('Payment or customer not found for this invoice');
    }

    const sub = paymentData.subscription;
    const plan = sub?.plan;
    const customer = paymentData.customer;
    
    // For custom plans or payments without a standard subscription:
    const planName = plan?.name || paymentData.planName || 'Custom/Customized Plan';
    const planFeatures = plan?.features as any[] || [];
    const activationDate = sub?.startDate || paymentData.createdAt;
    
    // Calculate endDate if not present
    let endDate = sub?.endDate;
    if (!endDate) {
      const durationMonths = paymentData.billingCycle === 'YEARLY' ? 12 : 1;
      endDate = new Date(activationDate);
      endDate.setMonth(endDate.getMonth() + durationMonths);
    }

    return await generateAgreementPdfBuffer({
      customerName: customer.name || customer.companyName || 'Valued Customer',
      companyName: customer.companyName || customer.name || 'QUIKBOOM Digital Marketing Agency',
      purchaseDate: paymentData.createdAt,
      activationDate: activationDate,
      planName: planName,
      planFeatures: planFeatures,
      amount: Number(paymentData.amount),
      taxAmount: Number(paymentData.taxAmount || 0),
      totalAmount: Number(paymentData.totalAmount || paymentData.amount),
      startDate: activationDate,
      endDate: endDate,
      orderNumber: paymentData.orderNumber || String(paymentData.orderId || paymentData.id),
      invoiceNumber: paymentData.invoiceUrl || invoice.invoiceNo,
    });
  }
}
