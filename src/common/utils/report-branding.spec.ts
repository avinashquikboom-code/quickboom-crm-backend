import PDFDocument = require('pdfkit');
import * as ExcelJS from 'exceljs';
import {
  applyExcelBranding,
  drawPdfHeaderLogo,
  getOfficialLogoBuffer,
  getOfficialLogoPath,
} from './report-branding.util';
import { renderDailyPerformancePdf } from '../../modules/telecaller-targets/telecaller-performance-pdf';
import { renderReportPdf } from '../../modules/hrm-reports/report-pdf';
import { renderSalaryReportPdf } from '../../modules/hrm-reports/salary-report.pdf';
import { renderCommissionReportPdf } from '../../modules/hrm-reports/commission-report.pdf';
import { generatePlanProposalPdfBuffer } from './plan-proposal-pdf.util';
import { generateCalendarAppointmentPdfBuffer } from './calendar-pdf.util';
import { generateInvoicePaymentReceiptPdfBuffer } from '../../modules/invoice/invoice-billing.helper';
import { renderQuikBoomPdf } from '../../modules/export/export-renderer.util';

describe('Centralized Official Report Branding (app_logo.png)', () => {
  it('loads the official PNG logo buffer from backend assets', () => {
    const logoPath = getOfficialLogoPath();
    expect(logoPath).toBeTruthy();
    expect(logoPath).toContain('app_logo.png');

    const buf = getOfficialLogoBuffer();
    expect(buf).toBeTruthy();
    expect(buf!.length).toBeGreaterThan(10_000);
    // PNG magic bytes: 89 50 4E 47
    expect(buf![0]).toBe(0x89);
    expect(buf![1]).toBe(0x50);
    expect(buf![2]).toBe(0x4e);
    expect(buf![3]).toBe(0x47);
  });

  it('draws the official logo in top-left PDF header preserving aspect ratio without errors', async () => {
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const res = drawPdfHeaderLogo(doc, { x: 36, y: 20, maxWidth: 42, maxHeight: 42 });
      expect(res.rendered).toBe(true);
      expect(res.textStartX).toBeGreaterThan(36);
      doc.text('Test Header', res.textStartX, 30);
      doc.end();
    });
    expect(buf.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(buf.toString('latin1')).toContain('/Subtype /Image');
  });

  it('embeds the official logo in all production PDF report generators', async () => {
    const now = new Date('2026-12-01T10:00:00.000Z');
    const buffers = await Promise.all([
      renderDailyPerformancePdf({
        companyName: 'QB Suite',
        reportDate: '2026-12-01',
        reportVersion: 1,
        generatedAt: now,
        employeeName: 'Test Employee',
        employeeCode: 'EMP-01',
        department: 'Telecalling',
        designation: 'Executive',
        shiftName: 'Day',
        shiftTimings: '09:30 AM - 06:30 PM',
        punchInText: '09:30 AM IST',
        punchOutText: '06:30 PM IST',
        workingHoursText: '8.00 hrs',
        overallScore: 95,
        callConnectionRate: 60,
        leadConversionRate: 25,
        metrics: [],
        stats: {
          outgoingCalls: 20,
          connectedCalls: 12,
          followUpsCompleted: 8,
          newLeadsCreated: 4,
          visitsScheduled: 1,
          visitsCompleted: 1,
          proposalsSent: 2,
          leadsWon: 1,
        },
      }),
      renderReportPdf({
        title: 'Monthly Attendance Report',
        companyName: 'QB Suite',
        employeeName: 'Test Employee',
        employeeCode: 'EMP-01',
        department: 'Sales',
        designation: 'Executive',
        period: 'December 2026',
        generatedAt: now,
        summaryRows: [['Present Days', '22']],
        tableHead: ['Date', 'Status'],
        tableRows: [['2026-12-01', 'PRESENT']],
      }),
      renderSalaryReportPdf({
        company: { name: 'QB Suite', city: 'Mumbai' },
        employee: { name: 'Test Employee', code: 'EMP-01', department: 'Sales', designation: 'Executive' },
        period: { year: 2026, month: 12, periodLabel: 'December 2026' },
        isProvisional: false,
        payrollStatus: 'APPROVED',
        attendance: { totalDays: 31, present: 22, halfDays: 0, absent: 0, paidLeave: 1, unpaidLeave: 0, holidays: 1, weeklyOffs: 7, lateMarks: 0 },
        earnings: { basic: 25000, hra: 5000, allowances: 2000, bonus: 0, commission: 0, overtime: 0, gross: 32000 },
        deductions: { pf: 1800, esi: 0, pt: 200, tds: 0, lop: 0, late: 0, loan: 0, other: 0, total: 2000 },
        netSalary: 30000,
        generatedAt: now,
      } as any),
      renderCommissionReportPdf({
        company: 'QB Suite',
        employeeName: 'Test Employee',
        employeeCode: 'EMP-01',
        department: 'Sales',
        period: 'December 2026',
        provisional: false,
        lines: [],
        summary: {
          generated: 5000,
          employeeShare: 4000,
          leaderShare: 1000,
          approved: 4000,
          pending: 0,
          paid: 4000,
          outstanding: 0,
          reversed: 0,
          netEarned: 4000,
          customers: 2,
        },
      }),
      generatePlanProposalPdfBuffer({
        proposalNo: 'PROP-001',
        companyName: 'QB Suite',
        proposalType: 'STANDARD',
        leadName: 'Acme Corp',
        businessName: 'Acme Corp',
        planName: 'Growth Plan',
        planPrice: 15000,
        billingCycle: 'MONTHLY',
        features: ['4 Reels', '8 Posts'],
      }),
      generateCalendarAppointmentPdfBuffer({
        customerName: 'Acme Corp',
        date: now,
        time: '10:00 AM',
        eventTitle: 'Onboarding Call',
      }),
      generateInvoicePaymentReceiptPdfBuffer({
        receiptNo: 'RCPT-001',
        invoiceNo: 'INV-001',
        paymentDate: now,
        paymentMode: 'UPI',
        paymentMethod: 'UPI',
        customerName: 'Acme Corp',
        amountPaid: 15000,
        invoiceTotal: 15000,
        totalPaidToDate: 15000,
        remainingBalance: 0,
      }),
      renderQuikBoomPdf({
        module: 'CRM',
        title: 'CRM Leads Export',
        companyName: 'QB Suite',
        columns: [{ key: 'name', label: 'Name' }],
        rows: [{ name: 'Acme Corp' }],
      }),
    ]);

    for (const pdf of buffers) {
      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
      expect(pdf.toString('latin1')).toContain('/Subtype /Image');
    }
  });

  it('embeds the official logo in ExcelJS workbooks via applyExcelBranding', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    const startRow = applyExcelBranding(wb, ws, 'QB Suite Report', 'Period: 2026-12');
    expect(startRow).toBe(4);
    expect((wb as any).media.length).toBeGreaterThan(0);
    const out = Buffer.from(await wb.xlsx.writeBuffer());
    expect(out.length).toBeGreaterThan(2000);
  });
});
