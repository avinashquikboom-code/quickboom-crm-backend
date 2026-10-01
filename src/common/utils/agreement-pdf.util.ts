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

export const INVOICE_ISSUER = Object.freeze({
  brand: 'QB SUITE',
  companyName: 'QUIK BOOM MARKETING AGENCY',
  address: [
    'FP 68, Gorwa Ankodia, 30MTRS, Canal Ring Road,',
    'near Shivanta Iris, Gorwa,',
    'Vadodara, Gujarat 391330',
  ].join('\n'),
  supportEmail: 'support@quikboom.in',
});

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatAgreementDate(d: Date | string | null | undefined): string {
  if (!d) return 'N/A';
  const dateObj = d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return 'N/A';
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = MONTH_NAMES[dateObj.getMonth()];
  const year = dateObj.getFullYear();
  return `${day} ${month} ${year}`;
}

function resolveFontPaths() {
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

export function generateAgreementPdfBuffer(data: AgreementData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Font registration
      const fontPaths = resolveFontPaths();
      let regularFont = 'Helvetica';
      let boldFont = 'Helvetica-Bold';

      if (fontPaths) {
        doc.registerFont('AgreementFont', fontPaths.regular);
        doc.registerFont('AgreementFont-Bold', fontPaths.bold);
        regularFont = 'AgreementFont';
        boldFont = 'AgreementFont-Bold';
      }

      // Design tokens
      const primaryColor = '#10B981'; // Green header & bullet color
      const darkColor = '#0F172A';    // Slate 900
      const textDark = '#334155';     // Slate 700
      const borderCol = '#E2E8F0';    // Slate 200

      // Client name resolution (Preserve reference default "My SafaWala.com")
      const clientName = (data.companyName || data.customerName || 'My SafaWala.com').trim();
      const clientUpper = clientName.toUpperCase();

      // Dynamic or reference financial terms
      const feeNum = Number(data.amount || 0);
      const monthlyFee = feeNum > 0 ? `₹${feeNum.toLocaleString('en-IN')}/-` : '₹35,000/-';
      const threeMonthFee = feeNum > 0 ? `₹${(feeNum * 3).toLocaleString('en-IN')}/-` : '₹1,05,000/-';
      const advanceFee = feeNum > 0 ? `₹${Math.round(feeNum / 2).toLocaleString('en-IN')}/-` : '₹17,500/-';
      const remainingFee = advanceFee;

      // Dates
      const rawStartDate = data.startDate || data.activationDate;
      const serviceStartDate = rawStartDate ? formatAgreementDate(rawStartDate) : '____________________';
      const rawAgreementDate = data.purchaseDate || data.startDate || new Date();
      const agreementDate = rawAgreementDate ? formatAgreementDate(rawAgreementDate) : '_______________________';

      // Section helper
      const drawSection = (title: string, contentCallback: () => void) => {
        doc.fillColor(darkColor).fontSize(11.5).font(boldFont).text(title, 50, doc.y);
        doc.moveDown(0.3);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(borderCol).lineWidth(0.8).stroke();
        doc.moveDown(0.6);
        contentCallback();
        doc.moveDown(1.2);
      };

      // =====================================================================
      // PAGE 1: TITLE, HEADER, INTRODUCTION, SERVICES, COMMITMENT, PAYMENT TERMS
      // =====================================================================

      // TITLE
      doc
        .fillColor(darkColor)
        .fontSize(15)
        .font(boldFont)
        .text('SOCIAL MEDIA MARKETING SERVICE AGREEMENT', 50, 48, { align: 'center' });

      doc.moveDown(0.4);

      // GREEN HEADER TEXT
      doc
        .fillColor(primaryColor)
        .fontSize(11)
        .font(boldFont)
        .text(`QUIK BOOM MARKETING AGENCY  |  ${clientUpper}`, { align: 'center' });

      doc.moveDown(0.8);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(borderCol).lineWidth(0.8).stroke();
      doc.moveDown(0.8);

      // INTRODUCTION
      doc
        .fillColor(textDark)
        .fontSize(10)
        .font(regularFont)
        .text(
          `This Agreement is made between QUIK BOOM MARKETING AGENCY (the “Agency”) and ${clientName} (the “Client”). Both parties agree to the following terms and conditions:`,
          { align: 'justify', lineGap: 3 },
        );

      doc.moveDown(1.2);

      // 1. Services
      drawSection('Services', () => {
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            `QUIK BOOM MARKETING AGENCY will provide Social Media Marketing Services for ${clientName}, including:`,
            { lineGap: 2 },
          );

        doc.moveDown(0.5);

        const bullets = [
          'Social Media Page Handling',
          '2 Stories Everyday',
          '1 Reel Everyday',
          '1 Post Everyday',
          'Content planning and regular posting',
        ];

        bullets.forEach((b) => {
          doc.fillColor(primaryColor).fontSize(10).font(boldFont).text('•  ', { continued: true });
          doc.fillColor(textDark).fontSize(9.8).font(regularFont).text(b, { lineGap: 3 });
        });

        doc.moveDown(0.6);
        doc.fillColor(darkColor).fontSize(10).font(boldFont).text(`Monthly Service Fee: ${monthlyFee}`);
      });

      // 2. Minimum Commitment
      drawSection('Minimum Commitment', () => {
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            'The Client agrees to continue the Social Media Marketing Services for a minimum period of 3 months.',
            { lineGap: 2 },
          );

        doc.moveDown(0.6);
        doc.fillColor(darkColor).fontSize(10).font(boldFont).text(`Minimum 3-Month Service Value: ${threeMonthFee}`);
        doc.moveDown(0.6);
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            'The Client cannot discontinue the service before completion of the 3-month commitment without settling the applicable payment obligations, unless mutually agreed in writing by both parties.',
            { lineGap: 2, align: 'justify' },
          );
      });

      // 3. Payment Terms
      drawSection('Payment Terms', () => {
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            `The monthly service fee of ${monthlyFee} shall be paid in two installments:`,
            { lineGap: 2 },
          );

        doc.moveDown(0.5);
        doc.fillColor(primaryColor).fontSize(10).font(boldFont).text('•  ', { continued: true });
        doc
          .fillColor(textDark)
          .fontSize(9.8)
          .font(regularFont)
          .text(`50% Advance: ${advanceFee} at the beginning of each month.`, { lineGap: 3 });

        doc.fillColor(primaryColor).fontSize(10).font(boldFont).text('•  ', { continued: true });
        doc
          .fillColor(textDark)
          .fontSize(9.8)
          .font(regularFont)
          .text(`50% Remaining Payment: ${remainingFee} at the end of each month.`, { lineGap: 3 });
      });

      // =====================================================================
      // PAGE 2: OPERATIONAL CLAUSES & SIGNATURE SECTION
      // =====================================================================
      doc.addPage();

      // Running green header text
      doc
        .fillColor(primaryColor)
        .fontSize(10.5)
        .font(boldFont)
        .text(`QUIK BOOM MARKETING AGENCY  |  ${clientUpper}`, 50, 48, { align: 'center' });

      doc.moveDown(0.4);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(borderCol).lineWidth(0.8).stroke();
      doc.moveDown(0.8);

      // 4. Client Responsibilities
      drawSection('Client Responsibilities', () => {
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            'The Client will provide the required information, photos, videos, business details, approvals and other materials required for social media marketing.',
            { lineGap: 2, align: 'justify' },
          );

        doc.moveDown(0.5);
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            'Any delay in providing required materials or approvals may affect the content posting schedule.',
            { lineGap: 2, align: 'justify' },
          );
      });

      // 5. Performance
      drawSection('Performance', () => {
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            'The Agency will make reasonable professional efforts to improve the Client’s social media presence.',
            { lineGap: 2, align: 'justify' },
          );

        doc.moveDown(0.5);
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            'However, specific results such as followers, views, leads, enquiries, viral content or sales are not guaranteed, as social media performance depends on various factors.',
            { lineGap: 2, align: 'justify' },
          );
      });

      // 6. Additional Services
      drawSection('Additional Services', () => {
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            'Any services outside the agreed package, including paid advertising, influencer marketing, professional photography/videography or additional content, will be charged separately after mutual discussion and approval.',
            { lineGap: 2, align: 'justify' },
          );
      });

      // 7. Termination
      drawSection('Termination', () => {
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            "After completion of the minimum 3-month commitment, either party may discontinue the service by providing 30 days' written notice, subject to settlement of all outstanding payments.",
            { lineGap: 2, align: 'justify' },
          );
      });

      // 8. Agreement & Acceptance
      drawSection('Agreement & Acceptance', () => {
        doc
          .fillColor(textDark)
          .fontSize(10)
          .font(regularFont)
          .text(
            'Both parties confirm that they have read, understood and accepted all the terms and conditions mentioned in this Agreement.',
            { lineGap: 2 },
          );
      });

      doc.moveDown(0.5);

      // SIGNATURE SECTION (Two-column layout)
      const tableY = doc.y;
      const colWidth = 240;
      const tableH = 100;

      doc.rect(50, tableY, colWidth, tableH).strokeColor('#CBD5E1').lineWidth(1).stroke();
      doc.rect(305, tableY, colWidth, tableH).strokeColor('#CBD5E1').lineWidth(1).stroke();

      // LEFT COLUMN: FOR QUIK BOOM MARKETING AGENCY
      doc
        .fillColor(darkColor)
        .fontSize(9.5)
        .font(boldFont)
        .text('FOR QUIK BOOM MARKETING AGENCY', 60, tableY + 12);

      doc
        .fillColor(textDark)
        .fontSize(9)
        .font(regularFont)
        .text('Authorized Person: ____________________', 60, tableY + 38)
        .text('Signature: ____________________________', 60, tableY + 58)
        .text('Date: ________________________________', 60, tableY + 78);

      // RIGHT COLUMN: FOR CLIENT
      doc
        .fillColor(darkColor)
        .fontSize(9.5)
        .font(boldFont)
        .text(`FOR ${clientUpper}`, 315, tableY + 12);

      doc
        .fillColor(textDark)
        .fontSize(9)
        .font(regularFont)
        .text('Authorized Person: ____________________', 315, tableY + 38)
        .text('Signature: ____________________________', 315, tableY + 58)
        .text('Date: ________________________________', 315, tableY + 78);

      // BELOW SIGNATURE TABLE:
      const belowY = tableY + tableH + 18;
      doc
        .fillColor(darkColor)
        .fontSize(9.5)
        .font(boldFont)
        .text('Service Start Date: ', 50, belowY, { continued: true });
      doc.fillColor(textDark).font(regularFont).text(serviceStartDate);

      doc
        .fillColor(darkColor)
        .fontSize(9.5)
        .font(boldFont)
        .text('Agreement Date: ', 50, belowY + 16, { continued: true });
      doc.fillColor(textDark).font(regularFont).text(agreementDate);

      // PAGE NUMBERS
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        doc
          .fillColor('#94A3B8')
          .fontSize(8)
          .font(regularFont)
          .text(`Page ${i + 1} of ${range.count}`, 50, 805, {
            width: 495,
            align: 'center',
            lineBreak: false,
          });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
