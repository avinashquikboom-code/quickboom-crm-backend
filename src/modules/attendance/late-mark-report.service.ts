import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { dateToMinutesInIST } from '../payroll/salary-calculation';
import { getBusinessDate, getBusinessDayRange } from '../../common/utils/timezone.util';
import {
  StoredLateMark,
  dueReport,
  reportHtml,
  summarizeLateMarks,
  toCsv,
  addDays,
  weekContaining,
} from './late-mark-report.logic';

const DEFAULT_SETTINGS = {
  timezone: 'Asia/Kolkata',
  weekStartsOn: 1,
  dailyEnabled: false,
  weeklyEnabled: false,
  monthlyEnabled: false,
  dailySendHour: 23,
  dailySendMinute: 0,
  weeklySendHour: 9,
  weeklySendMinute: 0,
  monthlySendHour: 9,
  monthlySendMinute: 0,
  recipients: '',
  cc: '',
  includeEmployeeDetails: true,
  includeCsv: true,
};

@Injectable()
export class LateMarkReportService {
  private readonly logger = new Logger(LateMarkReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  async settings(customerId: number) {
    const row = await this.prisma.lateMarkReportSetting.findUnique({ where: { customerId } });
    return row || { customerId, ...DEFAULT_SETTINGS };
  }

  async saveSettings(customerId: number, body: Record<string, unknown>) {
    const data = this.cleanSettings(body);
    return this.prisma.lateMarkReportSetting.upsert({
      where: { customerId },
      create: { customerId, ...DEFAULT_SETTINGS, ...data },
      update: data,
    });
  }

  async daily(customerId: number, date: string, filters: ReportFilters = {}) {
    const range = getBusinessDayRange(date, (await this.settings(customerId)).timezone);
    const summary = await this.summary(customerId, range.start, range.end, filters);
    const present = await this.prisma.attendance.count({
      where: { customerId, date: { gte: range.start, lte: range.end }, punchIn: { not: null } },
    });
    const scheduled = await this.scheduledEmployees(customerId, range.dateStr);
    const rate = summary.rows[0]?.rate ?? 0;
    return {
      date: range.dateStr,
      scheduledEmployees: scheduled,
      presentEmployees: present,
      lateEmployees: summary.employeesAffected,
      configuredRate: rate,
      ...summary,
    };
  }

  async weekly(customerId: number, date: string, filters: ReportFilters = {}) {
    const settings = await this.settings(customerId);
    const anchor = getBusinessDayRange(date, settings.timezone).dateStr;
    const week = weekContaining(anchor, settings.weekStartsOn);
    const bounds = this.bounds(week.start, week.end, settings.timezone);
    const summary = await this.summary(customerId, bounds.start, bounds.end, filters);
    return { weekStart: week.start, weekEnd: week.end, ...summary };
  }

  async monthly(customerId: number, year: number, month: number, filters: ReportFilters = {}) {
    const settings = await this.settings(customerId);
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(Date.UTC(year, month, 0));
    const end = endDate.toISOString().slice(0, 10);
    const bounds = this.bounds(start, end, settings.timezone);
    const summary = await this.summary(customerId, bounds.start, bounds.end, filters);
    const eligible = await this.prisma.attendance.count({
      where: { customerId, date: { gte: bounds.start, lte: bounds.end }, punchIn: { not: null } },
    });
    return {
      year,
      month,
      workingDays: summary.byDate.length,
      eligibleAttendance: eligible,
      ...summary,
    };
  }

  async employee(customerId: number, employeeId: number, from: string, to: string) {
    const settings = await this.settings(customerId);
    const bounds = this.bounds(from, to, settings.timezone);
    return this.summary(customerId, bounds.start, bounds.end, { employeeId });
  }

  async mine(customerId: number, employeeId: number, today: string) {
    const settings = await this.settings(customerId);
    const week = weekContaining(today, settings.weekStartsOn);
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const [day, weekly, monthly] = await Promise.all([
      this.summary(customerId, ...this.pair(today, today, settings.timezone), { employeeId }),
      this.summary(customerId, ...this.pair(week.start, week.end, settings.timezone), { employeeId }),
      this.summary(customerId, ...this.pair(monthStart, monthEnd, settings.timezone), { employeeId }),
    ]);
    return {
      todayLateMinutes: day.totalLateMinutes,
      todayDeduction: day.totalDeduction,
      weeklyLateMinutes: weekly.totalLateMinutes,
      weeklyDeduction: weekly.totalDeduction,
      monthlyLateDays: monthly.totalLateMarks,
      monthlyLateMinutes: monthly.totalLateMinutes,
      monthlyDeduction: monthly.totalDeduction,
    };
  }

  async history(customerId: number) {
    return this.prisma.lateMarkReportDelivery.findMany({
      where: { customerId },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }

  async preview(customerId: number, kind: 'DAILY' | 'WEEKLY' | 'MONTHLY', date: string) {
    const report = await this.reportFor(customerId, kind, date);
    return { subject: report.subject, html: report.html };
  }

  async csv(customerId: number, kind: 'DAILY' | 'WEEKLY' | 'MONTHLY', date: string, year?: number, month?: number) {
    const report = await this.reportFor(customerId, kind, date, year, month);
    return { filename: `${kind.toLowerCase()}-late-marks.csv`, csv: toCsv(report.summary.rows) };
  }

  async retry(customerId: number, id: number) {
    const row = await this.prisma.lateMarkReportDelivery.findFirst({ where: { id, customerId } });
    if (!row) throw new NotFoundException('Report delivery was not found.');
    if (row.status === 'SENT') return row;
    await this.prisma.lateMarkReportDelivery.update({ where: { id }, data: { status: 'RETRY_PENDING', failureReason: null } });
    return this.deliverExisting(row.id);
  }

  async runDue(now = new Date()) {
    const settings = await this.prisma.lateMarkReportSetting.findMany({
      where: { OR: [{ dailyEnabled: true }, { weeklyEnabled: true }, { monthlyEnabled: true }] },
    });
    for (const setting of settings) {
      for (const kind of ['DAILY', 'WEEKLY', 'MONTHLY'] as const) {
        const due = dueReport(now, setting, kind);
        if (!due.due) continue;
        await this.deliver(setting.customerId, kind, due.periodKey, due.label, due.start, due.end).catch((error: any) => {
          this.logger.error(`Late mark ${kind} report failed for customer ${setting.customerId}: ${error?.message}`);
        });
      }
    }
  }

  private async deliver(customerId: number, kind: 'DAILY' | 'WEEKLY' | 'MONTHLY', periodKey: string, label: string, start: string, end: string) {
    const existing = await this.prisma.lateMarkReportDelivery.findUnique({
      where: { customerId_kind_periodKey: { customerId, kind, periodKey } },
    });
    if (existing && ['SENT', 'PROCESSING'].includes(existing.status)) return existing;
    const created = existing
      ? await this.prisma.lateMarkReportDelivery.update({ where: { id: existing.id }, data: { status: 'PROCESSING', failureReason: null } })
      : await this.prisma.lateMarkReportDelivery.create({
          data: { customerId, kind, periodKey, periodLabel: label, status: 'PROCESSING' },
        }).catch(async (error: any) => {
          if (error?.code === 'P2002') return this.prisma.lateMarkReportDelivery.findUnique({ where: { customerId_kind_periodKey: { customerId, kind, periodKey } } });
          throw error;
        });
    if (!created || created.status === 'SENT') return created;
    return this.sendDelivery(created.id, customerId, kind, label, start, end);
  }

  private async deliverExisting(id: number) {
    const row = await this.prisma.lateMarkReportDelivery.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Report delivery was not found.');
    const [start, end] = this.deliveryBounds(row.kind, row.periodKey, row.periodLabel);
    return this.sendDelivery(row.id, row.customerId, row.kind as any, row.periodLabel, start, end);
  }

  private async sendDelivery(id: number, customerId: number, kind: string, label: string, start: string, end: string) {
    const settings = await this.settings(customerId);
    const recipients = this.emails(settings.recipients);
    if (!recipients.length) {
      return this.prisma.lateMarkReportDelivery.update({
        where: { id },
        data: { status: 'FAILED', failureReason: 'No authorized recipient email is configured.' },
      });
    }
    const bounds = this.bounds(start, end, settings.timezone);
    const summary = await this.summary(customerId, bounds.start, bounds.end);
    const subject = this.subject(kind, label);
    const html = reportHtml(subject, settings.includeEmployeeDetails ? summary : { ...summary, byEmployee: [] }, [label]);
    const csv = toCsv(summary.rows);
    try {
      if (!this.emailService) throw new Error('Email service is not available.');
      for (const recipient of recipients) {
        await this.emailService.sendEmail({
          to: recipient,
          cc: this.emails(settings.cc),
          subject,
          html,
          recordType: 'customer',
          recordId: customerId,
          attachments: settings.includeCsv ? [{ filename: `${kind.toLowerCase()}-late-marks.csv`, content: csv }] : undefined,
        });
      }
      return this.prisma.lateMarkReportDelivery.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date(), recipients: recipients.join(', '), failureReason: null, attachmentName: settings.includeCsv ? `${kind.toLowerCase()}-late-marks.csv` : null },
      });
    } catch (error: any) {
      return this.prisma.lateMarkReportDelivery.update({
        where: { id },
        data: { status: 'RETRY_PENDING', failureReason: error?.message || 'Email provider did not accept the message.' },
      });
    }
  }

