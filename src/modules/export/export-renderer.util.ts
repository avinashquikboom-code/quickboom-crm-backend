import PDFDocument = require('pdfkit');
import * as ExcelJS from 'exceljs';
import JSZip = require('jszip');
import { ExportColumnDef, isSensitiveExportKey } from './export-schemas';

export interface ExportRenderContext {
  title: string;
  module: string;
  sheetName?: string;
  orientation?: 'portrait' | 'landscape';
  companyName?: string;
  generatedBy?: string;
  generatedAt?: Date;
  appliedFilters?: Record<string, any>;
  summaryMetrics?: Array<{ label: string; value: string | number }>;
  includeBranding?: boolean;
  includeSummary?: boolean;
  includeFilters?: boolean;
  columns: ExportColumnDef[];
  rows: Array<Record<string, any>>;
}

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

export function sanitizeSpreadsheetCell(value: any): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Strip any accidental HTML tags
  str = str.replace(/<[^>]*>/g, '').trim();
  if (FORMULA_PREFIX_RE.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function formatIndianCurrency(value: any): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'Rs. 0.00';
  return `Rs. ${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCellForDisplay(value: any, type?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object' && !(value instanceof Date)) {
    if (Array.isArray(value)) return value.join(', ') || '—';
    return value.name || value.title || value.label || '—';
  }
  if (type === 'currency') return formatIndianCurrency(value);
  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('en-IN') : String(value);
  }
  if (type === 'date') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (type === 'datetime') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }
  if (type === 'status') {
    return String(value)
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return String(value).replace(/<[^>]*>/g, '').trim() || '—';
}

export function renderQuikBoomCsv(ctx: ExportRenderContext): Buffer {
  const safeCols = ctx.columns.filter((c) => !isSensitiveExportKey(c.key));
  const escapeCsv = (val: string) => {
    const clean = sanitizeSpreadsheetCell(val);
    if (/[",\n\r]/.test(clean)) {
      return `"${clean.replace(/"/g, '""')}"`;
    }
    return clean;
  };

  const lines: string[] = [];
  lines.push(safeCols.map((c) => escapeCsv(c.label)).join(','));

  for (const row of ctx.rows) {
    const line = safeCols.map((col) => {
      const raw = row[col.key];
      if (col.type === 'currency' || col.type === 'number') {
        const n = Number(raw);
        return Number.isFinite(n) ? String(n) : '0';
      }
      if (col.type === 'date' || col.type === 'datetime') {
        return escapeCsv(formatCellForDisplay(raw, col.type));
      }
      if (col.type === 'status') {
        return escapeCsv(formatCellForDisplay(raw, 'status'));
      }
      if (raw === null || raw === undefined) return '';
      if (typeof raw === 'object') return escapeCsv(formatCellForDisplay(raw, col.type));
      return escapeCsv(String(raw));
    });
    lines.push(line.join(','));
  }

  // UTF-8 BOM for Microsoft Excel compatibility
  return Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8');
}

