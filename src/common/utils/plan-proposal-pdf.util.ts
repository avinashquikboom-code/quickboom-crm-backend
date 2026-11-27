import PDFDocument = require('pdfkit');

export interface PlanProposalPdfData {
  proposalNo: string;
  leadId?: number;
  leadName: string;
  businessName?: string;
  companyName: string;
  planName: string;
  planCode?: string;
  description?: string;
  billingCycle?: string;
  monthlyPrice?: number;
  yearlyPrice?: number;
  userLimit?: number;
  leadLimit?: number;
  storageLimit?: number;
  storageUnit?: string;
  planPrice: number;
  currency?: string;
  proposalType: string;
  features?: string[];
  customerRequirements?: string;
  discount?: number;
  validUntil?: string;
  terms?: string;
  customSummary?: string;
}

const BRAND_DARK = '#163A2E';
const BRAND_ACCENT = '#20C466';
const BRAND_SOFT_BG = '#F0F7F4';
const CARD_BG = '#F8FAFC';
const BORDER_COLOR = '#E2E8E5';
const TEXT_PRIMARY = '#0F172A';
const TEXT_SECONDARY = '#475569';
const TEXT_MUTED = '#64748B';

function formatMoney(currency: string, amount: number): string {
  return `${currency} ${Number(amount || 0).toLocaleString('en-IN')}`;
}