  private async reportFor(customerId: number, kind: 'DAILY' | 'WEEKLY' | 'MONTHLY', date: string, year?: number, month?: number) {
    const settings = await this.settings(customerId);
    let summary;
    let label = date;
    if (kind === 'DAILY') {
      const report = await this.daily(customerId, date);
      summary = report;
      label = report.date;
    } else if (kind === 'WEEKLY') {
      const report = await this.weekly(customerId, date);
      summary = report;
      label = `${report.weekStart} to ${report.weekEnd}`;
    } else {
      const now = getBusinessDayRange(date, settings.timezone).dateStr;
      const report = await this.monthly(customerId, year || Number(now.slice(0, 4)), month || Number(now.slice(5, 7)));
      summary = report;
      label = `${report.month}/${report.year}`;
    }
    const subject = this.subject(kind, label);
    return { subject, html: reportHtml(subject, summary, [label]), summary };
  }

  private async summary(customerId: number, start: Date, end: Date, filters: ReportFilters = {}) {
    const rows = await this.prisma.attendance.findMany({
      where: {
        customerId,
        date: { gte: start, lte: end },
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        OR: [{ isLate: true }, { lateMinutes: { gt: 0 } }, { lateDeduction: { gt: 0 } }],
      },
      include: { employee: { include: { department: true, shift: true } } },
      orderBy: { id: 'asc' },
    });
    const mapped = rows.map((row) => this.mapRow(row)).filter((row) => this.matches(row, filters));
    return summarizeLateMarks(mapped);
  }

