import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationService?: NotificationService,
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

    const pfPctConfig = payrollPolicy?.pfPercent ?? salaryPolicy?.pfPercent ?? 12.0;
    const esiPctConfig = payrollPolicy?.esiPercent ?? salaryPolicy?.esiPercent ?? 0.75;
    const commissionEnabled = salaryPolicy?.commissionEnabled ?? false;
    const commissionPctConfig = salaryPolicy?.commissionPercentage ?? 0.0;

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

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      const itemsData: any[] = [];

      for (const emp of employees) {
        const structure = emp.salaryStructures[0];
        let basic = structure ? structure.basicSalary : 0;
        if (!basic && emp.bankDetails) {
          const b = typeof emp.bankDetails === 'string' ? JSON.parse(emp.bankDetails) : emp.bankDetails;
          basic = Number(b?.basicSalary || b?.monthlySalary || 0);
        }
        if (!basic) basic = 35000;
        const hra = structure ? structure.hra : Math.round(basic * 0.4);
        const allowances = structure ? structure.allowances : Math.round(basic * 0.1);
        const specialAllowance = structure ? structure.specialAllowance : 0;
        const bonus = structure ? structure.bonus : 0;
        const overtime = structure ? structure.overtime : 0;
        const otherEarnings = structure ? structure.otherEarnings : 0;

        // ── Commission Integration ──
        let commission = structure ? structure.commission : 0;
        if (commission === 0 && commissionEnabled && commissionPctConfig > 0) {
          commission = Math.round((basic * commissionPctConfig) / 100);
        }

        // ── Dynamic Working Days Calculation ──
        const workingDaysConfig = this.calculateWorkingDays(
          year,
          month,
          attendancePolicy?.workingDaysPerWeek || 5,
          emp.shift?.workingDays,
        );

        // ── Attendance Integration ──
        const attendances = await tx.attendance.findMany({
          where: {
            customerId: numCustomerId,
            employeeId: emp.id,
            date: {
              gte: periodStart,
              lte: periodEnd,
            },
          },
        });

        const presentCount = attendances.filter(
          (a) => a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'REMOTE',
        ).length;
        const halfDayCount = attendances.filter((a) => a.status === 'HALF_DAY').length;
        const wfhCount = attendances.filter(
          (a) => a.workMode === 'WFH' || a.workMode === 'REMOTE',
        ).length;

        // Actual present days (integer aligned to DB schema)
        const presentDays = Math.min(
          workingDaysConfig,
          Math.round(presentCount + halfDayCount * 0.5),
        );

        // ── Leave Integration ──
        const approvedLeaves = await tx.leaveRequest.findMany({
          where: {
            customerId: numCustomerId,
            employeeId: emp.id,
            status: 'APPROVED',
            fromDate: { lte: periodEnd },
            toDate: { gte: periodStart },
          },
          include: {
            leaveType: true,
          },
        });

        let rawPaidLeaveDays = 0;
        let rawUnpaidLeaveDays = 0;

        for (const lr of approvedLeaves) {
          const code = lr.leaveType?.code?.toUpperCase() || '';
          const name = lr.leaveType?.name?.toLowerCase() || '';
          const isUnpaid =
            code === 'UL' ||
            code === 'LOP' ||
            name.includes('unpaid') ||
            name.includes('loss of pay') ||
            name.includes('lop');

          const lFrom = new Date(Math.max(new Date(lr.fromDate).getTime(), periodStart.getTime()));
          const lTo = new Date(Math.min(new Date(lr.toDate).getTime(), periodEnd.getTime()));
          let daysInPeriod = 0;
          if (lFrom <= lTo) {
            const totalLeaveDays = lr.days || 1;
            const diffDays = Math.round((lTo.getTime() - lFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            daysInPeriod = Math.min(totalLeaveDays, Math.max(1, diffDays));
          } else {
            daysInPeriod = lr.days || 1;
          }

          if (isUnpaid) {
            rawUnpaidLeaveDays += daysInPeriod;
          } else {
            rawPaidLeaveDays += daysInPeriod;
          }
        }

        const paidLeaveDays = Math.min(workingDaysConfig - presentDays, Math.round(rawPaidLeaveDays));
        const unpaidLeaveDays = Math.min(
          Math.max(0, workingDaysConfig - presentDays - paidLeaveDays),
          Math.round(rawUnpaidLeaveDays),
        );

        // Reconcile Absent Days
        // Approved paid leaves are NOT absent. Working days = present + absent + paid leave + unpaid leave
        const absentDays = Math.max(
          0,
          workingDaysConfig - presentDays - paidLeaveDays - unpaidLeaveDays,
        );

        // Unpaid leave deduction (Loss of Pay)
        const perDayRate = basic / workingDaysConfig;
        const unpaidLeaveDeduction = Math.round(unpaidLeaveDays * perDayRate);

        // ── Approved Expense Reimbursement Integration ──
        const approvedClaims = await tx.employeeClaim.findMany({
          where: {
            customerId: numCustomerId,
            employeeId: emp.id,
            status: 'APPROVED',
            paymentStatus: { in: ['UNPAID', 'PENDING'] },
            claimDate: { lte: periodEnd },
          },
        });
        const reimbursement = approvedClaims.reduce(
          (sum, c) => sum + (c.approvedAmount ?? c.amount ?? 0),
          0,
        );

        // ── Approved Loan Deduction Integration ──
        const activeLoans = await tx.employeeLoan.findMany({
          where: {
            customerId: numCustomerId,
            employeeId: emp.id,
            status: { in: ['ACTIVE', 'APPROVED'] },
            remainingBalance: { gt: 0 },
          },
        });
        let loanDeduction = 0;
        for (const loan of activeLoans) {
          if (loan.startDate && loan.startDate > periodEnd) {
            continue; // Loan starts in future
          }
          const emi =
            loan.monthlyEmi > 0
              ? loan.monthlyEmi
              : (loan.approvedAmount || loan.loanAmount) / (loan.termMonths || 12);
          const deductionAmount = Math.min(emi, loan.remainingBalance || emi);
          loanDeduction += Math.round(deductionAmount);
        }

        // ── Statutory Deductions ──
        const pf = structure ? structure.pf : Math.round(basic * (pfPctConfig / 100));
        const esi = structure ? structure.esi : Math.round(basic * (esiPctConfig / 100));
        const profTax = structure ? structure.professionalTax : 200;
        const tds = structure ? structure.tds : 0;
        const otherDeductions = structure ? structure.otherDeductions : 0;

        // ── Final Calculation ──
        const gross =
          basic +
          hra +
          allowances +
          specialAllowance +
          bonus +
          commission +
          overtime +
          otherEarnings +
          reimbursement;

        const deductions =
          pf +
          esi +
          profTax +
          tds +
          otherDeductions +
          loanDeduction +
          unpaidLeaveDeduction;

        const net = Math.max(0, gross - deductions);

        totalGross += gross;
        totalDeductions += deductions;
        totalNet += net;

        itemsData.push({
          payrollId: payroll.id,
          customerId: numCustomerId,
          employeeId: emp.id,
          basicSalary: basic,
          hra,
          allowances,
          specialAllowance,
          bonus,
          commission,
          overtime,
          otherEarnings,
          reimbursement,
          pf,
          esi,
          professionalTax: profTax,
          tds,
          otherDeductions,
          loanDeduction,
          grossSalary: gross,
          totalDeductions: deductions,
          netSalary: net,
          workingDays: workingDaysConfig,
          presentDays,
          absentDays,
          halfDays: halfDayCount,
          paidLeaveDays,
          unpaidLeaveDays,
          wfhDays: wfhCount,
          status: 'CALCULATED',
        });
      }

      // Recreate items idempotently
      await tx.payrollItem.deleteMany({
        where: { payrollId: payroll.id },
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

    return this.prisma.$transaction(async (tx) => {
      const periodEnd = new Date(payroll.year, payroll.month, 0, 23, 59, 59, 999);

      // Process each payroll item to settle claims and loans
      for (const item of payroll.items) {
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

        // Mark salary slip status as PAID
        await tx.salarySlip.updateMany({
          where: { payrollItemId: item.id },
          data: { status: 'PAID' },
        });
      }

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
      };
    });
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
    if (where.employeeId && items.length === 0 && currentEmployee) {
      const activeStructure = currentEmployee.salaryStructures?.[0];
      let basic = activeStructure ? activeStructure.basicSalary : 0;
      if (!basic && currentEmployee.bankDetails) {
        const b = typeof currentEmployee.bankDetails === 'string'
          ? JSON.parse(currentEmployee.bankDetails)
          : currentEmployee.bankDetails;
        basic = Number(b?.basicSalary || b?.monthlySalary || 0);
      }

      if (basic > 0) {
        const hra = activeStructure?.hra ?? Math.round(basic * 0.4);
        const allowances = activeStructure?.allowances ?? Math.round(basic * 0.1);
        const specialAllowance = activeStructure?.specialAllowance ?? 0;
        const pf = activeStructure?.pf ?? Math.round(basic * 0.12);
        const esi = activeStructure?.esi ?? Math.round(basic * 0.0075);
        const professionalTax = activeStructure?.professionalTax ?? 200;
        const grossSalary = activeStructure?.grossSalary ?? (basic + hra + allowances + specialAllowance);
        const totalDeductions = activeStructure?.totalDeductions ?? (pf + esi + professionalTax);
        const netSalary = activeStructure?.netSalary ?? Math.max(0, grossSalary - totalDeductions);

        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const curYear = now.getFullYear();
        const FULL_MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = FULL_MONTH_NAMES[curMonth] || `Month ${curMonth}`;

        items = [{
          id: `active-${currentEmployee.id}`,
          slipNumber: `SALARY-${curYear}${String(curMonth).padStart(2, '0')}-${currentEmployee.id}`,
          payPeriod: `${monthName} ${curYear}`,
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
            grossSalary,
            totalDeductions,
            netSalary,
          },
        }];
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

    const pf = Number(data.pf) || Math.round(basicSalary * 0.12);
    const esi = Number(data.esi) || Math.round(basicSalary * 0.0075);
    const professionalTax = Number(data.professionalTax) || 200;
    const tds = Number(data.tds) || 0;
    const otherDeductions = Number(data.otherDeductions) || 0;

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

