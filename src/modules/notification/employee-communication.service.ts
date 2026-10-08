import { Injectable, Logger, Optional } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import PDFDocument = require('pdfkit');
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

export type EmployeeChannel = 'EMAIL' | 'WHATSAPP' | 'BOTH';

const EMPLOYEE_EVENTS = [
  'TASK_ASSIGNED',
  'SCHEDULE_ASSIGNED',
  'SCHEDULE_UPDATED',
  'SALARY_SLIP',
  'ATTENDANCE_REPORT',
] as const;

type EmployeeEvent = (typeof EMPLOYEE_EVENTS)[number];

@Injectable()
export class EmployeeCommunicationService {
  private readonly logger = new Logger(EmployeeCommunicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly whatsappService?: WhatsappService,
  ) {}

  async notifyTaskAssigned(params: {
    employeeId: number;
    taskId: number;
    title: string;
    description?: string | null;
    customerName?: string | null;
    priority?: string | null;
    dueDate?: Date | string | null;
    assignedBy?: string | null;
    status?: string | null;
    force?: boolean;
  }) {
    const due = this.formatDate(params.dueDate);
    const name = await this.employeeName(params.employeeId);
    const text = [
      `Hi ${name},`,
      '',
      'A new task has been assigned to you.',
      '',
      `Task: ${params.title}`,
      `Customer: ${params.customerName || '—'}`,
      `Due Date: ${due}`,
      `Priority: ${params.priority || 'MEDIUM'}`,
      `Assigned By: ${params.assignedBy || 'QB Suite'}`,
      '',
      'Please open the application to view the complete task details.',
      '',
      'Regards,',
      'QB Suite',
    ].join('\n');
    return this.dispatch({
      employeeId: params.employeeId,
      eventType: 'TASK_ASSIGNED',
      identifierKey: `TASK_ASSIGNED:${params.employeeId}:${params.taskId}`,
      subject: `New Task Assigned - ${params.title}`,
      text,
      whatsappTemplate: 'employee_task_assigned',
      whatsappParams: [name, params.title, params.customerName || '-', due, params.priority || 'MEDIUM', params.assignedBy || 'QB Suite'],
      whatsappText: `Hi ${name},\n\nYou have been assigned a new task.\n\nTask: ${params.title}\nCustomer: ${params.customerName || '—'}\nDue: ${due}\nPriority: ${params.priority || 'MEDIUM'}\n\nAssigned by: ${params.assignedBy || 'QB Suite'}\n\nOpen QB Suite to view the complete details.`,
      force: params.force,
    });
  }

  async notifySchedule(params: {
    employeeId: number;
    workId: number;
    title: string;
    customerName?: string | null;
    date?: Date | string | null;
    time?: string | null;
    location?: string | null;
    notes?: string | null;
    assignedBy?: string | null;
    previousDate?: string | null;
    previousTime?: string | null;
    cancelled?: boolean;
    force?: boolean;
    channels?: EmployeeChannel;
  }) {
    const date = this.formatDate(params.date);
    const changed = Boolean(params.previousDate || params.previousTime || params.cancelled);
    const eventType: EmployeeEvent = changed ? 'SCHEDULE_UPDATED' : 'SCHEDULE_ASSIGNED';
    const stamp = `${date}|${params.time || ''}|${params.location || ''}|${params.cancelled ? 'CANCELLED' : 'ACTIVE'}`;
    const name = await this.employeeName(params.employeeId);
    const previous = params.previousDate
      ? `Previous:\n${params.previousDate}${params.previousTime ? `, ${params.previousTime}` : ''}\n\nNew:\n${date}${params.time ? `, ${params.time}` : ''}`
      : '';
    const text = [
      `Hi ${name},`,
      '',
      changed ? 'Your schedule was updated.' : 'A schedule has been assigned to you.',
      '',
      previous,
      `Date: ${date}`,
      `Time: ${params.time || '—'}`,
      `Customer: ${params.customerName || '—'}`,
      `Task: ${params.title}`,
      `Location: ${params.location || '—'}`,
      params.cancelled ? 'Status: Cancelled' : '',
      params.notes ? `Notes: ${params.notes}` : '',
      '',
      'Please check QB Suite for details.',
      '',
      'Regards,',
      'QB Suite',
    ].filter((line) => line !== undefined).join('\n');
    return this.dispatch({
      employeeId: params.employeeId,
      eventType,
      identifierKey: `${eventType}:${params.employeeId}:${params.workId}:${stamp}`,
      subject: changed ? `Schedule Updated - ${date}` : `Schedule Assigned - ${date}`,
      text,
      whatsappTemplate: changed ? 'employee_schedule_updated' : 'employee_schedule_assigned',
      whatsappParams: [name, date, params.time || '-', params.customerName || '-', params.title, params.location || '-'],
      whatsappText: `Schedule ${changed ? 'Update' : 'Assigned'}\n\nDate: ${date}\nTime: ${params.time || '—'}\nCustomer: ${params.customerName || '—'}\nTask: ${params.title}\nLocation: ${params.location || '—'}\n\nPlease check QB Suite for details.`,
      force: params.force,
      channels: params.channels,
    });
  }

