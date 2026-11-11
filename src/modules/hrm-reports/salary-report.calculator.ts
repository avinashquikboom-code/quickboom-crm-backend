import { PrismaService } from '../../prisma/prisma.service';
import {
  agreedMonthlySalary,
  countPayableAttendance,
  lateMarkDeduction,
  lopDeduction,
  settleMonthlySalary,
} from '../payroll/salary-calculation';

export interface SalaryReportData {
  employee: {
    id: number;
    code: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    department: string;
    designation: string;
    joiningDate?: Date | null;
  };
  company: {
    name: string;
    logo?: string | null;
  };
  period: {
    year: number;
    month: number;
    monthName: string;
    startDate: Date;
    endDate: Date;
    periodLabel: string;
  };
  isProvisional: boolean;
  payrollStatus: string;
  payrollId: number | null;
  attendance: {
    calendarDays: number;
    scheduledDays: number;
    presentDays: number;
    absentDays: number;
    halfDays: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    weeklyOffDays: number;
    holidayDays: number;
    lateArrivals: number;
    earlyDepartures: number;
    totalWorkingHours: number;
    totalBreakHours: number;
    approvedOvertimeHours: number;
  };
  earnings: {
    registeredSalary: number;
    basicSalary: number;
    hra: number;
    allowances: number;
    specialAllowance: number;
    bonus: number;
    commission: number;
    overtime: number;
    reimbursement: number;
    otherEarnings: number;
    grossSalary: number;
  };
  deductions: {
    lopDays: number;
    lopDeduction: number;
    lateMarks: number;
    lateDeductions: number;
    pf: number;
    esi: number;
    professionalTax: number;
    tds: number;
    loanDeduction: number;
    otherDeductions: number;
    totalDeductions: number;
  };
  netPayable: number;
  fileName: string;
  generatedAt: Date;
}

