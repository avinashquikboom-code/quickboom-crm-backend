import { InvoiceStatus, SubscriptionBillingCycle, SubscriptionStatus } from '@prisma/client';
import PDFDocument = require('pdfkit');
import * as fs from 'fs';
import * as path from 'path';
import { formatInrCurrency } from '../receipt/receipt.service';

export function roundCurrency(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

export function isOnlinePaymentMethod(method?: string | null): boolean {
  const m = String(method || '').trim().toUpperCase();
  return ['RAZORPAY', 'UPI', 'CARD', 'CREDIT_CARD', 'DEBIT_CARD', 'NET_BANKING', 'WALLET', 'ONLINE', 'PAYMENT_GATEWAY'].includes(m);
}

export function resolvePaymentModeFromTransactions(
  payments: Array<{ paymentMode?: string | null; paymentMethod?: string | null; status?: string | null; amount?: number; refundedAmount?: number }>,
): 'ONLINE' | 'OFFLINE' | 'MIXED' | 'NOT_PAID' {
  const settled = payments.filter((p) => {
    const s = String(p.status || 'CONFIRMED').toUpperCase();
    const net = Number(p.amount || 0) - Number(p.refundedAmount || 0);
    return (s === 'CONFIRMED' || s === 'SUCCESS' || s === 'PAID') && net > 0;
  });
  if (!settled.length) return 'NOT_PAID';

  let hasOnline = false;
  let hasOffline = false;
  for (const p of settled) {
    const mode = String(p.paymentMode || '').toUpperCase();
    if (mode === 'ONLINE' || (!mode && isOnlinePaymentMethod(p.paymentMethod))) {
      hasOnline = true;
    } else {
      hasOffline = true;
    }
  }
  if (hasOnline && hasOffline) return 'MIXED';
  if (hasOnline) return 'ONLINE';
  return 'OFFLINE';
}

export function computeNextBillingFromSubscription(sub: any): {
  nextBillingDate: Date | null;
  nextBillingAmount: number | null;
  billingCycle: string;
  renewalStatus: string;
  packageAmount: number;
  discount: number;
  tax: number;
} {
  if (!sub) {
    return {
      nextBillingDate: null,
      nextBillingAmount: null,
      billingCycle: 'ONE_TIME',
      renewalStatus: 'NOT_APPLICABLE',
      packageAmount: 0,
      discount: 0,
      tax: 0,
    };
  }

  const cycle = String(sub.billingCycle || 'MONTHLY').toUpperCase();
  const status = String(sub.status || '').toUpperCase();

  if (status === SubscriptionStatus.CANCELED || status === SubscriptionStatus.EXPIRED || !sub.autoRenew) {
    return {
      nextBillingDate: sub.endDate ? new Date(sub.endDate) : null,
      nextBillingAmount: null,
      billingCycle: cycle,
      renewalStatus: status === SubscriptionStatus.CANCELED ? 'CANCELLED' : !sub.autoRenew ? 'NON_RENEWING' : 'EXPIRED',
      packageAmount: 0,
      discount: 0,
      tax: 0,
    };
  }

  let basePrice = 0;
  if (sub.customPrice != null && Number(sub.customPrice) > 0) {
    basePrice = Number(sub.customPrice);
  } else if (sub.plan) {
    if (cycle === SubscriptionBillingCycle.YEARLY) {
      basePrice = Number(sub.plan.yearlyPrice || 0);
    } else if (cycle === 'QUARTERLY') {
      basePrice = roundCurrency(Number(sub.plan.monthlyPrice || 0) * 3);
    } else if (cycle === 'HALF_YEARLY') {
      basePrice = roundCurrency(Number(sub.plan.monthlyPrice || 0) * 6);
    } else {
      basePrice = Number(sub.plan.monthlyPrice || 0);
    }
  }

  let discount = 0;
  if (sub.coupon && sub.coupon.isActive !== false) {
    const pct = Number(sub.coupon.discountPct || 0);
    if (pct > 0) {
      discount = roundCurrency((basePrice * pct) / 100);
      if (sub.coupon.maximumDiscountAmount && discount > Number(sub.coupon.maximumDiscountAmount)) {
        discount = Number(sub.coupon.maximumDiscountAmount);
      }
    }
  } else if (sub.discountAmount && Number(sub.discountAmount) > 0) {
    discount = Number(sub.discountAmount);
  }

  const taxable = Math.max(0, roundCurrency(basePrice - discount));
  const tax = roundCurrency(taxable * 0.18);
  const estimatedTotal = roundCurrency(taxable + tax);

  return {
    nextBillingDate: sub.endDate ? new Date(sub.endDate) : null,
    nextBillingAmount: estimatedTotal,
    billingCycle: cycle,
    renewalStatus: sub.autoRenew ? 'AUTO_RENEW_ACTIVE' : 'MANUAL_RENEWAL',
    packageAmount: basePrice,
    discount,
    tax,
  };
}

export function resolveInvoiceDisplayStatus(inv: {
  status: InvoiceStatus | string;
  totalAmount: number;
  paidAmount: number;
  dueDate: Date | string;
}): {
  paymentStatus: string;
  isOverdue: boolean;
  progressPercent: number;
} {
  const rawStatus = String(inv.status || 'PENDING').toUpperCase();
  const total = roundCurrency(inv.totalAmount);
  const paid = roundCurrency(inv.paidAmount);
  const balance = Math.max(0, roundCurrency(total - paid));

  if (rawStatus === 'CANCELLED') {
    return { paymentStatus: 'CANCELLED', isOverdue: false, progressPercent: 0 };
  }
  if (rawStatus === 'DRAFT') {
    return { paymentStatus: 'DRAFT', isOverdue: false, progressPercent: 0 };
  }

  const due = inv.dueDate ? new Date(inv.dueDate) : null;
  const pastDue = Boolean(due && !isNaN(due.getTime()) && due.getTime() < Date.now() && balance > 0.01);

  if (balance <= 0.01 && total > 0) {
    return { paymentStatus: 'PAID', isOverdue: false, progressPercent: 100 };
  }
  if (paid > 0.01 && balance > 0.01) {
    const pct = total > 0 ? Math.min(99, Math.max(1, Math.round((paid / total) * 100))) : 0;
    return { paymentStatus: 'PARTIALLY_PAID', isOverdue: pastDue || rawStatus === 'OVERDUE', progressPercent: pct };
  }
  return {
    paymentStatus: 'UNPAID',
    isOverdue: pastDue || rawStatus === 'OVERDUE',
    progressPercent: 0,
  };
}

export async function generateInvoicePaymentReceiptPdfBuffer(params: {
  receiptNo: string;
  invoiceNo: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  planName?: string;
  paymentDate: Date;
  paymentMode: string;
  paymentMethod: string;
  transactionRef?: string | null;
  amountPaid: number;
  invoiceTotal: number;
  totalPaidToDate: number;
  remainingBalance: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 45 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header brand strip
    doc.rect(0, 0, doc.page.width, 84).fill('#173D30');
    const logoPath = path.resolve(process.cwd(), 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 45, 20, { height: 42 });
      } catch {}
    }

    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('PAYMENT RECEIPT', 45, 24, { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#A7F3D0').text(`Receipt No: ${params.receiptNo}`, 45, 50, { align: 'right' });

    doc.moveDown(3);
    const yStart = 108;
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text('QUIK BOOM MARKETING AGENCY', 45, yStart);
    doc.font('Helvetica').fontSize(9).fillColor('#4B5563').text(
      'FP 68, Gorwa Ankodia, 30MTRS, Canal Ring Road, Gorwa, Vadodara, Gujarat 391330\nsupport@quikboom.in',
      45,
      yStart + 18,
    );

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Received From:', 340, yStart);
    doc.font('Helvetica').fontSize(9.5).fillColor('#374151').text(
      `${params.customerName}\n${params.customerEmail || ''}\n${params.customerPhone || ''}`.trim(),
      340,
      yStart + 16,
    );

    // Summary Box
    const boxY = 195;
    doc.roundedRect(45, boxY, 505, 95, 8).fillAndStroke('#F0FDF4', '#BBF7D0');
    doc.fillColor('#166534').font('Helvetica-Bold').fontSize(10).text('AMOUNT RECEIVED', 65, boxY + 18);
    doc.fillColor('#14532D').font('Helvetica-Bold').fontSize(24).text(formatInrCurrency(params.amountPaid), 65, boxY + 36);
    doc.fillColor('#15803D').font('Helvetica').fontSize(9.5).text(
      `Payment Date: ${new Date(params.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      65,
      boxY + 68,
    );

    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9.5).text('Invoice Reference:', 330, boxY + 20);
    doc.font('Helvetica').text(params.invoiceNo, 440, boxY + 20);
    doc.font('Helvetica-Bold').text('Payment Mode:', 330, boxY + 38);
    doc.font('Helvetica').text(`${params.paymentMode} (${params.paymentMethod})`, 440, boxY + 38);
    doc.font('Helvetica-Bold').text('Transaction Ref:', 330, boxY + 56);
    doc.font('Helvetica').text(params.transactionRef || '—', 440, boxY + 56);

    // Breakdown Table
    const tblY = 315;
    doc.rect(45, tblY, 505, 28).fill('#F8FAFC');
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(9).text('DESCRIPTION', 58, tblY + 9);
    doc.text('AMOUNT', 450, tblY + 9, { width: 85, align: 'right' });

    const rows: Array<[string, string]> = [
      [`Plan / Service (${params.planName || 'Subscription'})`, formatInrCurrency(params.invoiceTotal)],
      ['This Payment Settled', formatInrCurrency(params.amountPaid)],
      ['Total Paid to Date', formatInrCurrency(params.totalPaidToDate)],
      ['Remaining Outstanding Balance', formatInrCurrency(params.remainingBalance)],
    ];

    let curY = tblY + 32;
    rows.forEach(([label, val], idx) => {
      if (idx === rows.length - 1) {
        doc.rect(45, curY - 4, 505, 26).fill('#F8FAFC');
      }
      doc.fillColor('#1E293B').font(idx === rows.length - 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(label, 58, curY + 2);
      doc.text(val, 450, curY + 2, { width: 85, align: 'right' });
      curY += 28;
    });

    doc.fillColor('#64748B').font('Helvetica').fontSize(8.5).text(
      'This is a computer-generated payment receipt. Original tax invoice remains immutable.',
      45,
      740,
      { align: 'center', width: 505 },
    );

    doc.end();
  });
}
