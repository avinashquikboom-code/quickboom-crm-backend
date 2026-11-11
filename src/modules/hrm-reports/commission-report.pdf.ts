import PDFDocument = require('pdfkit');
import { CommissionLine, CommissionSummary } from './commission-report.calculator';

const inr = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount || 0);

export function renderCommissionReportPdf(input: {
  company: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  period: string;
  provisional: boolean;
  lines: CommissionLine[];
  summary: CommissionSummary;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.rect(0, 0, doc.page.width, 64).fill('#163A2E');
    doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold').text(input.company, 36, 16);
    doc.fontSize(10).font('Helvetica').text('EMPLOYEE MONTHLY COMMISSION REPORT', 36, 38);
    doc.fontSize(9).text(input.period, 320, 24, { align: 'right', width: 230 });
    doc.fillColor(input.provisional ? '#92400E' : '#166534').fontSize(9).text(input.provisional ? 'PROVISIONAL — pending commission or payroll is not final' : 'FINAL — uses the stored commission ledger', 36, 76);
    doc.fillColor('#172B24').fontSize(10).text(`${input.employeeName} · ${input.employeeCode} · ${input.department}`, 36, 94);
    const cards: Array<[string, string]> = [
      ['Generated', inr(input.summary.generated)],
      ['Employee share', inr(input.summary.employeeShare)],
      ['Leader share', inr(input.summary.leaderShare)],
      ['Approved', inr(input.summary.approved)],
      ['Pending', inr(input.summary.pending)],
      ['Paid', inr(input.summary.paid)],
      ['Outstanding', inr(input.summary.outstanding)],
      ['Reversed', inr(input.summary.reversed)],
      ['Net earned', inr(input.summary.netEarned)],
      ['Customers', String(input.summary.customers)],
    ];
    cards.forEach(([label, value], index) => {
      const x = 36 + (index % 2) * 260;
      const y = 118 + Math.floor(index / 2) * 16;
      doc.fontSize(8).fillColor('#718078').text(label, x, y, { width: 110 });
      doc.fillColor('#172B24').text(value, x + 110, y, { width: 140 });
    });
    let y = 210;
    doc.fontSize(9).font('Helvetica-Bold').text('Customer, invoice, rate, employee share, leader share, status', 36, y);
    y += 16;
    doc.font('Helvetica').fontSize(8);
    for (const line of input.lines) {
      if (y > 760) { doc.addPage(); y = 40; }
      doc.fillColor('#172B24').text(`${line.customerName} · ${line.product} · Invoice ${line.invoiceNumber} · Order ${line.orderNumber}`, 36, y, { width: 520 });
      y += 12;
      doc.fillColor('#64748B').text(`${inr(line.invoiceAmount)} · ${line.rateLabel} · Total ${inr(line.commissionAmount)} · Employee ${inr(line.employeeShare)} · Leader ${inr(line.leaderShare)} · ${line.status} · ${line.paymentStatus}`, 36, y, { width: 520 });
      y += 16;
    }
    if (!input.lines.length) doc.fillColor('#718078').text('No eligible commission transactions were recorded in this month.', 36, y);
    doc.end();
  });
}
