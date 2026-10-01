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
  const day = dateObj.getDate();
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

function resolveLogoPath(): string | null {
  const candidatePaths = [
    path.join(__dirname, '../../assets/images/logo.png'),
    path.join(__dirname, '../assets/images/logo.png'),
    path.join(process.cwd(), 'src/assets/images/logo.png'),
    path.join(process.cwd(), 'dist/src/assets/images/logo.png'),
    path.join(process.cwd(), 'uploads/logo.png'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

export function generateAgreementPdfBuffer(data: AgreementData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 40,
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
      const hasCustomFont = !!fontPaths;

      if (fontPaths) {
        doc.registerFont('AgreementFont', fontPaths.regular);
        doc.registerFont('AgreementFont-Bold', fontPaths.bold);
        regularFont = 'AgreementFont';
        boldFont = 'AgreementFont-Bold';
      }

      const formatCurrency = (val: number): string => {
        const sym = hasCustomFont ? '₹' : 'Rs. ';
        return `${sym}${Number(val || 0).toLocaleString('en-IN')}`;
      };

      // Exact Tax Invoice Design Tokens
      const primaryColor = '#10B981'; // QB Suite Green
      const darkColor = '#0F172A';    // Slate 900
      const grayColor = '#64748B';    // Slate 500
      const borderCol = '#E2E8F0';    // Slate 200
      const lightBg = '#F8FAFC';      // Slate 50
      const greenLightBg = '#ECFDF5'; // Emerald 50
      const greenDark = '#065F46';    // Emerald 800
      const textDark = '#334155';     // Slate 700

      const leftX = 40;
      const rightX = 305;
      const cardWidth = 250;
      const fullWidth = 515;

      const logoPath = resolveLogoPath();
      const agreementDateStr = formatAgreementDate(data.purchaseDate || new Date());

      // =====================================================================
      // PAGE 1: HEADER, CLIENT INFO, PLAN & PAYMENT, SERVICES, COMMITMENT
      // =====================================================================

      // Header Branding
      if (logoPath) {
        try {
          doc.image(logoPath, leftX, 40, { fit: [42, 42] });
        } catch (_) {}
      }

      const headerTextX = logoPath ? leftX + 48 : leftX;
      doc
        .fillColor(primaryColor)
        .fontSize(18)
        .font(boldFont)
        .text(INVOICE_ISSUER.brand, headerTextX, 40);

      doc
        .fillColor(darkColor)
        .fontSize(9.5)
        .font(boldFont)
        .text(INVOICE_ISSUER.companyName, headerTextX, 62);

      doc
        .fillColor(grayColor)
        .fontSize(7.8)
        .font(regularFont)
        .text('FP 68, Gorwa Ankodia Canal Ring Road, Vadodara, Gujarat 391330', headerTextX, 75);

      // Header Right Column
      doc
        .fillColor(darkColor)
        .fontSize(12)
        .font(boldFont)
        .text('SOCIAL MEDIA MARKETING', 295, 40, { width: 260, align: 'right' });

      doc
        .fillColor(primaryColor)
        .fontSize(11)
        .font(boldFont)
        .text('SERVICE AGREEMENT', 295, 55, { width: 260, align: 'right' });

      doc
        .fillColor(grayColor)
        .fontSize(8.5)
        .font(regularFont)
        .text(`Agreement Date: ${agreementDateStr}`, 295, 70, { width: 260, align: 'right' })
        .text(`Order Number: ${data.orderNumber}`, 295, 83, { width: 260, align: 'right' });

      // Header Divider Line
      doc
        .moveTo(leftX, 98)
        .lineTo(leftX + fullWidth, 98)
        .strokeColor(borderCol)
        .lineWidth(1)
        .stroke();

      // ---------------------------------------------------------------------
      // 1. CLIENT INFORMATION & 2. PLAN & PAYMENT (2-Column Cards)
      // ---------------------------------------------------------------------
      const metaY = 106;
      const metaHeight = 146;

      // --- Left Card: 1. CLIENT INFORMATION ---
      doc.rect(leftX, metaY, cardWidth, metaHeight).fillAndStroke(lightBg, borderCol);
      doc.rect(leftX, metaY, cardWidth, 22).fillAndStroke('#F1F5F9', borderCol);
      doc
        .fillColor(darkColor)
        .fontSize(8.5)
        .font(boldFont)
        .text('1. CLIENT INFORMATION', leftX + 8, metaY + 7);

      const clientRows = [
        ['Customer Name:', data.customerName || 'Valued Customer'],
        ['Company Name:', data.companyName || 'N/A'],
        ['Purchase Date:', formatAgreementDate(data.purchaseDate)],
        ['Activation Date:', formatAgreementDate(data.activationDate)],
        ['Order Number:', data.orderNumber || 'N/A'],
        ['Invoice Number:', data.invoiceNumber || 'REC-2026-' + String(data.orderNumber || '').replace(/\D/g, '').padStart(6, '0')],
      ];

      clientRows.forEach(([lbl, val], idx) => {
        const rowY = metaY + 28 + idx * 18;
        doc
          .fillColor(grayColor)
          .fontSize(8)
          .font(regularFont)
          .text(lbl, leftX + 8, rowY, { width: 78 });
        doc
          .fillColor(darkColor)
          .fontSize(idx === 0 || idx === 1 ? 8.5 : 8)
          .font(idx === 0 || idx === 1 || idx === 4 ? boldFont : regularFont)
          .text(String(val), leftX + 86, rowY, { width: cardWidth - 94, ellipsis: true });
      });

      // --- Right Card: 2. PLAN & PAYMENT ---
      doc.rect(rightX, metaY, cardWidth, metaHeight).fillAndStroke(lightBg, borderCol);
      doc.rect(rightX, metaY, cardWidth, 22).fillAndStroke('#F1F5F9', borderCol);
      doc
        .fillColor(darkColor)
        .fontSize(8.5)
        .font(boldFont)
        .text('2. PLAN & PAYMENT', rightX + 8, metaY + 7);

      const validityStr = `${formatAgreementDate(data.startDate)} to ${formatAgreementDate(data.endDate)}`;
      const planRows = [
        ['Plan:', data.planName || 'Standard Package'],
        ['Validity:', validityStr],
        ['Service Fee:', formatCurrency(data.amount)],
        ['GST (18%):', formatCurrency(data.taxAmount)],
      ];

      planRows.forEach(([lbl, val], idx) => {
        const rowY = metaY + 28 + idx * 17;
        doc
          .fillColor(grayColor)
          .fontSize(8)
          .font(regularFont)
          .text(lbl, rightX + 8, rowY, { width: 68 });
        doc
          .fillColor(darkColor)
          .fontSize(idx === 0 ? 8.5 : 8)
          .font(idx === 0 ? boldFont : regularFont)
          .text(String(val), rightX + 76, rowY, { width: cardWidth - 84, ellipsis: true });
      });

      // Branded Total Paid Card Accent (matching Tax Invoice total paid pill)
      const totalPillY = metaY + 104;
      doc.rect(rightX + 8, totalPillY, cardWidth - 16, 28).fillAndStroke(greenLightBg, primaryColor);
      doc
        .fillColor(greenDark)
        .fontSize(9)
        .font(boldFont)
        .text('TOTAL PAID:', rightX + 16, totalPillY + 9);
      doc
        .fillColor(greenDark)
        .fontSize(10)
        .font(boldFont)
        .text(`${formatCurrency(data.totalAmount)} (PAID)`, rightX + 16, totalPillY + 8, {
          width: cardWidth - 32,
          align: 'right',
        });

      // ---------------------------------------------------------------------
      // 3. SERVICES PROVIDED (Clean 2-Column Grid)
      // ---------------------------------------------------------------------
      const servicesY = 262;
      doc
        .fillColor(primaryColor)
        .fontSize(9.5)
        .font(boldFont)
        .text('3. SERVICES PROVIDED', leftX, servicesY);

      doc
        .moveTo(leftX, servicesY + 13)
        .lineTo(leftX + fullWidth, servicesY + 13)
        .strokeColor(borderCol)
        .lineWidth(0.75)
        .stroke();

      const defaultServices = [
        '4 Reels',
        '3 Creative Posts',
        '1 Influencer Promotion',
        '3 Stories',
        'Social Media Account Management',
        'Content Writing & Captions',
        'Trending Hashtags',
        'Meta Ads Campaign Setup & Management',
        'Google Ads Campaign Setup & Management',
        'Monthly Performance Report',
        'Ads will run only during the content execution period.',
        'Meta & Google Ads Budget will be paid by the client.',
      ];

      let serviceItems: string[] = [];
      if (Array.isArray(data.planFeatures) && data.planFeatures.length > 0) {
        serviceItems = data.planFeatures.map((f) => {
          if (typeof f === 'string') return f;
          const name = f?.name || f?.serviceName || JSON.stringify(f);
          return f?.qty && f.qty > 0 ? `${f.qty} x ${name}` : name;
        });
      } else {
        serviceItems = defaultServices;
      }

      // Render services inside branded card in 2 columns
      const halfCount = Math.ceil(serviceItems.length / 2);
      const colHeight = Math.max(88, halfCount * 14 + 14);

      doc.rect(leftX, servicesY + 18, fullWidth, colHeight).fillAndStroke(lightBg, borderCol);

      for (let i = 0; i < serviceItems.length; i++) {
        const isSecondCol = i >= halfCount;
        const colIndex = isSecondCol ? i - halfCount : i;
        const itemX = isSecondCol ? leftX + 260 : leftX + 10;
        const itemY = servicesY + 25 + colIndex * 14;

        // Green bullet
        doc
          .fillColor(primaryColor)
          .fontSize(9)
          .font(boldFont)
          .text('•', itemX, itemY);

        // Feature text
        doc
          .fillColor(darkColor)
          .fontSize(7.8)
          .font(regularFont)
          .text(serviceItems[i], itemX + 10, itemY, { width: 235, ellipsis: true });
      }

      // ---------------------------------------------------------------------
      // 4. MINIMUM COMMITMENT
      // ---------------------------------------------------------------------
      const minCommitY = servicesY + 18 + colHeight + 12;
      doc
        .fillColor(primaryColor)
        .fontSize(9.5)
        .font(boldFont)
        .text('4. MINIMUM COMMITMENT', leftX, minCommitY);

      doc
        .moveTo(leftX, minCommitY + 13)
        .lineTo(leftX + fullWidth, minCommitY + 13)
        .strokeColor(borderCol)
        .lineWidth(0.75)
        .stroke();

      doc.rect(leftX, minCommitY + 18, fullWidth, 48).fillAndStroke(lightBg, borderCol);
      doc
        .fillColor(textDark)
        .fontSize(8)
        .font(regularFont)
        .text(
          "The Client acknowledges that marketing requires a minimum duration to show significant results. This agreement ensures the delivery of services for the plan validity specified above. Any early termination may be subject to standard deductions as per the agency's policy.",
          leftX + 8,
          minCommitY + 25,
          { width: fullWidth - 16, lineGap: 2, align: 'justify' },
        );

      // Page 1 bottom continuation hint
      doc
        .fillColor(grayColor)
        .fontSize(7.5)
        .font(regularFont)
        .text('Continued on Next Page ->', leftX, minCommitY + 18 + 48 + 14, {
          width: fullWidth,
          align: 'right',
        });

      // =====================================================================
      // PAGE 2: PAYMENT TERMS, OPERATIONAL CLAUSES, SIGNATORY & FOOTER
      // =====================================================================
      doc.addPage();

      // Page 2 Running Header
      if (logoPath) {
        try {
          doc.image(logoPath, leftX, 38, { fit: [20, 20] });
        } catch (_) {}
      }

      const p2HeaderX = logoPath ? leftX + 26 : leftX;
      doc
        .fillColor(primaryColor)
        .fontSize(9)
        .font(boldFont)
        .text(`${INVOICE_ISSUER.brand} • SOCIAL MEDIA MARKETING SERVICE AGREEMENT`, p2HeaderX, 42);

      doc
        .fillColor(grayColor)
        .fontSize(8)
        .font(regularFont)
        .text(`Order: ${data.orderNumber} • ${agreementDateStr}`, 295, 42, {
          width: 260,
          align: 'right',
        });

      doc
        .moveTo(leftX, 58)
        .lineTo(leftX + fullWidth, 58)
        .strokeColor(borderCol)
        .lineWidth(0.75)
        .stroke();

      // ---------------------------------------------------------------------
      // 5. PAYMENT TERMS
      // ---------------------------------------------------------------------
      const payTermsY = 68;
      doc
        .fillColor(primaryColor)
        .fontSize(9.5)
        .font(boldFont)
        .text('5. PAYMENT TERMS', leftX, payTermsY);

      doc
        .moveTo(leftX, payTermsY + 13)
        .lineTo(leftX + fullWidth, payTermsY + 13)
        .strokeColor(borderCol)
        .lineWidth(0.75)
        .stroke();

      doc.rect(leftX, payTermsY + 18, fullWidth, 48).fillAndStroke(lightBg, borderCol);
      doc
        .fillColor(textDark)
        .fontSize(8)
        .font(regularFont)
        .text(
          'Payment for the selected plan has been processed successfully. Services will commence on the specified Activation Date. All fees are non-refundable once the service period has commenced. Invoices and receipts are available in your portal.',
          leftX + 8,
          payTermsY + 25,
          { width: fullWidth - 16, lineGap: 2, align: 'justify' },
        );

      // ---------------------------------------------------------------------
      // 6. CLIENT RESPONSIBILITIES
      // ---------------------------------------------------------------------
      const respY = payTermsY + 18 + 48 + 12;
      doc
        .fillColor(primaryColor)
        .fontSize(9.5)
        .font(boldFont)
        .text('6. CLIENT RESPONSIBILITIES', leftX, respY);

      doc
        .moveTo(leftX, respY + 13)
        .lineTo(leftX + fullWidth, respY + 13)
        .strokeColor(borderCol)
        .lineWidth(0.75)
        .stroke();

      doc.rect(leftX, respY + 18, fullWidth, 50).fillAndStroke(lightBg, borderCol);
      doc
        .fillColor(textDark)
        .fontSize(8)
        .font(regularFont)
        .text(
          'The Client agrees to provide necessary access to social media accounts, timely feedback, and required branding assets. Delays in providing these materials may affect the delivery timeline, and the Agency will not be held responsible for such delays.',
          leftX + 8,
          respY + 25,
          { width: fullWidth - 16, lineGap: 2, align: 'justify' },
        );

      // ---------------------------------------------------------------------
      // 7. PERFORMANCE
      // ---------------------------------------------------------------------
      const perfY = respY + 18 + 50 + 12;
      doc
        .fillColor(primaryColor)
        .fontSize(9.5)
        .font(boldFont)
        .text('7. PERFORMANCE', leftX, perfY);

      doc
        .moveTo(leftX, perfY + 13)
        .lineTo(leftX + fullWidth, perfY + 13)
        .strokeColor(borderCol)
        .lineWidth(0.75)
        .stroke();

      doc.rect(leftX, perfY + 18, fullWidth, 52).fillAndStroke(lightBg, borderCol);
      doc
        .fillColor(textDark)
        .fontSize(8)
        .font(regularFont)
        .text(
          "The Agency will use its best efforts and industry standard practices to manage and grow the Client's social media presence. However, the Agency does not guarantee specific numerical milestones (like exact follower counts) as platforms' algorithms are outside the Agency's control.",
          leftX + 8,
          perfY + 25,
          { width: fullWidth - 16, lineGap: 2, align: 'justify' },
        );

      // ---------------------------------------------------------------------
      // 8. TERMINATION
      // ---------------------------------------------------------------------
      const termY = perfY + 18 + 52 + 12;
      doc
        .fillColor(primaryColor)
        .fontSize(9.5)
        .font(boldFont)
        .text('8. TERMINATION', leftX, termY);

      doc
        .moveTo(leftX, termY + 13)
        .lineTo(leftX + fullWidth, termY + 13)
        .strokeColor(borderCol)
        .lineWidth(0.75)
        .stroke();

      doc.rect(leftX, termY + 18, fullWidth, 48).fillAndStroke(lightBg, borderCol);
      doc
        .fillColor(textDark)
        .fontSize(8)
        .font(regularFont)
        .text(
          'Either party may terminate this agreement at the end of the current validity period by providing written notice. In the event of breach of terms, the non-breaching party may terminate immediately.',
          leftX + 8,
          termY + 25,
          { width: fullWidth - 16, lineGap: 2, align: 'justify' },
        );

      // ---------------------------------------------------------------------
      // TERMS & GOVERNING JURISDICTION (matching Tax Invoice terms card)
      // ---------------------------------------------------------------------
      const legalY = termY + 18 + 48 + 14;
      doc.rect(leftX, legalY, fullWidth, 42).fillAndStroke(lightBg, borderCol);
      doc
        .fillColor(darkColor)
        .fontSize(7.8)
        .font(boldFont)
        .text('TERMS & GOVERNING JURISDICTION', leftX + 8, legalY + 7);
      doc
        .fillColor(grayColor)
        .fontSize(7.5)
        .font(regularFont)
        .text(
          `This agreement is governed by the laws of India. Any dispute arising hereunder shall be subject to the exclusive jurisdiction of the courts in Vadodara, Gujarat. For support or operational queries, contact ${INVOICE_ISSUER.supportEmail}.`,
          leftX + 8,
          legalY + 18,
          { width: fullWidth - 16, lineGap: 1.5 },
        );

      // ---------------------------------------------------------------------
      // VERIFICATION STAMP & SIGNATORY SECTION (matching Tax Invoice signTop)
      // ---------------------------------------------------------------------
      const signTop = legalY + 42 + 16;

      // Verification Badge (Left)
      doc.rect(leftX, signTop, 185, 48).fillAndStroke(greenLightBg, primaryColor);
      doc
        .fillColor(greenDark)
        .fontSize(11)
        .font(boldFont)
        .text('DIGITALLY VERIFIED', leftX + 8, signTop + 11, {
          width: 169,
          align: 'center',
        });
      doc
        .fillColor(greenDark)
        .fontSize(7.5)
        .font(regularFont)
        .text('Official Agreement • No Physical Signature Required', leftX + 8, signTop + 28, {
          width: 169,
          align: 'center',
        });

      // Signatory block (Right)
      doc
        .fillColor(darkColor)
        .fontSize(8.5)
        .font(boldFont)
        .text(`For ${INVOICE_ISSUER.companyName}`, 295, signTop + 8, {
          width: 260,
          align: 'right',
        });
      doc
        .fillColor(grayColor)
        .fontSize(8)
        .font(regularFont)
        .text('Authorized System Signatory', 295, signTop + 23, {
          width: 260,
          align: 'right',
        });
      doc
        .fillColor(grayColor)
        .fontSize(7.5)
        .font(regularFont)
        .text('Electronic Acceptance Signified via Payment', 295, signTop + 35, {
          width: 260,
          align: 'right',
        });

      // ---------------------------------------------------------------------
      // 11. SYSTEM GENERATED AGREEMENT FOOTER (At the bottom of Page 2)
      // ---------------------------------------------------------------------
      const footerCardY = 705;
      const footerCardHeight = 62;
      doc.rect(leftX, footerCardY, fullWidth, footerCardHeight).fillAndStroke(lightBg, borderCol);

      doc
        .fillColor(primaryColor)
        .fontSize(9)
        .font(boldFont)
        .text('SYSTEM GENERATED AGREEMENT', leftX + 8, footerCardY + 11, {
          width: fullWidth - 16,
          align: 'center',
        });

      doc
        .fillColor(grayColor)
        .fontSize(7.8)
        .font(regularFont)
        .text(
          'This agreement is electronically generated by the QUIK BOOM MARKETING AGENCY system upon successful payment and does not require a physical signature. The payment and generation of this document signify mutual acceptance of the terms.',
          leftX + 16,
          footerCardY + 25,
          { width: fullWidth - 32, align: 'center', lineGap: 2 },
        );

      // =====================================================================
      // RUNNING PAGE FOOTERS (Across all buffered pages)
      // =====================================================================
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        doc
          .fillColor(grayColor)
          .fontSize(7.5)
          .font(regularFont)
          .text(
            `Page ${i + 1} of ${range.count} • ${INVOICE_ISSUER.brand} • Official Service Agreement • ${INVOICE_ISSUER.supportEmail}`,
            leftX,
            810,
            { width: fullWidth, align: 'center', lineBreak: false },
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