export async function renderQuikBoomExcel(ctx: ExportRenderContext): Promise<Buffer> {
  const safeCols = ctx.columns.filter((c) => !isSensitiveExportKey(c.key));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QB Suite Admin Panel';
  workbook.created = ctx.generatedAt || new Date();

  const generatedStr = formatCellForDisplay(ctx.generatedAt || new Date(), 'datetime');

  // 1. Summary Sheet (when summary or filters included)
  if (ctx.includeSummary !== false && ((ctx.summaryMetrics && ctx.summaryMetrics.length > 0) || ctx.appliedFilters)) {
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.getColumn(1).width = 28;
    summarySheet.getColumn(2).width = 48;

    summarySheet.addRow([ctx.companyName || 'QUIK BOOM MARKETING AGENCY — QB SUITE']);
    summarySheet.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF123D32' } };
    summarySheet.addRow([ctx.title]);
    summarySheet.getRow(2).font = { bold: true, size: 12, color: { argb: 'FF142D25' } };
    summarySheet.addRow(['Generated At (IST)', generatedStr]);
    if (ctx.generatedBy) summarySheet.addRow(['Generated By', sanitizeSpreadsheetCell(ctx.generatedBy)]);
    summarySheet.addRow(['Total Exported Records', ctx.rows.length]);
    summarySheet.addRow([]);

    if (ctx.summaryMetrics && ctx.summaryMetrics.length > 0) {
      const hdr = summarySheet.addRow(['Metric', 'Value']);
      hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123D32' } };
      for (const m of ctx.summaryMetrics) {
        summarySheet.addRow([sanitizeSpreadsheetCell(m.label), typeof m.value === 'number' ? m.value : sanitizeSpreadsheetCell(m.value)]);
      }
      summarySheet.addRow([]);
    }

    if (ctx.includeFilters !== false && ctx.appliedFilters && Object.keys(ctx.appliedFilters).length > 0) {
      const fHdr = summarySheet.addRow(['Applied Filter', 'Value']);
      fHdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      fHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B50' } };
      for (const [k, v] of Object.entries(ctx.appliedFilters)) {
        if (v === undefined || v === null || v === '') continue;
        summarySheet.addRow([sanitizeSpreadsheetCell(k), sanitizeSpreadsheetCell(v)]);
      }
    }
  }

  // 2. Records Sheet
  const sheet = workbook.addWorksheet((ctx.sheetName || ctx.title || 'Records').slice(0, 31));
  sheet.addRow([`${ctx.companyName || 'QB SUITE'} — ${ctx.title}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: 'FF123D32' } };
  sheet.addRow([`Generated: ${generatedStr} IST | Records: ${ctx.rows.length}`]);
  sheet.getRow(2).font = { size: 10, color: { argb: 'FF64748B' } };
  sheet.addRow([]);

  const headerRowIndex = 4;
  const headerRow = sheet.addRow(safeCols.map((c) => c.label));
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123D32' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF073D30' } },
      bottom: { style: 'thin', color: { argb: 'FF073D30' } },
    };
  });

  safeCols.forEach((col, idx) => {
    const excelCol = sheet.getColumn(idx + 1);
    excelCol.width = col.width || 18;
    if (col.type === 'phone') {
      excelCol.numFmt = '@';
    }
  });

  for (const row of ctx.rows) {
    const rowValues = safeCols.map((col) => {
      const raw = row[col.key];
      if (col.type === 'currency' || col.type === 'number') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
      }
      if (col.type === 'date' || col.type === 'datetime') {
        return formatCellForDisplay(raw, col.type);
      }
      if (col.type === 'status') {
        return formatCellForDisplay(raw, 'status');
      }
      if (raw === null || raw === undefined) return '';
      if (typeof raw === 'object') return sanitizeSpreadsheetCell(formatCellForDisplay(raw, col.type));
      return sanitizeSpreadsheetCell(String(raw));
    });

    const added = sheet.addRow(rowValues);
    added.eachCell((cell, colIdx) => {
      const colDef = safeCols[colIdx - 1];
      cell.alignment = {
        vertical: 'middle',
        horizontal: colDef?.type === 'currency' || colDef?.type === 'number' ? 'right' : 'left',
        wrapText: true,
      };
      if (colDef?.type === 'currency') {
        cell.numFmt = '"₹"#,##0.00';
      } else if (colDef?.type === 'number') {
        cell.numFmt = '#,##0.##';
      } else if (colDef?.type === 'phone') {
        cell.numFmt = '@';
      }
    });
  }

  // Totals row for currency columns
  const hasCurrency = safeCols.some((c) => c.type === 'currency');
  if (hasCurrency && ctx.rows.length > 0) {
    const totals = safeCols.map((col, idx) => {
      if (idx === 0) return 'TOTAL';
      if (col.type === 'currency') {
        return ctx.rows.reduce((sum, r) => sum + (Number(r[col.key]) || 0), 0);
      }
      return '';
    });
    const totalRow = sheet.addRow(totals);
    totalRow.font = { bold: true, color: { argb: 'FF123D32' } };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1EC' } };
    totalRow.eachCell((cell, colIdx) => {
      if (safeCols[colIdx - 1]?.type === 'currency') {
        cell.numFmt = '"₹"#,##0.00';
      }
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];
  if (safeCols.length > 0) {
    sheet.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex + ctx.rows.length, column: safeCols.length },
    };
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

export async function renderQuikBoomPdf(ctx: ExportRenderContext): Promise<Buffer> {
  const safeCols = ctx.columns.filter((c) => !isSensitiveExportKey(c.key));
  const orientation = ctx.orientation || (safeCols.length > 6 ? 'landscape' : 'portrait');

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: orientation,
      margin: 36,
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 72;
    const startX = 36;
    const bottomLimit = doc.page.height - 54;
    const generatedStr = formatCellForDisplay(ctx.generatedAt || new Date(), 'datetime');

    const drawHeaderBanner = () => {
      doc.save();
      doc.rect(startX, 32, pageWidth, 56).fill('#123D32');
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13).text(ctx.companyName || 'QB SUITE — QUIK BOOM MARKETING AGENCY', startX + 14, 42, {
        width: pageWidth - 180,
      });
      doc.fillColor('#A7F3D0').font('Helvetica').fontSize(9).text(ctx.title, startX + 14, 60, {
        width: pageWidth - 180,
      });
      doc.fillColor('#E2E8E5').font('Helvetica').fontSize(8).text(`Generated: ${generatedStr} IST`, startX + pageWidth - 170, 44, {
        width: 156,
        align: 'right',
      });
      if (ctx.generatedBy) {
        doc.text(`By: ${ctx.generatedBy}`, startX + pageWidth - 170, 58, { width: 156, align: 'right' });
      }
      doc.restore();
    };

    drawHeaderBanner();
    let y = 100;

    // Applied filters line
    if (ctx.includeFilters !== false && ctx.appliedFilters) {
      const filterPairs = Object.entries(ctx.appliedFilters)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}: ${v}`);
      if (filterPairs.length > 0) {
        doc.fillColor('#475569').font('Helvetica').fontSize(8).text(`Filters: ${filterPairs.join(' | ')}`, startX, y, { width: pageWidth });
        y += 16;
      }
    }

    // Summary metrics strip
    if (ctx.includeSummary !== false && ctx.summaryMetrics && ctx.summaryMetrics.length > 0) {
      const boxCount = Math.min(ctx.summaryMetrics.length, 4);
      const boxGap = 8;
      const boxW = (pageWidth - boxGap * (boxCount - 1)) / boxCount;
      ctx.summaryMetrics.slice(0, boxCount).forEach((m, i) => {
        const bx = startX + i * (boxW + boxGap);
        doc.roundedRect(bx, y, boxW, 38, 5).fillAndStroke('#F3F8F5', '#CDE2D6');
        doc.fillColor('#64748B').font('Helvetica').fontSize(7.5).text(String(m.label).toUpperCase(), bx + 8, y + 7, { width: boxW - 16, ellipsis: true });
        doc.fillColor('#142D25').font('Helvetica-Bold').fontSize(10).text(String(m.value), bx + 8, y + 19, { width: boxW - 16, ellipsis: true });
      });
      y += 48;
    }

    // Column width calculation
    const totalWeight = safeCols.reduce((sum, c) => sum + (c.width || 16), 0) || 1;
    const colWidths = safeCols.map((c) => ((c.width || 16) / totalWeight) * pageWidth);

    const drawTableHeader = (currY: number) => {
      doc.rect(startX, currY, pageWidth, 22).fill('#123D32');
      let cx = startX;
      safeCols.forEach((col, i) => {
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5).text(col.label, cx + 4, currY + 7, {
          width: colWidths[i] - 8,
          ellipsis: true,
          align: col.type === 'currency' || col.type === 'number' ? 'right' : 'left',
        });
        cx += colWidths[i];
      });
      return currY + 22;
    };

    if (ctx.rows.length === 0) {
      doc.fillColor('#64748B').font('Helvetica').fontSize(10).text('No matching records found for the selected filters.', startX, y + 20, {
        width: pageWidth,
        align: 'center',
      });
    } else {
      y = drawTableHeader(y);

      ctx.rows.forEach((row, rowIdx) => {
        doc.font('Helvetica').fontSize(7.5);
        const cellTexts = safeCols.map((col) => formatCellForDisplay(row[col.key], col.type));
        const heights = cellTexts.map((txt, i) => doc.heightOfString(txt, { width: colWidths[i] - 8 }));
        const rowH = Math.max(20, Math.min(64, Math.max(...heights) + 10));

        if (y + rowH > bottomLimit) {
          doc.addPage({ size: 'A4', layout: orientation, margin: 36 });
          y = 36;
          y = drawTableHeader(y);
        }

        if (rowIdx % 2 === 1) {
          doc.rect(startX, y, pageWidth, rowH).fill('#F8FAF9');
        }
        doc.moveTo(startX, y + rowH).lineTo(startX + pageWidth, y + rowH).strokeColor('#E2E8E5').lineWidth(0.5).stroke();

        let cx = startX;
        cellTexts.forEach((txt, i) => {
          const col = safeCols[i];
          doc.fillColor('#142D25').font('Helvetica').fontSize(7.5).text(txt, cx + 4, y + 5, {
            width: colWidths[i] - 8,
            height: rowH - 8,
            ellipsis: true,
            align: col.type === 'currency' || col.type === 'number' ? 'right' : 'left',
          });
          cx += colWidths[i];
        });
        y += rowH;
      });
    }

    // Page numbers & footer on every page
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#64748B').font('Helvetica').fontSize(7.5).text(
        `QB Suite Export • Confidential • Page ${i + 1} of ${range.count}`,
        startX,
        doc.page.height - 30,
        { width: pageWidth, align: 'center' },
      );
    }

    doc.end();
  });
}

export async function renderQuikBoomZip(files: Array<{ filename: string; buffer: Buffer }>): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.filename, f.buffer);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
