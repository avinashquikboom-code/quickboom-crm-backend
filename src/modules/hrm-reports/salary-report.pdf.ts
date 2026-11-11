import PDFDocument = require('pdfkit');
import { SalaryReportData } from './salary-report.calculator';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function renderSalaryReportPdf(data: SalaryReportData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 72; // 36 left + 36 right margins

    // 1. BRAND HEADER BAR
    doc.rect(0, 0, pageWidth, 74).fill('#163A2E');
    doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text(data.company.name || 'QB Suite', 36, 18);
    doc.fontSize(11).font('Helvetica').text('EMPLOYEE MONTHLY SALARY SUMMARY', 36, 42);

    // Document identifier on top right
    doc.fontSize(9).font('Helvetica-Bold').text(data.period.periodLabel, 300, 24, { align: 'right', width: contentWidth - 264 });
    doc.fontSize(8).font('Helvetica').text(`Ref: ${data.employee.code}/${data.period.year}/${String(data.period.month).padStart(2, '0')}`, 300, 40, { align: 'right', width: contentWidth - 264 });

    // 2. STATUS BANNER (FINALIZED vs PROVISIONAL)
    const bannerColor = data.isProvisional ? '#D97706' : '#166534';
    const bannerBg = data.isProvisional ? '#FEF3C7' : '#DCFCE7';
    const bannerText = data.isProvisional
      ? 'PROVISIONAL STATEMENT  ·  Attendance-based calculation pending monthly payroll finalization'
      : `FINALIZED PAYROLL STATEMENT  ·  Status: ${data.payrollStatus}  ·  Reconciled with Salary Slip`;

    doc.rect(36, 86, contentWidth, 24).fill(bannerBg);
    doc.rect(36, 86, 4, 24).fill(bannerColor);
    doc.fillColor(bannerColor).fontSize(9).font('Helvetica-Bold').text(bannerText, 46, 93);

    // 3. EMPLOYEE & PERIOD DETAILS GRID
    let y = 122;
    doc.rect(36, y, contentWidth, 68).fill('#F8FAFC');
    doc.rect(36, y, contentWidth, 68).stroke('#E2E8F0');

    // Column 1
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text('EMPLOYEE NAME', 48, y + 10);
    doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text(data.employee.name, 48, y + 22);
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text('EMPLOYEE ID', 48, y + 40);
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text(data.employee.code, 48, y + 50);

    // Column 2
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text('DEPARTMENT', 210, y + 10);
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text(data.employee.department, 210, y + 22);
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text('DESIGNATION', 210, y + 40);
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text(data.employee.designation, 210, y + 50);

    // Column 3
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text('CALCULATION PERIOD', 370, y + 10);
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text(`${data.period.monthName} ${data.period.year}`, 370, y + 22);
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text('GENERATED ON', 370, y + 40);
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica').text(data.generatedAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }), 370, y + 50);

    // 4. ATTENDANCE & TIME TRACKING SUMMARY
    y = 202;
    doc.fillColor('#163A2E').fontSize(10).font('Helvetica-Bold').text('ATTENDANCE & TIME TRACKING SUMMARY', 36, y);
    y += 16;

    doc.rect(36, y, contentWidth, 54).fill('#FFFFFF');
    doc.rect(36, y, contentWidth, 54).stroke('#E2E8F0');

    const attCols = [
      { label: 'Scheduled', val: `${data.attendance.scheduledDays}d` },
      { label: 'Present', val: `${data.attendance.presentDays}d` },
      { label: 'Paid Leaves', val: `${data.attendance.paidLeaveDays}d` },
      { label: 'Unpaid / LOP', val: `${data.attendance.unpaidLeaveDays}d` },
      { label: 'Half Days', val: `${data.attendance.halfDays}d` },
      { label: 'Late Marks', val: `${data.attendance.lateArrivals}` },
      { label: 'Working Hrs', val: `${data.attendance.totalWorkingHours}h` },
      { label: 'Break Hrs', val: `${data.attendance.totalBreakHours}h` },
      { label: 'Overtime', val: `${data.attendance.approvedOvertimeHours}h` },
    ];

    const colWidth = contentWidth / attCols.length;
    attCols.forEach((col, idx) => {
      const colX = 36 + idx * colWidth;
      doc.fillColor('#64748B').fontSize(7).font('Helvetica').text(col.label, colX + 4, y + 10, { width: colWidth - 8, align: 'center' });
      doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text(col.val, colX + 4, y + 26, { width: colWidth - 8, align: 'center' });
      if (idx > 0) {
        doc.moveTo(colX, y + 6).lineTo(colX, y + 48).stroke('#E2E8F0');
      }
    });

    // 5. SALARY BREAKDOWN (EARNINGS VS DEDUCTIONS)
    y = 276;
    doc.fillColor('#163A2E').fontSize(10).font('Helvetica-Bold').text('SALARY BREAKDOWN', 36, y);
    y += 16;

    const halfWidth = (contentWidth - 12) / 2;

    // EARNINGS BOX
    doc.rect(36, y, halfWidth, 230).fill('#FFFFFF');
    doc.rect(36, y, halfWidth, 230).stroke('#E2E8F0');
    doc.rect(36, y, halfWidth, 24).fill('#F1F5F9');
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text('EARNINGS / CREDITS', 46, y + 7);
    doc.text('AMOUNT', 36 + halfWidth - 65, y + 7);

    const earningsList: Array<[string, number]> = [
      ['Basic Salary', data.earnings.basicSalary],
      ['House Rent Allowance (HRA)', data.earnings.hra],
      ['Standard Allowances', data.earnings.allowances],
      ['Special Allowance', data.earnings.specialAllowance],
      ['Approved Overtime Earnings', data.earnings.overtime],
      ['Approved Reimbursements', data.earnings.reimbursement],
      ['Commission & Incentives', data.earnings.commission],
      ['Performance Bonus', data.earnings.bonus],
      ['Other Earnings', data.earnings.otherEarnings],
    ];

    let earnY = y + 32;
    earningsList.forEach(([lbl, amt]) => {
      doc.fillColor('#475569').fontSize(8).font('Helvetica').text(lbl, 46, earnY);
      doc.fillColor('#0F172A').font('Helvetica-Bold').text(formatCurrency(amt), 36 + halfWidth - 85, earnY, { align: 'right', width: 75 });
      earnY += 18;
    });

    // Gross Earnings Total
    doc.rect(36, y + 198, halfWidth, 32).fill('#ECFDF5');
    doc.fillColor('#065F46').fontSize(9).font('Helvetica-Bold').text('GROSS EARNINGS', 46, y + 208);
    doc.fillColor('#065F46').fontSize(10).text(formatCurrency(data.earnings.grossSalary), 36 + halfWidth - 95, y + 208, { align: 'right', width: 85 });

    // DEDUCTIONS BOX
    const dedX = 36 + halfWidth + 12;
    doc.rect(dedX, y, halfWidth, 230).fill('#FFFFFF');
    doc.rect(dedX, y, halfWidth, 230).stroke('#E2E8F0');
    doc.rect(dedX, y, halfWidth, 24).fill('#F1F5F9');
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text('DEDUCTIONS', dedX + 10, y + 7);
    doc.text('AMOUNT', dedX + halfWidth - 65, y + 7);

    const deductionsList: Array<[string, number, string?]> = [
      ['Attendance LOP Deductions', data.deductions.lopDeduction, `${data.deductions.lopDays} days`],
      ['Late Arrival Deductions', data.deductions.lateDeductions, `${data.deductions.lateMarks} marks`],
      ['Provident Fund (PF)', data.deductions.pf],
      ['Employee State Insurance (ESI)', data.deductions.esi],
      ['Professional Tax (PT)', data.deductions.professionalTax],
      ['Tax Deducted at Source (TDS)', data.deductions.tds],
      ['Employee Loan EMI / Advances', data.deductions.loanDeduction],
      ['Other Deductions', data.deductions.otherDeductions],
    ];

    let dedY = y + 32;
    deductionsList.forEach(([lbl, amt, note]) => {
      doc.fillColor('#475569').fontSize(8).font('Helvetica').text(lbl, dedX + 10, dedY);
      if (note) {
        doc.fillColor('#94A3B8').fontSize(7).text(`(${note})`, dedX + 10 + doc.widthOfString(lbl) + 4, dedY);
      }
      doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold').text(formatCurrency(amt), dedX + halfWidth - 85, dedY, { align: 'right', width: 75 });
      dedY += 18;
    });

    // Total Deductions Total
    doc.rect(dedX, y + 198, halfWidth, 32).fill('#FEF2F2');
    doc.fillColor('#991B1B').fontSize(9).font('Helvetica-Bold').text('TOTAL DEDUCTIONS', dedX + 10, y + 208);
    doc.fillColor('#991B1B').fontSize(10).text(formatCurrency(data.deductions.totalDeductions), dedX + halfWidth - 95, y + 208, { align: 'right', width: 85 });

    // 6. NET SALARY PAYABLE BANNER
    y = 524;
    doc.rect(36, y, contentWidth, 60).fill('#163A2E');
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica').text('NET SALARY PAYABLE', 52, y + 16);
    doc.fillColor('#93C5FD').fontSize(8).text(data.isProvisional ? 'Provisional Net Estimate' : 'Final Approved Disbursable Amount', 52, y + 32);

    doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text(formatCurrency(data.netPayable), 300, y + 18, { align: 'right', width: contentWidth - 280 });
    doc.fillColor('#A7F3D0').fontSize(8).font('Helvetica-Bold').text(`STATUS: ${data.payrollStatus}`, 300, y + 40, { align: 'right', width: contentWidth - 280 });

    // 7. CALCULATION RULES & RECONCILIATION NOTES
    y = 600;
    doc.rect(36, y, contentWidth, 68).fill('#F8FAFC');
    doc.rect(36, y, contentWidth, 68).stroke('#E2E8F0');
    doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold').text('PAYROLL & ATTENDANCE CALCULATION RULES', 46, y + 10);
    doc.fillColor('#64748B').fontSize(7.5).font('Helvetica').text(
      '• Monthly salary calculation strictly follows registered salary components, shift definitions, and attendance punches.\n' +
      '• Daily salary calculation is based on the authoritative 30-day corporate divisor. Loss of pay (LOP) incorporates unpaid leaves & missing punches.\n' +
      '• Break time is excluded from payable working hours. Overtime is payable strictly upon formal management approval.\n' +
      '• This automated statement is reconciled with the HRMS payroll register and individual salary slips.',
      46,
      y + 22,
      { width: contentWidth - 20, lineGap: 2 },
    );

    // 8. SIGNATURE & AUDIT AREA
    y = 684;
    doc.moveTo(36, y + 44).lineTo(180, y + 44).stroke('#CBD5E1');
    doc.fillColor('#64748B').fontSize(7.5).font('Helvetica').text('Employee Signature', 36, y + 48);

    doc.moveTo(pageWidth - 180, y + 44).lineTo(pageWidth - 36, y + 44).stroke('#CBD5E1');
    doc.fillColor('#64748B').fontSize(7.5).font('Helvetica').text('Authorized Signatory / HR', pageWidth - 180, y + 48, { align: 'right', width: 144 });

    // 9. FOOTER
    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(index);
      doc.fontSize(7.5).font('Helvetica').fillColor('#94A3B8').text(
        `QB Suite Automated HRM System  ·  ${data.fileName}  ·  Generated ${data.generatedAt.toISOString()}  ·  Page ${index + 1} of ${pages.count}`,
        36,
        806,
        { align: 'center', width: contentWidth },
      );
    }

    doc.end();
  });
}