  private mapRow(row: any): StoredLateMark {
    const punch = row.punchIn ? dateToMinutesInIST(row.punchIn).timeStr : null;
    const shift = row.employee?.shift;
    return {
      id: row.id,
      employeeId: row.employeeId,
      employeeCode: row.employee?.employeeCode || `EMP-${row.employeeId}`,
      employeeName: `${row.employee?.firstName || ''} ${row.employee?.lastName || ''}`.trim() || 'Employee',
      department: row.employee?.department?.name || 'General',
      shiftName: shift?.name || 'Assigned shift',
      shiftStart: shift?.startTime || '',
      shiftEnd: shift?.endTime || '',
      punchIn: punch,
      date: row.date ? getBusinessDate(new Date(row.date), 'Asia/Kolkata') : '',
      status: String(row.status || ''),
      lateMinutes: Number(row.lateMinutes) || 0,
      graceMinutes: Number(row.lateGraceMinutes) || 0,
      rate: Number(row.lateRatePerMinute) || 0,
      deduction: Number(row.lateDeduction) || 0,
    };
  }

  private matches(row: StoredLateMark, filters: ReportFilters) {
    const search = (filters.search || '').trim().toLowerCase();
    const department = (filters.department || '').trim().toLowerCase();
    const searchOk = !search || `${row.employeeName} ${row.employeeCode}`.toLowerCase().includes(search);
    const departmentOk = !department || department === 'all' || row.department.toLowerCase() === department;
    return searchOk && departmentOk;
  }

