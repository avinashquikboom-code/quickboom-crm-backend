import { Injectable, NotFoundException, UnauthorizedException, ForbiddenException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  BulkDeleteInvoiceDto,
  RecordInvoicePaymentDto,
  VerifyInvoicePaymentDto,
  RescheduleInstallmentDto,
  GeneratePaymentLinkDto,
  CancelInvoiceDto,
  SendInvoiceCommunicationDto,
} from './dto/invoice.dto';
import { InvoiceStatus, WorkStatus } from '@prisma/client';
import { isUserSuperAdmin, isUserAdmin } from '../../common/utils/role.util';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import PDFDocument = require('pdfkit');
import { formatInrCurrency } from '../receipt/receipt.service';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { FinancialMetricsService } from './financial-metrics.service';
import { getBusinessDayRange } from '../../common/utils/timezone.util';
import {
  roundCurrency,
  isOnlinePaymentMethod,
  resolvePaymentModeFromTransactions,
  computeNextBillingFromSubscription,
  resolveInvoiceDisplayStatus,
  generateInvoicePaymentReceiptPdfBuffer,
} from './invoice-billing.helper';
import {
  parseCalendarDateInput,
  resolveSubscriptionActivationDate,
  resolveSubscriptionExpiryDate,
  calculatePlanExpiry,
  utcCalendarDateKey,
} from '../../common/utils/subscription-date.util';

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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly whatsappService?: WhatsappService,
    @Optional() private readonly financialMetrics?: FinancialMetricsService,
  ) {}

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
      const successfulPayments = await this.prisma.paymentHistory.findMany({
        where: {
          customerId,
          deletedAt: null,
          status: { in: ['SUCCESS', 'PAID'] },
        },
        include: {
          subscription: {
            include: { plan: true, coupon: true, installments: { orderBy: { installmentNumber: 'asc' } } },
          },
          customer: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!Array.isArray(successfulPayments) || !successfulPayments.length) return;

      const allInvoices = await this.prisma.invoice.findMany({
        where: { customerId },
        include: { payments: true },
      });

      // Group payments by subscriptionId when present so partial payments consolidate into one invoice
      const groupedBySub = new Map<string, typeof successfulPayments>();
      for (const p of successfulPayments) {
        const key = p.subscriptionId ? `sub-${p.subscriptionId}` : `pay-${p.id}`;
        const arr = groupedBySub.get(key) || [];
        arr.push(p);
        groupedBySub.set(key, arr);
      }

      for (const [key, paymentsGroup] of groupedBySub.entries()) {
        const firstPay = paymentsGroup[0];
        const latestPay = paymentsGroup[paymentsGroup.length - 1];
        const sub = firstPay.subscription;

        const expectedInvoiceNo = firstPay.orderNumber?.startsWith('INV-')
          ? firstPay.orderNumber
          : firstPay.invoiceUrl?.startsWith('INV-')
            ? firstPay.invoiceUrl
            : firstPay.orderNumber && firstPay.orderNumber.startsWith('#QB-')
              ? firstPay.orderNumber.replace('#QB-', 'INV-2026-')
              : `INV-${firstPay.createdAt.getFullYear()}-${String(firstPay.id).padStart(6, '0')}`;

        const matchingInvoices = allInvoices.filter(
          (inv) =>
            (sub && inv.subscriptionId === sub.id) ||
            inv.invoiceNo === expectedInvoiceNo ||
            paymentsGroup.some(
              (p) =>
                (p.orderNumber && inv.invoiceNo === p.orderNumber) ||
                (p.invoiceUrl && inv.invoiceNo === p.invoiceUrl) ||
                (p.orderNumber && inv.notes && inv.notes.includes(p.orderNumber)) ||
                (inv.notes && inv.notes.includes(`Order: ${p.id}`)),
            ),
        );

        // If an admin intentionally deleted this invoice, do NOT recreate it
        if (matchingInvoices.some((inv) => inv.deletedAt !== null)) {
          continue;
        }

        const totalPaid = roundCurrency(
          paymentsGroup.reduce((sum, p) => sum + Number(p.totalAmount || p.amount || 0), 0),
        );

        let fullBase = Number(firstPay.amount) || 0;
        let fullTax = Number(firstPay.taxAmount) || 0;
        let fullTotal = roundCurrency(fullBase + fullTax);

        if (sub) {
          const cycle = String(sub.billingCycle || firstPay.billingCycle || 'MONTHLY').toUpperCase();
          const planBase =
            sub.customPrice != null && Number(sub.customPrice) > 0
              ? Number(sub.customPrice)
              : sub.plan
                ? cycle === 'YEARLY'
                  ? Number(sub.plan.yearlyPrice || 0)
                  : Number(sub.plan.monthlyPrice || 0)
                : fullBase;
          const discountAmt = Number(sub.discountAmount || 0);
          const taxable = Math.max(0, roundCurrency(planBase - discountAmt));
          const computedTax = roundCurrency(taxable * 0.18);
          const computedTotal = roundCurrency(taxable + computedTax);
          if (computedTotal > 0) {
            fullBase = taxable;
            fullTax = computedTax;
            fullTotal = computedTotal;
          }
        }

        if (fullTotal <= 0) {
          fullTotal = roundCurrency(
            paymentsGroup.reduce((sum, p) => sum + Number(p.totalAmount || p.amount || 0), 0),
          );
          fullBase = roundCurrency(fullTotal / 1.18);
          fullTax = roundCurrency(fullTotal - fullBase);
        }

        const effectivePaid = Math.min(totalPaid, fullTotal);
        const balanceAmount = Math.max(0, roundCurrency(fullTotal - effectivePaid));
        const isFullyPaid = balanceAmount <= 0.01;
        const resolvedMode = resolvePaymentModeFromTransactions(
          paymentsGroup.map((p) => ({
            paymentMode: isOnlinePaymentMethod(p.paymentMethod) ? 'ONLINE' : 'OFFLINE',
            paymentMethod: p.paymentMethod,
            status: 'CONFIRMED',
            amount: Number(p.totalAmount || p.amount || 0),
          })),
        );

        const pendingInst = sub?.installments?.find((inst: any) =>
          ['PENDING', 'DUE', 'OVERDUE'].includes(String(inst.status || '').toUpperCase()),
        );
        const nextInstDate = !isFullyPaid
          ? pendingInst?.dueDate ||
            (() => {
              const d = new Date(firstPay.createdAt);
              d.setDate(d.getDate() + 30);
              return d;
            })()
          : null;
        const nextInstAmt = !isFullyPaid ? Number(pendingInst?.totalAmount || balanceAmount) : null;
        const billingInfo = computeNextBillingFromSubscription(sub);

        const planName = firstPay.planName || sub?.plan?.name || 'CRM Subscription Plan';
        const cycle = String(firstPay.billingCycle || sub?.billingCycle || 'MONTHLY');
        const planActivation = resolveSubscriptionActivationDate(firstPay.createdAt, sub?.startDate);

        let targetInvoice = matchingInvoices.find((inv) => inv.deletedAt === null);

        if (!targetInvoice) {
          let contact = await this.prisma.contact.findFirst({
            where: { customerId, deletedAt: null },
          });
          if (!contact) {
            contact = await this.prisma.contact.create({
              data: {
                customerId,
                firstName: firstPay.customer?.companyName || firstPay.customer?.name || 'Customer',
                lastName: 'Billing',
                email: firstPay.customer?.email || `billing-${customerId}@quikboom.com`,
                phone: firstPay.customer?.phone || 'N/A',
              },
            });
          }

          targetInvoice = await this.prisma.invoice.create({
            data: {
              customerId,
              contactId: contact.id,
              subscriptionId: sub?.id || null,
              invoiceNo: expectedInvoiceNo,
              status: isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
              issueDate: firstPay.createdAt,
              dueDate: nextInstDate || firstPay.createdAt,
              subTotal: fullBase,
              taxAmount: fullTax,
              discount: Number(sub?.discountAmount || 0),
              totalAmount: fullTotal,
              paidAmount: Math.min(totalPaid, fullTotal),
              balanceAmount,
              paymentMode: resolvedMode,
              lastPaymentDate: latestPay.createdAt,
              nextInstallmentDate: nextInstDate,
              nextInstallmentAmount: nextInstAmt,
              nextBillingDate: billingInfo.nextBillingDate,
              nextBillingAmount: billingInfo.nextBillingAmount,
              billingCycle: cycle,
              planName,
              notes: `Subscription payment for ${planName} (${cycle} billing). Purchase: ${utcCalendarDateKey(firstPay.createdAt)}. Plan activation: ${utcCalendarDateKey(planActivation)}. Payment Method: ${latestPay.paymentMethod || 'RAZORPAY'}. Total Paid: ₹${totalPaid}, Balance: ₹${balanceAmount}. Order: ${firstPay.orderNumber || firstPay.id}`,
            },
            include: { payments: true },
          });
        } else if (
          Number(targetInvoice.paidAmount || 0) === 0 ||
          (sub && !targetInvoice.subscriptionId) ||
          (!isFullyPaid && targetInvoice.status === InvoiceStatus.PAID && balanceAmount > 0.01)
        ) {
          targetInvoice = await this.prisma.invoice.update({
            where: { id: targetInvoice.id },
            data: {
              subscriptionId: sub?.id || targetInvoice.subscriptionId,
              totalAmount: Math.max(Number(targetInvoice.totalAmount || 0), fullTotal),
              paidAmount: Math.min(totalPaid, Math.max(Number(targetInvoice.totalAmount || 0), fullTotal)),
              balanceAmount,
              status: isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
              paymentMode: resolvedMode,
              lastPaymentDate: latestPay.createdAt,
              nextInstallmentDate: nextInstDate,
              nextInstallmentAmount: nextInstAmt,
              nextBillingDate: billingInfo.nextBillingDate,
              nextBillingAmount: billingInfo.nextBillingAmount,
              billingCycle: cycle,
              planName,
            },
            include: { payments: true },
          });
        }

        // Backfill InvoicePayment rows for any PaymentHistory not yet linked
        if (this.prisma.invoicePayment && targetInvoice) {
          for (const p of paymentsGroup) {
            const existsIp = await this.prisma.invoicePayment.findFirst({
              where: {
                OR: [
                  { idempotencyKey: `payhist-${p.id}` },
                  { invoiceId: targetInvoice.id, paymentHistoryId: p.id },
                ],
              },
            });
            if (!existsIp) {
              const mode = isOnlinePaymentMethod(p.paymentMethod) ? 'ONLINE' : 'OFFLINE';
              await this.prisma.invoicePayment.create({
                data: {
                  invoiceId: targetInvoice.id,
                  customerId,
                  paymentHistoryId: p.id,
                  amount: Number(p.totalAmount || p.amount || 0),
                  paymentMode: mode,
                  paymentMethod: String(p.paymentMethod || 'RAZORPAY'),
                  transactionRef: p.transactionId || p.paymentId || p.orderNumber,
                  gatewayPaymentId: p.paymentId,
                  gatewayOrderId: p.orderId,
                  receiptNo: p.invoiceUrl || `QUIKBOOM-RECEIPT-${p.createdAt.getFullYear()}-${String(p.id).padStart(6, '0')}`,
                  status: 'CONFIRMED',
                  paymentDate: p.createdAt,
                  remarks: `Reconciled ${mode.toLowerCase()} payment`,
                  idempotencyKey: `payhist-${p.id}`,
                },
              });
            }
          }
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
    query: {
      status?: InvoiceStatus | string;
      page?: number;
      limit?: number;
      search?: string;
      customerId?: number | string;
      clientId?: number | string;
      fromDate?: string;
      toDate?: string;
      dateFrom?: string;
      dateTo?: string;
      paymentMode?: string;
      subscriptionPlanId?: number | string;
    },
    user?: any,
  ) {
    const isSuperAdmin = user ? isUserSuperAdmin(user) : false;
    const rawCustId = query?.customerId || query?.clientId || customerId;
    const numCustomerId = Number(rawCustId);

    const where: any = { deletedAt: null };

    if (numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
      await this.reconcileCustomerInvoices(numCustomerId);
    } else if (!isSuperAdmin) {
      throw new UnauthorizedException('Customer context is required');
    } else {
      await this.reconcileAllCustomerInvoices();
    }

    const fromStr = query.fromDate || query.dateFrom;
    const toStr = query.toDate || query.dateTo;
    if (fromStr || toStr) {
      const start = fromStr ? getBusinessDayRange(fromStr).start : undefined;
      const end = toStr ? getBusinessDayRange(toStr).end : undefined;
      where.issueDate = {
        ...(start ? { gte: start } : {}),
        ...(end ? { lte: end } : {}),
      };
    }

    if (query.subscriptionPlanId && Number(query.subscriptionPlanId) > 0) {
      where.subscription = { planId: Number(query.subscriptionPlanId) };
    }

    if (query.paymentMode && query.paymentMode !== 'ALL') {
      where.paymentMode = String(query.paymentMode).toUpperCase();
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
            status: { in: [InvoiceStatus.PENDING, InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID] },
            dueDate: { lt: new Date() },
            balanceAmount: { gt: 0.01 },
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
      const searchConds = [
        { invoiceNo: { contains: q, mode: 'insensitive' } },
        { contact: { firstName: { contains: q, mode: 'insensitive' } } },
        { contact: { lastName: { contains: q, mode: 'insensitive' } } },
        { contact: { email: { contains: q, mode: 'insensitive' } } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { companyName: { contains: q, mode: 'insensitive' } } },
        { planName: { contains: q, mode: 'insensitive' } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchConds }];
        delete where.OR;
      } else {
        where.OR = searchConds;
      }
    }

    const [items, total, financialSummary, upcomingBillingCount] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issueDate: 'desc' },
        include: {
          contact: true,
          customer: true,
          items: true,
          payments: { orderBy: { paymentDate: 'desc' } },
          subscription: {
            include: {
              plan: true,
              coupon: true,
              installments: { orderBy: { installmentNumber: 'asc' } },
            },
          },
        },
      }),
      this.prisma.invoice.count({ where }),
      this.financialMetrics
        ? this.financialMetrics.getFinancialSummary({
            customerId: numCustomerId > 0 ? numCustomerId : null,
            fromDate: fromStr,
            toDate: toStr,
            paymentMode: query.paymentMode,
            subscriptionPlanId: query.subscriptionPlanId ? Number(query.subscriptionPlanId) : null,
          })
        : Promise.resolve(null),
      this.prisma.customerSubscription?.count
        ? this.prisma.customerSubscription.count({
            where: {
              ...(numCustomerId && !Number.isNaN(numCustomerId) && numCustomerId > 0 ? { customerId: numCustomerId } : {}),
              status: 'ACTIVE',
              autoRenew: true,
            },
          })
        : Promise.resolve(0),
    ]);

    const now = new Date();
    const formatted = await Promise.all((items as any[]).map(async (inv: any) => {
      const planDates = await this.resolveInvoicePlanDates(inv);
      const contactFullName = inv.contact
        ? `${inv.contact.firstName || ''} ${inv.contact.lastName || ''}`.trim()
        : '';
      const clientDisplayName = contactFullName || inv.customer?.name || inv.customer?.companyName || 'General Client';

      const calc = this.financialMetrics
        ? this.financialMetrics.computeAuthoritativeInvoice(inv, now)
        : {
            subTotal: Number(inv.subTotal || 0),
            discountAmount: Number(inv.discountAmount || 0),
            taxAmount: Number(inv.taxAmount || 0),
            totalAmount: Number(inv.totalAmount || 0),
            paidAmount: Number(inv.paidAmount || 0),
            balanceAmount: Number(inv.balanceAmount ?? Math.max(0, Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0))),
            status: inv.status,
            isOverdue: Boolean(inv.isOverdue),
            paymentMode: inv.paymentMode || 'NOT_PAID',
            paymentMethod: null,
            paymentMethods: [],
            lastPaymentDate: inv.lastPaymentDate || null,
            planName: inv.planName || 'CRM Subscription Plan',
            billingCycle: inv.billingCycle || null,
            nextInstallmentDate: inv.nextInstallmentDate || null,
            nextInstallmentAmount: inv.nextInstallmentAmount != null ? Number(inv.nextInstallmentAmount) : null,
            nextBillingDate: inv.nextBillingDate || null,
            nextBillingAmount: inv.nextBillingAmount != null ? Number(inv.nextBillingAmount) : null,
          };

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNo,
        invoiceNo: inv.invoiceNo,
        customerId: inv.customerId,
        subscriptionId: inv.subscriptionId,
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
        amount: `₹${calc.totalAmount.toLocaleString('en-IN')}`,
        subTotal: calc.subTotal,
        discountAmount: calc.discountAmount,
        taxAmount: calc.taxAmount,
        tax: calc.taxAmount,
        totalAmount: calc.totalAmount,
        total: calc.totalAmount,
        paidAmount: calc.paidAmount,
        balanceAmount: calc.balanceAmount,
        outstandingBalance: calc.balanceAmount,
        status: calc.status,
        paymentStatus: calc.status,
        isOverdue: calc.isOverdue,
        paymentMode: calc.paymentMode,
        paymentMethod: calc.paymentMethod,
        paymentMethods: calc.paymentMethods,
        lastPaymentDate: calc.lastPaymentDate,
        paymentDate: calc.lastPaymentDate,
        nextInstallmentDate: calc.nextInstallmentDate,
        nextInstallmentAmount: calc.nextInstallmentAmount,
        nextBillingDate: calc.nextBillingDate,
        nextBillingAmount: calc.nextBillingAmount,
        billingCycle: calc.billingCycle,
        planName: calc.planName,
        notes: inv.notes,
        contact: inv.contact,
        customer: inv.customer,
        items: inv.items || [],
        payments: inv.payments || [],
      };
    }));

    const totalPages = Math.ceil(total / limit) || 1;
    const c = financialSummary?.counts || {
      total,
      paid: 0,
      partiallyPaid: 0,
      pending: 0,
      overdue: 0,
      draft: 0,
      cancelled: 0,
    };

    return {
      data: formatted,
      items: formatted,
      summary: {
        totalInvoices: c.total,
        paidInvoices: c.paid,
        partiallyPaidInvoices: c.partiallyPaid,
        pendingPayments: c.pending,
        pendingInvoices: c.pending,
        overdueInvoices: c.overdue,
        draftInvoices: c.draft,
        cancelledInvoices: c.cancelled,
        totalInvoiceAmount: financialSummary?.totalInvoicedAmount ?? 0,
        totalBilledAmount: financialSummary?.totalInvoicedAmount ?? 0,
        totalCollected: financialSummary?.totalCollectedAmount ?? 0,
        totalCollectedAmount: financialSummary?.totalCollectedAmount ?? 0,
        outstandingBalance: financialSummary?.outstandingReceivables ?? 0,
        overdueAmount: financialSummary?.overdueAmount ?? 0,
        upcomingBillingAmount: financialSummary?.upcomingBillingAmount ?? 0,
        upcomingCollectionsTotal: financialSummary?.upcomingCollectionsTotal ?? 0,
        onlineCollections: financialSummary?.onlineCollections ?? 0,
        offlineCollections: financialSummary?.offlineCollections ?? 0,
        refundedAmount: financialSummary?.refundedAmount ?? 0,
      },
      counts: {
        ...c,
        upcomingBilling: upcomingBillingCount,
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
    const planDates = await this.resolveInvoicePlanDates(invoice);

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
        const tableTop = metaBottom + 12;
        doc.rect(40, tableTop, 515, 22).fill('#F1F5F9');
        doc.fillColor(darkColor).fontSize(8.5).font(boldFont);
        doc.text('ITEM / SERVICE DESCRIPTION', 48, tableTop + 6, { width: 188 });
        doc.text('SAC CODE', 240, tableTop + 6, { width: 60, align: 'center' });
        doc.text('BASE AMT', 305, tableTop + 6, { width: 78, align: 'right' });
        doc.text('GST', 388, tableTop + 6, { width: 78, align: 'right' });
        doc.text('TOTAL', 471, tableTop + 6, { width: 76, align: 'right' });

        // Itemized Table Rows
        const subTotal = Number(invoice.subTotal || 0);
        const taxAmount = Number(invoice.taxAmount || 0);
        const totalAmount = Number(invoice.totalAmount || subTotal + taxAmount);
        const isTaxCharged = taxAmount > 0.005;
        const cgst = taxAmount / 2;
        const sgst = taxAmount / 2;
        const rowTop = tableTop + 28;
        const planName = this.resolveInvoicePlanName(invoice);
        const planNameHeight = doc
          .fontSize(9.5)
          .font(boldFont)
          .heightOfString(planName, { width: 188, lineGap: 1 });

        doc
          .fillColor(darkColor)
          .fontSize(9.5)
          .font(boldFont)
          .text(planName, 48, rowTop, { width: 188, lineGap: 1 });
        const validityLine = planEndLabel
          ? `Validity: ${planStartLabel} → ${planEndLabel}`
          : `Invoice Reference: ${invoiceNo}`;
        const validityY = rowTop + planNameHeight + 3;
        doc
          .fontSize(8)
          .font(regularFont)
          .fillColor(grayColor)
          .text(validityLine, 48, validityY, { width: 188 });

        doc.fillColor(darkColor).fontSize(8.5).font(regularFont);
        doc.text('998311', 240, rowTop, { width: 60, align: 'center' });
        doc.text(formatInrCurrency(subTotal), 305, rowTop, { width: 78, align: 'right' });
        doc.text(formatInrCurrency(taxAmount), 388, rowTop, { width: 78, align: 'right' });
        doc.font(boldFont).text(formatInrCurrency(totalAmount), 471, rowTop, {
          width: 76,
          align: 'right',
        });

        const rowBottom = Math.max(rowTop + 34, validityY + 12);
        doc
          .moveTo(40, rowBottom)
          .lineTo(555, rowBottom)
          .strokeColor(borderCol)
          .stroke();

        // Summary & Tax Breakdown Box
        const summaryTop = rowBottom + 12;

        // Left Box: Tax Breakdown
        doc.rect(40, summaryTop, 245, 95).fill(lightBg);
        doc.rect(40, summaryTop, 245, 95).strokeColor(borderCol).stroke();

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
        doc.rect(310, summaryTop, 245, 95).fill(lightBg);
        doc.rect(310, summaryTop, 245, 95).strokeColor(borderCol).stroke();

        doc.fillColor(darkColor).fontSize(8.5).font(boldFont).text('PAYMENT SETTLEMENT', 320, summaryTop + 10);
        doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
          .text('Taxable Value:', 320, summaryTop + 24)
          .fillColor(darkColor).text(formatInrCurrency(subTotal), 430, summaryTop + 24, { width: 115, align: 'right' });

        doc.fillColor(grayColor).text(isTaxCharged ? 'Total Tax (GST 18%):' : 'Total Tax:', 320, summaryTop + 38)
          .fillColor(darkColor).text(formatInrCurrency(taxAmount), 430, summaryTop + 38, { width: 115, align: 'right' });

        doc.moveTo(320, summaryTop + 52).lineTo(545, summaryTop + 52).strokeColor('#CBD5E1').stroke();

        doc.fillColor(primaryColor).fontSize(10).font(boldFont).text('Total Paid Amount:', 320, summaryTop + 58);
        doc.text(formatInrCurrency(isPaid ? totalAmount : 0), 430, summaryTop + 58, { width: 115, align: 'right' });

        doc.fillColor(grayColor).fontSize(8).font(regularFont).text('Balance Due:', 320, summaryTop + 76);
        doc
          .fillColor(isPaid ? '#059669' : '#B45309')
          .font(boldFont)
          .text(
            isPaid ? `${formatInrCurrency(0)} (PAID)` : formatInrCurrency(totalAmount),
            430,
            summaryTop + 76,
            { width: 115, align: 'right' },
          );

        // Official Verification Stamp & Signature Section
        const signTop = summaryTop + 110;

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

  async getUpcomingBilling(customerId: number | string | undefined, user?: any) {
    const isSuperAdmin = user ? isUserSuperAdmin(user) : false;
    const numCust = Number(customerId);
    const where: any = {
      status: 'ACTIVE',
      autoRenew: true,
      ...(numCust > 0 ? { customerId: numCust } : !isSuperAdmin ? { customerId: -1 } : {}),
    };

    const subs = await this.prisma.customerSubscription.findMany({
      where,
      include: { customer: true, plan: true, coupon: true },
      orderBy: { endDate: 'asc' },
    });

    return subs.map((sub) => {
      const next = computeNextBillingFromSubscription(sub);
      const baseAmount =
        sub.customPrice != null && Number(sub.customPrice) > 0
          ? Number(sub.customPrice)
          : String(sub.billingCycle || 'MONTHLY').toUpperCase() === 'YEARLY'
            ? Number(sub.plan?.yearlyPrice || 0)
            : Number(sub.plan?.monthlyPrice || 0);
      const discount = Number(sub.discountAmount || 0);
      const taxable = Math.max(0, roundCurrency(baseAmount - discount));
      const tax = roundCurrency(taxable * 0.18);
      return {
        subscriptionId: sub.id,
        customerId: sub.customerId,
        customerName: sub.customer?.name || sub.customer?.companyName || 'Customer',
        companyName: sub.customer?.companyName || sub.customer?.name || 'Customer',
        planName: sub.plan?.name || 'CRM Plan',
        billingCycle: sub.billingCycle || 'MONTHLY',
        nextBillingDate: next.nextBillingDate || sub.endDate,
        estimatedAmount: next.nextBillingAmount ?? roundCurrency(taxable + tax),
        taxAmount: tax,
        discountAmount: discount,
        renewalStatus: sub.autoRenew ? 'AUTO_RENEW' : 'MANUAL',
        status: sub.status,
      };
    });
  }

  async recordPayment(customerId: number | string, id: number | string, dto: RecordInvoicePaymentDto, user: any) {
    const invoice = await this.findOne(customerId, id, user);
    const amount = roundCurrency(Number(dto.amount));
    if (!amount || amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero.');
    }

    const existingPayments = await this.prisma.invoicePayment.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { paymentDate: 'desc' },
    });

    const calc = this.financialMetrics
      ? this.financialMetrics.computeAuthoritativeInvoice({ ...invoice, payments: existingPayments })
      : { totalAmount: Number(invoice.totalAmount || 0), paidAmount: Number(invoice.paidAmount || 0), balanceAmount: Number(invoice.balanceAmount || 0) };

    if (amount > calc.balanceAmount + 0.01) {
      throw new BadRequestException(`Payment amount (₹${amount}) exceeds remaining balance (₹${calc.balanceAmount}).`);
    }

    const paymentMode = dto.paymentMode || (isOnlinePaymentMethod(dto.paymentMethod) ? 'ONLINE' : 'OFFLINE');
    const receiptNo = `QUIKBOOM-RECEIPT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();

    const created = await this.prisma.invoicePayment.create({
      data: {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount,
        paymentMode,
        paymentMethod: dto.paymentMethod || (paymentMode === 'ONLINE' ? 'RAZORPAY' : 'BANK_TRANSFER'),
        transactionRef: dto.transactionRef || null,
        receiptNo,
        proofUrl: dto.proofUrl || null,
        remarks: dto.remarks || null,
        status: dto.pendingVerification ? 'PENDING' : 'CONFIRMED',
        paymentDate,
        recordedById: user?.id ? Number(user.id) : null,
      },
    });

    const allPayments = [created, ...existingPayments];
    const updatedCalc = this.financialMetrics
      ? this.financialMetrics.computeAuthoritativeInvoice({ ...invoice, payments: allPayments })
      : {
          paidAmount: roundCurrency(calc.paidAmount + amount),
          balanceAmount: Math.max(0, roundCurrency(calc.balanceAmount - amount)),
          status: calc.balanceAmount - amount <= 0.01 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
          paymentMode: resolvePaymentModeFromTransactions(allPayments),
          isOverdue: false,
        };

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: updatedCalc.paidAmount,
        balanceAmount: updatedCalc.balanceAmount,
        status: updatedCalc.status,
        paymentMode: updatedCalc.paymentMode,
        lastPaymentDate: paymentDate,
        nextInstallmentDate: dto.nextInstallmentDate ? new Date(dto.nextInstallmentDate) : updatedCalc.balanceAmount <= 0.01 ? null : invoice.nextInstallmentDate,
        nextInstallmentAmount: dto.nextInstallmentAmount != null ? Number(dto.nextInstallmentAmount) : updatedCalc.balanceAmount <= 0.01 ? null : updatedCalc.balanceAmount,
      },
    });

    return { payment: created, invoiceStatus: updatedCalc.status, paidAmount: updatedCalc.paidAmount, balanceAmount: updatedCalc.balanceAmount };
  }

  async getInvoicePayments(customerId: number | string, id: number | string, user: any) {
    const invoice = await this.findOne(customerId, id, user);
    return this.prisma.invoicePayment.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { paymentDate: 'desc' },
    });
  }

  async getPaymentReceiptPdf(customerId: number | string, id: number | string, paymentId: number | string, user: any, res: Response) {
    const invoice = await this.findOne(customerId, id, user);
    const payment = await this.prisma.invoicePayment.findFirst({
      where: { id: Number(paymentId), invoiceId: invoice.id },
    });
    if (!payment) throw new NotFoundException('Payment receipt not found.');

    const pdfBuffer = await generateInvoicePaymentReceiptPdfBuffer({
      receiptNo: payment.receiptNo || `QUIKBOOM-RECEIPT-${payment.id}`,
      invoiceNo: invoice.invoiceNo,
      customerName: invoice.customer?.companyName || invoice.customer?.name || 'Customer',
      customerEmail: invoice.customer?.email || '',
      planName: invoice.planName || 'CRM Subscription Plan',
      paymentDate: payment.paymentDate || payment.createdAt,
      amountPaid: Number(payment.amount || 0),
      invoiceTotal: Number(invoice.totalAmount || 0),
      totalPaidToDate: Number(invoice.paidAmount || payment.amount || 0),
      remainingBalance: Number(invoice.balanceAmount || 0),
      paymentMode: payment.paymentMode,
      paymentMethod: payment.paymentMethod,
      transactionRef: payment.transactionRef,
    });

    const filename = `${(payment.receiptNo || `QUIKBOOM-RECEIPT-${payment.id}`).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.end(pdfBuffer);
  }

  async rescheduleInstallment(customerId: number | string, id: number | string, dto: RescheduleInstallmentDto, user: any) {
    const invoice = await this.findOne(customerId, id, user);
    return this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        nextInstallmentDate: new Date(dto.dueDate),
        ...(dto.amount != null ? { nextInstallmentAmount: Number(dto.amount) } : {}),
      },
    });
  }

  async generatePaymentLink(customerId: number | string, id: number | string, dto: GeneratePaymentLinkDto, user: any) {
    const invoice = await this.findOne(customerId, id, user);
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + (dto.expiresInHours || 72) * 3600000);
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paymentLinkToken: token,
        paymentLinkExpiresAt: expiresAt,
        paymentLinkAllowPartial: Boolean(dto.allowPartial),
      },
    });
    const baseUrl = process.env.CUSTOMER_PORTAL_URL || 'https://app.qbapp.online';
    return {
      token,
      url: `${baseUrl}/pay/invoice/${invoice.id}?token=${token}`,
      expiresAt,
      allowPartial: Boolean(dto.allowPartial),
    };
  }

  async sendCommunication(customerId: number | string, id: number | string, dto: SendInvoiceCommunicationDto, user: any) {
    const invoice = await this.findOne(customerId, id, user);
    const recipient = invoice.customer?.email || invoice.customer?.phone || '';
    const log = await this.prisma.invoiceCommunicationLog.create({
      data: {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        channel: dto.channel || 'EMAIL',
        messageType: dto.messageType || 'INVOICE_PDF',
        recipient,
        status: recipient ? 'SENT' : 'FAILED',
        sentById: user?.id ? Number(user.id) : null,
      },
    });
    return log;
  }

  async cancelInvoice(customerId: number | string, id: number | string, dto: CancelInvoiceDto, user: any) {
    const invoice = await this.findOne(customerId, id, user);
    if (Number(invoice.paidAmount || 0) > 0 || invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Cannot cancel an invoice that already has verified payments.');
    }
    return this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: InvoiceStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: dto.reason || 'Cancelled by administrator',
      },
    });
  }
}