  async notifySalarySlip(params: { slipId: number; force?: boolean; channels?: EmployeeChannel; customerId?: number }) {
    const slip = await this.prisma.salarySlip.findUnique({
      where: { id: params.slipId },
      include: { employee: true },
    });
    if (!slip) return { skipped: true, reason: 'SLIP_NOT_FOUND' };
    if (params.customerId && slip.customerId !== params.customerId) return { skipped: true, reason: 'FORBIDDEN' };
    const employee = slip.employee;
    const name = `${employee.firstName} ${employee.lastName}`.trim();
    const filename = `salary-slip-${employee.employeeCode}-${slip.payPeriod.replace(/\s+/g, '-')}.pdf`;
    const pdf = await this.buildSalaryPdf({
      employeeName: name,
      employeeCode: employee.employeeCode,
      payPeriod: slip.payPeriod,
      gross: slip.grossSalary,
      deductions: slip.totalDeductions,
      net: slip.netSalary,
      slipNumber: slip.slipNumber,
    });
    const text = `Hi ${name},\n\nYour salary slip for ${slip.payPeriod} is attached.\n\nSalary Slip:\n${slip.payPeriod}\n\nRegards,\nQB Suite HR`;
    return this.dispatch({
      employeeId: employee.id,
      eventType: 'SALARY_SLIP',
      identifierKey: `SALARY_SLIP:${employee.id}:${slip.id}`,
      subject: `Salary Slip - ${slip.payPeriod}`,
      text,
      whatsappTemplate: 'employee_salary_slip',
      whatsappParams: [name, slip.payPeriod],
      whatsappText: `Hi ${name},\n\nYour salary slip for ${slip.payPeriod} is attached.`,
      pdf,
      filename,
      force: params.force,
      channels: params.channels,
    });
  }

  async notifyAttendanceReport(params: { employeeId: number; year: number; month: number; force?: boolean; channels?: EmployeeChannel; customerId?: number }) {
    const employee = await this.prisma.employee.findUnique({ where: { id: params.employeeId } });
    if (!employee || employee.status !== 'ACTIVE') return { skipped: true, reason: 'EMPLOYEE_INACTIVE' };
    if (params.customerId && employee.customerId !== params.customerId) return { skipped: true, reason: 'FORBIDDEN' };
    const summary = await this.buildAttendanceSummary(employee.id, employee.customerId, params.year, params.month);
    const name = `${employee.firstName} ${employee.lastName}`.trim();
    const filename = `attendance-report-${employee.employeeCode}-${summary.monthName}-${params.year}.pdf`;
    const pdf = await this.buildAttendancePdf({
      employeeName: name,
      employeeCode: employee.employeeCode,
      summary,
    });
    const text = [
      `Hi ${name},`,
      '',
      `Please find attached your monthly attendance report for ${summary.monthName} ${params.year}.`,
      '',
      'Summary:',
      `Present: ${summary.present}`,
      `Absent: ${summary.absent}`,
      `Leave: ${summary.leave}`,
      `Attendance: ${summary.percentage}%`,
      '',
      'The detailed report is attached as a PDF.',
      '',
      'Regards,',
      'QB Suite HR',
    ].join('\n');
    return this.dispatch({
      employeeId: employee.id,
      eventType: 'ATTENDANCE_REPORT',
      identifierKey: `ATTENDANCE_REPORT:${employee.id}:${params.year}-${String(params.month).padStart(2, '0')}`,
      subject: `Monthly Attendance Report - ${summary.monthName} ${params.year}`,
      text,
      whatsappTemplate: 'employee_attendance_report',
      whatsappParams: [name, `${summary.monthName} ${params.year}`, String(summary.percentage)],
      whatsappText: `Hi ${name},\n\nYour monthly attendance report for ${summary.monthName} ${params.year} is attached.\n\nAttendance: ${summary.percentage}%`,
      pdf,
      filename,
      force: params.force,
      channels: params.channels,
    });
  }

