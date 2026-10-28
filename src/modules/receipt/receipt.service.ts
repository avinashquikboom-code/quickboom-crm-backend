import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');

const inrCurrencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatInrCurrency(amount: any): string {
  if (amount === null || amount === undefined || amount === '') return '₹0.00';
  const num = Number(amount);
  if (isNaN(num)) return '₹0.00';
  return inrCurrencyFormatter.format(num);
}

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

  async generateReceiptPdfBuffer(payment: NormalizedReceiptPayment, receiptNo: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        console.log(`[PDF_GENERATION_START]\ndocumentId: ${receiptNo}`);
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          console.log(`[PDF_GENERATION_COMPLETE]\ndocumentId: ${receiptNo}\nbufferSize: ${pdfBuffer.length}`);
          console.log(`[PDF_GENERATION]\nstatus: SUCCESS\nbufferSize: ${pdfBuffer.length}`);
          resolve(pdfBuffer);
        });
        doc.on('error', (err) => {
          console.error(`[PDF_GENERATION_ERROR]\ndocumentId: ${receiptNo}\nerror: ${err.message}`);
          console.error(`[PDF_ERROR]\ndocumentType: RECEIPT\ndocumentId: ${receiptNo}\nerror: ${err.message}`);
          reject(err);
        });

        // Register Unicode Font supporting ₹ (U+20B9)
        const fontPaths = this.resolveFontPaths();
        let regularFont = 'Helvetica';
        let boldFont = 'Helvetica-Bold';

        if (fontPaths) {
          doc.registerFont('ReceiptFont', fontPaths.regular);
          doc.registerFont('ReceiptFont-Bold', fontPaths.bold);
          regularFont = 'ReceiptFont';
          boldFont = 'ReceiptFont-Bold';
        }

        const primaryColor = '#10B981';
        const darkColor = '#0F172A';
        const grayColor = '#64748B';
        const borderCol = '#E2E8F0';
        const lightBg = '#F8FAFC';

        // Header & Company Info (x = 40 to 555)
        doc.fillColor(primaryColor).fontSize(20).font(boldFont).text('QUIKBOOM CRM', 40, 40);
        doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
          .text('QuikBoom Marketing Solutions Pvt Ltd', 40, 62)
          .text('Dynasty Business Park, Andheri-Kurla Road, Mumbai, Maharashtra 400059', 40, 74)
          .text('GSTIN: 27AABCT3518Q1Z4 | PAN: AABCT3518Q | State Code: 27', 40, 86);

        doc.fillColor(darkColor).fontSize(16).font(boldFont).text('PAYMENT RECEIPT', 300, 40, { width: 255, align: 'right' });
        doc.fillColor(primaryColor).fontSize(10).font(boldFont).text(receiptNo, 300, 60, { width: 255, align: 'right' });
        doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
          .text('Customer Voucher Copy', 300, 74, { width: 255, align: 'right' })
          .text(`Receipt Date: ${new Date(payment.createdAt).toLocaleDateString('en-IN')}`, 300, 86, { width: 255, align: 'right' });

        doc.moveTo(40, 102).lineTo(555, 102).strokeColor(borderCol).lineWidth(1).stroke();

        // Customer & Receipt Meta 2-Column Section (Balanced 245pt each)
        const isOffline = payment.paymentMethod?.toUpperCase() === 'OFFLINE' || payment.paymentMethod?.toUpperCase() === 'CASH' || payment.paymentMethod?.toUpperCase() === 'BANK_TRANSFER';
        const paymentMethodLabel = isOffline ? 'Offline / Cash (Admin Approved)' : 'Online (Razorpay Verified)';
        const metaTop = 112;

        // Left Column (x=40, width=245): PAID BY CUSTOMER
        doc.fillColor(grayColor).fontSize(8.5).font(boldFont).text('PAID BY CUSTOMER', 40, metaTop);
        doc.fillColor(darkColor).fontSize(10).font(boldFont).text(payment.customer?.name || 'Customer Account', 40, metaTop + 14, { width: 245 });
        doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
          .text(`Email: ${payment.customer?.email || 'N/A'}`, 40, metaTop + 28, { width: 245 })
          .text(`Phone: ${payment.customer?.phone || 'N/A'}`, 40, metaTop + 40, { width: 245 })
          .text(`Customer ID: #${payment.customerId}`, 40, metaTop + 52, { width: 245 });

        // Right Column (x=310, width=245): TRANSACTION DETAILS
        doc.fillColor(grayColor).fontSize(8.5).font(boldFont).text('TRANSACTION DETAILS', 310, metaTop);
        doc.fillColor(darkColor).fontSize(8.5).font(regularFont)
          .text(`Payment Mode: ${paymentMethodLabel}`, 310, metaTop + 14, { width: 245 })
          .text(`Transaction Ref: ${payment.transactionId || 'TXN-' + payment.id}`, 310, metaTop + 28, { width: 245 })
          .text(`Order Reference: ${payment.orderNumber || '#QB-' + payment.id}`, 310, metaTop + 40, { width: 245 })
          .text(`Payment Status: CONFIRMED (PAID)`, 310, metaTop + 52, { width: 245 });

        doc.moveTo(40, metaTop + 70).lineTo(555, metaTop + 70).strokeColor(borderCol).stroke();

        // Itemized Table Header (x=40, width=515)
        const tableTop = metaTop + 82;
        doc.rect(40, tableTop, 515, 22).fill('#F1F5F9');
        doc.fillColor(darkColor).fontSize(8.5).font(boldFont);
        doc.text('#', 48, tableTop + 6, { width: 20 });
        doc.text('ITEM / PLAN DESCRIPTION', 72, tableTop + 6, { width: 160 });
        doc.text('BILLING CYCLE', 236, tableTop + 6, { width: 75 });
        doc.text('BASE AMT', 315, tableTop + 6, { width: 75, align: 'right' });
        doc.text('TAX (18%)', 395, tableTop + 6, { width: 75, align: 'right' });
        doc.text('AMOUNT PAID', 475, tableTop + 6, { width: 75, align: 'right' });

        // Itemized Table Row
        const planName = payment.planName;
        const cycle = payment.billingCycle;
        const baseAmt = Number(payment.amount);
        const taxAmt = Number(payment.taxAmount);
        const totalAmt = Number(payment.totalAmount);
        const cgst = taxAmt / 2;
        const sgst = taxAmt / 2;
        const rowTop = tableTop + 28;

        doc.fillColor(darkColor).fontSize(9.5).font(boldFont).text('1', 48, rowTop);
        doc.text(planName, 72, rowTop, { width: 160 });
        doc.fontSize(8).font(regularFont).fillColor(grayColor).text(`Receipt Ref: ${receiptNo} • Installment Settlement`, 72, rowTop + 13, { width: 160 });

        doc.fillColor(darkColor).fontSize(8.5).font(regularFont).text(cycle, 236, rowTop, { width: 75 });
        doc.text(formatInrCurrency(baseAmt), 315, rowTop, { width: 75, align: 'right' });
        doc.text(formatInrCurrency(taxAmt), 395, rowTop, { width: 75, align: 'right' });
        doc.font(boldFont).text(formatInrCurrency(totalAmt), 475, rowTop, { width: 75, align: 'right' });

        doc.moveTo(40, rowTop + 32).lineTo(555, rowTop + 32).strokeColor(borderCol).stroke();

        // Summary & Tax Breakdown Box (x=40..285, x=310..555, width=245 each)
        const summaryTop = rowTop + 44;

        // Left Box: Tax Breakdown
        doc.rect(40, summaryTop, 245, 95).fill(lightBg);
        doc.rect(40, summaryTop, 245, 95).strokeColor(borderCol).stroke();

        doc.fillColor(darkColor).fontSize(8.5).font(boldFont).text('TAX SUMMARY (GST 18%)', 50, summaryTop + 10);
        doc.fillColor(grayColor).fontSize(8).font(regularFont)
          .text('CGST (9.0%):', 50, summaryTop + 26)
          .text(formatInrCurrency(cgst), 160, summaryTop + 26, { width: 115, align: 'right' })
          .text('SGST (9.0%):', 50, summaryTop + 42)
          .text(formatInrCurrency(sgst), 160, summaryTop + 42, { width: 115, align: 'right' })
          .text('Total Tax Component:', 50, summaryTop + 58)
          .text(formatInrCurrency(taxAmt), 160, summaryTop + 58, { width: 115, align: 'right' });

        doc.moveTo(50, summaryTop + 72).lineTo(275, summaryTop + 72).strokeColor(borderCol).stroke();
        doc.fillColor(primaryColor).fontSize(8.5).font(boldFont)
          .text('Payment Status: Confirmed & Received', 50, summaryTop + 78);

        // Right Box: Payment Summary (x=310, width=245)
        doc.rect(310, summaryTop, 245, 95).fill(lightBg);
        doc.rect(310, summaryTop, 245, 95).strokeColor(borderCol).stroke();

        doc.fillColor(darkColor).fontSize(8.5).font(boldFont).text('PAYMENT SUMMARY', 320, summaryTop + 10);
        doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
          .text('Base Amount:', 320, summaryTop + 24)
          .fillColor(darkColor).text(formatInrCurrency(baseAmt), 430, summaryTop + 24, { width: 115, align: 'right' });

        doc.fillColor(grayColor).text('Tax Amount (18%):', 320, summaryTop + 38)
          .fillColor(darkColor).text(formatInrCurrency(taxAmt), 430, summaryTop + 38, { width: 115, align: 'right' });

        doc.moveTo(320, summaryTop + 52).lineTo(545, summaryTop + 52).strokeColor('#CBD5E1').stroke();

        doc.fillColor(primaryColor).fontSize(10).font(boldFont).text('Amount Received:', 320, summaryTop + 58);
        doc.text(formatInrCurrency(totalAmt), 430, summaryTop + 58, { width: 115, align: 'right' });

        doc.fillColor(grayColor).fontSize(8).font(regularFont).text('Voucher Type:', 320, summaryTop + 76);
        doc.fillColor('#059669').font(boldFont).text('OFFICIAL RECEIPT', 430, summaryTop + 76, { width: 115, align: 'right' });

        // Official Verification Stamp & Signature Section
        const signTop = summaryTop + 110;

        // Paid Stamp
        doc.rect(40, signTop, 140, 48).fillAndStroke('#ECFDF5', '#10B981');
        doc.fillColor('#065F46').fontSize(14).font(boldFont).text('PAID', 90, signTop + 12);
        doc.fontSize(7.5).font(regularFont).text('Official Payment Receipt • Verified', 48, signTop + 32);

        // Signatory (Aligned to right box column x=310, width=245)
        doc.fillColor(darkColor).fontSize(8.5).font(boldFont)
          .text('For QuikBoom Marketing Solutions Pvt Ltd', 310, signTop + 8, { width: 245, align: 'right' });
        doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
          .text('Authorized Signatory', 310, signTop + 34, { width: 245, align: 'right' });

        // Terms & Conditions Footer
        const footerTop = signTop + 65;
        doc.moveTo(40, footerTop).lineTo(555, footerTop).strokeColor(borderCol).stroke();
        doc.fillColor(grayColor).fontSize(7.5).font(regularFont)
          .text('Note: This is a computer-generated payment voucher confirming receipt of payment.', 40, footerTop + 10, { width: 515, align: 'center' })
          .text('Final Tax Invoice will be issued upon completion of 100% full plan payment.', 40, footerTop + 22, { width: 515, align: 'center' })
          .text('QuikBoom CRM • Support: support@quikboom.com • https://quikboom.com', 40, footerTop + 34, { width: 515, align: 'center' });

        doc.end();
      } catch (err: any) {
        console.error(`[PDF_GENERATION_ERROR]\ndocumentId: ${receiptNo}\nerror: ${err.message}`);
        console.error(`[PDF_ERROR]\ndocumentType: RECEIPT\ndocumentId: ${receiptNo}\nerror: ${err.message}`);
        reject(err);
      }
    });
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
    console.log(`[PDF_REQUEST]\ndocumentType: RECEIPT\ndocumentId: ${receiptId}`);
    try {
      const payment = await this.findPaymentByReceiptId(receiptId, customerId, user);
      const receiptNo = payment.receiptNumber;
      const safeReceiptNo = receiptNo.replace(/[^a-zA-Z0-9_-]/g, '_');

      const pdfBuffer = await this.generateReceiptPdfBuffer(payment, receiptNo);

      if (!pdfBuffer || pdfBuffer.length === 0 || pdfBuffer.toString('utf8', 0, 5) !== '%PDF-') {
        throw new Error('Generated PDF receipt document is invalid or empty');
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('Content-Disposition', `attachment; filename="receipt_${safeReceiptNo}.pdf"`);

      console.log(`[PDF_RESPONSE]\nstatus: 200\ncontentType: application/pdf\nsize: ${pdfBuffer.length}`);

      return res.end(pdfBuffer);
    } catch (err: any) {
      console.error(`[PDF_ERROR]\ndocumentType: RECEIPT\ndocumentId: ${receiptId}\nerror: ${err.message}`);
      if (!res.headersSent) {
        res.status(err.status || 500).json({
          statusCode: err.status || 500,
          message: err.message || 'Unable to generate PDF receipt. Please try again.',
        });
      }
    }
  }
}
