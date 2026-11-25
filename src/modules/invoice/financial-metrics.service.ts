import { Injectable } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getBusinessDate, getBusinessDayRange } from '../../common/utils/timezone.util';
import {
  roundCurrency,
  isOnlinePaymentMethod,
  resolvePaymentModeFromTransactions,
  computeNextBillingFromSubscription,
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

  resolveDateRange(fromDate?: string, toDate?: string): {
    startDate: Date | null;
    endDate: Date | null;
    prevStartDate: Date | null;
    prevEndDate: Date | null;
    fromKey: string | null;
    toKey: string | null;
  } {
    if (!fromDate && !toDate) {
      return {
        startDate: null,
        endDate: null,
        prevStartDate: null,
        prevEndDate: null,
        fromKey: null,
        toKey: null,
      };
    }

    const effectiveToKey = toDate || getBusinessDate(new Date());
    const effectiveFromKey = fromDate || '2020-01-01';
    const startDate = getBusinessDayRange(effectiveFromKey).start;
    const endDate = getBusinessDayRange(effectiveToKey).end;

    const spanMs = Math.max(86400000, endDate.getTime() - startDate.getTime() + 1);
    const prevEndDate = new Date(startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - spanMs + 1);

    return {
      startDate,
      endDate,
      prevStartDate,
      prevEndDate,
      fromKey: effectiveFromKey,
      toKey: effectiveToKey,
    };
  }

  computeAuthoritativeInvoice(inv: any, now = new Date()) {
    const items = Array.isArray(inv.items) ? inv.items : [];
    const sub = inv.subscription || null;

    let subTotal = roundCurrency(Number(inv.subTotal || 0));
    let taxAmount = roundCurrency(Number(inv.taxAmount || 0));
    const discountAmount = roundCurrency(Number(sub?.discountAmount || 0));
    let totalAmount = roundCurrency(Number(inv.totalAmount || 0));

    if (items.length > 0) {
      const itemsSubtotal = roundCurrency(
        items.reduce(
          (sum: number, item: any) =>
            sum + Number(item.amount ?? Number(item.quantity || 1) * Number(item.unitPrice || 0)),
          0,
        ),
      );
      if (itemsSubtotal > 0) {
        subTotal = itemsSubtotal;
        if (taxAmount <= 0 && totalAmount > subTotal) {
          taxAmount = roundCurrency(totalAmount - subTotal);
        }
        totalAmount = roundCurrency(Math.max(0, subTotal - discountAmount + taxAmount));
      }
    } else if (sub && Number(inv.totalAmount || 0) <= 0) {
      const cycle = String(sub.billingCycle || inv.billingCycle || 'MONTHLY').toUpperCase();
      const planBase =
        sub.customPrice != null && Number(sub.customPrice) > 0
          ? Number(sub.customPrice)
          : sub.plan
            ? cycle === 'YEARLY'
              ? Number(sub.plan.yearlyPrice || 0)
              : Number(sub.plan.monthlyPrice || 0)
            : 0;
      if (planBase > 0) {
        const taxable = Math.max(0, roundCurrency(planBase - discountAmount));
        subTotal = taxable;
        taxAmount = roundCurrency(taxable * 0.18);
        totalAmount = roundCurrency(taxable + taxAmount);
      }
    }

    if (totalAmount > 0 && subTotal <= 0) {
      subTotal = roundCurrency(totalAmount / 1.18);
      taxAmount = roundCurrency(totalAmount - subTotal);
    }

    const invoicePayments = Array.isArray(inv.payments) ? inv.payments : [];
    const verifiedPayments = invoicePayments.filter((p: any) =>
      ['SUCCESS', 'PAID', 'VERIFIED', 'CONFIRMED'].includes(String(p.status || '').toUpperCase()),
    );
    const refundedPayments = invoicePayments.filter(
      (p: any) => String(p.status || '').toUpperCase() === 'REFUNDED',
    );

    const grossPaidFromRows = roundCurrency(
      verifiedPayments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0),
    );
    const totalRefunded = roundCurrency(
      refundedPayments.reduce((sum: number, p: any) => sum + Number(p.refundedAmount || p.amount || 0), 0),
    );

    const paidAmount =
      verifiedPayments.length > 0
        ? Math.max(0, roundCurrency(grossPaidFromRows - totalRefunded))
        : roundCurrency(Number(inv.paidAmount || (inv.status === InvoiceStatus.PAID ? totalAmount : 0)));

    const balanceAmount = Math.max(0, roundCurrency(totalAmount - paidAmount));

    let status: InvoiceStatus = inv.status;
    if (status !== InvoiceStatus.CANCELLED && status !== InvoiceStatus.DRAFT) {
      if (balanceAmount <= 0.01 && totalAmount > 0) {
        status = InvoiceStatus.PAID;
      } else if (paidAmount > 0 && balanceAmount > 0.01) {
        status = InvoiceStatus.PARTIALLY_PAID;
      } else {
        status = InvoiceStatus.PENDING;
      }
    }

    const isOverdue =
      status !== InvoiceStatus.PAID &&
      status !== InvoiceStatus.CANCELLED &&
      balanceAmount > 0.01 &&
      Boolean(inv.dueDate && new Date(inv.dueDate).getTime() < now.getTime());

    const txForMode = verifiedPayments.map((p: any) => ({
      paymentMode: p.paymentMode,
      paymentMethod: p.paymentMethod,
    }));
    const paymentMode =
      txForMode.length > 0
        ? resolvePaymentModeFromTransactions(txForMode)
        : paidAmount > 0
          ? inv.paymentMode || 'ONLINE'
          : 'NOT_PAID';

    const paymentMethods = Array.from(
      new Set(
        verifiedPayments
          .map((p: any) => String(p.paymentMethod || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    );

    const lastPaymentDate =
      verifiedPayments.length > 0
        ? verifiedPayments
            .map((p: any) => new Date(p.paymentDate || p.createdAt))
            .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0]
        : inv.lastPaymentDate || (status === InvoiceStatus.PAID ? inv.issueDate : null);

    let planName = (inv.planName || sub?.plan?.name || '').trim();
    if (!planName && inv.notes && inv.notes.includes('Subscription payment for')) {
      const afterSub = inv.notes.split('Subscription payment for')[1];
      if (afterSub) {
        planName = afterSub
          .split(/\s*\(|\.\s*(?:Total Paid|Purchase|Plan activation|Payment Method|Order):/i)[0]
          .trim();
      }
    }
    if (!planName) {
      planName = items[0]?.description || 'CRM Subscription Plan';
    }

    const nextInstallmentRow = Array.isArray(sub?.installments)
      ? sub.installments.find((inst: any) =>
          ['PENDING', 'PARTIAL', 'OVERDUE'].includes(String(inst.status || '').toUpperCase()),
        )
      : null;

    const nextInstallmentDate =
      balanceAmount > 0.01 ? inv.nextInstallmentDate || nextInstallmentRow?.dueDate || null : null;
    const nextInstallmentAmount =
      balanceAmount > 0.01
        ? inv.nextInstallmentAmount != null
          ? Number(inv.nextInstallmentAmount)
          : nextInstallmentRow?.amount != null
            ? Number(nextInstallmentRow.amount)
            : balanceAmount
        : null;

    const billingCycle = inv.billingCycle || sub?.billingCycle || null;
    const computedNextBilling = sub
      ? computeNextBillingFromSubscription(sub)
      : { nextBillingDate: null, nextBillingAmount: null };
    const nextBillingDate = inv.nextBillingDate || computedNextBilling.nextBillingDate;
    const nextBillingAmount =
      inv.nextBillingAmount != null ? Number(inv.nextBillingAmount) : computedNextBilling.nextBillingAmount;

    return {
      subTotal,
      discountAmount,
      taxAmount,
      totalAmount,
      paidAmount,
      balanceAmount,
      status,
      isOverdue,
      paymentMode,
      paymentMethod: paymentMethods.length > 1 ? 'MIXED' : paymentMethods[0] || null,
      paymentMethods,
      lastPaymentDate,
      planName,
      billingCycle,
      nextInstallmentDate,
      nextInstallmentAmount,
      nextBillingDate,
      nextBillingAmount,
    };
  }

  async getFinancialSummary(filters: FinancialFilterParams = {}) {
    const { startDate, endDate, prevStartDate, prevEndDate, fromKey, toKey } = this.resolveDateRange(
      filters.fromDate,
      filters.toDate,
    );

    const baseCust =
      filters.customerId && Number.isFinite(Number(filters.customerId)) && Number(filters.customerId) > 0
        ? { customerId: Number(filters.customerId) }
        : {};

    const invoiceWhere: any = {
      ...baseCust,
      deletedAt: null,
      ...(startDate && endDate ? { issueDate: { gte: startDate, lte: endDate } } : {}),
      ...(filters.subscriptionPlanId ? { subscription: { planId: Number(filters.subscriptionPlanId) } } : {}),
    };

    const payWhere: any = {
      ...baseCust,
      deletedAt: null,
      status: { in: ['SUCCESS', 'PAID', 'REFUNDED'] },
      ...(startDate && endDate ? { createdAt: { gte: startDate, lte: endDate } } : {}),
    };

    const now = new Date();
    const [invoices, activeSubs, invoicePaymentRows, paymentHistoryRows] = await Promise.all([
      this.prisma.invoice.findMany({
        where: invoiceWhere,
        include: {
          items: true,
          payments: true,
          subscription: {
            include: { plan: true, coupon: true, installments: { orderBy: { installmentNumber: 'asc' } } },
          },
        },
      }),
      this.prisma.customerSubscription.findMany({
        where: {
          ...baseCust,
          status: 'ACTIVE',
          autoRenew: true,
          ...(filters.subscriptionPlanId ? { planId: Number(filters.subscriptionPlanId) } : {}),
        },
        include: { plan: true, coupon: true },
      }),
      this.prisma.invoicePayment.findMany({
        where: {
          ...baseCust,
          ...(startDate && endDate ? { paymentDate: { gte: startDate, lte: endDate } } : {}),
          status: { in: ['CONFIRMED', 'SUCCESS', 'PAID', 'VERIFIED', 'REFUNDED'] },
        },
      }),
      this.prisma.paymentHistory.findMany({
        where: payWhere,
      }),
    ]);

    let totalInvoicedAmount = 0;
    let totalTaxAmount = 0;
    let totalDiscountAmount = 0;
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
    };

    for (const inv of invoices) {
      const calc = this.computeAuthoritativeInvoice(inv, now);
      if (filters.paymentMode && filters.paymentMode !== 'ALL' && calc.paymentMode !== filters.paymentMode) {
        continue;
      }

      counts.total += 1;
      if (calc.status === InvoiceStatus.PAID) counts.paid += 1;
      else if (calc.status === InvoiceStatus.PARTIALLY_PAID) counts.partiallyPaid += 1;
      else if (calc.status === InvoiceStatus.DRAFT) counts.draft += 1;
      else if (calc.status === InvoiceStatus.CANCELLED) counts.cancelled += 1;
      else counts.pending += 1;

      if (calc.isOverdue) {
        counts.overdue += 1;
        overdueAmount += calc.balanceAmount;
      }

      if (calc.status !== InvoiceStatus.CANCELLED && calc.status !== InvoiceStatus.DRAFT) {
        totalInvoicedAmount += calc.totalAmount;
        totalTaxAmount += calc.taxAmount;
        totalDiscountAmount += calc.discountAmount;
        outstandingReceivables += calc.balanceAmount;
        if (calc.nextInstallmentAmount && calc.balanceAmount > 0.01) {
          upcomingInstallmentsAmount += calc.nextInstallmentAmount;
        }
      }
    }

    const linkedHistoryIds = new Set<number>(
      invoicePaymentRows.map((p: any) => p.paymentHistoryId).filter((id: any) => typeof id === 'number'),
    );

    let onlineCollections = 0;
    let offlineCollections = 0;
    let refundedAmount = 0;

    for (const p of invoicePaymentRows) {
      const st = String(p.status || '').toUpperCase();
      if (st === 'REFUNDED') {
        refundedAmount += Number(p.refundedAmount || p.amount || 0);
        continue;
      }
      const amt = Number(p.amount || 0);
      if (p.paymentMode === 'ONLINE' || isOnlinePaymentMethod(p.paymentMethod)) {
        onlineCollections += amt;
      } else {
        offlineCollections += amt;
      }
      if (Number(p.refundedAmount || 0) > 0) {
        refundedAmount += Number(p.refundedAmount || 0);
      }
    }

    for (const h of paymentHistoryRows) {
      if (linkedHistoryIds.has(h.id)) continue;
      const st = String(h.status || '').toUpperCase();
      if (st === 'REFUNDED') {
        refundedAmount += Number(h.totalAmount || h.amount || 0);
        continue;
      }
      const amt = Number(h.totalAmount || h.amount || 0);
      if (isOnlinePaymentMethod(h.paymentMethod)) onlineCollections += amt;
      else offlineCollections += amt;
    }

    const totalCollectedAmount = Math.max(0, roundCurrency(onlineCollections + offlineCollections - refundedAmount));
    const upcomingBillingAmount = roundCurrency(
      activeSubs.reduce((sum: number, sub: any) => {
        const next = computeNextBillingFromSubscription(sub);
        return sum + Number(next.nextBillingAmount || 0);
      }, 0),
    );

    let previousCollectedAmount: number | null = null;
    let collectionGrowthPercent: number | null = null;
    if (prevStartDate && prevEndDate) {
      const prevPayments = await this.prisma.paymentHistory.aggregate({
        where: {
          ...baseCust,
          deletedAt: null,
          status: { in: ['SUCCESS', 'PAID'] },
          createdAt: { gte: prevStartDate, lte: prevEndDate },
        },
        _sum: { totalAmount: true },
      });
      previousCollectedAmount = roundCurrency(Number(prevPayments._sum.totalAmount || 0));
      if (previousCollectedAmount > 0) {
        collectionGrowthPercent = roundCurrency(
          ((totalCollectedAmount - previousCollectedAmount) / previousCollectedAmount) * 100,
        );
      }
    }

    return {
      dateRange: { from: fromKey, to: toKey },
      totalInvoicedAmount: roundCurrency(totalInvoicedAmount),
      totalCollectedAmount,
      onlineCollections: roundCurrency(onlineCollections),
      offlineCollections: roundCurrency(offlineCollections),
      refundedAmount: roundCurrency(refundedAmount),
      outstandingReceivables: roundCurrency(outstandingReceivables),
      overdueAmount: roundCurrency(overdueAmount),
      totalTaxAmount: roundCurrency(totalTaxAmount),
      totalDiscountAmount: roundCurrency(totalDiscountAmount),
      upcomingInstallmentsAmount: roundCurrency(upcomingInstallmentsAmount),
      upcomingBillingAmount,
      upcomingCollectionsTotal: roundCurrency(upcomingInstallmentsAmount + upcomingBillingAmount),
      previousCollectedAmount,
      collectionGrowthPercent,
      counts,
    };
  }
}