  async sendCompletedMonthReports(now = new Date()) {
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    if (ist.getUTCDate() !== 1) return { skipped: true, reason: 'NOT_MONTH_START' };
    const monthIndex = ist.getUTCMonth();
    const year = monthIndex === 0 ? ist.getUTCFullYear() - 1 : ist.getUTCFullYear();
    const month = monthIndex === 0 ? 12 : monthIndex;
    const employees = await this.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    let sent = 0;
    for (const employee of employees) {
      try {
        const result = await this.notifyAttendanceReport({ employeeId: employee.id, year, month });
        if (!(result as any)?.skipped) sent += 1;
      } catch (err: any) {
        this.logger.warn(`[ATTENDANCE_REPORT] employeeId=${employee.id} ${err?.message}`);
      }
    }
    this.logger.log(`[ATTENDANCE_REPORT] month=${year}-${month} employees=${employees.length} attempted=${sent}`);
    return { year, month, employees: employees.length, attempted: sent };
  }

  async listHistory(employeeId: number, customerId?: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, phone: true, userId: true, customerId: true },
    });
    if (!employee || (customerId && employee.customerId !== customerId)) return { employee: null, items: [] };
    const prefix = (event: string) => ({ identifierKey: { startsWith: `${event}:${employee.id}:` } });
    const items = await this.prisma.emailLog.findMany({
      where: {
        customerId: employee.customerId,
        eventType: { in: [...EMPLOYEE_EVENTS] },
        OR: EMPLOYEE_EVENTS.map((event) => prefix(event)),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        employeeCode: employee.employeeCode,
        email: employee.email,
        whatsapp: employee.phone,
      },
      items: items.map((item) => ({
        id: item.id,
        employeeId: employee.id,
        eventType: item.eventType,
        identifierKey: item.identifierKey,
        channel: item.channel,
        recipient: item.recipientEmail,
        subject: item.subject,
        status: item.status,
        providerMessageId: item.providerMessageId,
        failureReason: item.errorMessage,
        sentAt: item.status === 'SENT' ? item.sentAt : null,
        failedAt: item.status === 'FAILED' ? item.createdAt : null,
        createdAt: item.createdAt,
      })),
    };
  }

  async resend(logId: number, channel?: EmployeeChannel, customerId?: number) {
    const log = await this.prisma.emailLog.findUnique({ where: { id: logId } });
    if (!log || !EMPLOYEE_EVENTS.includes(log.eventType as EmployeeEvent)) {
      return { success: false, message: 'Employee communication record not found' };
    }
    if (customerId && log.customerId !== customerId) {
      return { success: false, message: 'Employee communication record not found' };
    }
    const target = (channel || log.channel || 'BOTH').toUpperCase() as EmployeeChannel;
    const selected = target === 'EMAIL' || target === 'WHATSAPP' ? target : 'BOTH';
    if ((log.status === 'SENT' || log.status === 'DELIVERED') && selected !== 'BOTH' && selected === log.channel) {
      return { success: true, skipped: true, message: 'This channel was already sent.' };
    }
    const employeeId = this.employeeIdFromKey(log.identifierKey);
    if (!employeeId) return { success: false, message: 'Employee could not be resolved from this record' };
    const parts = String(log.identifierKey || '').split(':');
    if (log.eventType === 'SALARY_SLIP') {
      return this.notifySalarySlip({ slipId: Number(parts[2]), force: selected !== 'BOTH', channels: selected, customerId });
    }
    if (log.eventType === 'ATTENDANCE_REPORT') {
      const [year, month] = (parts[2] || '').split('-').map(Number);
      return this.notifyAttendanceReport({ employeeId, year, month, force: selected !== 'BOTH', channels: selected, customerId });
    }
    return this.dispatch({
      employeeId,
      eventType: log.eventType as EmployeeEvent,
      identifierKey: log.identifierKey || `RESEND:${log.id}`,
      subject: log.subject,
      text: log.renderedContent || log.subject,
      whatsappTemplate: log.eventType === 'SCHEDULE_UPDATED' ? 'employee_schedule_updated' : log.eventType === 'SCHEDULE_ASSIGNED' ? 'employee_schedule_assigned' : 'employee_task_assigned',
      whatsappText: log.renderedContent || log.subject,
      force: selected !== 'BOTH',
      channels: selected,
    });
  }

  async salarySlipFile(slipId: number, customerId?: number) {
    const slip = await this.prisma.salarySlip.findUnique({ where: { id: slipId }, include: { employee: true } });
    if (!slip || (customerId && slip.customerId !== customerId)) return null;
    const employee = slip.employee;
    const filename = `salary-slip-${employee.employeeCode}-${slip.payPeriod.replace(/\s+/g, '-')}.pdf`;
    const buffer = await this.buildSalaryPdf({
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeCode: employee.employeeCode,
      payPeriod: slip.payPeriod,
      gross: slip.grossSalary,
      deductions: slip.totalDeductions,
      net: slip.netSalary,
      slipNumber: slip.slipNumber,
    });
    return { filename, buffer };
  }

  async attendanceFile(employeeId: number, year: number, month: number, customerId?: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || (customerId && employee.customerId !== customerId)) return null;
    const summary = await this.buildAttendanceSummary(employee.id, employee.customerId, year, month);
    const filename = `attendance-report-${employee.employeeCode}-${summary.monthName}-${year}.pdf`;
    const buffer = await this.buildAttendancePdf({
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeCode: employee.employeeCode,
      summary,
    });
    return { filename, buffer };
  }

  private async dispatch(input: {
    employeeId: number;
    eventType: EmployeeEvent;
    identifierKey: string;
    subject: string;
    text: string;
    whatsappTemplate: string;
    whatsappParams?: string[];
    whatsappText: string;
    pdf?: Buffer;
    filename?: string;
    force?: boolean;
    channels?: EmployeeChannel;
  }) {
    const employee = await this.prisma.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) return { skipped: true, reason: 'EMPLOYEE_NOT_FOUND' };
    const channels = input.channels || 'BOTH';
    const emailResult = channels !== 'WHATSAPP'
      ? await this.sendEmailChannel(employee, input)
      : { skipped: true };
    const whatsappResult = channels !== 'EMAIL'
      ? await this.sendWhatsappChannel(employee, input)
      : { skipped: true };
    return { email: emailResult, whatsapp: whatsappResult };
  }

  private async alreadySent(identifierKey: string, channel: 'EMAIL' | 'WHATSAPP') {
    const existing = await this.prisma.emailLog.findFirst({
      where: { identifierKey, channel, status: { in: ['SENT', 'DELIVERED'] } },
      select: { id: true },
    });
    return Boolean(existing);
  }

  private async sendEmailChannel(employee: { id: number; customerId: number; userId: number | null; email: string }, input: {
    eventType: EmployeeEvent;
    identifierKey: string;
    subject: string;
    text: string;
    pdf?: Buffer;
    filename?: string;
    force?: boolean;
  }) {
    const email = (employee.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await this.writeLog(employee, input, 'EMAIL', email || 'missing', 'FAILED', 'Invalid or missing employee email');
      return { success: false, status: 'FAILED' };
    }
    if (!input.force && await this.alreadySent(input.identifierKey, 'EMAIL')) {
      return { success: true, skipped: true, status: 'SENT' };
    }
    if (!this.emailService) {
      await this.writeLog(employee, input, 'EMAIL', email, 'FAILED', 'Email service unavailable');
      return { success: false, status: 'FAILED' };
    }
    try {
      await this.emailService.sendEmail({
        to: email,
        subject: input.subject,
        text: input.text,
        html: input.text.replace(/\n/g, '<br/>'),
        eventType: input.eventType,
        identifierKey: input.identifierKey,
        recordType: 'employee',
        recordId: employee.id,
        channel: 'EMAIL',
        skipEmailLog: true,
        attachments: input.pdf
          ? [{ filename: input.filename || 'document.pdf', content: input.pdf, contentType: 'application/pdf' }]
          : undefined,
      }, { id: employee.userId || undefined, customerId: employee.customerId });
      await this.writeLog(employee, input, 'EMAIL', email, 'SENT', null);
      return { success: true, status: 'SENT' };
    } catch (err: any) {
      await this.writeLog(employee, input, 'EMAIL', email, 'FAILED', err?.message || 'Email failed');
      return { success: false, status: 'FAILED' };
    }
  }

  private async sendWhatsappChannel(employee: { id: number; customerId: number; userId: number | null; phone: string | null }, input: {
    eventType: EmployeeEvent;
    identifierKey: string;
    subject: string;
    text: string;
    whatsappTemplate: string;
    whatsappParams?: string[];
    whatsappText: string;
    pdf?: Buffer;
    filename?: string;
    force?: boolean;
  }) {
    const phone = (employee.phone || '').trim();
    if (!phone) {
      await this.writeLog(employee, input, 'WHATSAPP', 'missing', 'FAILED', 'Employee WhatsApp/mobile number is missing');
      return { success: false, status: 'FAILED' };
    }
    if (!input.force && await this.alreadySent(input.identifierKey, 'WHATSAPP')) {
      return { success: true, skipped: true, status: 'SENT' };
    }
    if (!this.whatsappService) {
      await this.writeLog(employee, input, 'WHATSAPP', phone, 'FAILED', 'WhatsApp service unavailable');
      return { success: false, status: 'FAILED' };
    }
    try {
      let template: any = { success: false };
      try {
        template = await this.whatsappService.sendTemplate(
          phone,
          input.whatsappTemplate,
          (input.whatsappParams || []).map((text) => ({ type: 'text' as const, text: text || '-' })),
          'en_US',
          input.whatsappText,
          input.eventType,
          employee.customerId,
          employee.userId || undefined,
        );
      } catch (err: any) {
        template = { success: false, message: err?.message || 'WhatsApp template failed' };
      }
      let document: any = null;
      if (input.pdf) {
        try {
          document = await this.whatsappService.sendDocumentMessage({
            to: phone,
            pdfBuffer: input.pdf,
            filename: input.filename || 'document.pdf',
            caption: input.whatsappText,
            stageName: input.eventType,
          });
        } catch (err: any) {
          document = { success: false, message: err?.message || 'WhatsApp document failed' };
        }
      }
      const accepted = input.pdf ? Boolean(document?.success) : Boolean(template?.success);
      const messageId = document?.messageId || template?.messageId;
      if (!accepted) {
        const reason = document?.message || document?.reason || template?.message || template?.reason || 'WhatsApp was not accepted';
        await this.writeLog(employee, input, 'WHATSAPP', phone, 'FAILED', reason, messageId);
        return { success: false, status: 'FAILED' };
      }
      await this.writeLog(employee, input, 'WHATSAPP', phone, 'SENT', null, messageId);
      return { success: true, status: 'SENT', providerMessageId: messageId };
    } catch (err: any) {
      await this.writeLog(employee, input, 'WHATSAPP', phone, 'FAILED', err?.message || 'WhatsApp failed');
      return { success: false, status: 'FAILED' };
    }
  }

  private async writeLog(
    employee: { id: number; customerId: number; userId: number | null },
    input: { eventType: string; identifierKey: string; subject: string; text: string },
    channel: 'EMAIL' | 'WHATSAPP',
    recipient: string,
    status: 'SENT' | 'FAILED',
    errorMessage: string | null,
    providerMessageId?: string,
  ) {
    try {
      await this.prisma.emailLog.create({
        data: {
          customerId: employee.customerId,
          userId: employee.userId || undefined,
          channel,
          identifierKey: input.identifierKey,
          recipientEmail: recipient || 'missing',
          subject: input.subject,
          renderedContent: input.text,
          eventType: input.eventType,
          status,
          errorMessage,
          providerMessageId: providerMessageId || null,
        },
      });
    } catch (err: any) {
      this.logger.warn(`[EMPLOYEE_COMM] history write failed: ${err?.message}`);
    }
  }

  private async employeeName(employeeId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true },
    });
    return employee ? `${employee.firstName} ${employee.lastName}`.trim() : 'Employee';
  }

  private employeeIdFromKey(key?: string | null) {
    if (!key) return null;
    const parts = key.split(':');
    const id = Number(parts[1]);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  private formatDate(value?: Date | string | null) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  }

  private async buildAttendanceSummary(employeeId: number, customerId: number, year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    const rows = await this.prisma.attendance.findMany({
      where: { employeeId, customerId, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    });
    const monthName = start.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    let present = 0;
    let absent = 0;
    let halfDay = 0;
    let leave = 0;
    let wfh = 0;
    let late = 0;
    let early = 0;
    let hours = 0;
    let overtime = 0;
    const days = rows.map((row) => {
      const worked = Number(row.workingHours || 0);
      hours += worked;
      if (worked > 8) overtime += worked - 8;
      if (row.isLate) late += 1;
      if (row.status === AttendanceStatus.PRESENT || row.status === AttendanceStatus.LATE) present += 1;
      if (row.status === AttendanceStatus.ABSENT) absent += 1;
      if (row.status === AttendanceStatus.HALF_DAY) halfDay += 1;
      if (row.status === AttendanceStatus.LEAVE) leave += 1;
      if (row.status === AttendanceStatus.REMOTE || (row.workMode || '').toUpperCase().includes('WFH')) wfh += 1;
      if (row.punchOut && worked > 0 && worked < 8 && row.status === AttendanceStatus.PRESENT) early += 1;
      return row;
    });
    const workingDays = days.length || new Date(year, month, 0).getDate();
    const attended = present + halfDay * 0.5;
    const percentage = workingDays > 0 ? Math.round((attended / workingDays) * 1000) / 10 : 0;
    return { monthName, year, present, absent, halfDay, leave, wfh, late, early, hours: Math.round(hours * 10) / 10, overtime: Math.round(overtime * 10) / 10, workingDays, percentage, days };
  }

  private buildSalaryPdf(data: {
    employeeName: string;
    employeeCode: string;
    payPeriod: string;
    gross: number;
    deductions: number;
    net: number;
    slipNumber: string;
  }) {
    return this.renderPdf((doc) => {
      doc.fontSize(18).text('QB Suite', { align: 'left' });
      doc.fontSize(11).fillColor('#166534').text('SALARY SLIP');
      doc.moveDown();
      doc.fillColor('#111').fontSize(12);
      doc.text(`Employee: ${data.employeeName}`);
      doc.text(`Employee Code: ${data.employeeCode}`);
      doc.text(`Period: ${data.payPeriod}`);
      doc.text(`Slip: ${data.slipNumber}`);
      doc.moveDown();
      doc.text(`Gross Salary: ₹${data.gross}`);
      doc.text(`Deductions: ₹${data.deductions}`);
      doc.text(`Net Salary: ₹${data.net}`);
    });
  }

  private buildAttendancePdf(data: {
    employeeName: string;
    employeeCode: string;
    summary: Awaited<ReturnType<EmployeeCommunicationService['buildAttendanceSummary']>>;
  }) {
    const summary = data.summary;
    return this.renderPdf((doc) => {
      doc.fontSize(18).text('QB Suite');
      doc.fontSize(11).fillColor('#166534').text('MONTHLY ATTENDANCE REPORT');
      doc.moveDown();
      doc.fillColor('#111').fontSize(11);
      doc.text(`Employee: ${data.employeeName}`);
      doc.text(`Employee Code: ${data.employeeCode}`);
      doc.text(`Month: ${summary.monthName} ${summary.year}`);
      doc.moveDown();
      doc.text(`Working days recorded: ${summary.workingDays}`);
      doc.text(`Present: ${summary.present}    Absent: ${summary.absent}    Half day: ${summary.halfDay}`);
      doc.text(`Leave: ${summary.leave}    WFH: ${summary.wfh}    Late: ${summary.late}    Early leave: ${summary.early}`);
      doc.text(`Total hours: ${summary.hours}    Overtime: ${summary.overtime}    Attendance: ${summary.percentage}%`);
      doc.moveDown();
      doc.fontSize(10).text('Date | In | Out | Hours | Status');
      for (const day of summary.days) {
        const date = new Date(day.date).toISOString().slice(0, 10);
        const inn = day.punchIn ? new Date(day.punchIn).toISOString().slice(11, 16) : '-';
        const out = day.punchOut ? new Date(day.punchOut).toISOString().slice(11, 16) : '-';
        doc.text(`${date} | ${inn} | ${out} | ${day.workingHours || 0} | ${day.status}${day.isLate ? ' LATE' : ''}`);
      }
    });
  }

  private renderPdf(draw: (doc: any) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      draw(doc);
      doc.end();
    });
  }
}