export async function generatePlanProposalPdfBuffer(data: PlanProposalPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;
    const currency = data.currency || 'INR';
    const basePrice = Number(data.planPrice || 0);
    const discount = Number(data.discount || 0);
    const netPrice = Math.max(0, basePrice - discount);
    const generatedAt = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    const ensureSpace = (neededHeight: number) => {
      if (doc.y + neededHeight > doc.page.height - 64) {
        doc.addPage();
        doc.y = 40;
      }
    };

    // 1. Branded Header Banner
    doc.rect(0, 0, pageWidth, 96).fill(BRAND_DARK);
    doc.rect(0, 96, pageWidth, 4).fill(BRAND_ACCENT);

    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor('#FFFFFF')
      .text('PLAN PROPOSAL', margin, 26);

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#CBD5E1')
      .text(data.companyName || 'QB Suite CRM', margin, 54);

    // Reference & Date Pill on Right
    const refBoxWidth = 175;
    const refBoxX = pageWidth - margin - refBoxWidth;
    doc
      .roundedRect(refBoxX, 24, refBoxWidth, 50, 8)
      .fillColor('#1E4D3D')
      .fill();
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#94A3B8')
      .text('REFERENCE NO.', refBoxX + 12, 32, { width: refBoxWidth - 24 });
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#FFFFFF')
      .text(data.proposalNo || 'N/A', refBoxX + 12, 44, { width: refBoxWidth - 24 });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#CBD5E1')
      .text(`Date: ${generatedAt}`, refBoxX + 12, 60, { width: refBoxWidth - 24 });

    // 2. Client & Proposal Info Two-Column Card
    let y = 118;
    const colGap = 14;
    const colWidth = (contentWidth - colGap) / 2;
    const infoCardHeight = 76;

    doc
      .roundedRect(margin, y, colWidth, infoCardHeight, 8)
      .fillAndStroke(CARD_BG, BORDER_COLOR);
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(TEXT_MUTED)
      .text('PREPARED FOR', margin + 14, y + 12);
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(TEXT_PRIMARY)
      .text(data.leadName || 'Valued Client', margin + 14, y + 26, { width: colWidth - 28 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(TEXT_SECONDARY)
      .text(
        `${data.businessName || data.companyName || '—'}${data.leadId ? `  •  Lead #${data.leadId}` : ''}`,
        margin + 14,
        y + 46,
        { width: colWidth - 28 },
      );

    const rightCardX = margin + colWidth + colGap;
    doc
      .roundedRect(rightCardX, y, colWidth, infoCardHeight, 8)
      .fillAndStroke(CARD_BG, BORDER_COLOR);
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(TEXT_MUTED)
      .text('PROPOSAL SUMMARY', rightCardX + 14, y + 12);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(BRAND_DARK)
      .text(
        `${data.planName || 'Custom Plan'}${data.planCode ? ` (${data.planCode})` : ''}`,
        rightCardX + 14,
        y + 26,
        { width: colWidth - 28 },
      );
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(TEXT_SECONDARY)
      .text(
        `Cycle: ${data.billingCycle || data.proposalType || 'STANDARD'}${data.validUntil ? `  •  Valid: ${data.validUntil}` : ''}`,
        rightCardX + 14,
        y + 46,
        { width: colWidth - 28 },
      );

    y += infoCardHeight + 16;

    // 3. Pricing Summary Strip
    const pricingHeight = discount > 0 ? 74 : 58;
    doc
      .roundedRect(margin, y, contentWidth, pricingHeight, 8)
      .fillAndStroke(BRAND_SOFT_BG, '#CBE5D6');

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BRAND_DARK)
      .text('INVESTMENT OVERVIEW', margin + 16, y + 12);

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(BRAND_DARK)
      .text(formatMoney(currency, netPrice), margin + 16, y + 28);

    if (discount > 0) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(TEXT_SECONDARY)
        .text(
          `Base Price: ${formatMoney(currency, basePrice)}   |   Discount Applied: -${formatMoney(currency, discount)}`,
          margin + 16,
          y + 52,
        );
    }

    doc.y = y + pricingHeight + 18;

    // Helper for clean section blocks
    const drawSectionTitle = (title: string) => {
      ensureSpace(44);
      const startY = doc.y;
      doc.rect(margin, startY + 2, 3, 13).fill(BRAND_ACCENT);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(BRAND_DARK)
        .text(title.toUpperCase(), margin + 10, startY + 2);
      doc.y = startY + 22;
    };

    // 4. Customer Requirements
    if (data.customerRequirements && data.customerRequirements.trim()) {
      drawSectionTitle('Customer Requirements');
      const reqText = data.customerRequirements.trim();
      const textHeight = doc.heightOfString(reqText, { width: contentWidth - 28 });
      const boxHeight = Math.max(36, textHeight + 20);
      ensureSpace(boxHeight + 12);
      const boxY = doc.y;
      doc
        .roundedRect(margin, boxY, contentWidth, boxHeight, 6)
        .fillAndStroke('#FFFFFF', BORDER_COLOR);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(TEXT_SECONDARY)
        .text(reqText, margin + 14, boxY + 10, { width: contentWidth - 28 });
      doc.y = boxY + boxHeight + 14;
    }

    // 5. Included Features
    const features = (data.features || []).map((f) => String(f).trim()).filter(Boolean);
    if (features.length) {
      drawSectionTitle('Included Deliverables & Features');
      features.forEach((item, index) => {
        const itemHeight = Math.max(24, doc.heightOfString(item, { width: contentWidth - 46 }) + 12);
        ensureSpace(itemHeight + 6);
        const rowY = doc.y;
        const rowBg = index % 2 === 0 ? '#FFFFFF' : CARD_BG;
        doc
          .roundedRect(margin, rowY, contentWidth, itemHeight, 5)
          .fillAndStroke(rowBg, BORDER_COLOR);
        doc.circle(margin + 16, rowY + itemHeight / 2, 3.5).fill(BRAND_ACCENT);
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(TEXT_PRIMARY)
          .text(item, margin + 28, rowY + 6, { width: contentWidth - 42 });
        doc.y = rowY + itemHeight + 5;
      });
      doc.y += 10;
    }

    // 6. Custom Package Summary
    if (data.customSummary && data.customSummary.trim()) {
      drawSectionTitle('Custom Package Details');
      const sumText = data.customSummary.trim();
      const textHeight = doc.heightOfString(sumText, { width: contentWidth - 28 });
      const boxHeight = Math.max(36, textHeight + 20);
      ensureSpace(boxHeight + 12);
      const boxY = doc.y;
      doc
        .roundedRect(margin, boxY, contentWidth, boxHeight, 6)
        .fillAndStroke(CARD_BG, BORDER_COLOR);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(TEXT_SECONDARY)
        .text(sumText, margin + 14, boxY + 10, { width: contentWidth - 28 });
      doc.y = boxY + boxHeight + 14;
    }

    // 7. Terms & Conditions
    if (data.terms && data.terms.trim()) {
      drawSectionTitle('Terms & Conditions');
      const termsText = data.terms.trim();
      const textHeight = doc.heightOfString(termsText, { width: contentWidth - 28 });
      const boxHeight = Math.max(36, textHeight + 20);
      ensureSpace(boxHeight + 12);
      const boxY = doc.y;
      doc
        .roundedRect(margin, boxY, contentWidth, boxHeight, 6)
        .fillAndStroke('#FFFFFF', BORDER_COLOR);
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(TEXT_MUTED)
        .text(termsText, margin + 14, boxY + 10, { width: contentWidth - 28 });
      doc.y = boxY + boxHeight + 14;
    }

    // 8. Branded Footer on all pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 40;
      doc
        .moveTo(margin, footerY - 8)
        .lineTo(pageWidth - margin, footerY - 8)
        .strokeColor(BORDER_COLOR)
        .lineWidth(0.75)
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(TEXT_MUTED)
        .text('Generated by QB Suite CRM', margin, footerY, {
          width: contentWidth / 2,
          align: 'left',
        });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(TEXT_MUTED)
        .text(`Page ${i + 1} of ${range.count}`, margin + contentWidth / 2, footerY, {
          width: contentWidth / 2,
          align: 'right',
        });
    }

    doc.end();
  });
}
