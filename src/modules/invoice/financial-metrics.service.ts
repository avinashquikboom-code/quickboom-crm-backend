import { Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getBusinessDate, getBusinessDayRange } from '../../common/utils/timezone.util';
import {
  computeNextBillingFromSubscription,
  isOnlinePaymentMethod,
  resolveInvoiceDisplayStatus,
  roundCurrency,
} from './invoice-billing.helper';

export interface FinancialFilterParams {
  customerId?: number | null;
  fromDate?: string;
  toDate?: string;
  paymentStatus?: string;
  paymentMode?: string;
  subscriptionPlanId?: number | null;
}

@Injectable()
export class FinancialMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  resolveDateBounds(fromDate?: string, toDate?: string): { start?: Date; end?: Date } {
    const start = fromDate ? getBusinessDayRange(fromDate).start : undefined;
    const end = toDate ? getBusinessDayRange(toDate).end : undefined;
    return { start, end };
  }

  /**
   * Authoritative financial summary shared across Main Admin Dashboard, CRM Dashboard,
   * Customer Dashboard, Invoices & Billing, Active Subscriptions, and Reports.
   */
  async getFinancialSummary(filters: FinancialFilterParams = {}) {
    const { customerId, fromDate, toDate, paymentStatus, paymentMode, subscriptionPlanId } = filters;
    const { start, end } = this.resolveDateBounds(fromDate, toDate);

    const baseCustomerWhere: any =
      customerId && Number.isFinite(Number(customerId)) && Number(customerId) > 0
        ? { customerId: Number(customerId) }
        : {};

    const invoiceWhere: any = {
      ...baseCustomerWhere,
      deletedAt: null,
    };

    if (start || end) {
      invoiceWhere.issueDate = {};
      if (start) invoiceWhere.issueDate.gte = start;
      if (end) invoiceWhere.issueDate.lte = end;
    }

    if (subscriptionPlanId && Number.isFinite(Number(subscriptionPlanId))) {
      invoiceWhere.subscription = { planId: Number(subscriptionPlanId) };
    }

    const paymentWhere: any = {
      status: 'CONFIRMED',
      invoice: { deletedAt: null, ...baseCustomerWhere },
    };
    if (start || end) {
      paymentWhere.paymentDate = {};
      if (start) paymentWhere.paymentDate.gte = start;
      if (end) paymentWhere.paymentDate.lte = end;
    }

    const [allNonDeletedInvoices, periodInvoices, periodConfirmedPayments, activeSubscriptions] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          ...baseCustomerWhere,
          deletedAt: null,
          ...(subscriptionPlanId ? { subscription: { planId: Number(subscriptionPlanId) } } : {}),
        },
        include: {
          payments: { where: { status: 'CONFIRMED' } },
          subscription: { include: { plan: true } },
        },
      }),
      this.prisma.invoice.findMany({
        where: invoiceWhere,
        include: {
          payments: { where: { status: 'CONFIRMED' } },
          subscription: { include: { plan: true } },
        },
      }),
      this.prisma.invoicePayment.findMany({
        where: paymentWhere,
        include: {
          invoice: { select: { id: true, customerId: true, paymentMode: true, subscriptionId: true } },
        },
      }),
      this.prisma.customerSubscription.findMany({
        where: {
          ...baseCustomerWhere,
          status: 'ACTIVE',
          ...(subscriptionPlanId ? { planId: Number(subscriptionPlanId) } : {}),
        },
        include: { plan: true, coupon: true },
      }),
    ]);

    // Also include verified PaymentHistory rows not yet linked to an InvoicePayment
    // so collections are never undercounted or double-counted.
    const linkedPaymentHistoryIds = new Set(
      periodConfirmedPayments
        .map((p) => p.paymentHistoryId)
        .filter((id): id is number => typeof id === 'number' && id > 0),
    );

    const legacyPaymentWhere: any = {
      ...baseCustomerWhere,
      deletedAt: null,
      status: { in: ['SUCCESS', 'PAID'] },
    };
    if (start || end) {
      legacyPaymentWhere.createdAt = {};
      if (start) legacyPaymentWhere.createdAt.gte = start;
      if (end) legacyPaymentWhere.createdAt.lte = end;
    }

    const legacyPayments = await this.prisma.paymentHistory.findMany({
      where: legacyPaymentWhere,
      include: { invoicePayments: { select: { id: true } } },
    });

    const unlinkedLegacyPayments = legacyPayments.filter(
      (lp) => !linkedPaymentHistoryIds.has(lp.id) && (!lp.invoicePayments || lp.invoicePayments.length === 0),
    );

    // Filter invoices by paymentStatus/paymentMode if requested
    const matchesStatusAndMode = (inv: any) => {
      const displayStatus = resolveInvoiceDisplayStatus(inv.status, inv.dueDate, Number(inv.balanceAmount || 0));
      if (paymentStatus && paymentStatus !== 'ALL') {
        const wanted = String(paymentStatus).toUpperCase();
        if (wanted === 'UNPAID' || wanted === 'PENDING') {
          if (!['PENDING', 'SENT'].includes(displayStatus)) return false;
        } else if (wanted === 'OVERDUE') {
          if (displayStatus !== 'OVERDUE' && !inv.isOverdue) return false;
        } else if (displayStatus !== wanted && String(inv.status).toUpperCase() !== wanted) {
          return false;
        }
      }
      if (paymentMode && paymentMode !== 'ALL') {
        const invMode = String(inv.paymentMode || 'NOT_PAID').toUpperCase();
        if (invMode !== String(paymentMode).toUpperCase()) return false;
      }
      return true;
    };

    const filteredPeriodInvoices = periodInvoices.filter(matchesStatusAndMode);
    const filteredAllInvoices = allNonDeletedInvoices.filter(matchesStatusAndMode);

    let totalInvoicedAmount = 0;
    let taxTotal = 0;
    let discountTotal = 0;
    let outstandingReceivables = 0;
    let overdueAmount = 0;
    let upcomingInstallmentsAmount = 0;

    const counts = {
      total: 0,
      paid: 0,
      partiallyPaid: 0,
      pending: 0,
      overdue: 0,
      draft: 0,
      cancelled: 0,
      upcomingBilling: 0,
    };

    const now = new Date();

    for (const inv of filteredPeriodInvoices) {
      const totalAmt = roundCurrency(Number(inv.totalAmount || 0));
      const taxAmt = roundCurrency(Number(inv.taxAmount || 0));
      const discAmt = roundCurrency(Number(inv.discountAmount || 0));
      const paidAmt = roundCurrency(
        inv.paidAmount != null
          ? Number(inv.paidAmount)
          : inv.status === InvoiceStatus.PAID
            ? totalAmt
            : (inv.payments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0),
      );
      const balanceAmt = roundCurrency(
        inv.balanceAmount != null
          ? Number(inv.balanceAmount)
          : Math.max(0, totalAmt - paidAmt),
      );

      const displayStatus = resolveInvoiceDisplayStatus(inv.status, inv.dueDate, balanceAmt);
      const isOverdue =
        displayStatus === 'OVERDUE' ||
        (balanceAmt > 0.01 &&
          inv.dueDate &&
          new Date(inv.dueDate) < now &&
          ![InvoiceStatus.PAID, InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT].includes(inv.status));

      counts.total += 1;
      if (displayStatus === 'PAID') counts.paid += 1;
      else if (displayStatus === 'PARTIALLY_PAID') counts.partiallyPaid += 1;
      else if (displayStatus === 'DRAFT') counts.draft += 1;
      else if (displayStatus === 'CANCELLED') counts.cancelled += 1;
      else counts.pending += 1;

      if (isOverdue) {
        counts.overdue += 1;
        overdueAmount = roundCurrency(overdueAmount + balanceAmt);
      }

      if (displayStatus !== 'DRAFT' && displayStatus !== 'CANCELLED') {
        totalInvoicedAmount = roundCurrency(totalInvoicedAmount + totalAmt);
        taxTotal = roundCurrency(taxTotal + taxAmt);
        discountTotal = roundCurrency(discountTotal + discAmt);
        outstandingReceivables = roundCurrency(outstandingReceivables + balanceAmt);
      }

      if (inv.nextInstallmentAmount && Number(inv.nextInstallmentAmount) > 0 && balanceAmt > 0.01) {
        upcomingInstallmentsAmount = roundCurrency(upcomingInstallmentsAmount + Number(inv.nextInstallmentAmount));
      }
    }

    // Also compute current outstanding/overdue across all open invoices when a date filter is narrow
    let currentOpenOutstanding = 0;
    let currentOpenOverdue = 0;
    for (const inv of filteredAllInvoices) {
      if (inv.status === InvoiceStatus.DRAFT || inv.status === InvoiceStatus.CANCELLED || inv.status === InvoiceStatus.PAID) {
        continue;
      }
      const totalAmt = Number(inv.totalAmount || 0);
      const paidAmt = Number(inv.paidAmount || 0);
      const balanceAmt = inv.balanceAmount != null ? Number(inv.balanceAmount) : Math.max(0, totalAmt - paidAmt);
      if (balanceAmt > 0.01) {
        currentOpenOutstanding = roundCurrency(currentOpenOutstanding + balanceAmt);
        if (inv.status === InvoiceStatus.OVERDUE || inv.isOverdue || (inv.dueDate && new Date(inv.dueDate) < now)) {
          currentOpenOverdue = roundCurrency(currentOpenOverdue + balanceAmt);
        }
      }
    }

    // Collections reporting strictly by payment transaction date
    let onlineCollections = 0;
    let offlineCollections = 0;
    let refundsTotal = 0;
    const methodBreakdown: Record<string, number> = {};
    const dailySeriesMap = new Map<string, { date: string; invoiced: number; collected: number }>();

    const recordCollection = (amount: number, methodRaw: string, txDate: Date, refunded = 0) => {
      const net = roundCurrency(Math.max(0, amount - refunded));
      refundsTotal = roundCurrency(refundsTotal + refunded);
      const method = String(methodRaw || 'OTHER').toUpperCase();
      if (paymentMode && paymentMode !== 'ALL') {
        const isOnline = isOnlinePaymentMethod(method);
        if (paymentMode.toUpperCase() === 'ONLINE' && !isOnline) return;
        if (paymentMode.toUpperCase() === 'OFFLINE' && isOnline) return;
      }
      if (isOnlinePaymentMethod(method)) {
        onlineCollections = roundCurrency(onlineCollections + net);
      } else {
        offlineCollections = roundCurrency(offlineCollections + net);
      }
      methodBreakdown[method] = roundCurrency((methodBreakdown[method] || 0) + net);

      const dayKey = getBusinessDate(txDate);
      const bucket = dailySeriesMap.get(dayKey) || { date: dayKey, invoiced: 0, collected: 0 };
      bucket.collected = roundCurrency(bucket.collected + net);
      dailySeriesMap.set(dayKey, bucket);
    };

    for (const p of periodConfirmedPayments) {
      recordCollection(
        Number(p.amount || 0),
        p.paymentMethod || p.paymentMode || 'OTHER',
        p.paymentDate || p.createdAt,
        Number(p.refundedAmount || 0),
      );
    }

    for (const lp of unlinkedLegacyPayments) {
      recordCollection(
        Number(lp.totalAmount || lp.amount || 0),
        lp.paymentMethod || 'RAZORPAY',
        lp.createdAt,
        0,
      );
    }

    for (const inv of filteredPeriodInvoices) {
      if (inv.status === InvoiceStatus.DRAFT || inv.status === InvoiceStatus.CANCELLED) continue;
      const dayKey = getBusinessDate(inv.issueDate || inv.createdAt);
      const bucket = dailySeriesMap.get(dayKey) || { date: dayKey, invoiced: 0, collected: 0 };
      bucket.invoiced = roundCurrency(bucket.invoiced + Number(inv.totalAmount || 0));
      dailySeriesMap.set(dayKey, bucket);
    }

    const totalCollectedAmount = roundCurrency(onlineCollections + offlineCollections);

    // Upcoming recurring subscription billing
    let upcomingBillingAmount = 0;
    for (const sub of activeSubscriptions) {
      if (!sub.autoRenew) continue;
      const next = computeNextBillingFromSubscription(sub);
      if (next.nextBillingAmount > 0) {
        counts.upcomingBilling += 1;
        upcomingBillingAmount = roundCurrency(upcomingBillingAmount + next.nextBillingAmount);
      }
    }

    const dailySeries = Array.from(dailySeriesMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalInvoicedAmount,
      totalBilledAmount: totalInvoicedAmount,
      actualRevenueCollected: totalCollectedAmount,
      totalCollectedAmount,
      onlineCollections,
      offlineCollections,
      outstandingReceivables: start || end ? outstandingReceivables : currentOpenOutstanding,
      outstandingBalance: start || end ? outstandingReceivables : currentOpenOutstanding,
      currentOpenOutstanding,
      overdueAmount: start || end ? overdueAmount : currentOpenOverdue,
      refundsTotal,
      taxTotal,
      discountTotal,
      upcomingInstallmentsAmount,
      upcomingBillingAmount,
      upcomingCollections: roundCurrency(upcomingInstallmentsAmount + upcomingBillingAmount),
      counts,
      methodBreakdown,
      dailySeries,
    };
  }
}
