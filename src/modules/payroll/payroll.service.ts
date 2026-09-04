import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

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

  async calculatePayroll(customerId: number | string | undefined, month: number, year: number, departmentId?: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numDeptId = departmentId && !isNaN(Number(departmentId)) ? Number(departmentId) : undefined;

    // Period date bounds
    const periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

    // 1. Fetch Policy for Customer
    const [payrollPolicy, salaryPolicy] = await Promise.all([
      this.prisma.payrollPolicy.findUnique({ where: { customerId: numCustomerId } }),
      this.prisma.salaryPolicy.findFirst({ where: { customerId: numCustomerId, isActive: true } }),
    ]);

    const workingDaysConfig = payrollPolicy?.workingDaysPerMonth || salaryPolicy?.workingDaysPerMonth || 30;
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
        const basic = structure ? structure.basicSalary : 35000;
        const hra = structure ? structure.hra : Math.round(basic * 0.4);
        const allowances = structure ? structure.allowances : 5000;
        const specialAllowance = structure ? structure.specialAllowance : 5000;
        const bonus = structure ? structure.bonus : 0;
        const overtime = structure ? structure.overtime : 0;
        const otherEarnings = structure ? structure.otherEarnings : 0;

        // ── Commission Integration ──
        let commission = structure ? structure.commission : 0;
        if (commission === 0 && commissionEnabled && commissionPctConfig > 0) {
          commission = Math.round((basic * commissionPctConfig) / 100);
        }

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

        const presentCount = attendances.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
        const halfDayCount = attendances.filter((a) => a.status === 'HALF_DAY').length;
        const wfhCount = attendances.filter((a) => a.workMode === 'WFH' || a.workMode === 'REMOTE').length;

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

        let paidLeaveDays = 0;
        let unpaidLeaveDays = 0;

        for (const lr of approvedLeaves) {
          const code = lr.leaveType?.code?.toUpperCase() || '';
          const name = lr.leaveType?.name?.toLowerCase() || '';
          const isUnpaid =
            code === 'UL' ||
            code === 'LOP' ||
            name.includes('unpaid') ||
            name.includes('loss of pay') ||
            name.includes('lop');

          if (isUnpaid) {
            unpaidLeaveDays += lr.days || 1;
          } else {
            paidLeaveDays += lr.days || 1;
          }
        }

        // Compute total effective attended / payable days
        const effectivePresentDays = Math.min(
          workingDaysConfig,
          Math.round(presentCount + halfDayCount * 0.5 + paidLeaveDays + wfhCount),
        );
        const absentDays = Math.max(0, workingDaysConfig - effectivePresentDays - unpaidLeaveDays);

        // Unpaid leave deduction
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
          presentDays: effectivePresentDays,
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

  async generatePayroll(customerId: number | string | undefined, payrollId?: number | string) {
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
      throw new NotFoundException('Payroll record not found. Please calculate payroll first.');
    }

    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const payPeriod = `${monthNames[payroll.month] || `M${payroll.month}`} ${payroll.year}`;

    return this.prisma.$transaction(async (tx) => {
      for (const item of payroll.items) {
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
              status: 'GENERATED',
            },
          });
        } else {
          await tx.salarySlip.update({
            where: { id: existing.id },
            data: {
              grossSalary: item.grossSalary,
              totalDeductions: item.totalDeductions,
              netSalary: item.netSalary,
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
        message: `Salary slips generated for payroll #${payroll.id}`,
        data: updated,
      };
    });
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

    if (query?.user && (query.user.role === 'EMPLOYEE' || query.user.roleType === 'EMPLOYEE')) {
      const emp = await this.prisma.employee.findFirst({
        where: {
          OR: [
            { userId: query.user.id },
            { email: { equals: query.user.email?.trim().toLowerCase(), mode: 'insensitive' } },
          ],
        },
      });
      if (emp) {
        where.employeeId = emp.id;
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

    const [items, total] = await Promise.all([
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
            },
          },
          payrollItem: true,
        },
      }),
      this.prisma.salarySlip.count({ where }),
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

  async getSalarySlipById(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const numId = Number(id);
    return this.prisma.salarySlip.findFirst({
      where: { id: numId, customerId: numCustomerId },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
        payrollItem: true,
      },
    });
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

    if (data.id) {
      return this.prisma.salaryStructure.update({
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
    }

    return this.prisma.salaryStructure.create({
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

