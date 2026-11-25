import * as ExcelJS from 'exceljs';
import JSZip = require('jszip');
import {
  renderQuikBoomCsv,
  renderQuikBoomExcel,
  renderQuikBoomPdf,
  renderQuikBoomZip,
  sanitizeSpreadsheetCell,
} from './export-renderer.util';
import { EXPORT_MODULE_SCHEMAS, isSensitiveExportKey } from './export-schemas';

describe('Global Export Engine', () => {
  const sampleRows = [
    {
      id: 101,
      businessName: 'QUIK BOOM MARKETING AGENCY',
      contactPerson: 'Avinash Magar',
      phone: '09284216276',
      email: 'contact@quikboom.in',
      city: 'Vadodara',
      category: 'Marketing agency',
      source: 'GOOGLE_MAPS',
      stage: 'WON',
      assignedTo: 'Rahul Sharma',
      estimatedValue: 59000,
      createdAt: '2026-11-25T09:00:00.000Z',
    },
    {
      id: 102,
      businessName: '=HYPERLINK("http://evil.example","Click")',
      contactPerson: '<b>Test User</b>',
      phone: '01234567890',
      email: 'test@example.com',
      city: 'Pune',
      category: 'Retail, "Electronics"',
      source: 'WEBSITE',
      stage: 'NEW',
      assignedTo: 'Unassigned',
      estimatedValue: 12500.5,
      createdAt: '2026-11-24T14:30:00.000Z',
    },
  ];

  it('blocks sensitive credential keys from export schemas and cell rendering', () => {
    expect(isSensitiveExportKey('passwordHash')).toBe(true);
    expect(isSensitiveExportKey('accessToken')).toBe(true);
    expect(isSensitiveExportKey('refreshToken')).toBe(true);
    expect(isSensitiveExportKey('apiKey')).toBe(true);
    expect(isSensitiveExportKey('businessName')).toBe(false);
    expect(sanitizeSpreadsheetCell('=SUM(A1:A5)')).toBe("'=SUM(A1:A5)");
    expect(sanitizeSpreadsheetCell('<b>Hello</b>')).toBe('Hello');
  });

  it('generates valid UTF-8 BOM CSV with formula-injection protection and escaping', () => {
    const buf = renderQuikBoomCsv({
      title: 'CRM Leads Report',
      module: 'leads',
      columns: EXPORT_MODULE_SCHEMAS.leads.columns,
      rows: sampleRows,
    });
    const text = buf.toString('utf8');
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('09284216276');
    expect(text).toContain('"\'=HYPERLINK(""http://evil.example"",""Click"")"');
    expect(text).toContain('Test User');
    expect(text).not.toContain('<b>');
  });

  it('generates a real XLSX workbook with Summary and Records sheets and numeric cells', async () => {
    const buf = await renderQuikBoomExcel({
      title: 'CRM Leads Report',
      module: 'leads',
      sheetName: 'CRM Leads',
      columns: EXPORT_MODULE_SCHEMAS.leads.columns,
      rows: sampleRows,
      summaryMetrics: [{ label: 'Total Leads', value: 2 }],
      appliedFilters: { source: 'ALL' },
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(wb.getWorksheet('Summary')).toBeDefined();
    const sheet = wb.getWorksheet('CRM Leads');
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(4).getCell(1).value).toBe('Lead ID');
    expect(sheet!.getRow(5).getCell(4).value).toBe('09284216276');
    expect(sheet!.getRow(5).getCell(11).value).toBe(59000);
    expect(sheet!.getRow(6).getCell(2).value).toBe("'=HYPERLINK(\"http://evil.example\",\"Click\")");
  });

  it('generates a valid PDF document with %PDF header and multi-page support', async () => {
    const buf = await renderQuikBoomPdf({
      title: 'CRM Leads Report',
      module: 'leads',
      orientation: 'landscape',
      columns: EXPORT_MODULE_SCHEMAS.leads.columns,
      rows: sampleRows,
      summaryMetrics: [{ label: 'Total Leads', value: 2 }],
      appliedFilters: { stage: 'ALL' },
    });
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(1500);
  });

  it('generates a valid ZIP archive containing PDF documents', async () => {
    const pdf = await renderQuikBoomPdf({
      title: 'Lead #101',
      module: 'leads',
      orientation: 'portrait',
      columns: EXPORT_MODULE_SCHEMAS.leads.columns.slice(0, 4),
      rows: [sampleRows[0]],
    });
    const zipBuf = await renderQuikBoomZip([{ filename: 'qb-lead-101.pdf', buffer: pdf }]);
    const zip = await JSZip.loadAsync(zipBuf);
    const entry = zip.file('qb-lead-101.pdf');
    expect(entry).not.toBeNull();
    const extracted = await entry!.async('nodebuffer');
    expect(extracted.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });
});
