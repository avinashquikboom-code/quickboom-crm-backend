import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { EmployeeCommunicationService } from '../notification/employee-communication.service';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationService?: NotificationService,
    @Optional() private readonly employeeCommunication?: EmployeeCommunicationService,
  ) {}

  private async resolveCustomerId(customerId?: number | string): Promise<number> {
    const parsed = Number(customerId);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
    const defaultCust = await this.prisma.customer.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return defaultCust ? defaultCust.id : 1;
  }

  private async autoCheckOutOpenAttendances(customerId: number, periodEnd: Date) {
    const now = new Date();
    const safetyHoursMs = 12 * 60 * 60 * 1000;
    const safetyDate = new Date(now.getTime() - safetyHoursMs);

    const openRecords = await this.prisma.attendance.findMany({
      where: {
        customerId,
        punchIn: { not: null },
        punchOut: null,
        OR: [
          { date: { lte: periodEnd } },
          { punchIn: { lte: safetyDate } },
        ],
      },
      include: {
        breaks: true,
        employee: { include: { shift: true } },
      },
    });

    for (const att of openRecords) {
      try {
        const punchInDate = new Date(att.punchIn!);
        const year = punchInDate.getFullYear();
        const month = punchInDate.getMonth();
        const day = punchInDate.getDate();

        const policy = await this.prisma.attendancePolicy.findFirst({
          where: { customerId: att.customerId, isActive: true },
          orderBy: { officeId: 'desc' },
        });

        const endTimeStr = att.employee?.shift?.endTime || policy?.officeEndTime || '18:30';
        const [endHour, endMin] = endTimeStr.split(':').map(Number);
        let scheduledEnd = new Date(year, month, day, endHour || 18, endMin || 30, 0, 0);

        if (scheduledEnd.getTime() <= punchInDate.getTime()) {
          scheduledEnd = new Date(punchInDate.getTime() + (policy?.workingHoursPerDay || 8.0) * 60 * 60 * 1000);
        }
        if (scheduledEnd.getTime() > now.getTime()) {
          scheduledEnd = now;
        }

        let totalBreakMins = 0;
        for (const b of att.breaks) {
          if (!b.breakEnd) {
            let bEnd = new Date(new Date(b.breakStart).getTime() + (policy?.maxBreakDurationMins || 60) * 60 * 1000);
            if (bEnd.getTime() > scheduledEnd.getTime()) bEnd = scheduledEnd;
            if (bEnd.getTime() < new Date(b.breakStart).getTime()) bEnd = new Date(b.breakStart);
            const bDuration = Math.max(0, Math.round((bEnd.getTime() - new Date(b.breakStart).getTime()) / (1000 * 60)));
            await this.prisma.attendanceBreak.update({
              where: { id: b.id },
              data: { breakEnd: bEnd, duration: bDuration },
            });
            totalBreakMins += bDuration;
          } else {
            totalBreakMins += (b.duration || Math.max(0, Math.round((new Date(b.breakEnd).getTime() - new Date(b.breakStart).getTime()) / (1000 * 60))));
          }
        }

        const grossMins = Math.max(0, Math.round((scheduledEnd.getTime() - punchInDate.getTime()) / (1000 * 60)));
        const netWorkingMins = Math.max(0, grossMins - totalBreakMins);
        const actualHours = Math.round((netWorkingMins / 60) * 100) / 100;
        const wasPunchInLate = Boolean(att.isLate || att.status === 'LATE');
        const finalStatus = wasPunchInLate
          ? (actualHours < (policy?.minWorkingHoursForHalfDay || 4.0) ? 'HALF_DAY' : 'LATE')
          : (actualHours >= (policy?.minWorkingHoursForHalfDay || 4.0) ? 'PRESENT' : (actualHours > 0 ? 'HALF_DAY' : 'PRESENT'));

        await this.prisma.attendance.update({
          where: { id: att.id },
          data: {
            punchOut: scheduledEnd,
            locationOut: 'Auto Check-out (Forgot Punch-Out)',
            workingMinutes: netWorkingMins,
            workingHours: actualHours,
            status: finalStatus,
            isLate: wasPunchInLate,
            lateMinutes: wasPunchInLate ? (att.lateMinutes || 0) : 0,
          },
        });
      } catch (err) {
        // Continue loop
      }
    }
  }

  /**
   * Calculates actual calendar working days for a given month & year
   * taking into account company AttendancePolicy or employee Shift working days.
   */
  calculateWorkingDays(year: number, month: number, workingDaysPerWeek = 5, shiftDays?: string[]): number {
    const daysInMonth = new Date(year, month, 0).getDate();
    let workingDays = 0;
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

      if (shiftDays && Array.isArray(shiftDays) && shiftDays.length > 0) {
        const dayName = dayNames[dayOfWeek];
        if (shiftDays.some((sd) => sd.toLowerCase() === dayName.toLowerCase())) {
          workingDays++;
        }
      } else if (workingDaysPerWeek === 6) {
        // Mon-Sat
        if (dayOfWeek >= 1 && dayOfWeek <= 6) {
          workingDays++;
        }
      } else if (workingDaysPerWeek === 7) {
        workingDays++;
      } else {
        // Default 5-day work week: Monday to Friday
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          workingDays++;
        }
      }
    }
    return workingDays;
  }

  private utcDayKey(value: Date): string {
    const date = new Date(value);
    return date.toISOString().slice(0, 10);
  }

  private eachUtcDay(year: number, month: number): Date[] {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: days }, (_, index) => new Date(Date.UTC(year, month - 1, index + 1)));
  }

  private isWeeklyOff(date: Date, shiftDays?: string[], workingDaysPerWeek = 5): boolean {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const name = names[date.getUTCDay()];
    if (shiftDays && shiftDays.length > 0) {
      return !shiftDays.some((day) => day.toLowerCase() === name.toLowerCase());
    }
    if (workingDaysPerWeek >= 7) return false;
    if (workingDaysPerWeek === 6) return date.getUTCDay() === 0;
    return date.getUTCDay() === 0 || date.getUTCDay() === 6;
  }

  private roundMoney(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private async writePayrollAudit(input: {
    customerId: number;
    user?: any;
    action: string;
    description: string;
    entityId: string;
    details?: Record<string, unknown>;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          customerId: input.customerId,
          userId: input.user?.id ? Number(input.user.id) : undefined,
          userName: input.user?.name || input.user?.email || undefined,
          userRole: input.user?.role || undefined,
          action: input.action,
          module: 'Payroll',
          description: input.description,
          entityType: 'PayrollItem',
          entityId: input.entityId,
          status: 'SUCCESS',
          details: input.details as any,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Payroll audit skipped: ${err?.message}`);
    }
  }

  private async buildEmployeePayroll(tx: any, input: {
    customerId: number;
    employee: any;
    year: number;
    month: number;
    periodEnd: Date;
    salaryDays: number;
    workingDaysPerWeek: number;
    holidays: Array<{ date: Date; officeId: number | null; name: string }>;
    commissionEnabled: boolean;
    commissionPct: number;
  }) {
    const structure = input.employee.salaryStructures?.[0];
    const basic = structure ? Number(structure.basicSalary) || 0 : 0;
    const hra = structure ? Number(structure.hra) || 0 : 0;
    const allowances = structure ? Number(structure.allowances) || 0 : 0;
    const specialAllowance = structure ? Number(structure.specialAllowance) || 0 : 0;
    const bonus = structure ? Number(structure.bonus) || 0 : 0;
    const overtime = structure ? Number(structure.overtime) || 0 : 0;
    const otherEarnings = structure ? Number(structure.otherEarnings) || 0 : 0;
    let commission = structure ? Number(structure.commission) || 0 : 0;

    const days = this.eachUtcDay(input.year, input.month);
    const joining = input.employee.joiningDate ? this.utcDayKey(new Date(input.employee.joiningDate)) : null;
    const attendances = await tx.attendance.findMany({
      where: {
        customerId: input.customerId,
        employeeId: input.employee.id,
        date: { gte: days[0], lte: input.periodEnd },
      },
    });
    const attendanceByDay = new Map<string, any>();
    for (const row of attendances) {
      attendanceByDay.set(this.utcDayKey(new Date(row.date)), row);
    }
    const leaves = await tx.leaveRequest.findMany({
      where: {
        customerId: input.customerId,
        employeeId: input.employee.id,
        status: 'APPROVED',
        fromDate: { lte: input.periodEnd },
        toDate: { gte: days[0] },
      },
      include: { leaveType: true },
    });
    const holidayByDay = new Map<string, string>();
    for (const holiday of input.holidays) {
      if (holiday.officeId && input.employee.officeId && holiday.officeId !== input.employee.officeId) continue;
      if (holiday.officeId && !input.employee.officeId) continue;
      holidayByDay.set(this.utcDayKey(new Date(holiday.date)), holiday.name);
    }

    let presentDays = 0;
    let halfDays = 0;
    let absentDays = 0;
    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    let halfPaidLeave = 0;
    let holidayDays = 0;
    let weeklyOffDays = 0;
    let payableDays = 0;
    let lopDays = 0;
    let wfhDays = 0;

    for (const day of days) {
      const key = this.utcDayKey(day);
      if (joining && key < joining) continue;
      if (this.isWeeklyOff(day, input.employee.shift?.workingDays, input.workingDaysPerWeek)) {
        weeklyOffDays += 1;
        payableDays += 1;
        continue;
      }
      if (holidayByDay.has(key)) {
        holidayDays += 1;
        payableDays += 1;
        continue;
      }
      const leave = leaves.find((row: any) => key >= this.utcDayKey(new Date(row.fromDate)) && key <= this.utcDayKey(new Date(row.toDate)));
      const attendance = attendanceByDay.get(key);
      const halfAttendance = attendance?.status === 'HALF_DAY';
      if (leave) {
        const code = String(leave.leaveType?.code || '').toUpperCase();
        const name = String(leave.leaveType?.name || '').toLowerCase();
        const unpaid = code === 'UL' || code === 'LOP' || name.includes('unpaid') || name.includes('loss of pay') || name.includes('lop');
        const weight = halfAttendance ? 0.5 : 1;
        if (unpaid) {
          unpaidLeaveDays += weight;
          lopDays += weight;
          if (halfAttendance) halfDays += 1;
        } else if (halfAttendance) {
          halfPaidLeave += 1;
          payableDays += 0.5;
          lopDays += 0.5;
          halfDays += 1;
        } else {
          paidLeaveDays += 1;
          payableDays += 1;
        }
        continue;
      }
      if (attendance?.workMode === 'WFH' || attendance?.workMode === 'REMOTE' || attendance?.status === 'REMOTE') {
        wfhDays += 1;
      }
      if (attendance?.status === 'PRESENT' || attendance?.status === 'LATE' || attendance?.status === 'REMOTE') {
        presentDays += 1;
        payableDays += 1;
        continue;
      }
      if (halfAttendance) {
        halfDays += 1;
        payableDays += 0.5;
        lopDays += 0.5;
        continue;
      }
      absentDays += 1;
      lopDays += 1;
    }

    const salaryDays = Math.max(1, input.salaryDays);
    const monthlyEarnings = basic + hra + allowances + specialAllowance + bonus + overtime + otherEarnings;
    if (commission === 0 && input.commissionEnabled && input.commissionPct > 0) {
      commission = this.roundMoney((basic * input.commissionPct) / 100);
    }
    const factor = payableDays / salaryDays;
    const paidBasic = this.roundMoney(basic * factor);
    const paidHra = this.roundMoney(hra * factor);
    const paidAllowances = this.roundMoney(allowances * factor);
    const paidSpecial = this.roundMoney(specialAllowance * factor);
    const paidBonus = this.roundMoney(bonus * factor);
    const paidOvertime = this.roundMoney(overtime * factor);
    const paidOther = this.roundMoney(otherEarnings * factor);
    const paidCommission = this.roundMoney(commission * factor);
    const lopDeduction = this.roundMoney(((monthlyEarnings + commission) * lopDays) / salaryDays);

    const claims = await tx.employeeClaim.findMany({
      where: {
        customerId: input.customerId,
        employeeId: input.employee.id,
        status: 'APPROVED',
        paymentStatus: { in: ['UNPAID', 'PENDING'] },
        claimDate: { lte: input.periodEnd },
      },
    });
    const reimbursement = this.roundMoney(claims.reduce((sum: number, claim: any) => sum + Number(claim.approvedAmount ?? claim.amount ?? 0), 0));

    const loans = await tx.employeeLoan.findMany({
      where: {
        customerId: input.customerId,
        employeeId: input.employee.id,
        status: { in: ['ACTIVE', 'APPROVED'] },
        remainingBalance: { gt: 0 },
      },
    });
    let loanDeduction = 0;
    let advanceDeduction = 0;
    const loanLines: any[] = [];
    for (const loan of loans) {
      if (loan.startDate && new Date(loan.startDate) > input.periodEnd) continue;
      const emi = Number(loan.monthlyEmi) > 0
        ? Number(loan.monthlyEmi)
        : Number(loan.approvedAmount || loan.loanAmount) / (Number(loan.termMonths) || 12);
      const current = this.roundMoney(Math.min(emi, Number(loan.remainingBalance) || emi));
      const isAdvance = /advance/i.test(`${loan.reason || ''} ${loan.notes || ''}`);
      if (isAdvance) advanceDeduction += current;
      else loanDeduction += current;
      loanLines.push({
        loanId: loan.id,
        kind: isAdvance ? 'ADVANCE' : 'LOAN',
        amount: Number(loan.approvedAmount || loan.loanAmount),
        emi: this.roundMoney(emi),
        recoveredBefore: this.roundMoney(Number(loan.approvedAmount || loan.loanAmount) - Number(loan.remainingBalance || 0)),
        current,
        remainingAfter: this.roundMoney(Math.max(0, Number(loan.remainingBalance || 0) - current)),
      });
    }

    const pf = structure ? Number(structure.pf) || 0 : 0;
    const esi = structure ? Number(structure.esi) || 0 : 0;
    const professionalTax = structure ? Number(structure.professionalTax) || 0 : 0;
    const tds = structure ? Number(structure.tds) || 0 : 0;
    const otherDeductions = structure ? Number(structure.otherDeductions) || 0 : 0;
    const gross = this.roundMoney(paidBasic + paidHra + paidAllowances + paidSpecial + paidBonus + paidCommission + paidOvertime + paidOther + reimbursement);
    const deductions = this.roundMoney(pf + esi + professionalTax + tds + otherDeductions + loanDeduction + advanceDeduction);
    const netBeforeFloor = this.roundMoney(gross - deductions);
    const blocked = netBeforeFloor < 0;
    const workingDays = days.length - weeklyOffDays - holidayDays;

    return {
      basicSalary: paidBasic,
      hra: paidHra,
      allowances: paidAllowances,
      specialAllowance: paidSpecial,
      bonus: paidBonus,
      commission: paidCommission,
      overtime: paidOvertime,
      otherEarnings: paidOther,
      reimbursement,
      pf,
      esi,
      professionalTax,
      tds,
      otherDeductions,
      loanDeduction: this.roundMoney(loanDeduction),
      advanceDeduction: this.roundMoney(advanceDeduction),
      grossSalary: gross,
      totalDeductions: deductions,
      netSalary: blocked ? 0 : netBeforeFloor,
      workingDays: Math.max(0, Math.round(workingDays)),
      presentDays,
      absentDays,
      halfDays,
      paidLeaveDays: paidLeaveDays + halfPaidLeave * 0.5,
      unpaidLeaveDays,
      wfhDays,
      payableDays,
      holidayDays,
      weeklyOffDays,
      lopDays,
      lopDeduction,
      status: 'CALCULATED',
      calculationSnapshot: {
        salaryDays,
        monthlySalary: this.roundMoney(monthlyEarnings + commission),
        presentDays,
        halfDays,
        absentDays,
        paidLeaveDays,
        halfPaidLeave,
        unpaidLeaveDays,
        holidayDays,
        weeklyOffDays,
        payableDays,
        lopDays,
        attendanceSalary: this.roundMoney(gross - reimbursement),
        reimbursement,
        expenses: claims.map((claim: any) => ({
          id: claim.id,
          title: claim.description,
          category: claim.category,
          amount: Number(claim.approvedAmount ?? claim.amount ?? 0),
          approvedAt: claim.reviewedAt,
        })),
        loans: loanLines,
        gross,
        lopDeduction,
        pf,
        esi,
        professionalTax,
        tds,
        advanceDeduction: this.roundMoney(advanceDeduction),
        loanDeduction: this.roundMoney(loanDeduction),
        otherDeductions,
        totalDeductions: deductions,
        netSalary: blocked ? netBeforeFloor : netBeforeFloor,
        blocked,
        blockReason: blocked ? 'Payroll deductions exceed payable salary. Please review deductions.' : null,
      },
    };
  }

  private formatSalarySlip(slip: any) {
    if (!slip) return null;
    const pi = slip.payrollItem;
    const p = pi?.payroll;

    const FULL_MONTH_NAMES = [
      '',
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];

    let month = p?.month;
    let year = p?.year;

    if (!month || !year) {
      const parts = (slip.payPeriod || '').split(' ');
      if (parts.length >= 2) {
        const mStr = parts[0].toLowerCase();
        const yNum = parseInt(parts[1], 10);
        if (!isNaN(yNum)) year = yNum;
        const foundMonthIdx = FULL_MONTH_NAMES.findIndex((m) => m.toLowerCase().startsWith(mStr.slice(0, 3)));
        if (foundMonthIdx > 0) month = foundMonthIdx;
      }
    }

    const monthName = month ? (FULL_MONTH_NAMES[month] || `Month ${month}`) : 'Current Month';
    const payPeriod = month && year ? `${monthName} ${year}` : (slip.payPeriod || 'Current Period');
    const daysInMonth = month && year ? new Date(year, month, 0).getDate() : 30;
    const formattedDate = slip.generatedAt
      ? slip.generatedAt.toISOString().split('T')[0]
      : (month && year ? `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}` : new Date().toISOString().split('T')[0]);
    const basicSalary = pi?.basicSalary ?? slip.basicSalary ?? slip.grossSalary;
    const hra = pi?.hra ?? slip.hra ?? 0;
    const specialAllowance = pi?.specialAllowance ?? slip.specialAllowance ?? 0;
    const allowances = (pi?.allowances ?? slip.allowances ?? 0) + specialAllowance;
    const bonus = pi?.bonus ?? slip.bonus ?? 0;
    const commission = pi?.commission ?? slip.commission ?? 0;
    const overtime = pi?.overtime ?? slip.overtime ?? 0;
    const reimbursement = pi?.reimbursement ?? slip.reimbursement ?? 0;
    const pf = pi?.pf ?? slip.pf ?? 0;
    const esi = pi?.esi ?? slip.esi ?? 0;
    const professionalTax = pi?.professionalTax ?? slip.professionalTax ?? 0;
    const tds = pi?.tds ?? slip.tds ?? 0;
    const otherDeductions = pi?.otherDeductions ?? slip.otherDeductions ?? 0;
    const loanDeduction = pi?.loanDeduction ?? slip.loanDeduction ?? 0;
    const unpaidLeaveDeduction = pi?.unpaidLeaveDeduction ?? slip.unpaidLeaveDeduction ?? 0;
    const totalDeductions = slip.totalDeductions ?? (pf + esi + professionalTax + tds + otherDeductions + loanDeduction + unpaidLeaveDeduction);
    const grossSalary = slip.grossSalary ?? (basicSalary + hra + allowances);
    const netSalary = slip.netSalary ?? Math.max(0, grossSalary - totalDeductions);

    return {
      ...slip,
      month,
      year,
      monthName,
      payPeriod,
      date: formattedDate,
      workingDays: pi?.workingDays ?? 0,
      presentDays: pi?.presentDays ?? 0,
      absentDays: pi?.absentDays ?? 0,
      halfDays: pi?.halfDays ?? 0,
      paidLeaveDays: pi?.paidLeaveDays ?? 0,
      unpaidLeaveDays: pi?.unpaidLeaveDays ?? 0,
      wfhDays: pi?.wfhDays ?? 0,
      basicSalary,
      hra,
      allowances,
      specialAllowance,
      bonus,
      commission,
      overtime,
      reimbursement,
      pf,
      esi,
      professionalTax,
      tds,
      otherDeductions,
      loanDeduction,
      unpaidLeaveDeduction,
      grossSalary,
      totalDeductions,
      netSalary,
      payrollItem: {
        ...(pi || {}),
        basicSalary,
        hra,
        allowances,
        specialAllowance,
        bonus,
        commission,
        overtime,
        reimbursement,
        pf,
        esi,
        professionalTax,
        tds,
        otherDeductions,
        loanDeduction,
        unpaidLeaveDeduction,
        grossSalary,
        totalDeductions,
        netSalary,
      },
    };
  }

  async calculatePayroll(customerId: number | string | undefined, month: number, year: number, departmentId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numDeptId = departmentId && !isNaN(Number(departmentId)) ? Number(departmentId) : undefined;

    // Period date bounds (strictly covers the selected calendar month)
    const daysInMonth = new Date(year, month, 0).getDate();
    const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(year, month - 1, daysInMonth, 23, 59, 59, 999));

    // Auto-checkout any open attendance records in or before this period
    await this.autoCheckOutOpenAttendances(numCustomerId, periodEnd);

    // 1. Fetch Policy for Customer
    const [payrollPolicy, salaryPolicy, attendancePolicy] = await Promise.all([
      this.prisma.payrollPolicy.findUnique({ where: { customerId: numCustomerId } }),
      this.prisma.salaryPolicy.findFirst({ where: { customerId: numCustomerId, isActive: true } }),
      this.prisma.attendancePolicy.findFirst({ where: { customerId: numCustomerId, isActive: true } }),
    ]);

    const commissionEnabled = salaryPolicy?.commissionEnabled ?? false;
    const commissionPctConfig = salaryPolicy?.commissionPercentage ?? 0.0;
    const salaryDays = payrollPolicy?.workingDaysPerMonth || salaryPolicy?.workingDaysPerMonth || daysInMonth;
    const workingDaysPerWeek = attendancePolicy?.workingDaysPerWeek || 5;

    // 2. Fetch active employees
    const whereClause: any = { customerId: numCustomerId, status: 'ACTIVE' };
    if (numDeptId) {
      whereClause.departmentId = numDeptId;
    }

    const employees = await this.prisma.employee.findMany({
      where: whereClause,
      include: {
        salaryStructures: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        department: true,
        designation: true,
        shift: true,
      },
    });

    if (!employees || employees.length === 0) {
      throw new NotFoundException('No active employees found for payroll calculation');
    }

    return this.prisma.$transaction(async (tx) => {
      // 3. Fetch or create Payroll record (Idempotent)
      let payroll = await tx.payroll.findFirst({
        where: { customerId: numCustomerId, month, year, departmentId: numDeptId || null },
      });

      if (!payroll) {
        payroll = await tx.payroll.create({
          data: {
            customerId: numCustomerId,
            month,
            year,
            departmentId: numDeptId || null,
            status: 'CALCULATED',
          },
        });
      }
      if (payroll.status === 'PAID') {
        throw new BadRequestException('This payroll is already paid and cannot be recalculated.');
      }

      const holidays = await tx.publicHoliday.findMany({
        where: {
          customerId: numCustomerId,
          isActive: true,
          date: { gte: periodStart, lte: periodEnd },
        },
      });
      const lockedItems = await tx.payrollItem.findMany({
        where: { payrollId: payroll.id, status: 'PAID' },
      });
      const lockedEmployeeIds = new Set(lockedItems.map((item: any) => item.employeeId));

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      const itemsData: any[] = [];

      for (const locked of lockedItems) {
        totalGross += Number(locked.grossSalary) || 0;
        totalDeductions += Number(locked.totalDeductions) || 0;
        totalNet += Number(locked.netSalary) || 0;
      }

      for (const emp of employees) {
        if (lockedEmployeeIds.has(emp.id)) continue;
        const computed = await this.buildEmployeePayroll(tx, {
          customerId: numCustomerId,
          employee: emp,
          year,
          month,
          periodEnd,
          salaryDays,
          workingDaysPerWeek,
          holidays,
          commissionEnabled,
          commissionPct: commissionPctConfig,
        });
        totalGross += computed.grossSalary;
        totalDeductions += computed.totalDeductions;
        totalNet += computed.netSalary;
        itemsData.push({
          payrollId: payroll.id,
          customerId: numCustomerId,
          employeeId: emp.id,
          ...computed,
          paidLeaveDays: Math.round(computed.paidLeaveDays),
          unpaidLeaveDays: Math.round(computed.unpaidLeaveDays),
        });
      }

      await tx.payrollItem.deleteMany({
        where: { payrollId: payroll.id, status: { not: 'PAID' } },
      });

      await tx.payrollItem.createMany({
        data: itemsData,
      });

      const updatedPayroll = await tx.payroll.update({
        where: { id: payroll.id },
        data: {
          status: 'CALCULATED',
          grossSalary: totalGross,
          totalDeductions,
          netSalary: totalNet,
          totalEmployees: employees.length,
          processedAt: new Date(),
        },
        include: {
          items: {
            include: {
              employee: {
                include: {
                  department: true,
                  designation: true,
                },
              },
            },
          },
        },
      });

      return updatedPayroll;
    });
  }

  async previewPayroll(customerId: number | string | undefined, month: number, year: number, departmentId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numDeptId = departmentId && !isNaN(Number(departmentId)) ? Number(departmentId) : undefined;
    const whereClause: any = { customerId: numCustomerId, status: 'ACTIVE' };
    if (numDeptId) {
      whereClause.departmentId = numDeptId;
    }

    const employees = await this.prisma.employee.findMany({
      where: whereClause,
      include: {
        salaryStructures: {
          where: { status: 'ACTIVE' },
          take: 1,
        },
        department: true,
      },
    });

    let estGross = 0;
    let estDeductions = 0;
    let estNet = 0;

    const list = employees.map((e) => {
      const st = e.salaryStructures[0];
      const basic = st?.basicSalary || 35000;
      const gross = st?.grossSalary || basic * 1.5;
      const ded = st?.totalDeductions || basic * 0.15;
      const net = st?.netSalary || gross - ded;

      estGross += gross;
      estDeductions += ded;
      estNet += net;

      return {
        id: e.id,
        code: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`,
        department: e.department?.name || 'General',
        basic,
        net,
      };
    });

    return {
      month,
      year,
      totalEmployees: employees.length,
      estimatedGross: Math.round(estGross),
      estimatedDeductions: Math.round(estDeductions),
      estimatedNet: Math.round(estNet),
      employees: list,
    };
  }

  async approvePayroll(customerId: number | string | undefined, payrollId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numPayrollId = Number(payrollId);

    let payroll: any;
    if (!isNaN(numPayrollId) && numPayrollId > 0) {
      payroll = await this.prisma.payroll.findFirst({
        where: { id: numPayrollId, customerId: numCustomerId },
      });
    } else {
      payroll = await this.prisma.payroll.findFirst({
        where: { customerId: numCustomerId },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!payroll) {
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      payroll = await this.calculatePayroll(numCustomerId, currentMonth, currentYear);
    }

    const updated = await this.prisma.payroll.update({
      where: { id: payroll.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
      },
      include: {
        items: {
          include: {
            employee: true,
          },
        },
      },
    });

    return {
      success: true,
      message: `Payroll batch #${payroll.id} approved successfully`,
      data: updated,
    };
  }

  async generatePayroll(
    customerId: number | string | undefined,
    payrollId?: number | string,
    options?: { month?: number; year?: number; employeeId?: number },
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numPayrollId = Number(payrollId);

    let payroll: any;
    if (!isNaN(numPayrollId) && numPayrollId > 0) {
      payroll = await this.prisma.payroll.findFirst({
        where: { id: numPayrollId, customerId: numCustomerId },
        include: { items: true },
      });
    } else if (options?.month && options?.year) {
      payroll = await this.prisma.payroll.findFirst({
        where: { customerId: numCustomerId, month: options.month, year: options.year },
        include: { items: true },
      });
      if (!payroll) {
        payroll = await this.calculatePayroll(numCustomerId, options.month, options.year);
        payroll = await this.prisma.payroll.findFirst({
          where: { id: payroll.id },
          include: { items: true },
        });
      }
    } else {
      payroll = await this.prisma.payroll.findFirst({
        where: { customerId: numCustomerId },
        orderBy: { createdAt: 'desc' },
        include: { items: true },
      });
    }

    if (!payroll) {
      throw new NotFoundException('Payroll record not found. Please calculate payroll first.');
    }

    const FULL_MONTH_NAMES = [
      '',
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const payPeriod = `${FULL_MONTH_NAMES[payroll.month] || `Month ${payroll.month}`} ${payroll.year}`;
    const daysInMonth = new Date(payroll.year, payroll.month, 0).getDate();
    const slipDate = new Date(Date.UTC(payroll.year, payroll.month - 1, daysInMonth, 12, 0, 0));

    const targetItems = options?.employeeId
      ? payroll.items.filter((it: any) => it.employeeId === Number(options.employeeId))
      : payroll.items;

    const result = await this.prisma.$transaction(async (tx) => {
      for (const item of targetItems) {
        const slipNum = `SLIP-${payroll.year}${payroll.month.toString().padStart(2, '0')}-${item.employeeId.toString().padStart(4, '0')}`;

        const existing = await tx.salarySlip.findFirst({
          where: { payrollItemId: item.id, customerId: numCustomerId },
        });

        if (!existing) {
          await tx.salarySlip.create({
            data: {
              customerId: numCustomerId,
              payrollItemId: item.id,
              employeeId: item.employeeId,
              slipNumber: slipNum,
              payPeriod,
              grossSalary: item.grossSalary,
              totalDeductions: item.totalDeductions,
              netSalary: item.netSalary,
              generatedAt: slipDate,
              status: 'GENERATED',
            },
          });
        } else {
          await tx.salarySlip.update({
            where: { id: existing.id },
            data: {
              payPeriod,
              grossSalary: item.grossSalary,
              totalDeductions: item.totalDeductions,
              netSalary: item.netSalary,
              generatedAt: slipDate,
              status: 'GENERATED',
            },
          });
        }
      }

      const updated = await tx.payroll.update({
        where: { id: payroll.id },
        data: {
          status: 'GENERATED',
        },
        include: {
          items: {
            include: {
              employee: true,
              salarySlips: true,
            },
          },
        },
      });

      return {
        success: true,
        message: `Salary slips generated for ${payPeriod} (Payroll #${payroll.id})`,
        data: updated,
      };
    });

    // 8. SALARY GENERATED -> EMPLOYEE NOTIFICATION
    if (this.notificationService && result?.data?.items) {
      for (const item of result.data.items) {
        if (item.employeeId) {
          const slip = item.salarySlips?.[0];
          this.notificationService
            .sendSalaryGeneratedNotification({
              customerId: numCustomerId,
              employeeId: item.employeeId,
              payPeriod,
              month: payroll.month,
              year: payroll.year,
              slipId: slip?.id,
            })
            .catch((err: any) => {
              this.logger.warn(`Failed to dispatch SALARY_GENERATED notification: ${err?.message}`);
            });
        }
      }
    }

    return result;
  }

  async disbursePayroll(customerId: number | string | undefined, payrollId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numPayrollId = Number(payrollId);

    let payroll: any;
    if (!isNaN(numPayrollId) && numPayrollId > 0) {
      payroll = await this.prisma.payroll.findFirst({
        where: { id: numPayrollId, customerId: numCustomerId },
        include: { items: true },
      });
    } else {
      payroll = await this.prisma.payroll.findFirst({
        where: { customerId: numCustomerId },
        orderBy: { createdAt: 'desc' },
        include: { items: true },
      });
    }

    if (!payroll) {
      throw new NotFoundException('No payroll batch found to disburse. Please calculate and approve payroll first.');
    }
    if (payroll.status === 'PAID') {
      return {
        success: true,
        alreadyPaid: true,
        message: `Payroll batch #${payroll.id} is already paid`,
        data: payroll,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const periodEnd = new Date(payroll.year, payroll.month, 0, 23, 59, 59, 999);

      // Process each payroll item to settle claims and loans
      const paidItemIds: number[] = [];
      for (const item of payroll.items) {
        if (item.status === 'PAID') continue;
        const snapshot = item.calculationSnapshot as any;
        if (snapshot?.blocked) {
          throw new BadRequestException(snapshot.blockReason || 'Payroll deductions exceed payable salary. Please review deductions.');
        }
        paidItemIds.push(item.id);
        // Settle approved claims that were reimbursed
        if (item.reimbursement && item.reimbursement > 0) {
          await tx.employeeClaim.updateMany({
            where: {
              customerId: numCustomerId,
              employeeId: item.employeeId,
              status: 'APPROVED',
              paymentStatus: { in: ['UNPAID', 'PENDING'] },
              claimDate: { lte: periodEnd },
            },
            data: {
              paymentStatus: 'PAID',
              status: 'PAID',
              paidAt: new Date(),
            },
          });
        }

        // Apply loan deductions to remaining balances
        if (item.loanDeduction && item.loanDeduction > 0) {
          const activeLoans = await tx.employeeLoan.findMany({
            where: {
              customerId: numCustomerId,
              employeeId: item.employeeId,
              status: { in: ['ACTIVE', 'APPROVED'] },
              remainingBalance: { gt: 0 },
            },
          });

          let pendingDeduction = item.loanDeduction;
          for (const loan of activeLoans) {
            if (pendingDeduction <= 0) break;
            const currentBalance = loan.remainingBalance || 0;
            const deduct = Math.min(pendingDeduction, currentBalance);
            const newBalance = Math.max(0, currentBalance - deduct);
            pendingDeduction -= deduct;

            await tx.employeeLoan.update({
              where: { id: loan.id },
              data: {
                remainingBalance: newBalance,
                status: newBalance <= 0 ? 'PAID' : loan.status,
              },
            });
          }
        }

        await tx.payrollItem.update({
          where: { id: item.id },
          data: { status: 'PAID', paidAt: new Date() },
        });
        await tx.salarySlip.updateMany({
          where: { payrollItemId: item.id },
          data: { status: 'PAID' },
        });
      }
      (payroll as any).paidItemIds = paidItemIds;

      const updated = await tx.payroll.update({
        where: { id: payroll.id },
        data: {
          status: 'PAID',
          disbursedAt: new Date(),
        },
        include: {
          items: {
            include: {
              employee: true,
            },
          },
        },
      });

      return {
        success: true,
        message: `Payroll batch #${payroll.id} disbursed successfully. Reimbursed expenses and loan installments marked as settled.`,
        data: updated,
        paidItemIds,
      };
    });
    await this.deliverSalarySlips(numCustomerId, result.paidItemIds || [], undefined);
    return result;
  }

  async payPayrollItem(customerId: number | string | undefined, itemId: number | string, user?: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const item = await this.prisma.payrollItem.findFirst({
      where: { id: Number(itemId), customerId: numCustomerId },
      include: { payroll: true, employee: true, salarySlips: true },
    });
    if (!item) throw new NotFoundException('Payroll record not found');
    if (item.status === 'PAID') {
      return { success: true, alreadyPaid: true, message: 'This payroll is already paid', data: item };
    }
    const snapshot = item.calculationSnapshot as any;
    if (snapshot?.blocked || Number(item.netSalary) < 0) {
      throw new BadRequestException(snapshot?.blockReason || 'Payroll deductions exceed payable salary. Please review deductions.');
    }
    const payroll = item.payroll;
    const periodEnd = new Date(payroll.year, payroll.month, 0, 23, 59, 59, 999);
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const payPeriod = `${monthNames[payroll.month]} ${payroll.year}`;

    await this.prisma.$transaction(async (tx) => {
      if (item.reimbursement > 0) {
        await tx.employeeClaim.updateMany({
          where: {
            customerId: numCustomerId,
            employeeId: item.employeeId,
            status: 'APPROVED',
            paymentStatus: { in: ['UNPAID', 'PENDING'] },
            claimDate: { lte: periodEnd },
          },
          data: { paymentStatus: 'PAID', status: 'PAID', paidAt: new Date() },
        });
      }
      if (item.loanDeduction > 0 || item.advanceDeduction > 0) {
        let pending = Number(item.loanDeduction || 0) + Number(item.advanceDeduction || 0);
        const loans = await tx.employeeLoan.findMany({
          where: { customerId: numCustomerId, employeeId: item.employeeId, status: { in: ['ACTIVE', 'APPROVED'] }, remainingBalance: { gt: 0 } },
        });
        for (const loan of loans) {
          if (pending <= 0) break;
          const deduct = Math.min(pending, Number(loan.remainingBalance) || 0);
          const nextBalance = Math.max(0, Number(loan.remainingBalance || 0) - deduct);
          pending -= deduct;
          await tx.employeeLoan.update({
            where: { id: loan.id },
            data: { remainingBalance: nextBalance, status: nextBalance <= 0 ? 'PAID' : loan.status },
          });
        }
      }
      const slipNum = `SLIP-${payroll.year}${String(payroll.month).padStart(2, '0')}-${String(item.employeeId).padStart(4, '0')}`;
      const existing = await tx.salarySlip.findFirst({ where: { payrollItemId: item.id, customerId: numCustomerId } });
      if (!existing) {
        await tx.salarySlip.create({
          data: {
            customerId: numCustomerId,
            payrollItemId: item.id,
            employeeId: item.employeeId,
            slipNumber: slipNum,
            payPeriod,
            grossSalary: item.grossSalary,
            totalDeductions: item.totalDeductions,
            netSalary: item.netSalary,
            status: 'PAID',
          },
        });
      } else {
        await tx.salarySlip.update({ where: { id: existing.id }, data: { status: 'PAID', payPeriod, grossSalary: item.grossSalary, totalDeductions: item.totalDeductions, netSalary: item.netSalary } });
      }
      await tx.payrollItem.update({ where: { id: item.id }, data: { status: 'PAID', paidAt: new Date() } });
      const unpaid = await tx.payrollItem.count({ where: { payrollId: payroll.id, status: { not: 'PAID' } } });
      await tx.payroll.update({
        where: { id: payroll.id },
        data: unpaid === 0 ? { status: 'PAID', disbursedAt: new Date() } : { status: payroll.status },
      });
    });

    await this.deliverSalarySlips(numCustomerId, [item.id], user);
    await this.writePayrollAudit({
      customerId: numCustomerId,
      user,
      action: 'PAY',
      description: `Payroll marked paid for employee ${item.employeeId} ${payPeriod}`,
      entityId: String(item.id),
      details: { month: payroll.month, year: payroll.year, netSalary: item.netSalary },
    });
    const fresh = await this.prisma.payrollItem.findFirst({
      where: { id: item.id, customerId: numCustomerId },
      include: { employee: { include: { department: true, designation: true } }, salarySlips: true, payroll: true },
    });
    return { success: true, message: 'Payroll marked as paid', data: fresh };
  }

  private async deliverSalarySlips(customerId: number, itemIds: number[], user?: any) {
    if (!itemIds.length || !this.employeeCommunication) return;
    const slips = await this.prisma.salarySlip.findMany({
      where: { customerId, payrollItemId: { in: itemIds } },
    });
    for (const slip of slips) {
      let emailStatus = 'EMAIL_PENDING';
      let whatsappStatus = 'WHATSAPP_PENDING';
      try {
        const result: any = await this.employeeCommunication.notifySalarySlip({ slipId: slip.id, customerId });
        emailStatus = result?.email?.status === 'FAILED' ? 'EMAIL_FAILED' : result?.email?.skipped && result?.email?.status !== 'SENT' && !result?.email?.success ? 'EMAIL_FAILED' : 'EMAIL_SENT';
        if (result?.email?.status === 'FAILED') emailStatus = 'EMAIL_FAILED';
        else if (result?.email?.success || result?.email?.status === 'SENT' || result?.email?.skipped) emailStatus = 'EMAIL_SENT';
        if (result?.whatsapp?.status === 'FAILED' || result?.whatsapp?.success === false) whatsappStatus = 'WHATSAPP_FAILED';
        else if (result?.whatsapp?.success || result?.whatsapp?.status === 'SENT' || result?.whatsapp?.skipped) whatsappStatus = 'WHATSAPP_SENT';
      } catch (err: any) {
        emailStatus = 'EMAIL_FAILED';
        whatsappStatus = 'WHATSAPP_FAILED';
        this.logger.warn(`Salary slip delivery failed for slip ${slip.id}: ${err?.message}`);
      }
      await this.prisma.payrollItem.update({
        where: { id: slip.payrollItemId },
        data: { emailStatus, whatsappStatus },
      });
      await this.writePayrollAudit({
        customerId,
        user,
        action: 'DELIVER',
        description: `Salary slip delivery ${emailStatus} ${whatsappStatus}`,
        entityId: String(slip.payrollItemId),
      });
    }
  }

  async getPayrolls(
    customerId?: number | string,
    query?: { page?: number; limit?: number; month?: number; year?: number; status?: string; departmentId?: number },
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId };
    if (query?.month) where.month = Number(query.month);
    if (query?.year) where.year = Number(query.year);
    if (query?.status && query.status !== 'ALL') where.status = query.status;
    if (query?.departmentId) where.departmentId = Number(query.departmentId);

    const [items, total] = await Promise.all([
      this.prisma.payroll.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        skip,
        take: limit,
        include: {
          items: {
            include: {
              employee: {
                include: {
                  department: true,
                  designation: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.payroll.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: items,
      items,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getPayrollById(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    return this.prisma.payroll.findFirst({
      where: { id: numId, customerId: numCustomerId },
      include: {
        items: {
          include: {
            employee: {
              include: {
                department: true,
                designation: true,
              },
            },
            salarySlips: true,
          },
        },
      },
    });
  }

  async getSalarySlips(
    customerId?: number | string,
    query?: { user?: any; page?: number; limit?: number; search?: string; month?: number; year?: number },
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId };
    let currentEmployee: any = null;

    if (query?.user) {
      if (query.user.employee?.id) {
        currentEmployee = query.user.employee;
      } else {
        currentEmployee = await this.prisma.employee.findFirst({
          where: {
            customerId: numCustomerId,
            OR: [
              { userId: query.user.id },
              { email: { equals: query.user.email?.trim().toLowerCase(), mode: 'insensitive' } },
            ],
          },
          include: {
            salaryStructures: {
              where: { status: 'ACTIVE' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            department: true,
            designation: true,
          },
        });
      }

      const isSuperOrAdmin =
        String(query.user.role).toUpperCase() === 'SUPER_ADMIN' ||
        String(query.user.role).toUpperCase() === 'COMPANY_ADMIN' ||
        String(query.user.roleType).toUpperCase() === 'SUPER_ADMIN' ||
        String(query.user.roleType).toUpperCase() === 'CUSTOMER_ADMIN' ||
        String(query.user.roleType).toUpperCase() === 'TENANT_ADMIN';

      if (!isSuperOrAdmin && currentEmployee) {
        where.employeeId = currentEmployee.id;
      }
    }

    if (query?.month || query?.year) {
      where.payrollItem = {
        payroll: {
          ...(query?.month ? { month: Number(query.month) } : {}),
          ...(query?.year ? { year: Number(query.year) } : {}),
        },
      };
    }

    if (query?.search && query.search.trim()) {
      const s = query.search.trim();
      where.employee = {
        OR: [
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
          { employeeCode: { contains: s, mode: 'insensitive' } },
        ],
      };
    }

    const [rawItems, total] = await Promise.all([
      this.prisma.salarySlip.findMany({
        where,
        orderBy: { generatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          employee: {
            include: {
              department: true,
              designation: true,
              salaryStructures: {
                where: { status: 'ACTIVE' },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
          payrollItem: {
            include: {
              payroll: true,
            },
          },
        },
      }),
      this.prisma.salarySlip.count({ where }),
    ]);

    let items = rawItems.map((slip) => this.formatSalarySlip(slip));

    // If an employee queries their slips and no slips exist yet, synthesize an active salary slip
    // from their active salary structure or bankDetails so Mobile immediately reflects their latest salary!
    if (where.employeeId && currentEmployee) {
      const activeStructure = currentEmployee.salaryStructures?.[0];
      let basic = activeStructure ? activeStructure.basicSalary : 0;
      if (!basic && currentEmployee.bankDetails) {
        const b = typeof currentEmployee.bankDetails === 'string'
          ? JSON.parse(currentEmployee.bankDetails)
          : currentEmployee.bankDetails;
        basic = Number(b?.basicSalary || b?.monthlySalary || 0);
      }

      if (basic > 0) {
        const hra = activeStructure?.hra !== undefined ? activeStructure.hra : Math.round(basic * 0.4);
        const allowances = activeStructure?.allowances !== undefined ? activeStructure.allowances : Math.round(basic * 0.1);
        const specialAllowance = activeStructure?.specialAllowance !== undefined ? activeStructure.specialAllowance : 0;
        const pf = activeStructure?.pf !== undefined ? activeStructure.pf : Math.round(basic * 0.12);
        const esi = activeStructure?.esi !== undefined ? activeStructure.esi : Math.round(basic * 0.0075);
        const professionalTax = activeStructure?.professionalTax !== undefined ? activeStructure.professionalTax : 200;
        const tds = activeStructure?.tds !== undefined ? activeStructure.tds : 0;
        const grossSalary = activeStructure?.grossSalary !== undefined ? activeStructure.grossSalary : (basic + hra + allowances + specialAllowance);
        const totalDeductions = activeStructure?.totalDeductions !== undefined ? activeStructure.totalDeductions : (pf + esi + professionalTax + tds);
        const netSalary = activeStructure?.netSalary !== undefined ? activeStructure.netSalary : Math.max(0, grossSalary - totalDeductions);

        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const curYear = now.getFullYear();
        const FULL_MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = FULL_MONTH_NAMES[curMonth] || `Month ${curMonth}`;

        const currentPayPeriod = `${monthName} ${curYear}`;
        const existingCurrentIndex = items.findIndex((it: any) => it.payPeriod === currentPayPeriod || (it.month === curMonth && it.year === curYear));

        if (existingCurrentIndex >= 0) {
          items[existingCurrentIndex] = {
            ...items[existingCurrentIndex],
            basicSalary: basic,
            hra,
            allowances,
            specialAllowance,
            pf,
            esi,
            professionalTax,
            tds,
            grossSalary,
            totalDeductions,
            netSalary,
            payrollItem: {
              ...(items[existingCurrentIndex].payrollItem || {}),
              basicSalary: basic,
              hra,
              allowances,
              specialAllowance,
              pf,
              esi,
              professionalTax,
              tds,
              grossSalary,
              totalDeductions,
              netSalary,
            },
          };
        } else {
          items.unshift({
            id: `active-${currentEmployee.id}`,
            slipNumber: `SALARY-${curYear}${String(curMonth).padStart(2, '0')}-${currentEmployee.id}`,
            payPeriod: currentPayPeriod,
            month: curMonth,
            year: curYear,
            monthName,
            date: now.toISOString().split('T')[0],
            grossSalary,
            totalDeductions,
            netSalary,
            basicSalary: basic,
            hra,
            allowances,
            specialAllowance,
            pf,
            esi,
            professionalTax,
            tds,
            status: 'ACTIVE',
            employee: {
              id: currentEmployee.id,
              firstName: currentEmployee.firstName,
              lastName: currentEmployee.lastName,
              employeeCode: currentEmployee.employeeCode,
              department: currentEmployee.department,
              designation: currentEmployee.designation,
            },
            payrollItem: {
              basicSalary: basic,
              hra,
              allowances,
              specialAllowance,
              pf,
              esi,
              professionalTax,
              tds,
              grossSalary,
              totalDeductions,
              netSalary,
            },
          });
        }
      }
    }

    const totalPages = Math.ceil((total || (items.length ? 1 : 0)) / limit) || 1;

    return {
      data: items,
      items,
      slips: items,
      pagination: {
        page,
        pageSize: limit,
        total: total || items.length,
        totalPages,
      },
      meta: {
        page,
        limit,
        total: total || items.length,
        totalPages,
      },
    };
  }

  async getSalarySlipById(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    const slip = await this.prisma.salarySlip.findFirst({
      where: { id: numId, customerId: numCustomerId },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
        payrollItem: {
          include: {
            payroll: true,
          },
        },
      },
    });
    return this.formatSalarySlip(slip);
  }

  async getPayrollHistory(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const payrolls = await this.prisma.payroll.findMany({
      where: { customerId: numCustomerId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 12,
      include: {
        items: true,
      },
    });

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    if (!payrolls || payrolls.length === 0) {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      const result = [];

      for (let i = 5; i >= 0; i--) {
        let m = currentMonth - i;
        let y = currentYear;
        if (m <= 0) {
          m += 12;
          y -= 1;
        }
        result.push({
          month: monthNames[m - 1],
          year: y,
          gross: 0,
          net: 0,
          deductions: 0,
          employees: 0,
          status: 'UNPROCESSED',
        });
      }
      return result;
    }

    return payrolls.map((p) => ({
      month: monthNames[p.month - 1] || `M${p.month}`,
      year: p.year,
      gross: Math.round(p.grossSalary),
      net: Math.round(p.netSalary),
      deductions: Math.round(p.totalDeductions),
      employees: p.totalEmployees,
      status: p.status,
    }));
  }

  async getSalaryStructures(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    return this.prisma.salaryStructure.findMany({
      where: { customerId: numCustomerId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async saveSalaryStructure(customerId: number | string | undefined, data: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const basicSalary = Number(data.basicSalary) || 0;
    const hra = Number(data.hra) || 0;
    const allowances = Number(data.allowances) || 0;
    const specialAllowance = Number(data.specialAllowance) || 0;
    const bonus = Number(data.bonus) || 0;
    const commission = Number(data.commission) || 0;
    const overtime = Number(data.overtime) || 0;
    const otherEarnings = Number(data.otherEarnings) || 0;

    const pf = data.pf !== undefined && data.pf !== null && data.pf !== '' ? Number(data.pf) : Math.round(basicSalary * 0.12);
    const esi = data.esi !== undefined && data.esi !== null && data.esi !== '' ? Number(data.esi) : Math.round(basicSalary * 0.0075);
    const professionalTax = data.professionalTax !== undefined && data.professionalTax !== null && data.professionalTax !== '' ? Number(data.professionalTax) : 200;
    const tds = data.tds !== undefined && data.tds !== null && data.tds !== '' ? Number(data.tds) : 0;
    const otherDeductions = data.otherDeductions !== undefined && data.otherDeductions !== null && data.otherDeductions !== '' ? Number(data.otherDeductions) : 0;

    const grossSalary = basicSalary + hra + allowances + specialAllowance + bonus + commission + overtime + otherEarnings;
    const totalDeductions = pf + esi + professionalTax + tds + otherDeductions;
    const netSalary = Math.max(0, grossSalary - totalDeductions);

    let savedStructure: any;
    if (data.id) {
      savedStructure = await this.prisma.salaryStructure.update({
        where: { id: Number(data.id) },
        data: {
          basicSalary,
          hra,
          allowances,
          specialAllowance,
          bonus,
          commission,
          overtime,
          otherEarnings,
          pf,
          esi,
          professionalTax,
          tds,
          otherDeductions,
          grossSalary,
          totalDeductions,
          netSalary,
          status: data.status || 'ACTIVE',
        },
      });
    } else {
      savedStructure = await this.prisma.salaryStructure.create({
        data: {
          customerId: numCustomerId,
          employeeId: Number(data.employeeId),
          basicSalary,
          hra,
          allowances,
          specialAllowance,
          bonus,
          commission,
          overtime,
          otherEarnings,
          pf,
          esi,
          professionalTax,
          tds,
          otherDeductions,
          grossSalary,
          totalDeductions,
          netSalary,
          status: 'ACTIVE',
        },
      });
    }

    // Sync bankDetails on Employee record & update any current generated slips
    const empId = Number(data.employeeId || savedStructure?.employeeId);
    if (empId) {
      const emp = await this.prisma.employee.findUnique({ where: { id: empId } });
      if (emp) {
        let b: any = emp.bankDetails;
        if (typeof b === 'string') {
          try { b = JSON.parse(b); } catch (e) { b = {}; }
        } else if (!b || typeof b !== 'object') {
          b = {};
        }
        b.basicSalary = String(basicSalary);
        b.monthlySalary = String(grossSalary);
        await this.prisma.employee.update({
          where: { id: emp.id },
          data: { bankDetails: b },
        });

        // Update existing generated / draft slips for this employee so they reflect immediately
        const slips = await this.prisma.salarySlip.findMany({
          where: {
            employeeId: empId,
            customerId: numCustomerId,
            status: { in: ['GENERATED', 'CALCULATED', 'DRAFT'] },
          },
          include: { payrollItem: true },
        });
        for (const slip of slips) {
          await this.prisma.salarySlip.update({
            where: { id: slip.id },
            data: {
              grossSalary,
              totalDeductions,
              netSalary,
            },
          });
          if (slip.payrollItemId) {
            await this.prisma.payrollItem.update({
              where: { id: slip.payrollItemId },
              data: {
                basicSalary,
                hra,
                allowances,
                specialAllowance,
                pf,
                esi,
                professionalTax,
                grossSalary,
                totalDeductions,
                netSalary,
              },
            });
          }
        }
      }
    }

    return savedStructure;
  }

  async deleteSalaryStructure(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    return this.prisma.salaryStructure.deleteMany({
      where: { id: Number(id), customerId: numCustomerId },
    });
  }

  async getPayrollPolicy(customerId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    let policy = await this.prisma.payrollPolicy.findUnique({
      where: { customerId: numCustomerId },
    });

    if (!policy) {
      const salaryPol = await this.prisma.salaryPolicy.findFirst({
        where: { customerId: numCustomerId, isActive: true },
      });

      policy = await this.prisma.payrollPolicy.create({
        data: {
          customerId: numCustomerId,
          workingDaysPerMonth: salaryPol?.workingDaysPerMonth || 30,
          overtimeMultiplier: salaryPol?.overtimeMultiplier || 1.5,
          pfPercent: salaryPol?.pfPercent || 12.0,
          esiPercent: salaryPol?.esiPercent || 0.75,
          taxExemptionLimit: 300000,
        },
      });
    }

    return policy;
  }

  async savePayrollPolicy(customerId: number | string | undefined, data: any) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const workingDaysPerMonth = Number(data.workingDaysPerMonth) || 30;
    const overtimeMultiplier = Number(data.overtimeMultiplier) || 1.5;
    const pfPercent = Number(data.pfPercent) || 12.0;
    const esiPercent = Number(data.esiPercent) || 0.75;
    const taxExemptionLimit = Number(data.taxExemptionLimit) || 300000;

    const policy = await this.prisma.payrollPolicy.upsert({
      where: { customerId: numCustomerId },
      create: {
        customerId: numCustomerId,
        workingDaysPerMonth,
        overtimeMultiplier,
        pfPercent,
        esiPercent,
        taxExemptionLimit,
      },
      update: {
        workingDaysPerMonth,
        overtimeMultiplier,
        pfPercent,
        esiPercent,
        taxExemptionLimit,
      },
    });

    // Also sync to SalaryPolicy if it exists
    await this.prisma.salaryPolicy.updateMany({
      where: { customerId: numCustomerId, isActive: true },
      data: {
        workingDaysPerMonth,
        overtimeMultiplier,
        pfPercent,
        esiPercent,
      },
    });

    return policy;
  }
}

