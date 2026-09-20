import PDFDocument = require('pdfkit');
import * as path from 'path';
import * as fs from 'fs';

export interface CalendarAppointmentData {
  appointmentNo?: string;
  customerName: string;
  companyName?: string;
  eventTitle: string;
  date: string | Date;
  time?: string;
  duration?: string;
  location?: string;
  assignedEmployeeName?: string;
  assignedEmployeeEmail?: string;
  assignedEmployeePhone?: string;
  customerEmail?: string;
  customerPhone?: string;
  notes?: string;
  agenda?: string;
}

function resolveFontPaths(): { regular: string; bold: string } | null {
  const candidateDirs = [
    path.join(__dirname, '../../../assets/fonts'),
    path.join(process.cwd(), 'assets/fonts'),
  ];

  for (const dir of candidateDirs) {
    const regular = path.join(dir, 'Roboto-Regular.ttf');
    const bold = path.join(dir, 'Roboto-Bold.ttf');
    if (fs.existsSync(regular) && fs.existsSync(bold)) {
      return { regular, bold };
    }
  }
  return null;
}

export async function generateCalendarAppointmentPdfBuffer(
  data: CalendarAppointmentData,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });
      doc.on('error', (err) => {
        reject(err);
      });

      const fontPaths = resolveFontPaths();
      let regularFont = 'Helvetica';
      let boldFont = 'Helvetica-Bold';

      if (fontPaths) {
        doc.registerFont('CalFont', fontPaths.regular);
        doc.registerFont('CalFont-Bold', fontPaths.bold);
        regularFont = 'CalFont';
        boldFont = 'CalFont-Bold';
      }

      const primaryColor = '#0284C7'; // Sky Blue / Cyan
      const darkColor = '#0F172A';
      const grayColor = '#64748B';
      const borderCol = '#E2E8F0';
      const lightBg = '#F8FAFC';

      const apptNo = data.appointmentNo || `APT-${Date.now().toString(36).toUpperCase()}`;
      const company = data.companyName || 'QUIKBOOM Digital Marketing Agency';

      // Header & Branding
      doc.fillColor(primaryColor).fontSize(20).font(boldFont).text('QUIKBOOM CRM', 40, 40);
      doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
        .text(company, 40, 62)
        .text('Customer Calendar & Appointment Scheduling', 40, 74);

      doc.fillColor(darkColor).fontSize(16).font(boldFont).text('MEETING CONFIRMATION', 300, 40, { width: 255, align: 'right' });
      doc.fillColor(primaryColor).fontSize(10).font(boldFont).text(apptNo, 300, 60, { width: 255, align: 'right' });
      doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
        .text(`Issued: ${new Date().toLocaleDateString('en-IN')}`, 300, 74, { width: 255, align: 'right' });

      doc.moveTo(40, 95).lineTo(555, 95).strokeColor(borderCol).lineWidth(1).stroke();

      // Meeting Details Card (Background box)
      const cardTop = 110;
      doc.rect(40, cardTop, 515, 110).fillAndStroke(lightBg, borderCol);

      doc.fillColor(primaryColor).fontSize(12).font(boldFont)
        .text(data.eventTitle || 'Scheduled Business Meeting', 55, cardTop + 14);

      const dateStr = data.date instanceof Date ? data.date.toLocaleDateString('en-IN') : String(data.date);
      const timeStr = data.time || '10:00 AM';
      const locationStr = data.location || 'Online Video Meeting / Office';

      doc.fillColor(darkColor).fontSize(9.5).font(regularFont);
      doc.text(`📅 Date: ${dateStr}`, 55, cardTop + 38);
      doc.text(`⏰ Time: ${timeStr} (IST)`, 55, cardTop + 56);
      doc.text(`📍 Location / Link: ${locationStr}`, 55, cardTop + 74);

      // Attendees Section (2 Columns: Customer on Left, Representative on Right)
      const attendeeTop = 240;

      // Left Column - Client
      doc.rect(40, attendeeTop, 245, 120).fillAndStroke('#FFFFFF', borderCol);
      doc.fillColor(grayColor).fontSize(9).font(boldFont).text('CLIENT / ATTENDEE', 55, attendeeTop + 12);
      doc.fillColor(darkColor).fontSize(11).font(boldFont).text(data.customerName || 'Valued Client', 55, attendeeTop + 28);
      doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
        .text(`Email: ${data.customerEmail || 'Registered Email'}`, 55, attendeeTop + 48)
        .text(`Phone: ${data.customerPhone || 'Registered Phone'}`, 55, attendeeTop + 62);

      // Right Column - Assigned Representative
      doc.rect(310, attendeeTop, 245, 120).fillAndStroke('#FFFFFF', borderCol);
      doc.fillColor(grayColor).fontSize(9).font(boldFont).text('ASSIGNED REPRESENTATIVE', 325, attendeeTop + 12);
      doc.fillColor(darkColor).fontSize(11).font(boldFont).text(data.assignedEmployeeName || 'QuickBoom Representative', 325, attendeeTop + 28);
      doc.fillColor(grayColor).fontSize(8.5).font(regularFont)
        .text(`Email: ${data.assignedEmployeeEmail || 'team@quikboom.com'}`, 325, attendeeTop + 48)
        .text(`Phone: ${data.assignedEmployeePhone || 'Support Desk'}`, 325, attendeeTop + 62);

      // Agenda & Notes Section
      const notesTop = 380;
      doc.rect(40, notesTop, 515, 80).fillAndStroke('#FFFFFF', borderCol);
      doc.fillColor(grayColor).fontSize(9).font(boldFont).text('MEETING NOTES & AGENDA', 55, notesTop + 12);
      doc.fillColor(darkColor).fontSize(8.5).font(regularFont)
        .text(data.notes || data.agenda || 'Discussion of digital marketing scope, project milestones, and business deliverables.', 55, notesTop + 28, { width: 485 });

      // Footer
      doc.moveTo(40, 720).lineTo(555, 720).strokeColor(borderCol).lineWidth(1).stroke();
      doc.fillColor(grayColor).fontSize(8).font(regularFont)
        .text('This is a system-generated appointment confirmation from QuickBoom CRM.', 40, 730, { align: 'center', width: 515 })
        .text('For rescheduling or inquiries, please contact your assigned representative.', 40, 742, { align: 'center', width: 515 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
