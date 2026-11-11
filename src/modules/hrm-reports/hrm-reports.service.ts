import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { isUserAdmin } from '../../common/utils/role.util';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PayrollService } from '../payroll/payroll.service';
import { S3Service } from '../s3/s3.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { buildAttendanceReport } from './attendance-report.calculator';
import { commissionInPeriod, presentCommission, summarizeCommissions } from './commission-report.calculator';
import { renderCommissionReportPdf } from './commission-report.pdf';
import { isUnpaidLeave, leaveBalanceLine, overlapLeaveDays } from './leave-report.calculator';
import { renderReportPdf } from './report-pdf';
import { calculateEmployeeSalaryReport } from './salary-report.calculator';
import { renderSalaryReportPdf } from './salary-report.pdf';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

@Injectable()
export class HrmReportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HrmReportsService.name);
  private timer: NodeJS.Timeout | null = null;
  private working = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly whatsappService?: WhatsappService,
    @Optional() private readonly s3Service?: S3Service,
    @Optional() private readonly payrollService?: PayrollService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.logger.warn(`HRM report tick failed: ${error?.message}`));
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async customerId(value?: number | string) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    const customer = await this.prisma.customer.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
    return customer?.id || 1;
  }

  private istParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
    return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') };
  }

  private periodClosed(year: number, month: number, graceHours: number, deliveryTime: string) {
    const now = this.istParts();
    const lastDay = new Date(year, month, 0).getDate();
    const [hour, minute] = deliveryTime.split(':').map((part) => Number(part) || 0);
    const readyMinutes = (hour * 60 + minute) + graceHours * 60;
    if (now.year > year || (now.year === year && now.month > month)) return true;
    if (now.year === year && now.month === month && now.day === lastDay) {
      return now.hour * 60 + now.minute >= readyMinutes;
    }
    return false;
  }

  async getSettings(customerValue?: number | string) {
    const customerId = await this.customerId(customerValue);
    return this.prisma.hrmReportSetting.upsert({
      where: { customerId },
      update: {},
      create: { customerId, updatedAt: new Date() },
    });
  }

  async updateSettings(customerValue: number | string | undefined, body: Record<string, unknown>) {
    const customerId = await this.customerId(customerValue);
    const data = {
      attendanceEnabled: body.attendanceEnabled !== false,
      leaveEnabled: body.leaveEnabled !== false,
      salaryEnabled: body.salaryEnabled !== false,
      commissionEnabled: body.commissionEnabled !== false,
      emailEnabled: body.emailEnabled !== false,
      whatsappEnabled: body.whatsappEnabled !== false,
      deliveryTime: String(body.deliveryTime || '18:30'),
      graceHours: Math.max(0, Number(body.graceHours ?? 2)),
      maxAttempts: Math.min(5, Math.max(1, Number(body.maxAttempts ?? 5))),
      updatedAt: new Date(),
    };
    return this.prisma.hrmReportSetting.upsert({ where: { customerId }, update: data, create: { customerId, ...data } });
  }

  async dashboard(customerValue: number | string | undefined, query: Record<string, string | undefined>) {
    const customerId = await this.customerId(customerValue);
    const year = Number(query.year) || this.istParts().year;
    const month = Number(query.month) || this.istParts().month;
    const [employees, reports, deliveries, cycle, commission] = await Promise.all([
      this.prisma.employee.count({ where: { customerId, status: 'ACTIVE' } }),
      this.prisma.hrmEmployeeMonthlyReport.findMany({ where: this.reportWhere(customerId, year, month, query) }),
      this.prisma.hrmNotificationDelivery.findMany({ where: { customerId, createdAt: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) } } }),
      this.openCycle(customerId, year, month),
      this.commissionSummary(customerId, year, month, query),
    ]);
    const count = (status: string) => deliveries.filter((row) => row.status === status).length;
    return {
      totalEmployees: employees,
      reportsGenerated: reports.filter((row) => row.status === 'GENERATED' || row.status === 'COMPLETED').length,
      reportsPending: reports.filter((row) => row.status === 'PENDING' || row.status === 'GENERATING').length,
      emailDelivered: deliveries.filter((row) => row.channel === 'EMAIL' && ['SENT', 'DELIVERED', 'READ'].includes(row.status)).length,
      whatsappDelivered: deliveries.filter((row) => row.channel === 'WHATSAPP' && ['SENT', 'DELIVERED', 'READ'].includes(row.status)).length,
      failedDeliveries: count('FAILED'),
      monthlyAttendanceReports: reports.filter((row) => row.reportType === 'ATTENDANCE').length,
      monthlyLeaveReports: reports.filter((row) => row.reportType === 'LEAVE_BALANCE').length,
      monthlySalaryReports: reports.filter((row) => row.reportType === 'SALARY_SUMMARY').length,
      monthlyCommissionReports: reports.filter((row) => row.reportType === 'COMMISSION').length,
      cycle,
      commission,
      rows: await this.rows(customerId, year, month, query),
    };
  }

  private reportWhere(customerId: number, year: number, month: number, query: Record<string, string | undefined>) {
    return {
      customerId,
      year,
      month,
      ...(query.reportType ? { reportType: query.reportType as never } : {}),
      ...(query.employeeId ? { employeeId: Number(query.employeeId) } : {}),
    };
  }

  async rows(customerId: number, year: number, month: number, query: Record<string, string | undefined>) {
    const employees = await this.prisma.employee.findMany({
      where: {
        customerId,
        status: 'ACTIVE',
        ...(query.departmentId ? { departmentId: Number(query.departmentId) } : {}),
        ...(query.designationId ? { designationId: Number(query.designationId) } : {}),
        ...(query.employeeId ? { id: Number(query.employeeId) } : {}),
      },
      include: { department: true, designation: true },
      orderBy: { employeeCode: 'asc' },
      take: 200,
    });
    const reports = await this.prisma.hrmEmployeeMonthlyReport.findMany({ where: { customerId, year, month, employeeId: { in: employees.map((employee) => employee.id) } } });
    const deliveries = await this.prisma.hrmNotificationDelivery.findMany({ where: { customerId, employeeId: { in: employees.map((employee) => employee.id) } } });
    return employees.map((employee) => {
      const attendance = reports.find((row) => row.employeeId === employee.id && row.reportType === 'ATTENDANCE');
      const leave = reports.find((row) => row.employeeId === employee.id && row.reportType === 'LEAVE_BALANCE');
      const salary = reports.find((row) => row.employeeId === employee.id && row.reportType === 'SALARY_SUMMARY');
      const commission = reports.find((row) => row.employeeId === employee.id && row.reportType === 'COMMISSION');
      const mine = deliveries.filter((row) => row.employeeId === employee.id);
      const latest = (channel: 'EMAIL' | 'WHATSAPP') => mine.filter((row) => row.channel === channel).sort((a, b) => b.id - a.id)[0];
      const email = latest('EMAIL');
      const whatsapp = latest('WHATSAPP');
      return {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        department: employee.department?.name || '—',
        designation: employee.designation?.name || '—',
        attendanceStatus: attendance?.status || 'PENDING',
        leaveStatus: leave?.status || 'PENDING',
        salaryStatus: salary?.status || 'PENDING',
        commissionStatus: commission?.status || 'PENDING',
        isProvisional: salary?.isProvisional ?? ((salary?.summary as any)?.isProvisional ?? false),
        netPayable: (salary?.summary as any)?.netPayable ?? null,
        payrollStatus: (salary?.summary as any)?.payrollStatus ?? null,
        salaryFileName: salary?.fileName || null,
        emailStatus: email?.status || 'PENDING',
        whatsappStatus: whatsapp?.status || 'PENDING',
        emailDeliveryId: email?.id || null,
        whatsappDeliveryId: whatsapp?.id || null,
        generatedAt: attendance?.generatedAt || leave?.generatedAt || salary?.generatedAt || null,
        lastAttemptAt: email?.lastAttemptAt || whatsapp?.lastAttemptAt || null,
        attendanceReportId: attendance?.id || null,
        leaveReportId: leave?.id || null,
        salaryReportId: salary?.id || null,
        commissionReportId: commission?.id || null,
      };
    }).filter((row) => {
      if (query.deliveryStatus && row.emailStatus !== query.deliveryStatus && row.whatsappStatus !== query.deliveryStatus) return false;
      if (query.channel === 'EMAIL' && row.emailStatus === 'PENDING' && query.deliveryStatus) return row.emailStatus === query.deliveryStatus;
      return true;
    });
  }

  async generate(customerValue: number | string | undefined, body: Record<string, unknown>) {
    const customerId = await this.customerId(customerValue);
    const settings = await this.getSettings(customerId);
    const now = this.istParts();
    const year = Number(body.year || now.year);
    const month = Number(body.month || now.month);
    if (!this.periodClosed(year, month, settings.graceHours, settings.deliveryTime)) {
      throw new BadRequestException('Reports can be generated only after the month ends and the attendance finalization grace period has passed.');
    }
    const key = `monthly:${customerId}:${year}:${month}`;
    const existing = await this.prisma.hrmMonthlyReportRun.findUnique({ where: { idempotencyKey: key } });
    if (existing && body.force !== true && existing.status === 'COMPLETED') {
      return { success: true, message: 'This monthly report batch was already completed.', data: existing };
    }
    const run = existing || await this.prisma.hrmMonthlyReportRun.create({
      data: { customerId, year, month, idempotencyKey: key, status: 'PENDING', updatedAt: new Date() },
    });
    const outboxKey = `generate:${run.id}:${body.employeeIds || 'all'}:${body.send === false ? 'store' : 'send'}`;
    await this.prisma.hrmNotificationOutbox.upsert({
      where: { idempotencyKey: outboxKey },
      update: {},
      create: {
        customerId,
        eventType: 'MONTHLY_GENERATE',
        idempotencyKey: outboxKey,
        payload: { runId: run.id, year, month, employeeIds: body.employeeIds || null, departmentId: body.departmentId || null, types: body.types || ['ATTENDANCE', 'LEAVE_BALANCE', 'SALARY_SUMMARY', 'COMMISSION'], channels: body.channels || ['EMAIL', 'WHATSAPP'], send: body.send !== false } as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
    await this.processOutbox(10);
    return { success: true, message: 'Monthly report job queued.', data: run };
  }

  async enqueueLeaveDecision(customerId: number, leave: { id: number; employeeId: number; status: string; days?: number; fromDate?: Date; toDate?: Date; rejectionReason?: string | null; leaveType?: { name?: string } | null }, actorName: string) {
    const kind = leave.status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED';
    const key = `leave:${customerId}:${leave.id}:${kind}`;
    await this.prisma.hrmNotificationOutbox.upsert({
      where: { idempotencyKey: key },
      update: {},
      create: {
        customerId,
        eventType: kind,
        idempotencyKey: key,
        payload: {
          leaveRequestId: leave.id,
          employeeId: leave.employeeId,
          leaveType: leave.leaveType?.name || 'Leave',
          fromDate: leave.fromDate,
          toDate: leave.toDate,
          days: leave.days,
          status: leave.status,
          actorName,
          reason: leave.rejectionReason || '',
        },
        updatedAt: new Date(),
      },
    });
    this.processOutbox(5).catch((error) => this.logger.warn(`Leave notice failed: ${error?.message}`));
  }

  async processOutbox(limit = 5) {
    if (this.working) return;
    this.working = true;
    try {
      const jobs = await this.prisma.hrmNotificationOutbox.findMany({
        where: { status: 'PENDING', availableAt: { lte: new Date() } },
        orderBy: { id: 'asc' },
        take: limit,
      });
      for (const job of jobs) {
        const claimed = await this.prisma.hrmNotificationOutbox.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'PROCESSING', attemptCount: { increment: 1 } } });
        if (!claimed.count) continue;
        try {
          if (job.eventType === 'MONTHLY_GENERATE') await this.runMonthly(job.customerId, job.payload as Record<string, unknown>);
          else if (job.eventType === 'RETRY_DELIVERY') await this.retryDelivery(job.customerId, Number((job.payload as { deliveryId?: number }).deliveryId));
          else await this.sendLeaveNotice(job.customerId, job.payload as Record<string, unknown>, job.eventType);
          await this.prisma.hrmNotificationOutbox.update({ where: { id: job.id }, data: { status: 'SENT' } });
        } catch (error) {
          const attempts = job.attemptCount + 1;
          const failed = attempts >= 5;
          await this.prisma.hrmNotificationOutbox.update({
            where: { id: job.id },
            data: {
              status: failed ? 'FAILED' : 'PENDING',
              lastError: error instanceof Error ? error.message : 'Report job failed',
              availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
            },
          });
        }
      }
    } finally {
      this.working = false;
    }
  }

  private async runMonthly(customerId: number, payload: Record<string, unknown>) {
    const year = Number(payload.year);
    const month = Number(payload.month);
    const settings = await this.getSettings(customerId);
    let types = (payload.types as string[]) || ['ATTENDANCE', 'LEAVE_BALANCE', 'SALARY_SUMMARY', 'COMMISSION'];
    if (settings.attendanceEnabled === false) types = types.filter((type) => type !== 'ATTENDANCE');
    if (settings.leaveEnabled === false) types = types.filter((type) => type !== 'LEAVE_BALANCE');
    if (settings.salaryEnabled === false) types = types.filter((type) => type !== 'SALARY_SUMMARY');
    if (settings.commissionEnabled === false) types = types.filter((type) => type !== 'COMMISSION');
    await this.openCycle(customerId, year, month);
    let payrollStatus = 'OPEN';
    try {
      const payroll = await this.payrollService?.calculatePayroll(customerId, month, year);
      payrollStatus = payroll?.status === 'PAID' || payroll?.status === 'APPROVED' ? 'FINAL' : 'PROVISIONAL';
    } catch (error) {
      payrollStatus = error instanceof BadRequestException ? 'FINAL' : 'PROVISIONAL';
      this.logger.warn(`Payroll period kept unchanged: ${error instanceof Error ? error.message : error}`);
    }
    const employees = await this.prisma.employee.findMany({
      where: {
        customerId,
        status: 'ACTIVE',
        ...(Array.isArray(payload.employeeIds) ? { id: { in: payload.employeeIds.map(Number) } } : {}),
        ...(payload.departmentId ? { departmentId: Number(payload.departmentId) } : {}),
      },
      include: { department: true, designation: true, shift: true, customer: true, salaryStructures: { where: { status: 'ACTIVE' }, take: 1 } },
    });
    const company = employees[0]?.customer?.name || 'QB Suite';
    let commissionProvisional = false;
    for (const employee of employees) {
      const built: Array<{ type: 'ATTENDANCE' | 'LEAVE_BALANCE' | 'SALARY_SUMMARY' | 'COMMISSION'; buffer: Buffer; fileName: string; id: number; note: string }> = [];
      if (types.includes('ATTENDANCE')) built.push({ ...(await this.attendancePdf(customerId, employee, company, year, month)), note: 'Attendance totals are for this month only.' });
      if (types.includes('LEAVE_BALANCE')) built.push({ ...(await this.leavePdf(customerId, employee, company, year, month)), note: 'Leave balances use the stored ledger.' });
      if (types.includes('SALARY_SUMMARY')) built.push(await this.salaryPdf(customerId, employee, year, month));
      if (types.includes('COMMISSION')) {
        const commission = await this.commissionPdf(customerId, employee, company, year, month);
        commissionProvisional = commissionProvisional || commission.provisional;
        built.push(commission.file);
      }
      if (payload.send !== false) await this.deliverReports(customerId, employee, built, year, month);
    }
    await this.prisma.hrmMonthlyCycle.update({
      where: { idempotencyKey: `cycle:${customerId}:${year}:${month}` },
      data: { attendanceStatus: 'FINAL', payrollStatus, commissionStatus: commissionProvisional ? 'PROVISIONAL' : 'FINAL', finalizedAt: new Date() },
    });
    if (payload.runId) {
      await this.prisma.hrmMonthlyReportRun.update({ where: { id: Number(payload.runId) }, data: { status: 'COMPLETED', finishedAt: new Date() } });
    }
  }

  private async attendancePdf(customerId: number, employee: any, company: string, year: number, month: number) {
    const { start, end } = this.bounds(year, month);
    const [policy, holidays, attendance, leaves] = await Promise.all([
      this.prisma.attendancePolicy.findFirst({ where: { customerId, isActive: true } }),
      this.prisma.publicHoliday.findMany({ where: { customerId, isActive: true, date: { gte: start, lte: end } } }),
      this.prisma.attendance.findMany({ where: { customerId, employeeId: employee.id, date: { gte: start, lte: end } } }),
      this.prisma.leaveRequest.findMany({ where: { customerId, employeeId: employee.id, status: 'APPROVED', fromDate: { lte: end }, toDate: { gte: start } } }),
    ]);
    const approvedLeaveDates = leaves.flatMap((leave) => this.datesBetween(leave.fromDate, leave.toDate, start, end));
    const report = buildAttendanceReport({
      year,
      month,
      joiningDate: employee.joiningDate,
      shiftName: employee.shift?.name,
      workingDaysPerWeek: policy?.workingDaysPerWeek || 5,
      minWorkingHours: policy?.minWorkingHours || 8,
      holidays,
      attendance,
      approvedLeaveDates,
    });
    const fileName = `Attendance_Report_${employee.employeeCode}_${MONTHS[month - 1]}_${year}.pdf`;
    const buffer = await renderReportPdf({
      title: 'Monthly Attendance Report',
      companyName: company,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeCode: employee.employeeCode,
      department: employee.department?.name || '—',
      designation: employee.designation?.name || '—',
      period: `${MONTHS[month - 1]} ${year}`,
      generatedAt: new Date(),
      summaryRows: Object.entries(report.summary).map(([label, value]) => [label, String(value)]),
      tableHead: ['Date', 'Day', 'In', 'Out', 'Hours', 'Status'],
      tableRows: report.days.map((day) => [day.date, day.day, day.checkIn, day.checkOut, String(day.workingHours), day.status]),
    });
    const saved = await this.storeReport(customerId, employee, year, month, 'ATTENDANCE', fileName, buffer, report.summary);
    return { ...saved, buffer, fileName, type: 'ATTENDANCE' as const };
  }

  private async leavePdf(customerId: number, employee: any, company: string, year: number, month: number) {
    const { start, end } = this.bounds(year, month);
    const [balances, requests, adjustments] = await Promise.all([
      this.prisma.employeeLeaveBalance.findMany({ where: { customerId, employeeId: employee.id, year }, include: { leaveType: true } }),
      this.prisma.leaveRequest.findMany({ where: { customerId, employeeId: employee.id }, include: { leaveType: true }, orderBy: { fromDate: 'desc' } }),
      this.prisma.leaveAdjustmentHistory.findMany({ where: { customerId, employeeId: employee.id, createdAt: { gte: start, lte: end } } }),
    ]);
    const lines = balances.map((balance) => {
      const unpaidType = isUnpaidLeave(balance.leaveType.code, balance.leaveType.name);
      const monthRequests = requests.filter((request) => request.leaveTypeId === balance.leaveTypeId);
      const taken = monthRequests.filter((request) => request.status === 'APPROVED' && !unpaidType).reduce((sum, request) => sum + overlapLeaveDays(request, start, end), 0);
      const unpaid = monthRequests.filter((request) => request.status === 'APPROVED' && unpaidType).reduce((sum, request) => sum + overlapLeaveDays(request, start, end), 0);
      const credited = adjustments.filter((row) => row.leaveTypeId === balance.leaveTypeId && row.adjustmentAmount > 0 && !String(row.adjustmentType).toLowerCase().includes('carry')).reduce((sum, row) => sum + row.adjustmentAmount, 0);
      const expired = adjustments.filter((row) => row.leaveTypeId === balance.leaveTypeId && String(row.adjustmentType).toLowerCase().includes('expir')).reduce((sum, row) => sum + Math.abs(row.adjustmentAmount), 0);
      const other = adjustments.filter((row) => row.leaveTypeId === balance.leaveTypeId && row.adjustmentAmount < 0 && !String(row.adjustmentType).toLowerCase().includes('expir')).reduce((sum, row) => sum + row.adjustmentAmount, 0);
      const usedBefore = Math.max(0, balance.usedDays - taken);
      return leaveBalanceLine({
        leaveType: balance.leaveType.name,
        allocated: balance.allocatedDays,
        usedBeforeMonth: usedBefore,
        credited,
        carryForward: 0,
        carryAlreadyInOpening: true,
        taken,
        adjustments: other,
        expired,
        unpaid,
      });
    });
    for (const line of lines) {
      await this.prisma.hrmLeaveMonthlySnapshot.upsert({
        where: { employeeId_leaveTypeId_year_month: { employeeId: employee.id, leaveTypeId: balances.find((balance) => balance.leaveType.name === line.leaveType)?.leaveTypeId || 0, year, month } },
        update: this.decimalLine(line),
        create: { customerId, employeeId: employee.id, leaveTypeId: balances.find((balance) => balance.leaveType.name === line.leaveType)!.leaveTypeId, year, month, ...this.decimalLine(line) },
      }).catch(() => undefined);
    }
    const fileName = `Leave_Balance_${employee.employeeCode}_${MONTHS[month - 1]}_${year}.pdf`;
    const buffer = await renderReportPdf({
      title: 'Monthly Leave Balance Report',
      companyName: company,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeCode: employee.employeeCode,
      department: employee.department?.name || '—',
      designation: employee.designation?.name || '—',
      period: `${MONTHS[month - 1]} ${year}`,
      generatedAt: new Date(),
      summaryRows: [
        ['Approved', String(requests.filter((request) => request.status === 'APPROVED').length)],
        ['Rejected', String(requests.filter((request) => request.status === 'REJECTED').length)],
        ['Pending', String(requests.filter((request) => request.status === 'PENDING').length)],
      ],
      tableHead: ['Type', 'Opening', 'Taken', 'Closing'],
      tableRows: lines.map((line) => [line.leaveType, String(line.opening), String(line.taken), String(line.closing)]),
    });
    const saved = await this.storeReport(customerId, employee, year, month, 'LEAVE_BALANCE', fileName, buffer, { lines });
    return { ...saved, buffer, fileName, type: 'LEAVE_BALANCE' as const };
  }

  private decimalLine(line: { opening: number; credited: number; carryForward: number; taken: number; adjustments: number; expired: number; unpaid: number; closing: number }) {
    const value = (amount: number) => new Prisma.Decimal(amount.toFixed(2));
    return { opening: value(line.opening), credited: value(line.credited), carryForward: value(line.carryForward), taken: value(line.taken), adjustments: value(line.adjustments), expired: value(line.expired), unpaid: value(line.unpaid), closing: value(line.closing) };
  }

  private async storeReport(
    customerId: number,
    employee: { id: number },
    year: number,
    month: number,
    reportType: 'ATTENDANCE' | 'LEAVE_BALANCE' | 'SALARY_SUMMARY' | 'COMMISSION',
    fileName: string,
    buffer: Buffer,
    summary: unknown,
    extra?: { payrollId?: number | null; isProvisional?: boolean },
  ) {
    const localName = reportType === 'ATTENDANCE' ? 'attendance-report.pdf' : reportType === 'LEAVE_BALANCE' ? 'leave-balance-report.pdf' : reportType === 'SALARY_SUMMARY' ? 'salary-summary.pdf' : 'commission-report.pdf';
    const key = `hrm-reports/${customerId}/${employee.id}/${year}/${month}/${localName}`;
    let storageKey = key;
    try {
      if (this.s3Service) await this.s3Service.uploadPrivatePdf(buffer, key);
      else throw new Error('S3 is not configured');
    } catch (error) {
      const directory = path.join(process.cwd(), 'uploads', 'hrm-reports', String(customerId), String(employee.id), String(year), String(month));
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, localName), buffer);
      storageKey = `uploads/hrm-reports/${customerId}/${employee.id}/${year}/${month}/${localName}`;
      this.logger.warn(`Stored HRM PDF locally because S3 was unavailable: ${error instanceof Error ? error.message : error}`);
    }
    return this.prisma.hrmEmployeeMonthlyReport.upsert({
      where: { customerId_employeeId_year_month_reportType: { customerId, employeeId: employee.id, year, month, reportType } },
      update: {
        status: 'GENERATED',
        fileName,
        storageKey,
        summary: summary as Prisma.InputJsonValue,
        payrollId: extra?.payrollId ?? null,
        isProvisional: extra?.isProvisional ?? false,
        generatedAt: new Date(),
        error: null,
      },
      create: {
        customerId,
        employeeId: employee.id,
        year,
        month,
        reportType,
        status: 'GENERATED',
        fileName,
        storageKey,
        summary: summary as Prisma.InputJsonValue,
        payrollId: extra?.payrollId ?? null,
        isProvisional: extra?.isProvisional ?? false,
        generatedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  private async deliverReports(customerId: number, employee: any, reports: Array<{ type: 'ATTENDANCE' | 'LEAVE_BALANCE' | 'SALARY_SUMMARY' | 'COMMISSION'; buffer: Buffer; fileName: string; id: number; note: string }>, year: number, month: number) {
    const settings = await this.getSettings(customerId);
    const period = `${MONTHS[month - 1]} ${year}`;
    const notes = reports.map((report) => `<li>${report.fileName}: ${report.note}</li>`).join('');
    if (settings.emailEnabled) {
      await this.sendChannel(customerId, employee, null, 'EMAIL', 'MONTHLY_REPORTS', `monthly-email:${customerId}:${employee.id}:${year}:${month}`, async () => {
        if (!employee.email) return { status: 'SKIPPED' as const, error: 'Employee email is missing' };
        await this.emailService?.sendEmail({
          to: employee.email,
          subject: `Your Monthly Attendance, Leave, Salary & Commission Reports - ${period}`,
          html: `<p>Hello ${employee.firstName},</p><p>Your reports for ${period} are attached as four separate PDFs.</p><ul>${notes}</ul><p>Regards,<br/>${employee.customer?.name || 'QB Suite'} HR Department</p>`,
          attachments: reports.map((report) => ({ filename: report.fileName, content: report.buffer, contentType: 'application/pdf' })),
        });
        return { status: 'SENT' as const };
      });
    }
    if (settings.whatsappEnabled) {
      const summary = reports.map((report) => report.note).join(' ');
      await this.sendChannel(customerId, employee, null, 'WHATSAPP', 'MONTHLY_REPORTS', `monthly-wa-summary:${customerId}:${employee.id}:${year}:${month}`, async () => {
        if (!employee.whatsappReportsOptIn) return { status: 'SKIPPED' as const, error: 'Employee has not opted in to WhatsApp HR reports' };
        if (!employee.phone) return { status: 'SKIPPED' as const, error: 'Employee phone is missing' };
        const result = await this.whatsappService?.sendTemplate(employee.phone, 'monthly_hrm_reports', [{ type: 'text', text: `${employee.firstName} ${period}. ${summary}`.slice(0, 900) }], 'en', `Hello ${employee.firstName}, your ${period} attendance, leave, salary and commission reports are ready. ${summary}`);
        if (!result || result.skipped) return { status: 'SKIPPED' as const, error: result?.reason || 'WhatsApp is not configured' };
        if (!result.success) return { status: 'FAILED' as const, error: result.error || result.reason || 'WhatsApp delivery failed' };
        return { status: 'SENT' as const, messageId: result.messageId };
      });
      for (const report of reports) {
        const kind = report.type === 'ATTENDANCE' ? 'MONTHLY_ATTENDANCE' : report.type === 'LEAVE_BALANCE' ? 'MONTHLY_LEAVE_BALANCE' : report.type === 'SALARY_SUMMARY' ? 'MONTHLY_SALARY' : 'MONTHLY_COMMISSION';
        await this.sendChannel(customerId, employee, report.id, 'WHATSAPP', kind, `monthly-wa:${customerId}:${employee.id}:${year}:${month}:${report.type}`, async () => {
          if (!employee.whatsappReportsOptIn) return { status: 'SKIPPED' as const, error: 'Employee has not opted in to WhatsApp HR reports' };
          if (!employee.phone) return { status: 'SKIPPED' as const, error: 'Employee phone is missing' };
          const result = await this.whatsappService?.sendDocumentMessage({ to: employee.phone, pdfBuffer: report.buffer, filename: report.fileName, caption: report.note });
          if (!result || result.skipped) return { status: 'SKIPPED' as const, error: result?.reason || 'WhatsApp is not configured' };
          if (!result.success) return { status: 'FAILED' as const, error: result.error || result.reason || 'WhatsApp delivery failed' };
          return { status: 'SENT' as const, messageId: result.messageId };
        });
      }
    }
  }

  private async sendChannel(customerId: number, employee: { id: number }, reportId: number | null, channel: 'EMAIL' | 'WHATSAPP', kind: 'MONTHLY_REPORTS' | 'MONTHLY_ATTENDANCE' | 'MONTHLY_LEAVE_BALANCE' | 'MONTHLY_SALARY' | 'MONTHLY_COMMISSION' | 'LEAVE_APPROVED' | 'LEAVE_REJECTED', idempotencyKey: string, send: () => Promise<{ status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string; messageId?: string }>) {
    const existing = await this.prisma.hrmNotificationDelivery.findUnique({ where: { idempotencyKey } });
    if (existing && ['SENT', 'DELIVERED', 'READ', 'SKIPPED'].includes(existing.status)) return existing;
    const delivery = existing || await this.prisma.hrmNotificationDelivery.create({
      data: { customerId, employeeId: employee.id, reportId, channel, kind, idempotencyKey, status: 'PROCESSING', updatedAt: new Date() },
    });
      const result = await send().catch((error): { status: 'FAILED'; error: string; messageId?: string } => ({ status: 'FAILED', error: error instanceof Error ? error.message : 'Delivery failed' }));
    return this.prisma.hrmNotificationDelivery.update({
      where: { id: delivery.id },
      data: { status: result.status, error: result.error || null, providerMessageId: result.messageId || null, attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });
  }

  private async sendLeaveNotice(customerId: number, payload: Record<string, unknown>, eventType: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: Number(payload.employeeId), customerId }, include: { customer: true, leaveBalances: true } });
    if (!employee) return;
    const remaining = employee.leaveBalances.reduce((sum, balance) => sum + balance.remainingDays, 0);
    const approved = eventType === 'LEAVE_APPROVED';
    const text = approved
      ? `Hello ${employee.firstName}, your ${payload.leaveType} leave from ${payload.fromDate} to ${payload.toDate} (${payload.days} days) has been approved by ${payload.actorName}. Remaining balance: ${remaining}.`
      : `Hello ${employee.firstName}, your ${payload.leaveType} leave from ${payload.fromDate} to ${payload.toDate} was rejected by ${payload.actorName}. Reason: ${payload.reason || 'Not provided'}.`;
    await this.sendChannel(customerId, employee, null, 'EMAIL', approved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED', `leave-email:${payload.leaveRequestId}:${eventType}`, async () => {
      if (!employee.email) return { status: 'SKIPPED', error: 'Employee email is missing' };
      await this.emailService?.sendEmail({ to: employee.email, subject: approved ? 'Leave request approved' : 'Leave request rejected', text });
      return { status: 'SENT' };
    });
    await this.sendChannel(customerId, employee, null, 'WHATSAPP', approved ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED', `leave-wa:${payload.leaveRequestId}:${eventType}`, async () => {
      if (!employee.whatsappReportsOptIn) return { status: 'SKIPPED', error: 'Employee has not opted in to WhatsApp HR reports' };
      if (!employee.phone) return { status: 'SKIPPED', error: 'Employee phone is missing' };
      const result = await this.whatsappService?.sendMessage(employee.phone, text);
      if (!result || result.skipped) return { status: 'SKIPPED', error: result?.reason || 'WhatsApp is not configured' };
      if (!result.success) return { status: 'FAILED', error: result.error || 'WhatsApp delivery failed' };
      return { status: 'SENT', messageId: result.messageId };
    });
  }

  private async retryDelivery(customerId: number, deliveryId: number) {
    const delivery = await this.prisma.hrmNotificationDelivery.findFirst({ where: { id: deliveryId, customerId }, include: { report: true } });
    if (!delivery || delivery.status !== 'FAILED') return;
    const employee = await this.prisma.employee.findFirst({ where: { id: delivery.employeeId, customerId }, include: { customer: true } });
    if (!employee) return;
    const reports = delivery.report
      ? [delivery.report]
      : await this.prisma.hrmEmployeeMonthlyReport.findMany({ where: { customerId, employeeId: employee.id, status: 'GENERATED' }, orderBy: { id: 'desc' }, take: 2 });
    const files: Array<{ id: number; fileName: string; buffer: Buffer; type: string }> = [];
    for (const report of reports) {
      if (!report.storageKey) continue;
      const buffer = report.storageKey.startsWith('uploads/')
        ? fs.readFileSync(path.join(process.cwd(), report.storageKey))
        : await this.s3Service!.readPrivateObject(report.storageKey);
      files.push({ id: report.id, fileName: report.fileName, buffer, type: report.reportType });
    }
    await this.prisma.hrmNotificationDelivery.update({ where: { id: delivery.id }, data: { status: 'PENDING' } });
    if (delivery.channel === 'EMAIL') {
      await this.sendChannel(customerId, employee, delivery.reportId, 'EMAIL', delivery.kind, delivery.idempotencyKey, async () => {
        if (!employee.email) return { status: 'SKIPPED' as const, error: 'Employee email is missing' };
        await this.emailService?.sendEmail({
          to: employee.email,
          subject: 'Your Monthly Attendance & Leave Reports',
          html: '<p>Your HR reports are attached.</p>',
          attachments: files.map((file) => ({ filename: file.fileName, content: file.buffer, contentType: 'application/pdf' })),
        });
        return { status: 'SENT' as const };
      });
      return;
    }
    const file = files[0];
    if (!file) throw new NotFoundException('Report file is not available to retry');
    await this.sendChannel(customerId, employee, file.id, 'WHATSAPP', delivery.kind, delivery.idempotencyKey, async () => {
      if (!employee.whatsappReportsOptIn) return { status: 'SKIPPED' as const, error: 'Employee has not opted in to WhatsApp HR reports' };
      if (!employee.phone) return { status: 'SKIPPED' as const, error: 'Employee phone is missing' };
      const result = await this.whatsappService?.sendDocumentMessage({ to: employee.phone, pdfBuffer: file.buffer, filename: file.fileName });
      if (!result || result.skipped) return { status: 'SKIPPED' as const, error: result?.reason || 'WhatsApp is not configured' };
      if (!result.success) return { status: 'FAILED' as const, error: result.error || 'WhatsApp delivery failed' };
      return { status: 'SENT' as const, messageId: result.messageId };
    });
  }

  async retry(customerValue: number | string | undefined, deliveryId: number) {
    const customerId = await this.customerId(customerValue);
    const delivery = await this.prisma.hrmNotificationDelivery.findFirst({ where: { id: deliveryId, customerId } });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status !== 'FAILED') throw new BadRequestException('Only a failed channel can be retried.');
    await this.prisma.hrmNotificationOutbox.create({
      data: {
        customerId,
        eventType: 'RETRY_DELIVERY',
        idempotencyKey: `retry:${delivery.id}:${delivery.attemptCount + 1}`,
        payload: { deliveryId: delivery.id },
        updatedAt: new Date(),
      },
    });
    await this.processOutbox(5);
    return { success: true, message: `${delivery.channel} retry queued. The other channel was not changed.` };
  }

  async download(customerValue: number | string | undefined, reportId: number, user: any) {
    const customerId = await this.customerId(user?.customerId || customerValue);
    const report = await this.prisma.hrmEmployeeMonthlyReport.findFirst({ where: { id: reportId, customerId } });
    if (!report?.storageKey) throw new NotFoundException('Report file not found');
    const admin = isUserAdmin(user);
    const employee = user?.id ? await this.prisma.employee.findFirst({ where: { userId: Number(user.id), customerId } }) : null;
    if (!admin && employee && employee.id !== report.employeeId) throw new ForbiddenException('You can download only your own HR report');
    if (!admin && !employee && !user?.id) throw new ForbiddenException('You can download only your own HR report');
    if (report.storageKey.startsWith('uploads/')) return { url: `/${report.storageKey}`, fileName: report.fileName };
    const url = await this.s3Service?.getPresignedUrl(report.storageKey, 900);
    return { url, fileName: report.fileName, expiresInSeconds: 900 };
  }

  async myReports(user: any) {
    const customerId = await this.customerId(user?.customerId);
    const employee = await this.prisma.employee.findFirst({ where: { userId: Number(user?.id), customerId } });
    if (!employee) throw new ForbiddenException('Employee record not found for this account');
    const reports = await this.prisma.hrmEmployeeMonthlyReport.findMany({ where: { customerId, employeeId: employee.id }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    const deliveries = await this.prisma.hrmNotificationDelivery.findMany({ where: { customerId, employeeId: employee.id }, orderBy: { id: 'desc' }, take: 30 });
    const now = this.istParts();
    const commission = await this.commissionSummary(customerId, now.year, now.month, { employeeId: String(employee.id) });
    return { reports, notifications: deliveries, commission };
  }

  async teamLeaves(user: any) {
    const customerId = await this.customerId(user?.customerId);
    const manager = await this.prisma.employee.findFirst({ where: { userId: Number(user?.id), customerId }, include: { ledTeams: { include: { members: true } } } });
    if (!manager) throw new ForbiddenException('Employee record not found for this account');
    const teamMemberIds = manager.ledTeams.flatMap((team) => team.members.map((member) => member.employeeId));
    return this.prisma.leaveRequest.findMany({
      where: { customerId, OR: [{ employee: { managerId: manager.id } }, { employeeId: { in: teamMemberIds } }] },
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async mySalarySummary(user: any, year?: number, month?: number) {
    const customerId = await this.customerId(user?.customerId);
    const employee = await this.prisma.employee.findFirst({
      where: { userId: Number(user?.id), customerId },
      include: { department: true, designation: true, shift: true, customer: true, salaryStructures: { where: { status: 'ACTIVE' }, take: 1 } },
    });
    if (!employee) throw new ForbiddenException('Employee record not found for this account');
    const now = this.istParts();
    const y = year || now.year;
    const m = month || now.month;

    const existing = await this.prisma.hrmEmployeeMonthlyReport.findFirst({
      where: { customerId, employeeId: employee.id, year: y, month: m, reportType: 'SALARY_SUMMARY' },
    });

    const summaryData = (existing?.summary as any) || await calculateEmployeeSalaryReport(this.prisma, customerId, employee, y, m);
    return {
      reportId: existing?.id || null,
      status: existing?.status || 'CALCULATED',
      isProvisional: existing?.isProvisional ?? summaryData.isProvisional,
      payrollStatus: summaryData.payrollStatus || 'PROVISIONAL',
      summary: summaryData,
    };
  }

  async mySalaryHistory(user: any) {
    const customerId = await this.customerId(user?.customerId);
    const employee = await this.prisma.employee.findFirst({ where: { userId: Number(user?.id), customerId } });
    if (!employee) throw new ForbiddenException('Employee record not found for this account');
    return this.prisma.hrmEmployeeMonthlyReport.findMany({
      where: { customerId, employeeId: employee.id, reportType: 'SALARY_SUMMARY' },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 24,
    });
  }

  async employeeSalarySummary(customerIdValue: number | string | undefined, employeeId: number, year: number, month: number, user: any) {
    const customerId = await this.customerId(customerIdValue);
    const admin = isUserAdmin(user);
    const employeeUser = user?.id ? await this.prisma.employee.findFirst({ where: { userId: Number(user.id), customerId } }) : null;
    if (!admin && (!employeeUser || employeeUser.id !== employeeId)) {
      throw new ForbiddenException('You do not have permission to view this employee salary summary.');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId },
      include: { department: true, designation: true, shift: true, customer: true, salaryStructures: { where: { status: 'ACTIVE' }, take: 1 } },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const existing = await this.prisma.hrmEmployeeMonthlyReport.findFirst({
      where: { customerId, employeeId: employee.id, year, month, reportType: 'SALARY_SUMMARY' },
    });

    const summaryData = (existing?.summary as any) || await calculateEmployeeSalaryReport(this.prisma, customerId, employee, year, month);
    return {
      reportId: existing?.id || null,
      status: existing?.status || 'CALCULATED',
      isProvisional: existing?.isProvisional ?? summaryData.isProvisional,
      payrollStatus: summaryData.payrollStatus || 'PROVISIONAL',
      summary: summaryData,
    };
  }

  async teamAttendanceAndLeaves(user: any, year?: number, month?: number) {
    const customerId = await this.customerId(user?.customerId);
    const manager = await this.prisma.employee.findFirst({
      where: { userId: Number(user?.id), customerId },
      include: { ledTeams: { include: { members: true } } },
    });
    if (!manager) throw new ForbiddenException('Employee record not found for this account');
    const teamMemberIds = manager.ledTeams.flatMap((team) => team.members.map((member) => member.employeeId));
    const now = this.istParts();
    const y = year || now.year;
    const m = month || now.month;

    const members = await this.prisma.employee.findMany({
      where: {
        customerId,
        OR: [{ managerId: manager.id }, { id: { in: teamMemberIds } }],
        status: 'ACTIVE',
      },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });

    const reports = await this.prisma.hrmEmployeeMonthlyReport.findMany({
      where: {
        customerId,
        employeeId: { in: members.map((m) => m.id) },
        year: y,
        month: m,
        reportType: { in: ['ATTENDANCE', 'LEAVE_BALANCE'] },
      },
    });

    return members.map((mem) => {
      const att = reports.find((r) => r.employeeId === mem.id && r.reportType === 'ATTENDANCE');
      const lve = reports.find((r) => r.employeeId === mem.id && r.reportType === 'LEAVE_BALANCE');
      return {
        employeeId: mem.id,
        employeeCode: mem.employeeCode,
        employeeName: `${mem.firstName} ${mem.lastName}`.trim(),
        department: mem.department?.name || '—',
        designation: mem.designation?.name || '—',
        attendanceStatus: att?.status || 'PENDING',
        attendanceReportId: att?.id || null,
        attendanceSummary: att?.summary || null,
        leaveStatus: lve?.status || 'PENDING',
        leaveReportId: lve?.id || null,
        leaveSummary: lve?.summary || null,
      };
    });
  }

  async applyWhatsappStatus(messageId: string, status: string, error?: string) {
    const mapped = status === 'read' ? 'READ' : status === 'delivered' ? 'DELIVERED' : status === 'failed' ? 'FAILED' : status === 'sent' ? 'SENT' : null;
    if (!mapped) return;
    await this.prisma.hrmNotificationDelivery.updateMany({
      where: { providerMessageId: messageId, channel: 'WHATSAPP' },
      data: { status: mapped, error: error || null },
    });
  }

  private bounds(year: number, month: number) {
    return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0, 23, 59, 59, 999) };
  }

  private datesBetween(from: Date, to: Date, start: Date, end: Date) {
    const dates: string[] = [];
    const cursor = new Date(Math.max(from.getTime(), start.getTime()));
    const last = new Date(Math.min(to.getTime(), end.getTime()));
    while (cursor <= last) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  private istBounds(year: number, month: number) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (value: number) => String(value).padStart(2, '0');
    return {
      start: new Date(`${year}-${pad(month)}-01T00:00:00.000+05:30`),
      end: new Date(`${year}-${pad(month)}-${pad(last)}T23:59:59.999+05:30`),
    };
  }

  async openCycle(customerId: number, year: number, month: number) {
    const bounds = this.istBounds(year, month);
    const idempotencyKey = `cycle:${customerId}:${year}:${month}`;
    return this.prisma.hrmMonthlyCycle.upsert({
      where: { idempotencyKey },
      update: {},
      create: { customerId, year, month, periodStart: bounds.start, periodEnd: bounds.end, idempotencyKey, updatedAt: new Date() },
    });
  }

  private async commissionRows(customerId: number, year: number, month: number, employeeId?: number) {
    const bounds = this.istBounds(year, month);
    const rows = await this.prisma.commission.findMany({
      where: { customerId, ...(employeeId ? { employeeId } : {}) },
      include: { employee: true, lead: true, plan: true, purchase: true },
    });
    return rows.filter((row) => commissionInPeriod(row, bounds.start, bounds.end)).map(presentCommission);
  }

  async commissionReport(customerValue: number | string | undefined, query: Record<string, string | undefined>) {
    const customerId = await this.customerId(customerValue);
    const now = this.istParts();
    return this.commissionSummary(customerId, Number(query.year) || now.year, Number(query.month) || now.month, query);
  }

  async openCurrentCycle(customerValue: number | string | undefined, year?: number, month?: number) {
    const customerId = await this.customerId(customerValue);
    const now = this.istParts();
    return this.openCycle(customerId, year || now.year, month || now.month);
  }

  async commissionSummary(customerId: number, year: number, month: number, query: Record<string, string | undefined> = {}) {
    const lines = await this.commissionRows(customerId, year, month, query.employeeId ? Number(query.employeeId) : undefined);
    const filtered = lines.filter((line) => !query.paymentStatus || line.paymentStatus === query.paymentStatus).filter((line) => !query.commissionStatus || line.status === query.commissionStatus);
    return { ...summarizeCommissions(filtered), lines: filtered };
  }

  private async salaryPdf(customerId: number, employee: any, year: number, month: number) {
    const data = await calculateEmployeeSalaryReport(this.prisma, customerId, employee, year, month);
    const buffer = await renderSalaryReportPdf(data);
    const saved = await this.storeReport(
      customerId,
      employee,
      year,
      month,
      'SALARY_SUMMARY',
      data.fileName,
      buffer,
      data,
      { payrollId: data.payrollId, isProvisional: data.isProvisional },
    );
    return { ...saved, buffer, fileName: data.fileName, type: 'SALARY_SUMMARY' as const, note: `Net salary ₹${Number(data.netPayable || 0).toLocaleString('en-IN')}. ${data.isProvisional ? 'Provisional until payroll is finalized.' : `Payroll ${data.payrollStatus}.`}`, data };
  }

  private async commissionPdf(customerId: number, employee: any, company: string, year: number, month: number) {
    const lines = await this.commissionRows(customerId, year, month, employee.id);
    const summary = summarizeCommissions(lines);
    const { customers, ...stored } = summary;
    const provisional = lines.some((line) => line.status === 'PENDING');
    const fileName = `Commission_Report_${employee.employeeCode}_${MONTHS[month - 1]}_${year}.pdf`;
    const buffer = await renderCommissionReportPdf({
      company,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeCode: employee.employeeCode,
      department: employee.department?.name || '—',
      period: `${MONTHS[month - 1]} ${year}`,
      provisional,
      lines,
      summary,
    });
    const saved = await this.storeReport(customerId, employee, year, month, 'COMMISSION', fileName, buffer, { ...summary, customers });
    const snapshotLines = lines.map((line) => ({ ...line, createdAt: line.createdAt.toISOString() })) as unknown as Prisma.InputJsonValue;
    await this.prisma.hrmCommissionMonthlySnapshot.upsert({
      where: { customerId_employeeId_year_month: { customerId, employeeId: employee.id, year, month } },
      update: { ...stored, provisional, lines: snapshotLines },
      create: { customerId, employeeId: employee.id, year, month, ...stored, provisional, lines: snapshotLines, updatedAt: new Date() },
    });
    return { provisional, file: { ...saved, buffer, fileName, type: 'COMMISSION' as const, note: `Commission earned ${summary.netEarned}, paid ${summary.paid}, outstanding ${summary.outstanding}.` } };
  }

  async myCommission(user: any, year?: number, month?: number) {
    const customerId = await this.customerId(user?.customerId);
    const employee = await this.prisma.employee.findFirst({ where: { userId: Number(user?.id), customerId } });
    if (!employee) throw new ForbiddenException('Employee record not found for this account');
    const now = this.istParts();
    return this.commissionSummary(customerId, year || now.year, month || now.month, { employeeId: String(employee.id) });
  }

  async teamCommissions(user: any, year?: number, month?: number) {
    const customerId = await this.customerId(user?.customerId);
    const manager = await this.prisma.employee.findFirst({ where: { userId: Number(user?.id), customerId }, include: { ledTeams: { include: { members: true } } } });
    if (!manager) throw new ForbiddenException('Employee record not found for this account');
    const teamIds = new Set(manager.ledTeams.flatMap((team) => team.members.map((member) => member.employeeId)));
    const now = this.istParts();
    const summary = await this.commissionSummary(customerId, year || now.year, month || now.month);
    const lines = summary.lines.filter((line) => teamIds.has(line.employeeId) || line.employeeId === manager.id);
    return { ...summarizeCommissions(lines), lines };
  }

  private async tick() {
    const now = this.istParts();
    if (now.day === 1) {
      const tenants = await this.prisma.employee.findMany({ where: { status: 'ACTIVE' }, distinct: ['customerId'], select: { customerId: true } });
      for (const tenant of tenants) await this.openCycle(tenant.customerId, now.year, now.month);
    }
    const settings = await this.prisma.hrmReportSetting.findMany();
    for (const setting of settings) {
      const now = this.istParts();
      const lastDay = new Date(now.year, now.month, 0).getDate();
      if (now.day !== lastDay || !this.periodClosed(now.year, now.month, setting.graceHours, setting.deliveryTime)) continue;
      const key = `monthly:${setting.customerId}:${now.year}:${now.month}`;
      const run = await this.prisma.hrmMonthlyReportRun.findUnique({ where: { idempotencyKey: key } });
      if (run) continue;
      await this.generate(setting.customerId, { year: now.year, month: now.month, send: true });
    }
    await this.processOutbox(5);
  }
}
