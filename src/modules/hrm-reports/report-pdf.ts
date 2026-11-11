import PDFDocument = require('pdfkit');

export function renderReportPdf(input: {
  title: string;
  companyName: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  designation: string;
  period: string;
  generatedAt: Date;
  summaryRows: Array<[string, string]>;
  tableHead: string[];
  tableRows: string[][];
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.rect(0, 0, doc.page.width, 72).fill('#163A2E');
    doc.fillColor('#FFFFFF').fontSize(16).text(input.companyName || 'QB Suite', 36, 22);
    doc.fontSize(10).text(input.title, 36, 44);
    doc.fillColor('#172B24').fontSize(12).text(input.employeeName, 36, 92);
    doc.fontSize(9).fillColor('#64748B');
    doc.text(`${input.employeeCode}  ·  ${input.department}  ·  ${input.designation}`);
    doc.text(`${input.period}  ·  Generated ${input.generatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    doc.moveDown();
    doc.fillColor('#172B24').fontSize(11).text('Summary');
    input.summaryRows.forEach(([label, value]) => {
      doc.fontSize(9).fillColor('#64748B').text(label, { continued: true }).fillColor('#172B24').text(`  ${value}`);
    });
    doc.moveDown();
    doc.fontSize(8).fillColor('#172B24').text(input.tableHead.join('  |  '));
    doc.moveTo(36, doc.y).lineTo(559, doc.y).stroke('#E2E8E5');
    input.tableRows.forEach((row) => {
      if (doc.y > 760) {
        doc.addPage();
        doc.fontSize(8).fillColor('#718078').text(`${input.title} · ${input.employeeCode}`, 36, 36);
      }
      doc.fontSize(8).fillColor('#172B24').text(row.join('  |  '), 36, doc.y + 2, { width: 523 });
    });
    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(index);
      doc.fontSize(8).fillColor('#718078').text(`Page ${index + 1} of ${pages.count}`, 36, 810, { align: 'right', width: 523 });
    }
    doc.end();
  });
}
