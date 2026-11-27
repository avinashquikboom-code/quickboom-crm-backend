import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');
import ExcelJS = require('exceljs');
import { drawPdfHeaderLogo, getOfficialLogoBuffer, applyExcelBranding } from '../../common/utils/report-branding.util';

export interface CatalogReportPayload {
  report: { id?: string; name: string; description?: string; category?: string };
  company?: { name?: string | null; email?: string | null; phone?: string | null; city?: string | null } | null;
  dateRange: { from: string; to: string };
  filters?: Record<string, any>;
  columns: string[];
  rows: Array<Record<string, any>>;
  summary: { records: number; [key: string]: any };
  generatedAt: string;
}

const BRAND_DARK = '#163A2E';
const BRAND_ACCENT = '#20C466';
const BRAND_SOFT = '#F0F7F4';
const ROW_ALT = '#F8FAFC';
const BORDER = '#E2E8E5';
const TEXT_DARK = '#0F172A';
const TEXT_MUTED = '#64748B';

const CURRENCY_KEYS = new Set([
  'amount', 'total', 'subtotal', 'subTotal', 'tax', 'taxAmount', 'totalAmount',
  'value', 'leadValue', 'price', 'unitPrice', 'gross', 'net', 'deductions', 'paid', 'balance',
]);
const PERCENT_KEYS = new Set(['taxRate', 'conversionRate', 'rate', 'percentage']);

let cachedLogo: Buffer | null | undefined;
function getQuikBoomLogoBuffer(): Buffer | null {
  if (cachedLogo !== undefined) return cachedLogo;
  const candidates = [
    path.resolve(__dirname, '../../assets/logo.png'),
    path.resolve(process.cwd(), 'dist/src/assets/logo.png'),
    path.resolve(process.cwd(), 'src/assets/logo.png'),
    path.resolve(process.cwd(), 'uploads/logo.png'),
    path.resolve(process.cwd(), '../QuickBoom-Admin-Pannel-crm/public/logo.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cachedLogo = fs.readFileSync(p);
        return cachedLogo;
      }
    } catch {
      /* ignore */
    }
  }
  cachedLogo = null;
  return null;
}