  private async scheduledEmployees(customerId: number, date: string) {
    const employees = await this.prisma.employee.findMany({
      where: { customerId, status: 'ACTIVE' },
      select: { shift: { select: { workingDays: true } } },
    });
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${date}T00:00:00.000Z`).getUTCDay()];
    return employees.filter((employee) => {
      const days = employee.shift?.workingDays || [];
      if (!days.length) return !['Saturday', 'Sunday'].includes(weekday);
      return days.some((day) => day.toLowerCase() === weekday.toLowerCase());
    }).length;
  }

  private deliveryBounds(kind: string, periodKey: string, periodLabel: string): [string, string] {
    if (kind === 'MONTHLY') {
      const [year, month] = periodKey.split('-').map(Number);
      const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      return [`${periodKey}-01`, end];
    }
    if (kind === 'WEEKLY') return [periodKey, addDays(periodKey, 6)];
    return [periodLabel, periodLabel];
  }

  private bounds(start: string, end: string, timezone: string) {
    return { start: getBusinessDayRange(start, timezone).start, end: getBusinessDayRange(end, timezone).end };
  }

  private pair(start: string, end: string, timezone: string): [Date, Date] {
    const bounds = this.bounds(start, end, timezone);
    return [bounds.start, bounds.end];
  }

  private cleanSettings(body: Record<string, unknown>) {
    const hour = (value: unknown, fallback: number) => Math.min(23, Math.max(0, Number(value ?? fallback) || 0));
    const minute = (value: unknown, fallback: number) => Math.min(59, Math.max(0, Number(value ?? fallback) || 0));
    return {
      timezone: String(body.timezone || DEFAULT_SETTINGS.timezone),
      weekStartsOn: Math.min(6, Math.max(0, Number(body.weekStartsOn ?? 1) || 0)),
      dailyEnabled: Boolean(body.dailyEnabled),
      weeklyEnabled: Boolean(body.weeklyEnabled),
      monthlyEnabled: Boolean(body.monthlyEnabled),
      dailySendHour: hour(body.dailySendHour, 23),
      dailySendMinute: minute(body.dailySendMinute, 0),
      weeklySendHour: hour(body.weeklySendHour, 9),
      weeklySendMinute: minute(body.weeklySendMinute, 0),
      monthlySendHour: hour(body.monthlySendHour, 9),
      monthlySendMinute: minute(body.monthlySendMinute, 0),
      recipients: String(body.recipients || ''),
      cc: String(body.cc || ''),
      includeEmployeeDetails: body.includeEmployeeDetails !== false,
      includeCsv: body.includeCsv !== false,
    };
  }

  private emails(value: string) {
    return value.split(/[,;\s]+/).map((item) => item.trim()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
  }

  private subject(kind: string, label: string) {
    if (kind === 'DAILY') return `Daily Late Mark Report – ${label} – QB Suite`;
    if (kind === 'WEEKLY') return `Weekly Late Mark Report – ${label} – QB Suite`;
    return `Monthly Late Mark Report – ${label} – QB Suite`;
  }
}

interface ReportFilters {
  search?: string;
  department?: string;
  employeeId?: number;
}

export function assertLateReportPeriod(date?: string) {
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Use a YYYY-MM-DD date.');
}
