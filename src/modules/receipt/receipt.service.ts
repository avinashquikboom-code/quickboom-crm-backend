import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Response } from 'express';
import PDFDocument from 'pdfkit';

@Injectable()
export class ReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to find a payment record by receiptId (e.g. "REC-2026-000001" or raw numeric ID)
   */
  async findPaymentByReceiptId(receiptId: string, customerId?: number, user?: any) {
    let payment: any = null;

    if (receiptId.startsWith('REC-')) {
      payment = await this.prisma.paymentHistory.findFirst({
        where: {
          invoiceUrl: receiptId,
          deletedAt: null,
        },
        include: {
          customer: true,
          subscription: {
            include: { plan: true },
          },
        },
      });
    }

    if (!payment && !isNaN(Number(receiptId))) {
      payment = await this.prisma.paymentHistory.findUnique({
        where: {
          id: Number(receiptId),
        },
        include: {
          customer: true,
          subscription: {
            include: { plan: true },
          },
        },
      });
    }

    if (!payment) {
      throw new NotFoundException(`Receipt ${receiptId} not found`);
    }

    // Role-based security validation
    if (user?.role === 'CUSTOMER') {
      const authCustId = customerId || user?.customerId;
      if (payment.customerId !== authCustId) {
        throw new ForbiddenException('You are not authorized to access this receipt.');
      }
    }

    // Must be paid/success to access receipt
    const isPaid = payment.status === 'PAID' || payment.status === 'SUCCESS';
    if (!isPaid) {
      throw new ForbiddenException(
        'Receipt is locked and will be available once payment is confirmed/approved.',
      );
    }

    return payment;
  }

  /**
   * Get receipt metadata
   */
  async getReceipt(receiptId: string, customerId?: number, user?: any) {
    const payment = await this.findPaymentByReceiptId(receiptId, customerId, user);
    const receiptNo =
      payment.invoiceUrl && payment.invoiceUrl.startsWith('REC-')
        ? payment.invoiceUrl
        : `REC-${payment.createdAt.getFullYear()}-${String(payment.id).padStart(6, '0')}`;

    return {
      success: true,
      receiptId: receiptNo,
      receiptNumber: receiptNo,
      orderNumber: payment.orderNumber || `#QB-${String(payment.id).padStart(6, '0')}`,
      transactionId: payment.transactionId || `TXN-${payment.id}`,
      paymentMethod: payment.paymentMethod || 'ONLINE',
      amount: Number(payment.amount),
      taxAmount: Number(payment.taxAmount || 0),
      totalAmount: Number(payment.totalAmount || payment.amount),
      paidDate: payment.createdAt,
      status: 'PAID',
      customer: {
        id: payment.customer?.id,
        name: payment.customer?.name || 'Customer',
        email: payment.customer?.email || '',
        phone: payment.customer?.phone || '',
      },
      plan: {
        name: payment.planName || payment.subscription?.plan?.name || 'Subscription Plan',
        billingCycle: payment.billingCycle || 'MONTHLY',
      },
      downloadUrl: `/receipts/${receiptNo}/download`,
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
    const receiptNo =
      payment.invoiceUrl && payment.invoiceUrl.startsWith('REC-')
        ? payment.invoiceUrl
        : `REC-${payment.createdAt.getFullYear()}-${String(payment.id).padStart(6, '0')}`;

    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receiptNo}.pdf"`);

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
    const isOffline = payment.paymentMethod?.toUpperCase() === 'OFFLINE' || payment.paymentMethod?.toUpperCase() === 'CASH';
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
    const planName = payment.planName || payment.subscription?.plan?.name || 'Standard Plan';
    const cycle = payment.billingCycle || 'MONTHLY';
    const baseAmt = Number(payment.amount);
    const taxAmt = Number(payment.taxAmount || 0);
    const totalAmt = Number(payment.totalAmount || baseAmt + taxAmt);
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

    doc.fillColor(grayColor).fontSize(8).font('Helvetica').text('Voucher Type:', 342, summaryTop + 72);
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