export function formatReportFilename(reportNameOrId: string, dateStr: string, ext: 'pdf' | 'xlsx' | 'csv'): string {
  const clean = String(reportNameOrId || 'Report')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const d = (dateStr || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `QuikBoom_${clean}_${d}.${ext}`;
}

export function humanizeColumnName(col: string): string {
  return String(col || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function isNumericValue(val: any): boolean {
  if (typeof val === 'number') return Number.isFinite(val);
  return false;
}

function sanitizePdfText(input: string): string {
  // PDFKit's built-in Helvetica only supports WinAnsi (Latin-1); strip emojis/non-Latin-1 glyphs
  // so they never render as garbled UTF-16 surrogate pairs.
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ENUM_LABELS: Record<string, string> = {
  GOOGLE_PLACES: 'Google Places',
  WHATSAPP: 'WhatsApp',
  WEBSITE: 'Website',
  MANUAL: 'Manual',
  CSV_IMPORT: 'CSV Import',
  GOOGLE_ADS: 'Google Ads',
  META_ADS: 'Meta Ads',
};

function formatCellText(col: string, val: any, forPdf = false): string {
  if (val === null || val === undefined || val === '') return forPdf ? '-' : '—';
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (CURRENCY_KEYS.has(col)) {
      return `INR ${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (PERCENT_KEYS.has(col)) {
      return `${val}%`;
    }
    return val.toLocaleString('en-IN');
  }
  if (val instanceof Date) {
    return val.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  }
  const raw = String(val).replace(/\s+/g, ' ').trim();
  const mapped = ENUM_LABELS[raw.toUpperCase()] || raw;
  return forPdf ? (sanitizePdfText(mapped) || '-') : mapped;
}

function computeTotals(columns: string[], rows: Array<Record<string, any>>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const col of columns) {
    let hasNumeric = false;
    let sum = 0;
    for (const row of rows) {
      const v = row[col];
      if (isNumericValue(v)) {
        hasNumeric = true;
        sum += v;
      }
    }
    if (hasNumeric && !PERCENT_KEYS.has(col)) {
      totals[col] = Math.round(sum * 100) / 100;
    }
  }
  return totals;
}

export async function buildFormattedReportPdf(view: CatalogReportPayload): Promise<Buffer> {
  const columns = view.columns?.length ? view.columns : (view.rows[0] ? Object.keys(view.rows[0]) : []);
  const rows = view.rows || [];
  const landscape = columns.length > 5;
  const companyName = view.company?.name || 'QuikBoom CRM';
  const generatedIst = new Date(view.generatedAt || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const logo = getOfficialLogoBuffer();
  const totals = computeTotals(columns, rows);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 28,
      size: 'A4',
      layout: landscape ? 'landscape' : 'portrait',
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 28;
    const bottomLimit = pageH - 42;
    const contentW = pageW - margin * 2;

    // Header Banner
    doc.rect(0, 0, pageW, 82).fill(BRAND_DARK);
    doc.rect(0, 82, pageW, 3.5).fill(BRAND_ACCENT);

    const { textStartX: titleX } = drawPdfHeaderLogo(doc, {
      x: margin,
      y: 18,
      maxWidth: 44,
      maxHeight: 44,
      customLogoBuffer: logo,
    });

    doc.font('Helvetica-Bold').fontSize(17).fillColor('#FFFFFF').text(view.report?.name || 'Report', titleX, 20, {
      width: contentW - (titleX - margin) - 180,
      ellipsis: true,
    });
    doc.font('Helvetica').fontSize(9.5).fillColor('#CBD5E1').text(companyName, titleX, 43);
    if (view.report?.description) {
      doc.fontSize(8.5).fillColor('#94A3B8').text(view.report.description, titleX, 57, {
        width: contentW - (titleX - margin) - 180,
        ellipsis: true,
      });
    }

    // Right metadata pill
    const metaW = 170;
    const metaX = pageW - margin - metaW;
    doc.roundedRect(metaX, 16, metaW, 52, 6).fill('#1E4D3D');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#94A3B8').text('PERIOD (IST)', metaX + 10, 22);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF').text(`${view.dateRange?.from || '—'} to ${view.dateRange?.to || '—'}`, metaX + 10, 32, { width: metaW - 20 });
    doc.font('Helvetica').fontSize(7.5).fillColor('#CBD5E1').text(`Generated: ${generatedIst}`, metaX + 10, 48, { width: metaW - 20, ellipsis: true });

    // Filter & Summary Strip
    let y = 98;
    const filterEntries = Object.entries(view.filters || {}).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
    const filterText = filterEntries.length
      ? filterEntries.map(([k, v]) => `${humanizeColumnName(k)}: ${v}`).join('  |  ')
      : 'All Records';

    doc.roundedRect(margin, y, contentW, 38, 6).fillAndStroke(BRAND_SOFT, '#CBE5D6');
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BRAND_DARK).text('APPLIED FILTERS:', margin + 12, y + 8, { continued: true });
    doc.font('Helvetica').fillColor(TEXT_DARK).text(`  ${filterText}`, { width: contentW - 200, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BRAND_DARK).text(
      `Total Records: ${Number(view.summary?.records ?? rows.length).toLocaleString('en-IN')}`,
      margin + 12,
      y + 22,
    );

    y += 50;

    if (!rows.length || !columns.length) {
      doc.roundedRect(margin, y, contentW, 64, 8).fillAndStroke(ROW_ALT, BORDER);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT_DARK).text('No records match the selected filters.', margin, y + 18, { align: 'center', width: contentW });
      doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text('Try broadening the date range or resetting status/department filters.', margin, y + 36, { align: 'center', width: contentW });
    } else {
      // Proportional column widths
      const weights = columns.map((col) => {
        const headerLen = humanizeColumnName(col).length;
        const sampleMax = rows.slice(0, 30).reduce((m, r) => Math.max(m, formatCellText(col, r[col], true).length), headerLen);
        return Math.min(34, Math.max(10, sampleMax));
      });
      const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
      const colWidths = weights.map((w) => Math.max(48, Math.floor((w / totalWeight) * contentW)));
      const diff = contentW - colWidths.reduce((s, w) => s + w, 0);
      if (colWidths.length) colWidths[0] += diff;

      const drawTableHeader = (topY: number) => {
        doc.rect(margin, topY, contentW, 22).fill(BRAND_DARK);
        let cx = margin;
        columns.forEach((col, i) => {
          const isNum = rows.some((r) => isNumericValue(r[col]));
          doc.save();
          doc.rect(cx, topY, colWidths[i], 22).clip();
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF').text(
            humanizeColumnName(col),
            cx + 5,
            topY + 7,
            { width: colWidths[i] - 10, align: isNum ? 'right' : 'left', lineBreak: false, ellipsis: true },
          );
          doc.restore();
          cx += colWidths[i];
        });
        return topY + 22;
      };

      y = drawTableHeader(y);

      rows.forEach((row, idx) => {
        const rowHeights = columns.map((col, i) =>
          doc.font('Helvetica').fontSize(8).heightOfString(formatCellText(col, row[col], true), { width: Math.max(20, colWidths[i] - 10) }),
        );
        const rowH = Math.max(18, Math.min(52, Math.ceil(Math.max(...rowHeights)) + 8));

        if (y + rowH > bottomLimit) {
          doc.addPage();
          y = drawTableHeader(margin);
        }

        doc.rect(margin, y, contentW, rowH).fillAndStroke(idx % 2 === 1 ? ROW_ALT : '#FFFFFF', BORDER);
        let cx = margin;
        columns.forEach((col, i) => {
          const val = row[col];
          const isNum = isNumericValue(val);
          doc.save();
          doc.rect(cx, y, colWidths[i], rowH).clip();
          doc.font('Helvetica').fontSize(8).fillColor(TEXT_DARK).text(
            formatCellText(col, val, true),
            cx + 5,
            y + 4,
            { width: Math.max(20, colWidths[i] - 10), align: isNum ? 'right' : 'left', height: rowH - 6, ellipsis: true },
          );
          doc.restore();
          cx += colWidths[i];
        });
        y += rowH;
        doc.y = y;
      });

      // Totals Row if any numeric columns exist
      if (Object.keys(totals).length > 0) {
        if (y + 22 > bottomLimit) {
          doc.addPage();
          y = drawTableHeader(margin);
        }
        doc.rect(margin, y, contentW, 22).fillAndStroke(BRAND_SOFT, '#CBE5D6');
        let cx = margin;
        columns.forEach((col, i) => {
          const text = i === 0 ? 'TOTAL' : totals[col] !== undefined ? formatCellText(col, totals[col], true) : '';
          doc.save();
          doc.rect(cx, y, colWidths[i], 22).clip();
          doc.font('Helvetica-Bold').fontSize(8).fillColor(BRAND_DARK).text(
            text,
            cx + 5,
            y + 7,
            { width: Math.max(20, colWidths[i] - 10), align: i === 0 ? 'left' : 'right', lineBreak: false, ellipsis: true },
          );
          doc.restore();
          cx += colWidths[i];
        });
        y += 22;
        doc.y = y;
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // Allow footer text below body bottomLimit without triggering PDFKit auto-pagination
      doc.page.margins.bottom = 0;
      const footerY = pageH - 24;
      doc.moveTo(margin, footerY - 6).lineTo(pageW - margin, footerY - 6).strokeColor(BORDER).lineWidth(0.75).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED).text(
        `${companyName}  •  QuikBoom CRM Report`,
        margin,
        footerY,
        { width: contentW / 2, align: 'left', lineBreak: false },
      );
      doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED).text(
        `Page ${i + 1} of ${range.count}`,
        margin + contentW / 2,
        footerY,
        { width: contentW / 2, align: 'right', lineBreak: false },
      );
    }

    doc.end();
  });
}

export async function buildFormattedReportExcel(view: CatalogReportPayload): Promise<Buffer> {
  const columns = view.columns?.length ? view.columns : (view.rows[0] ? Object.keys(view.rows[0]) : []);
  const rows = view.rows || [];
  const companyName = view.company?.name || 'QuikBoom CRM';
  const totals = computeTotals(columns, rows);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'QuikBoom CRM';
  wb.created = new Date();

  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Value', key: 'value', width: 52 },
  ];
  summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF163A2E' } };
  summary.addRow({ field: 'Company', value: companyName });
  summary.addRow({ field: 'Report Title', value: view.report?.name || 'Report' });
  summary.addRow({ field: 'Description', value: view.report?.description || '—' });
  summary.addRow({ field: 'Date Range (IST)', value: `${view.dateRange?.from || '—'} to ${view.dateRange?.to || '—'}` });
  summary.addRow({ field: 'Generated At (IST)', value: new Date(view.generatedAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) });
  summary.addRow({ field: 'Total Records', value: Number(view.summary?.records ?? rows.length) });
  Object.entries(totals).forEach(([k, v]) => {
    summary.addRow({ field: `Total ${humanizeColumnName(k)}`, value: v });
  });

  const detail = wb.addWorksheet('Detailed Records');
  applyExcelBranding(
    wb,
    detail,
    `${companyName} — ${view.report?.name || 'Report'}`,
    `Period: ${view.dateRange?.from || '—'} to ${view.dateRange?.to || '—'} (Asia/Kolkata) | Records: ${rows.length}`,
  );

  if (columns.length > 0) {
    const headerRow = detail.addRow(columns.map(humanizeColumnName));
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF163A2E' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8E5' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8E5' } },
      };
    });

    detail.views = [{ state: 'frozen', ySplit: 4 }];
    detail.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: Math.max(4, 4 + rows.length), column: columns.length },
    };

    rows.forEach((row, idx) => {
      const values = columns.map((c) => row[c] ?? '');
      const added = detail.addRow(values);
      added.eachCell((cell, colNumber) => {
        const col = columns[colNumber - 1];
        const raw = row[col];
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
        if (isNumericValue(raw)) {
          cell.numFmt = CURRENCY_KEYS.has(col) ? '₹#,##0.00' : PERCENT_KEYS.has(col) ? '0.0"%"' : '#,##0';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        }
        if (col.toLowerCase().includes('status') && typeof raw === 'string') {
          const u = raw.toUpperCase();
          if (['PAID', 'WON', 'PRESENT', 'ACTIVE', 'COMPLETED', 'CONVERTED'].some((k) => u.includes(k))) {
            cell.font = { bold: true, color: { argb: 'FF166534' } };
          } else if (['LOST', 'FAILED', 'CANCELLED', 'ABSENT'].some((k) => u.includes(k))) {
            cell.font = { bold: true, color: { argb: 'FF991B1B' } };
          }
        }
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE2E8E5' } },
        };
      });
    });

    if (Object.keys(totals).length > 0) {
      const totalRow = detail.addRow(
        columns.map((c, i) => (i === 0 ? 'TOTAL' : totals[c] !== undefined ? totals[c] : '')),
      );
      totalRow.eachCell((cell, colNumber) => {
        const col = columns[colNumber - 1];
        cell.font = { bold: true, color: { argb: 'FF163A2E' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7F4' } };
        if (totals[col] !== undefined) {
          cell.numFmt = CURRENCY_KEYS.has(col) ? '₹#,##0.00' : '#,##0';
        }
      });
    }

    columns.forEach((col, i) => {
      const maxLen = Math.min(
        45,
        Math.max(
          humanizeColumnName(col).length + 4,
          ...rows.slice(0, 50).map((r) => formatCellText(col, r[col]).length + 3),
        ),
      );
      detail.getColumn(i + 1).width = maxLen;
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function buildFormattedReportCsv(view: CatalogReportPayload): Buffer {
  const columns = view.columns?.length ? view.columns : (view.rows[0] ? Object.keys(view.rows[0]) : []);
  const rows = view.rows || [];

  const sanitizeCsv = (val: any): string => {
    let str = val === null || val === undefined ? '' : String(val);
    // Prevent CSV formula injection (=, +, -, @, tab, CR) unless it's a plain negative number
    if (/^[=+\-@\t\r]/.test(str) && !/^-\d+(\.\d+)?$/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const lines: string[] = [];
  lines.push(columns.map((c) => sanitizeCsv(humanizeColumnName(c))).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => sanitizeCsv(row[c] ?? '')).join(','));
  }

  return Buffer.from('\uFEFF' + lines.join('\n'), 'utf8');
}
