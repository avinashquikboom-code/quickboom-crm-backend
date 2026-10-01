import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');

export interface AgreementData {
  customerName: string;
  companyName: string;
  purchaseDate: Date;
  activationDate: Date;
  planName: string;
  planFeatures: any[];
  amount: number;
  taxAmount: number;
  totalAmount: number;
  startDate: Date;
  endDate: Date;
  orderNumber: string;
  invoiceNumber: string | null;
}

export function generateAgreementPdfBuffer(data: AgreementData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const primaryColor = '#0F172A';
      const grayColor = '#475569';
      const borderCol = '#E2E8F0';
      const lightBg = '#F8FAFC';

      const agreementDate = new Date().toLocaleDateString('en-IN');

      // Title
      doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold')
         .text('SOCIAL MEDIA MARKETING SERVICE AGREEMENT', { align: 'center' });
      doc.moveDown(0.5);
      doc.fillColor(grayColor).fontSize(10).font('Helvetica')
         .text(`QUIK BOOM MARKETING AGENCY | ${data.companyName.toUpperCase()}`, { align: 'center' });
      doc.moveDown(0.5);
      doc.fillColor(grayColor).fontSize(10).font('Helvetica-Bold')
         .text(`Agreement Date: ${agreementDate}`, { align: 'center' });
      doc.moveDown(2);

      // Helper function for sections
      const drawSectionHeader = (title: string) => {
        doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text(title);
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(borderCol).lineWidth(1).stroke();
        doc.moveDown(0.5);
      };

      // CLIENT INFORMATION
      drawSectionHeader('1. CLIENT INFORMATION');
      doc.fillColor(grayColor).fontSize(10).font('Helvetica');
      doc.text(`Customer Name:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ${data.customerName}`);
      doc.font('Helvetica').text(`Company Name:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ${data.companyName}`);
      doc.font('Helvetica').text(`Purchase Date:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ${data.purchaseDate.toLocaleDateString('en-IN')}`);
      doc.font('Helvetica').text(`Activation Date:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ${data.activationDate.toLocaleDateString('en-IN')}`);
      doc.font('Helvetica').text(`Order Number:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ${data.orderNumber}`);
      if (data.invoiceNumber) {
        doc.font('Helvetica').text(`Invoice Number:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ${data.invoiceNumber}`);
      }
      doc.moveDown(1.5);

      // PLAN & PAYMENT
      drawSectionHeader('2. PLAN & PAYMENT');
      doc.fillColor(grayColor).fontSize(10).font('Helvetica');
      doc.text(`Plan:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ${data.planName}`);
      doc.font('Helvetica').text(`Service Fee:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ₹${data.amount.toLocaleString('en-IN')}`);
      doc.font('Helvetica').text(`GST:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ₹${data.taxAmount.toLocaleString('en-IN')}`);
      doc.font('Helvetica').text(`Total Paid:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ₹${data.totalAmount.toLocaleString('en-IN')}`);
      doc.font('Helvetica').text(`Validity:`, 50, doc.y, { continued: true }).font('Helvetica-Bold').text(` ${data.startDate.toLocaleDateString('en-IN')} \u2192 ${data.endDate.toLocaleDateString('en-IN')}`);
      doc.moveDown(1.5);

      // SERVICES
      drawSectionHeader('3. SERVICES PROVIDED');
      doc.fillColor(grayColor).fontSize(10).font('Helvetica');
      if (data.planFeatures && data.planFeatures.length > 0) {
        data.planFeatures.forEach((feature) => {
          let text = typeof feature === 'string' ? feature : (feature.name || feature.serviceName || JSON.stringify(feature));
          if (feature.qty && feature.qty > 0) {
            text = `${feature.qty} x ${text}`;
          }
          doc.text(`\u2022 ${text}`);
        });
      } else {
        doc.text('\u2022 Comprehensive Social Media Page Handling');
        doc.text('\u2022 Standard Posts and Engagement');
      }
      doc.moveDown(1.5);

      // MINIMUM COMMITMENT
      drawSectionHeader('4. MINIMUM COMMITMENT');
      doc.fillColor(grayColor).fontSize(10).font('Helvetica');
      doc.text(`The Client acknowledges that marketing requires a minimum duration to show significant results. This agreement ensures the delivery of services for the plan validity specified above. Any early termination may be subject to standard deductions as per the agency's policy.`, { align: 'justify' });
      doc.moveDown(1.5);

      // PAYMENT TERMS
      drawSectionHeader('5. PAYMENT TERMS');
      doc.fillColor(grayColor).fontSize(10).font('Helvetica');
      doc.text(`Payment for the selected plan has been processed successfully. Services will commence on the specified Activation Date. All fees are non-refundable once the service period has commenced. Invoices and receipts are available in your portal.`, { align: 'justify' });
      doc.moveDown(1.5);

      // CLIENT RESPONSIBILITIES
      drawSectionHeader('6. CLIENT RESPONSIBILITIES');
      doc.fillColor(grayColor).fontSize(10).font('Helvetica');
      doc.text(`The Client agrees to provide necessary access to social media accounts, timely feedback, and required branding assets. Delays in providing these materials may affect the delivery timeline, and the Agency will not be held responsible for such delays.`, { align: 'justify' });
      doc.moveDown(1.5);

      // PERFORMANCE
      drawSectionHeader('7. PERFORMANCE');
      doc.fillColor(grayColor).fontSize(10).font('Helvetica');
      doc.text(`The Agency will use its best efforts and industry standard practices to manage and grow the Client's social media presence. However, the Agency does not guarantee specific numerical milestones (like exact follower counts) as platforms' algorithms are outside the Agency's control.`, { align: 'justify' });
      doc.moveDown(1.5);

      // TERMINATION
      drawSectionHeader('8. TERMINATION');
      doc.fillColor(grayColor).fontSize(10).font('Helvetica');
      doc.text(`Either party may terminate this agreement at the end of the current validity period by providing written notice. In the event of breach of terms, the non-breaching party may terminate immediately.`, { align: 'justify' });
      doc.moveDown(2);

      // SYSTEM GENERATED FOOTER
      doc.rect(50, doc.y, 495, 60).fillAndStroke(lightBg, borderCol);
      doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text('SYSTEM GENERATED AGREEMENT', 50, doc.y - 50 + 15, { align: 'center', width: 495 });
      doc.fillColor(grayColor).fontSize(8).font('Helvetica').text('This agreement is electronically generated by the QUIK BOOM MARKETING AGENCY system upon successful payment and does not require a physical signature. The payment and generation of this document signify mutual acceptance of the terms.', 60, doc.y + 5, { align: 'center', width: 475 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
