import PDFDocument = require('pdfkit');
import { CalculatedMetricPerformance } from './telecaller-targets.calculator';
import { drawStandardPdfHeader } from '../../common/utils/report-branding.util';

export interface DailyPerformancePdfInput {
  companyName: string;
  companyLogoBuffer?: Buffer | null;
  reportDate: string;
  reportVersion: number;
  generatedAt: Date;
  employeeName: string;
  employeeCode: string;
  department: string;
  designation: string;
  shiftName: string;
  shiftTimings: string;
  punchInText: string;
  punchOutText: string;
  workingHoursText: string;
  overallScore: number;
  callConnectionRate: number;
  leadConversionRate: number;
  metrics: CalculatedMetricPerformance[];
  stats: {
    outgoingCalls: number;
    connectedCalls: number;
    followUpsCompleted: number;
    newLeadsCreated: number;
    visitsScheduled: number;
    visitsCompleted: number;
    proposalsSent: number;
    leadsWon: number;
  };
  callVerificationLimitation?: string | null;
  summaryNotes?: string[];
  improvementAreas?: string[];
}

export function renderDailyPerformancePdf(input: DailyPerformancePdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      bufferPages: true,
      autoFirstPage: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 72;
    const bottomLimit = doc.page.height - 56;

    // Header Banner
    let y = drawStandardPdfHeader(doc, {
      companyName: input.companyName || 'QB Suite',
      title: 'Daily Telecaller Target & Performance Report',
      rightLine1: `Date: ${input.reportDate}`,
      rightLine2: `Version v${input.reportVersion}`,
      bannerHeight: 74,
      bannerColor: '#107569',
      marginX: 36,
      customLogoBuffer: input.companyLogoBuffer,
    });
    doc.roundedRect(36, y, contentWidth, 74, 6).fillAndStroke('#F8FAFC', '#E2E8F0');
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(11).text(input.employeeName, 48, y + 10);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#475569')
      .text(
        `ID: ${input.employeeCode}  |  Department: ${input.department}  |  Role: ${input.designation}`,
        48,
        y + 26,
      );
    doc.text(
      `Shift: ${input.shiftName} (${input.shiftTimings})  |  Working Hours: ${input.workingHoursText}`,
      48,
      y + 40,
    );
    doc.text(`Punch-In: ${input.punchInText}  |  Punch-Out: ${input.punchOutText}`, 48, y + 54);

    // KPI Summary Strip
    y += 84;
    const kpiW = (contentWidth - 18) / 4;
    const kpis = [
      { label: 'Overall Score', value: `${input.overallScore.toFixed(1)}%` },
      { label: 'Call Connection', value: `${input.callConnectionRate.toFixed(1)}%` },
      { label: 'Lead Conversion', value: `${input.leadConversionRate.toFixed(1)}%` },
      {
        label: 'Targets Met',
        value: `${input.metrics.filter((m) => !m.excluded && m.achievementPct >= 100).length}/${input.metrics.filter((m) => !m.excluded).length}`,
      },
    ];
    kpis.forEach((kpi, idx) => {
      const kx = 36 + idx * (kpiW + 6);
      doc.roundedRect(kx, y, kpiW, 44, 5).fillAndStroke('#FFFFFF', '#CBD5E1');
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#64748B')
        .text(kpi.label.toUpperCase(), kx + 8, y + 8, { width: kpiW - 16 });
      doc
        .font('Helvetica-Bold')
        .fontSize(12.5)
        .fillColor('#0F766E')
        .text(kpi.value, kx + 8, y + 21, { width: kpiW - 16 });
    });

    y += 56;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0F172A').text('Target-wise Performance', 36, y);
    y += 16;

    const cols = [
      { title: 'Metric', x: 36, w: 175, align: 'left' as const },
      { title: 'Assigned', x: 211, w: 62, align: 'right' as const },
      { title: 'Achieved', x: 273, w: 62, align: 'right' as const },
      { title: 'Remaining', x: 335, w: 64, align: 'right' as const },
      { title: 'Achieved %', x: 399, w: 68, align: 'right' as const },
      { title: 'Status', x: 467, w: 92, align: 'center' as const },
    ];

    const drawTableHeader = (headerY: number) => {
      doc.rect(36, headerY, contentWidth, 20).fill('#0F172A');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
      cols.forEach((c) => {
        doc.text(c.title, c.x + 4, headerY + 6, { width: c.w - 8, align: c.align });
      });
      return headerY + 20;
    };

    const ensureSpace = (needed: number, repeatTableHeader = false) => {
      if (y + needed <= bottomLimit) return;
      doc.addPage();
      y = 36;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#64748B')
        .text(`${input.companyName}  ·  ${input.employeeName} (${input.employeeCode})  ·  ${input.reportDate}`, 36, y);
      y += 16;
      if (repeatTableHeader) {
        y = drawTableHeader(y);
      }
    };

    y = drawTableHeader(y);
    const activeMetrics = input.metrics.filter((m) => !m.excluded);
    if (activeMetrics.length === 0) {
      doc.rect(36, y, contentWidth, 22).fillAndStroke('#FFFFFF', '#E2E8F0');
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#64748B')
        .text('No active mandatory targets assigned for this working date.', 44, y + 6);
      y += 22;
    } else {
      activeMetrics.forEach((m, index) => {
        ensureSpace(22, true);
        const bg = index % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
        doc.rect(36, y, contentWidth, 20).fillAndStroke(bg, '#E2E8F0');
        doc.font('Helvetica').fontSize(8).fillColor('#0F172A');
        doc.text(m.metricLabel, cols[0].x + 4, y + 6, { width: cols[0].w - 8, ellipsis: true });
        doc.text(String(m.effectiveTarget), cols[1].x + 4, y + 6, { width: cols[1].w - 8, align: 'right' });
        doc.text(String(m.actual), cols[2].x + 4, y + 6, { width: cols[2].w - 8, align: 'right' });
        doc.text(String(m.remaining), cols[3].x + 4, y + 6, { width: cols[3].w - 8, align: 'right' });
        doc.text(`${m.achievementPct.toFixed(1)}%`, cols[4].x + 4, y + 6, { width: cols[4].w - 8, align: 'right' });
        doc
          .font('Helvetica-Bold')
          .fillColor(m.achievementPct >= 100 ? '#15803D' : m.actual > 0 ? '#B45309' : '#B91C1C')
          .text(m.status.replace(/_/g, ' '), cols[5].x + 4, y + 6, { width: cols[5].w - 8, align: 'center' });
        y += 20;
      });
    }

    y += 14;
    ensureSpace(88);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0F172A').text('Activity & Conversion Statistics', 36, y);
    y += 14;

    const statRows = [
      `Calls: ${input.stats.outgoingCalls} outgoing  |  ${input.stats.connectedCalls} connected (${input.callConnectionRate.toFixed(1)}% connection rate)`,
      `Follow-ups & Visits: ${input.stats.followUpsCompleted} follow-ups completed  |  ${input.stats.visitsScheduled} visits scheduled  |  ${input.stats.visitsCompleted} visits completed`,
      `Pipeline & Conversions: ${input.stats.newLeadsCreated} new leads  |  ${input.stats.proposalsSent} proposals sent  |  ${input.stats.leadsWon} leads won (${input.leadConversionRate.toFixed(1)}% conversion)`,
    ];
    statRows.forEach((line) => {
      ensureSpace(16);
      doc.font('Helvetica').fontSize(8.5).fillColor('#334155').text(`• ${line}`, 42, y, { width: contentWidth - 12 });
      y += 14;
    });

    if (input.callVerificationLimitation) {
      ensureSpace(24);
      doc
        .font('Helvetica-Oblique')
        .fontSize(7.8)
        .fillColor('#92400E')
        .text(`Note: ${input.callVerificationLimitation}`, 42, y, { width: contentWidth - 12 });
      y += 18;
    }

    if (input.summaryNotes?.length) {
      y += 6;
      ensureSpace(36);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0F172A').text('Performance Summary', 36, y);
      y += 13;
      input.summaryNotes.forEach((note) => {
        ensureSpace(15);
        doc.font('Helvetica').fontSize(8.5).fillColor('#334155').text(`• ${note}`, 42, y, { width: contentWidth - 12 });
        y += 13;
      });
    }

    if (input.improvementAreas?.length) {
      y += 6;
      ensureSpace(36);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0F172A').text('Areas Requiring Improvement', 36, y);
      y += 13;
      input.improvementAreas.forEach((area) => {
        ensureSpace(15);
        doc.font('Helvetica').fontSize(8.5).fillColor('#991B1B').text(`• ${area}`, 42, y, { width: contentWidth - 12 });
        y += 13;
      });
    }

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#64748B')
        .text(
          `Generated ${input.generatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST  |  Page ${i + 1} of ${pages.count}`,
          36,
          doc.page.height - 32,
          { width: contentWidth, align: 'right' },
        );
    }

    doc.end();
  });
}
