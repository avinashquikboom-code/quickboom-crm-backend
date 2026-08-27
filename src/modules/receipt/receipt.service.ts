import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Response } from 'express';
import PDFDocument from 'pdfkit';

export interface NormalizedReceiptPayment {
  id: number;
  isCustom: boolean;
  customerId: number;
  customer?: any;
  status: string;
  planName: string;
  billingCycle: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: string;
  transactionId: string;
  orderNumber: string;
  receiptNumber: string;
  createdAt: Date;
}

@Injectable()
export class ReceiptService {
  private readonly logger = new Logger(ReceiptService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to find and normalize a payment/order record by any receipt identifier:
   * e.g. "REC-2026-000001", "DOC-6", "ORD-PAY-6", "ORD-CUST-6", "#QB-000006", "6", etc.
   */
  async findPaymentByReceiptId(receiptId: string, customerId?: number, user?: any): Promise<NormalizedReceiptPayment> {
    const rawId = (receiptId || '').trim();
    if (!rawId) {
      throw new NotFoundException('Receipt ID is required');
    }

    let record: any = null;
    let isCustom = false;

    // 1. Direct exact match in PaymentHistory
    record = await this.prisma.paymentHistory.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { invoiceUrl: rawId },
          { orderNumber: rawId },
          { orderId: rawId },
          { transactionId: rawId },
          { paymentId: rawId },
        ],
      },
      include: {
        customer: true,
        subscription: {
          include: { plan: true },
        },
      },
    });

    // 2. Direct exact match in CustomPlanOrder
    if (!record && this.prisma.customPlanOrder) {
      record = await this.prisma.customPlanOrder.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { orderNumber: rawId },
            { orderId: rawId },
            { transactionId: rawId },
            { paymentId: rawId },
          ],
        },
        include: {
          customer: true,
          subscription: {
            include: { plan: true },
          },
        },
      });
      if (record) isCustom = true;
    }

    // 3. Direct numeric ID lookup
    const directNum = Number(rawId);
    if (!record && !isNaN(directNum) && directNum > 0) {
      if (directNum >= 100000 && this.prisma.customPlanOrder) {
        // Namespaced Custom Order ID (e.g. 100006 -> co.id = 6)
        record = await this.prisma.customPlanOrder.findUnique({
          where: { id: directNum - 100000 },
          include: {
            customer: true,
            subscription: {
              include: { plan: true },
            },
          },
        });
        if (record && !record.deletedAt) isCustom = true;
        else record = null;
      }

      if (!record) {
        record = await this.prisma.paymentHistory.findUnique({
          where: { id: directNum },
          include: {
            customer: true,
            subscription: {
              include: { plan: true },
            },
          },
        });
        if (record?.deletedAt) record = null;
      }

      if (!record && this.prisma.customPlanOrder) {
        record = await this.prisma.customPlanOrder.findUnique({
          where: { id: directNum },
          include: {
            customer: true,
            subscription: {
              include: { plan: true },
            },
          },
        });
        if (record && !record.deletedAt) isCustom = true;
        else record = null;
      }
    }

    // 4. Pattern & Prefix Extraction (DOC-*, REC-*, ORD-PAY-*, ORD-CUST-*, QB-*, RCP-*, etc.)
    if (!record) {
      const isCustomPrefix = /CP|CUST/i.test(rawId);

      // Extract trailing digits or primary numeric component
      const match = rawId.match(/(\d+)(?!.*\d)/);
      if (match) {
        const extractedNum = parseInt(match[1], 10);
        if (extractedNum > 0) {
          if (isCustomPrefix && this.prisma.customPlanOrder) {
            record = await this.prisma.customPlanOrder.findUnique({
              where: { id: extractedNum },
              include: {
                customer: true,
                subscription: {
                  include: { plan: true },
                },
              },
            });
            if (record && !record.deletedAt) isCustom = true;
            else record = null;
          }

          if (!record) {
            record = await this.prisma.paymentHistory.findUnique({
              where: { id: extractedNum },
              include: {
                customer: true,
                subscription: {
                  include: { plan: true },
                },
              },
            });
            if (record?.deletedAt) record = null;
          }

          if (!record && this.prisma.customPlanOrder) {
            record = await this.prisma.customPlanOrder.findUnique({
              where: { id: extractedNum },
              include: {
                customer: true,
                subscription: {
                  include: { plan: true },
                },
              },
            });
            if (record && !record.deletedAt) isCustom = true;
            else record = null;
          }
        }
      }
    }

    // If still not found, log debug and throw 404
    if (!record) {
      this.logger.warn(
        `[RECEIPT_DOWNLOAD_DEBUG] requestedId: ${rawId}, customerId: ${customerId || user?.customerId || 'N/A'}, result: NOT_FOUND`,
      );
      throw new NotFoundException(`Receipt ${rawId} not found`);
    }

    // Normalize payment/order record
    const createdAt = new Date(record.createdAt || Date.now());
    const receiptNo = isCustom
      ? `REC-${createdAt.getFullYear()}-CP${String(record.id).padStart(4, '0')}`
      : (record.invoiceUrl && record.invoiceUrl.startsWith('REC-')
          ? record.invoiceUrl
          : `REC-${createdAt.getFullYear()}-${String(record.id).padStart(6, '0')}`);

    const normalized: NormalizedReceiptPayment = {
      id: record.id,
      isCustom,
      customerId: record.customerId,
      customer: record.customer,
      status: String(record.status || '').toUpperCase(),
      planName: isCustom
        ? `Custom Plan (${record.duration || 1} ${(record.durationUnit || 'MONTH').toLowerCase()}${record.duration > 1 ? 's' : ''})`
        : (record.planName || record.subscription?.plan?.name || 'Subscription Plan'),
      billingCycle: isCustom
        ? ((record.duration || 1) >= 12 ? 'YEARLY' : 'MONTHLY')
        : (record.billingCycle || 'MONTHLY'),
      amount: Number(isCustom ? (record.subtotal || 0) : (record.amount || 0)),
      taxAmount: Number(isCustom ? (record.tax || (record.subtotal * 0.18) || 0) : (record.taxAmount || 0)),
      totalAmount: Number(record.totalAmount || (isCustom ? ((record.subtotal || 0) + (record.tax || 0)) : (record.amount || 0))),
      paymentMethod: record.paymentMethod || 'RAZORPAY',
      transactionId: record.transactionId || (isCustom ? `TXN-CP-${record.id}` : `TXN-${record.id}`),
      orderNumber: record.orderNumber || (isCustom ? `ORD-CUST-${record.id}` : `#QB-${String(record.id).padStart(6, '0')}`),
      receiptNumber: receiptNo,
      createdAt,
    };

    // Role-based security validation: customer can only access their own receipts
    const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.isSuperAdmin;
    if (!isAdmin && user?.role === 'CUSTOMER') {
      const authCustId = customerId || user?.customerId;
      if (authCustId && Number(normalized.customerId) !== Number(authCustId)) {
        this.logger.warn(
          `[RECEIPT_DOWNLOAD_DEBUG] requestedId: ${rawId}, customerId: ${authCustId}, receiptCustomerId: ${normalized.customerId}, result: FORBIDDEN`,
        );
        throw new ForbiddenException('Access to this receipt is forbidden');
      }
    }

    // Must be confirmed/paid to access receipt
    const isPaid = normalized.status === 'PAID' || normalized.status === 'SUCCESS' || normalized.status === 'ACTIVATED';
    if (!isPaid) {
      this.logger.warn(
        `[RECEIPT_DOWNLOAD_DEBUG] requestedId: ${rawId}, paymentStatus: ${normalized.status}, result: NOT_PAID`,
      );
      throw new ForbiddenException(
        'Receipt is not available until payment is confirmed',
      );
    }

    this.logger.log(
      `[RECEIPT_DOWNLOAD_DEBUG] requestedId: ${rawId}, customerId: ${customerId || user?.customerId || 'N/A'}, foundReceiptId: ${normalized.id}, receiptNumber: ${normalized.receiptNumber}, documentNumber: ${rawId}, receiptCustomerId: ${normalized.customerId}, paymentStatus: ${normalized.status}`,
    );

    return normalized;
  }

  /**
   * Get receipt metadata
   */
  async getReceipt(receiptId: string, customerId?: number, user?: any) {
    const payment = await this.findPaymentByReceiptId(receiptId, customerId, user);

    return {
      success: true,
      receiptId: payment.receiptNumber,
      receiptNumber: payment.receiptNumber,
      documentNumber: receiptId,
      orderNumber: payment.orderNumber,
      transactionId: payment.transactionId,
      paymentMethod: payment.paymentMethod,
      amount: payment.amount,
      taxAmount: payment.taxAmount,
      totalAmount: payment.totalAmount,
      paidDate: payment.createdAt,
      status: 'PAID',
      customer: {
        id: payment.customer?.id,
        name: payment.customer?.name || 'Customer',
        email: payment.customer?.email || '',
        phone: payment.customer?.phone || '',
      },
      plan: {
        name: payment.planName,
        billingCycle: payment.billingCycle,
      },
      downloadUrl: `/receipts/${payment.receiptNumber}/download`,
    };
  }

  /**
   * Stream a generated PDF receipt
   */
  async downloadReceiptPdf(
    receiptId: string,
    customerId: number | undefined,
    user: any,
    res: Response,
  ) {
    const payment = await this.findPaymentByReceiptId(receiptId, customerId, user);
    const receiptNo = payment.receiptNumber;

    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt_${receiptNo}.pdf"`);

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

    doc.fillColor(darkColor).fontSize(16).font('Helvetica-Bold').text('PAYMENT RECEIPT', 350, 40, { align: 'right' });
    doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(receiptNo, 350, 60, { align: 'right' });
    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica')
      .text('Customer Voucher Copy', 350, 74, { align: 'right' })
      .text(`Receipt Date: ${new Date(payment.createdAt).toLocaleDateString('en-IN')}`, 350, 86, { align: 'right' });

    doc.moveTo(40, 102).lineTo(555, 102).strokeColor(borderCol).lineWidth(1).stroke();

    // Customer & Receipt Meta 2-Column Section
    const isOffline = payment.paymentMethod?.toUpperCase() === 'OFFLINE' || payment.paymentMethod?.toUpperCase() === 'CASH' || payment.paymentMethod?.toUpperCase() === 'BANK_TRANSFER';
    const paymentMethodLabel = isOffline ? 'Offline / Cash (Admin Approved)' : 'Online (Razorpay Verified)';
    const metaTop = 112;

    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica-Bold').text('PAID BY (CUSTOMER)', 40, metaTop);
    doc.fillColor(darkColor).fontSize(10).font('Helvetica-Bold').text(payment.customer?.name || 'Customer Account', 40, metaTop + 14);
    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica')
      .text(`Email: ${payment.customer?.email || 'N/A'}`, 40, metaTop + 28)
      .text(`Phone: ${payment.customer?.phone || 'N/A'}`, 40, metaTop + 40)
      .text(`Customer ID: #${payment.customerId}`, 40, metaTop + 52);

    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica-Bold').text('TRANSACTION DETAILS', 350, metaTop);
    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica')
      .text(`Payment Mode: ${paymentMethodLabel}`, 350, metaTop + 14)
      .text(`Transaction Ref: ${payment.transactionId || 'TXN-' + payment.id}`, 350, metaTop + 28)
      .text(`Order Reference: ${payment.orderNumber || '#QB-' + payment.id}`, 350, metaTop + 40)
      .text(`Payment Status: CONFIRMED (PAID)`, 350, metaTop + 52);

    doc.moveTo(40, metaTop + 70).lineTo(555, metaTop + 70).strokeColor(borderCol).stroke();

    // Itemized Table Header
    const tableTop = metaTop + 82;
    doc.rect(40, tableTop, 515, 22).fill('#F1F5F9');
    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold');
    doc.text('ITEM / PLAN DESCRIPTION', 50, tableTop + 6);
    doc.text('BILLING CYCLE', 240, tableTop + 6);
    doc.text('BASE AMT', 320, tableTop + 6);
    doc.text('TAX (18%)', 400, tableTop + 6);
    doc.text('AMOUNT PAID', 470, tableTop + 6, { align: 'right' });

    // Itemized Table Row
    const planName = payment.planName;
    const cycle = payment.billingCycle;
    const baseAmt = Number(payment.amount);
    const taxAmt = Number(payment.taxAmount);
    const totalAmt = Number(payment.totalAmount);
    const cgst = taxAmt / 2;
    const sgst = taxAmt / 2;
    const rowTop = tableTop + 28;

    doc.fillColor(darkColor).fontSize(9.5).font('Helvetica-Bold').text(planName, 50, rowTop);
    doc.fontSize(8).font('Helvetica').fillColor(grayColor).text(`Receipt Ref: ${receiptNo} • Installment Settlement`, 50, rowTop + 13);

    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica').text(cycle, 240, rowTop);
    doc.text(`₹${baseAmt.toLocaleString('en-IN')}`, 320, rowTop);
    doc.text(`₹${taxAmt.toLocaleString('en-IN')}`, 400, rowTop);
    doc.font('Helvetica-Bold').text(`₹${totalAmt.toLocaleString('en-IN')}`, 470, rowTop, { align: 'right' });

    doc.moveTo(40, rowTop + 32).lineTo(555, rowTop + 32).strokeColor(borderCol).stroke();

    // Summary & Tax Breakdown Box
    const summaryTop = rowTop + 44;

    // Left Box: Tax Breakdown
    doc.rect(40, summaryTop, 270, 95).fill(lightBg);
    doc.rect(40, summaryTop, 270, 95).strokeColor(borderCol).stroke();

    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold').text('TAX SUMMARY (GST 18%)', 52, summaryTop + 10);
    doc.fillColor(grayColor).fontSize(8).font('Helvetica')
      .text('CGST (9.0%):', 52, summaryTop + 26)
      .text(`₹${cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 240, summaryTop + 26, { align: 'right' })
      .text('SGST (9.0%):', 52, summaryTop + 42)
      .text(`₹${sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 240, summaryTop + 42, { align: 'right' })
      .text('Total Tax Component:', 52, summaryTop + 58)
      .text(`₹${taxAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 240, summaryTop + 58, { align: 'right' });

    doc.moveTo(52, summaryTop + 72).lineTo(298, summaryTop + 72).strokeColor(borderCol).stroke();
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold')
      .text('Payment Status: Confirmed & Received', 52, summaryTop + 78);

    // Right Box: Total Received
    doc.rect(330, summaryTop, 225, 95).fill(lightBg);
    doc.rect(330, summaryTop, 225, 95).strokeColor(borderCol).stroke();

    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica').text('Base Amount:', 342, summaryTop + 10);
    doc.fillColor(darkColor).text(`₹${baseAmt.toLocaleString('en-IN')}`, 470, summaryTop + 10, { align: 'right' });

    doc.fillColor(grayColor).text('Tax Amount (18%):', 342, summaryTop + 26);
    doc.fillColor(darkColor).text(`₹${taxAmt.toLocaleString('en-IN')}`, 470, summaryTop + 26, { align: 'right' });

    doc.moveTo(342, summaryTop + 42).lineTo(543, summaryTop + 42).strokeColor('#CBD5E1').stroke();

    doc.fillColor(primaryColor).fontSize(10.5).font('Helvetica-Bold').text('Amount Received:', 342, summaryTop + 50);
    doc.text(`₹${totalAmt.toLocaleString('en-IN')}`, 470, summaryTop + 50, { align: 'right' });

    doc.fillColor(grayColor).fontSize(8.5).font('Helvetica').text('Voucher Type:', 342, summaryTop + 72);
    doc.fillColor('#059669').font('Helvetica-Bold').text('OFFICIAL RECEIPT', 470, summaryTop + 72, { align: 'right' });

    // Official Verification Stamp & Signature Section
    const signTop = summaryTop + 110;

    // Paid Stamp
    doc.rect(40, signTop, 130, 48).fillAndStroke('#ECFDF5', '#10B981');
    doc.fillColor('#065F46').fontSize(14).font('Helvetica-Bold').text('PAID', 82, signTop + 12);
    doc.fontSize(7.5).font('Helvetica').text('Official Payment Receipt • Verified', 48, signTop + 32);

    // Signatory
    doc.fillColor(darkColor).fontSize(8.5).font('Helvetica-Bold')
      .text('For QuikBoom Marketing Solutions Pvt Ltd', 330, signTop + 8, { align: 'right' });
    doc.fillColor(grayColor).fontSize(8).font('Helvetica')
      .text('Authorized Signatory', 330, signTop + 34, { align: 'right' });

    // Terms & Conditions Footer
    const footerTop = signTop + 65;
    doc.moveTo(40, footerTop).lineTo(555, footerTop).strokeColor(borderCol).stroke();
    doc.fillColor(grayColor).fontSize(7.5).font('Helvetica')
      .text('Note: This is a computer-generated payment voucher confirming receipt of payment.', 40, footerTop + 10)
      .text('Final Tax Invoice will be issued upon completion of 100% full plan payment.', 40, footerTop + 22)
      .text('QuikBoom CRM • Support: support@quikboom.com | https://quikboom.com', 40, footerTop + 34, { align: 'center' });

    doc.end();
  }
}