export async function calculateEmployeeSalaryReport(
  prisma: PrismaService,
  customerId: number,
  employee: any,
  year: number,
  month: number,
): Promise<SalaryReportData> {
  const numEmpId = Number(employee.id);
  const employeeCode = employee.employeeCode || `EMP${String(numEmpId).padStart(3, '0')}`;
  const employeeName = [employee.firstName, employee.lastName].filter(Boolean).join(' ') || employee.name || 'Employee';
  const departmentName = employee.department?.name || 'Operations';
  const designationName = employee.designation?.name || 'Staff';

  const daysInCalendarMonth = new Date(year, month, 0).getDate();
  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month - 1, daysInCalendarMonth, 23, 59, 59, 999));
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });
  const periodLabel = `${monthName} ${year} (01 ${monthName.slice(0, 3)} - ${daysInCalendarMonth} ${monthName.slice(0, 3)} ${year})`;

  // Company info
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { name: true, companyName: true, logo: true },
  });
  const companyName = customer?.companyName || customer?.name || 'QB Suite';

  // Check for finalized payroll
  const finalizedItem = await prisma.payrollItem.findFirst({
    where: {
      customerId,
      employeeId: numEmpId,
      payroll: {
        month,
        year,
        status: { in: ['PAID', 'APPROVED'] },
      },
    },
    include: {
      payroll: true,
    },
  });

  const fileName = `Salary_Summary_${employeeCode}_${monthName}_${year}.pdf`;
  const generatedAt = new Date();

  if (finalizedItem) {
    // -------------------------------------------------------------
    // FINALIZED PAYROLL (MATCHES SALARY SLIP EXACTLY)
    // -------------------------------------------------------------
    const p = finalizedItem.payroll;
    const structure = employee.salaryStructures?.[0];
    const registered = agreedMonthlySalary(structure) || finalizedItem.basicSalary;

    return {
      employee: {
        id: numEmpId,
        code: employeeCode,
        name: employeeName,
        email: employee.email,
        phone: employee.phone,
        department: departmentName,
        designation: designationName,
        joiningDate: employee.joiningDate,
      },
      company: {
        name: companyName,
        logo: customer?.logo || null,
      },
      period: {
        year,
        month,
        monthName,
        startDate,
        endDate,
        periodLabel,
      },
      isProvisional: false,
      payrollStatus: p.status,
      payrollId: p.id,
      attendance: {
        calendarDays: daysInCalendarMonth,
        scheduledDays: finalizedItem.workingDays,
        presentDays: finalizedItem.presentDays,
        absentDays: finalizedItem.absentDays,
        halfDays: finalizedItem.halfDays ?? 0,
        paidLeaveDays: finalizedItem.paidLeaveDays ?? 0,
        unpaidLeaveDays: finalizedItem.unpaidLeaveDays ?? 0,
        weeklyOffDays: Math.max(0, daysInCalendarMonth - finalizedItem.workingDays),
        holidayDays: 0,
        lateArrivals: 0,
        earlyDepartures: 0,
        totalWorkingHours: Math.round(finalizedItem.presentDays * 8 * 10) / 10,
        totalBreakHours: Math.round(finalizedItem.presentDays * 1 * 10) / 10,
        approvedOvertimeHours: finalizedItem.overtime > 0 ? Math.round((finalizedItem.overtime / 200) * 10) / 10 : 0,
      },
      earnings: {
        registeredSalary: registered,
        basicSalary: finalizedItem.basicSalary,
        hra: finalizedItem.hra,
        allowances: finalizedItem.allowances,
        specialAllowance: finalizedItem.specialAllowance,
        bonus: finalizedItem.bonus,
        commission: finalizedItem.commission,
        overtime: finalizedItem.overtime,
        reimbursement: finalizedItem.reimbursement,
        otherEarnings: finalizedItem.otherEarnings,
        grossSalary: finalizedItem.grossSalary,
      },
      deductions: {
        lopDays: finalizedItem.unpaidLeaveDays || finalizedItem.absentDays,
        lopDeduction: Math.round(finalizedItem.absentDays * (registered / 30)),
        lateMarks: 0,
        lateDeductions: finalizedItem.lateDeduction ?? 0,
        pf: finalizedItem.pf,
        esi: finalizedItem.esi,
        professionalTax: finalizedItem.professionalTax,
        tds: finalizedItem.tds,
        loanDeduction: finalizedItem.loanDeduction,
        otherDeductions: finalizedItem.otherDeductions,
        totalDeductions: finalizedItem.totalDeductions,
      },
      netPayable: finalizedItem.netSalary,
      fileName,
      generatedAt,
    };
  }

  // -------------------------------------------------------------
  // PROVISIONAL ATTENDANCE-BASED CALCULATION
  // -------------------------------------------------------------
  const [payrollPolicy, salaryPolicy, attendancePolicy] = await Promise.all([
    prisma.payrollPolicy.findUnique({ where: { customerId } }),
    prisma.salaryPolicy.findFirst({ where: { customerId, isActive: true } }),
    prisma.attendancePolicy.findFirst({ where: { customerId, isActive: true } }),
  ]);

  const structure = employee.salaryStructures?.[0];
  const registeredSalary = agreedMonthlySalary(structure);
  const basicSalary = structure?.basicSalary ?? registeredSalary;
  const hra = structure?.hra ?? 0;
  const allowances = structure?.allowances ?? 0;
  const specialAllowance = structure?.specialAllowance ?? 0;
  const bonus = structure?.bonus ?? 0;
  const commission = structure?.commission ?? 0;
  const structureOvertime = structure?.overtime ?? 0;
  const otherEarnings = structure?.otherEarnings ?? 0;

  // Attendance records
  const attendances = await prisma.attendance.findMany({
    where: {
      customerId,
      employeeId: numEmpId,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: 'asc' },
  });

  // Approved leaves
  const approvedLeaves = await prisma.leaveRequest.findMany({
    where: {
      customerId,
      employeeId: numEmpId,
      status: 'APPROVED',
      fromDate: { lte: endDate },
      toDate: { gte: startDate },
    },
    include: { leaveType: true },
  });

  const attendanceMetrics = countPayableAttendance({
    year,
    month,
    joiningDate: employee.joiningDate,
    shiftDays: employee.shift?.workingDays,
    workingDaysPerWeek: attendancePolicy?.workingDaysPerWeek || 5,
    attendance: attendances.map((r) => ({ date: r.date, status: r.status })),
    leaves: approvedLeaves.map((l) => {
      const code = l.leaveType?.code?.toUpperCase() || '';
      const name = l.leaveType?.name?.toLowerCase() || '';
      return {
        from: l.fromDate,
        to: l.toDate,
        unpaid: code === 'UL' || code === 'LOP' || name.includes('unpaid') || name.includes('loss of pay'),
      };
    }),
  });

  // Calculate working hours & breaks
  let totalWorkingHours = 0;
  let totalBreakMinutes = 0;
  let lateMarks = 0;
  let earlyDepartures = 0;

  for (const att of attendances) {
    totalWorkingHours += Number(att.workingHours) || 0;
    totalBreakMinutes += Number(att.breakDuration) || 0;
    if (att.isLate || Number(att.lateMinutes) > 0) lateMarks += 1;
    if (String(att.status || '').toUpperCase().includes('EARLY')) earlyDepartures += 1;
  }
  totalWorkingHours = Math.round(totalWorkingHours * 10) / 10;
  const totalBreakHours = Math.round((totalBreakMinutes / 60) * 10) / 10;

  // Approved overtime
  let approvedOvertimeHours = 0;
  let overtimeEarnings = structureOvertime;
  if ((prisma as any).overtimeRequest) {
    const overtimeRequests = await (prisma as any).overtimeRequest.findMany({
      where: {
        customerId,
        employeeId: numEmpId,
        status: 'APPROVED',
        deletedAt: null,
        overtimeDate: { gte: startDate, lte: endDate },
      },
    });
    if (overtimeRequests.length > 0) {
      const extraOtAmt = overtimeRequests.reduce((sum: number, r: any) => sum + (Number(r.calculatedAmount) || 0), 0);
      const extraOtMins = overtimeRequests.reduce((sum: number, r: any) => sum + (Number(r.approvedMinutes) || 0), 0);
      overtimeEarnings += extraOtAmt;
      approvedOvertimeHours = Math.round((extraOtMins / 60) * 10) / 10;
    }
  }

  // Approved claims (Reimbursements)
  let approvedReimbursements = 0;
  const approvedClaims = await prisma.employeeClaim.findMany({
    where: {
      customerId,
      employeeId: numEmpId,
      status: 'APPROVED',
      claimDate: { lte: endDate },
      paymentStatus: { in: ['UNPAID', 'PENDING'] },
    },
  });
  approvedReimbursements = approvedClaims.reduce((sum, c) => sum + (c.approvedAmount ?? c.amount ?? 0), 0);

  // Active Loans
  const activeLoans = await prisma.employeeLoan.findMany({
    where: {
      customerId,
      employeeId: numEmpId,
      status: { in: ['ACTIVE', 'APPROVED'] },
      remainingBalance: { gt: 0 },
    },
  });
  let loanDeduction = 0;
  for (const loan of activeLoans) {
    if (loan.startDate && loan.startDate > endDate) continue;
    const emi = loan.monthlyEmi > 0 ? loan.monthlyEmi : (loan.approvedAmount || loan.loanAmount) / (loan.termMonths || 12);
    loanDeduction += Math.round(Math.min(emi, loan.remainingBalance || emi));
  }

  // Statutory deductions
  const pfPct = payrollPolicy?.pfPercent ?? salaryPolicy?.pfPercent ?? 12.0;
  const esiPct = payrollPolicy?.esiPercent ?? salaryPolicy?.esiPercent ?? 0.75;
  const pf = structure ? structure.pf : Math.round(registeredSalary * (pfPct / 100));
  const esi = structure ? structure.esi : Math.round(registeredSalary * (esiPct / 100));
  const professionalTax = structure?.professionalTax ?? 0;
  const tds = structure?.tds ?? 0;
  const otherDeductions = structure?.otherDeductions ?? 0;

  // Late mark deductions
  const lateDeduction = lateMarkDeduction(
    registeredSalary,
    lateMarks,
    Number(salaryPolicy?.lateArrivalDeductionPct) || 0,
  );

  const statutory = pf + esi + professionalTax + tds + otherDeductions + loanDeduction + lateDeduction;
  const extraEarnings = approvedReimbursements + (overtimeEarnings - structureOvertime);

  const settlement = settleMonthlySalary({
    monthlySalary: registeredSalary,
    lopDays: attendanceMetrics.lopDays,
    otherDeductions: statutory,
    extraEarnings,
  });

  return {
    employee: {
      id: numEmpId,
      code: employeeCode,
      name: employeeName,
      email: employee.email,
      phone: employee.phone,
      department: departmentName,
      designation: designationName,
      joiningDate: employee.joiningDate,
    },
    company: {
      name: companyName,
      logo: customer?.logo || null,
    },
    period: {
      year,
      month,
      monthName,
      startDate,
      endDate,
      periodLabel,
    },
    isProvisional: true,
    payrollStatus: 'PROVISIONAL',
    payrollId: null,
    attendance: {
      calendarDays: attendanceMetrics.calendarDays,
      scheduledDays: attendanceMetrics.workingDays,
      presentDays: attendanceMetrics.presentDays,
      absentDays: attendanceMetrics.absentDays + attendanceMetrics.nonServiceDays,
      halfDays: attendanceMetrics.halfDays,
      paidLeaveDays: attendanceMetrics.paidLeaveDays,
      unpaidLeaveDays: attendanceMetrics.unpaidLeaveDays,
      weeklyOffDays: attendanceMetrics.weeklyOffDays,
      holidayDays: attendanceMetrics.holidayDays,
      lateArrivals: lateMarks,
      earlyDepartures,
      totalWorkingHours,
      totalBreakHours,
      approvedOvertimeHours,
    },
    earnings: {
      registeredSalary,
      basicSalary,
      hra,
      allowances,
      specialAllowance,
      bonus,
      commission,
      overtime: overtimeEarnings,
      reimbursement: approvedReimbursements,
      otherEarnings,
      grossSalary: settlement.gross,
    },
    deductions: {
      lopDays: attendanceMetrics.lopDays,
      lopDeduction: settlement.lopDeduction,
      lateMarks,
      lateDeductions: lateDeduction,
      pf,
      esi,
      professionalTax,
      tds,
      loanDeduction,
      otherDeductions,
      totalDeductions: settlement.totalDeductions,
    },
    netPayable: settlement.net,
    fileName,
    generatedAt,
  };
}
