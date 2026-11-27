import * as fs from 'fs';
import * as path from 'path';
import type * as ExcelJS from 'exceljs';

export const OFFICIAL_BRAND_NAME = 'QB Suite';

let cachedLogoBuffer: Buffer | null | undefined;

export function getOfficialLogoPath(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../assets/images/app_logo.png'),
    path.resolve(__dirname, '../../src/assets/images/app_logo.png'),
    path.resolve(process.cwd(), 'dist/src/assets/images/app_logo.png'),
    path.resolve(process.cwd(), 'src/assets/images/app_logo.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

export function getOfficialLogoBuffer(): Buffer | null {
  if (cachedLogoBuffer !== undefined) {
    return cachedLogoBuffer;
  }
  const logoPath = getOfficialLogoPath();
  if (!logoPath) {
    cachedLogoBuffer = null;
    return null;
  }
  try {
    cachedLogoBuffer = fs.readFileSync(logoPath);
    return cachedLogoBuffer;
  } catch {
    cachedLogoBuffer = null;
    return null;
  }
}

/**
 * Renders the official logo in the top-left corner of a PDFKit header while
 * preserving its original aspect ratio, image quality, and PNG transparency.
 */
export function drawPdfHeaderLogo(
  doc: any,
  options: {
    x?: number;
    y?: number;
    maxWidth?: number;
    maxHeight?: number;
    customLogoBuffer?: Buffer | null;
  } = {},
): { rendered: boolean; textStartX: number } {
  const x = options.x ?? 36;
  const y = options.y ?? 14;
  const maxWidth = options.maxWidth ?? 42;
  const maxHeight = options.maxHeight ?? 42;
  const buffer = options.customLogoBuffer && options.customLogoBuffer.length > 0
    ? options.customLogoBuffer
    : getOfficialLogoBuffer();

  if (!buffer || buffer.length === 0) {
    return { rendered: false, textStartX: x };
  }

  try {
    doc.image(buffer, x, y, {
      fit: [maxWidth, maxHeight],
      align: 'left',
      valign: 'center',
    });
    return { rendered: true, textStartX: x + maxWidth + 12 };
  } catch {
    return { rendered: false, textStartX: x };
  }
}

/**
 * Draws a standardized branded PDF header banner with top-left logo, company name,
 * and report title without stretching or distorting the logo.
 */
export function drawStandardPdfHeader(
  doc: any,
  input: {
    companyName?: string | null;
    title: string;
    subtitle?: string | null;
    rightLine1?: string | null;
    rightLine2?: string | null;
    bannerHeight?: number;
    bannerColor?: string;
    marginX?: number;
    customLogoBuffer?: Buffer | null;
  },
): number {
  const pageWidth = doc.page.width;
  const marginX = input.marginX ?? 36;
  const bannerHeight = input.bannerHeight ?? 72;
  const bannerColor = input.bannerColor ?? '#107569';

  doc.rect(0, 0, pageWidth, bannerHeight).fill(bannerColor);

  const { textStartX } = drawPdfHeaderLogo(doc, {
    x: marginX,
    y: Math.max(10, Math.round((bannerHeight - 42) / 2)),
    maxWidth: 42,
    maxHeight: 42,
    customLogoBuffer: input.customLogoBuffer,
  });

  const rightBoxWidth = 170;
  const titleWidth = Math.max(180, pageWidth - textStartX - marginX - (input.rightLine1 ? rightBoxWidth + 12 : 0));

  doc
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(input.companyName || OFFICIAL_BRAND_NAME, textStartX, 16, {
      width: titleWidth,
      ellipsis: true,
    });

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor('#E2E8F0')
    .text(input.title, textStartX, 36, {
      width: titleWidth,
      ellipsis: true,
    });

  if (input.subtitle) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#CBD5E1')
      .text(input.subtitle, textStartX, 50, {
        width: titleWidth,
        ellipsis: true,
      });
  }

  if (input.rightLine1) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#FFFFFF')
      .text(input.rightLine1, pageWidth - marginX - rightBoxWidth, 18, {
        width: rightBoxWidth,
        align: 'right',
      });
  }
  if (input.rightLine2) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#E2E8F0')
      .text(input.rightLine2, pageWidth - marginX - rightBoxWidth, 34, {
        width: rightBoxWidth,
        align: 'right',
      });
  }

  return bannerHeight + 14;
}

/**
 * Embeds the official QB Suite logo in the top-left corner of an ExcelJS worksheet
 * and writes a branded title block beside it.
 */
export function applyExcelBranding(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  title: string,
  subtitle?: string,
): number {
  const logoBuffer = getOfficialLogoBuffer();
  worksheet.getRow(1).height = 24;
  worksheet.getRow(2).height = 18;
  worksheet.getRow(3).height = 10;

  if (logoBuffer && logoBuffer.length > 0) {
    try {
      const imageId = workbook.addImage({
        buffer: logoBuffer as any,
        extension: 'png',
      });
      worksheet.addImage(imageId, {
        tl: { col: 0, row: 0 },
        ext: { width: 38, height: 38 },
      });
    } catch {
      // Fallback gracefully if image embedding fails
    }
  }

  const titleCell = worksheet.getCell('B1');
  titleCell.value = title;
  titleCell.font = { bold: true, size: 13, color: { argb: 'FF0F172A' } };

  if (subtitle) {
    const subCell = worksheet.getCell('B2');
    subCell.value = subtitle;
    subCell.font = { size: 9.5, color: { argb: 'FF64748B' } };
  }

  // Row 4 is the next clean starting row for table headers
  return 4;
}
