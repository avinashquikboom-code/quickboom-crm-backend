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
    const lightBg = '#F8FAFC';

    // Header
    doc.fillColor(primaryColor).fontSize(22).font('Helvetica-Bold').text('QuikBoom CRM', 40, 40);
    doc.fillColor(grayColor).fontSize(9).font('Helvetica').text('Smart Growth for Smarter Businesses', 40, 65);

    doc.fillColor(darkColor).fontSize(16).font('Helvetica-Bold').text('PAYMENT RECEIPT', 380, 40, { align: 'right' });
    doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(receiptNo, 380, 60, { align: 'right' });

    doc.moveTo(40, 85).lineTo(555, 85).strokeColor('#E2E8F0').lineWidth(1).stroke();

    // Meta details block
    const isOffline = payment.paymentMethod?.toUpperCase() === 'OFFLINE' || payment.paymentMethod?.toUpperCase() === 'CASH';
    const paymentMethodLabel = isOffline ? 'Offline / Cash (Approved)' : 'Online (Razorpay)';

    doc.fillColor(grayColor).fontSize(9).font('Helvetica-Bold').text('RECEIPT DETAILS', 40, 100);
    doc.fillColor(darkColor).fontSize(10).font('Helvetica').text(`Receipt Date: ${new Date(payment.createdAt).toLocaleDateString('en-IN')}`, 40, 115);
    doc.text(`Payment Mode: ${paymentMethodLabel}`, 40, 130);
    doc.text(`Transaction Ref: ${payment.transactionId || 'TXN-' + payment.id}`, 40, 145);

    doc.fillColor(grayColor).fontSize(9).font('Helvetica-Bold').text('PAID BY (CUSTOMER)', 320, 100);
    doc.fillColor(darkColor).fontSize(10).font('Helvetica').text(payment.customer?.name || 'Customer Account', 320, 115);
    doc.text(`Email: ${payment.customer?.email || 'N/A'}`, 320, 130);
    doc.text(`Phone: ${payment.customer?.phone || 'N/A'}`, 320, 145);

    // Items table header
    const tableTop = 180;
    doc.rect(40, tableTop, 515, 24).fill('#F1F5F9');
    doc.fillColor(darkColor).fontSize(9).font('Helvetica-Bold');
    doc.text('ITEM / PLAN DESCRIPTION', 50, tableTop + 7);
    doc.text('CYCLE', 280, tableTop + 7);
    doc.text('TAX', 380, tableTop + 7);
    doc.text('AMOUNT PAID', 460, tableTop + 7, { align: 'right' });

    // Items table row
    const rowTop = tableTop + 30;
    const planName = payment.planName || payment.subscription?.plan?.name || 'Standard Package';
    const cycle = payment.billingCycle || 'MONTHLY';
    const baseAmt = Number(payment.amount);
    const taxAmt = Number(payment.taxAmount || 0);
    const totalAmt = Number(payment.totalAmount || baseAmt + taxAmt);

    doc.fillColor(darkColor).fontSize(10).font('Helvetica-Bold').text(planName, 50, rowTop);
    doc.fontSize(8).font('Helvetica').fillColor(grayColor).text(`Order Ref: ${payment.orderNumber || '#QB-' + payment.id}`, 50, rowTop + 14);

    doc.fillColor(darkColor).fontSize(9).font('Helvetica').text(cycle, 280, rowTop);
    doc.text(`₹${taxAmt.toLocaleString('en-IN')}`, 380, rowTop);
    doc.font('Helvetica-Bold').text(`₹${totalAmt.toLocaleString('en-IN')}`, 460, rowTop, { align: 'right' });

    doc.moveTo(40, rowTop + 35).lineTo(555, rowTop + 35).strokeColor('#E2E8F0').stroke();

    // Summary block
    const summaryTop = rowTop + 50;
    doc.rect(340, summaryTop, 215, 75).fill(lightBg);
    doc.rect(340, summaryTop, 215, 75).strokeColor('#E2E8F0').stroke();

    doc.fillColor(grayColor).fontSize(9).font('Helvetica').text('Subtotal:', 355, summaryTop + 12);
    doc.fillColor(darkColor).text(`₹${baseAmt.toLocaleString('en-IN')}`, 480, summaryTop + 12, { align: 'right' });

    doc.fillColor(grayColor).text('GST (18%):', 355, summaryTop + 28);
    doc.fillColor(darkColor).text(`₹${taxAmt.toLocaleString('en-IN')}`, 480, summaryTop + 28, { align: 'right' });

    doc.moveTo(355, summaryTop + 44).lineTo(540, summaryTop + 44).strokeColor('#CBD5E1').stroke();

    doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold').text('Total Paid:', 355, summaryTop + 52);
    doc.text(`₹${totalAmt.toLocaleString('en-IN')}`, 480, summaryTop + 52, { align: 'right' });

    // Payment Status Stamp
    doc.rect(40, summaryTop, 130, 45).fillAndStroke('#ECFDF5', '#10B981');
    doc.fillColor('#065F46').fontSize(14).font('Helvetica-Bold').text('PAID', 65, summaryTop + 14);
    doc.fontSize(8).font('Helvetica').text('Official Payment Receipt', 50, summaryTop + 30);

    // Footer note
    doc.fillColor(grayColor).fontSize(8).font('Helvetica')
      .text('Note: This is an official computer-generated payment receipt confirming receipt of funds.', 40, 400);
    doc.text('Final Tax Invoice will be issued upon completion of 100% full plan payment.', 40, 412);
    doc.text('QuikBoom CRM • Support: support@quikboom.com • Web: https://quikboom.com', 40, 430);

    doc.end();
  }
}
