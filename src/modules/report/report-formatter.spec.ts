import * as fs from 'fs';
import * as path from 'path';
import ExcelJS = require('exceljs');
import {
  buildFormattedReportCsv,
  buildFormattedReportExcel,
  buildFormattedReportPdf,
  formatReportFilename,
  CatalogReportPayload,
} from './report-formatter.util';

describe('ReportFormatterUtil (PDF, Excel, CSV)', () => {
  const longRows = Array.from({ length: 65 }).map((_, idx) => ({
    employee: `Aarav Suryavanshi Executive ${idx + 1} – Enterprise Sales Division`,
    business: `QuikBoom Partner Technologies Private Limited Branch #${idx + 1}`,
    status: idx % 3 === 0 ? 'WON' : idx % 3 === 1 ? 'PENDING' : 'LOST',
    amount: 12500 + idx * 250,
    conversionRate: 42.5,
    date: '2026-11-26',
  }));

  const payload: CatalogReportPayload = {
    report: {
      id: 'employee-leads',
      name: 'Employee-wise Leads',
      description: 'Leads with assigned executive and conversion metrics.',
      category: 'sales',
    },
    company: { name: 'QuikBoom Marketing Agency' },
    dateRange: { from: '2026-11-01', to: '2026-11-26' },
    filters: { status: 'All', department: 'Sales' },
    columns: ['employee', 'business', 'status', 'amount', 'conversionRate', 'date'],
    rows: longRows,
    summary: { records: longRows.length },
    generatedAt: '2026-11-26T17:00:00.000Z',
  };

  it('formats meaningful QuikBoom filenames', () => {
    expect(formatReportFilename('Employee-wise Leads', '2026-11-26', 'pdf')).toBe(
      'QuikBoom_Employee_wise_Leads_2026-11-26.pdf',
    );
    expect(formatReportFilename('Invoice Report', '2026-11-26', 'xlsx')).toBe(
      'QuikBoom_Invoice_Report_2026-11-26.xlsx',
    );
    expect(formatReportFilename('Daily Attendance', '2026-11-26', 'csv')).toBe(
      'QuikBoom_Daily_Attendance_2026-11-26.csv',
    );
  });

  it('generates multi-page branded PDFs and handles empty reports cleanly', async () => {
    const pdfBuf = await buildFormattedReportPdf(payload);
    expect(pdfBuf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfBuf.length).toBeGreaterThan(3000);

    const outDir = path.resolve(process.cwd(), '../output/report-samples');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, formatReportFilename(payload.report.name, '2026-11-26', 'pdf')), pdfBuf);

    const emptyPdf = await buildFormattedReportPdf({ ...payload, rows: [], summary: { records: 0 } });
    expect(emptyPdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('generates valid Excel (.xlsx) with Summary + Detailed Records sheets and numeric cells', async () => {
    const xlsxBuf = await buildFormattedReportExcel(payload);
    expect(xlsxBuf.subarray(0, 2).toString()).toBe('PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBuf as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Detailed Records']);

    const detail = wb.getWorksheet('Detailed Records')!;
    // Row 4 is header, Row 5 is first data row, Column 4 is amount (number)
    expect(detail.getRow(4).getCell(1).value).toBe('Employee');
    expect(typeof detail.getRow(5).getCell(4).value).toBe('number');
    expect(detail.getRow(5).getCell(4).value).toBe(12500);

    const outDir = path.resolve(process.cwd(), '../output/report-samples');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, formatReportFilename(payload.report.name, '2026-11-26', 'xlsx')), xlsxBuf);
  });

  it('generates UTF-8 CSV with formula-injection protection', () => {
    const csvBuf = buildFormattedReportCsv({
      ...payload,
      rows: [
        {
          employee: '=CMD("calc")',
          business: 'Acme, Inc.\nLine 2',
          status: 'WON',
          amount: 5000,
          conversionRate: 50,
          date: '2026-11-26',
        },
      ],
      summary: { records: 1 },
    });
    const text = csvBuf.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("'=CMD(\"\"calc\"\")");
    expect(text).toContain('"Acme, Inc.\nLine 2"');

    const outDir = path.resolve(process.cwd(), '../output/report-samples');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, formatReportFilename(payload.report.name, '2026-11-26', 'csv')), csvBuf);
  });
});
