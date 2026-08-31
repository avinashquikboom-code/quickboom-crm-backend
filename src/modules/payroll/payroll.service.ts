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
    // 1. Fetch active employees
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
      },
    });

    if (!employees || employees.length === 0) {
      throw new NotFoundException('No active employees found for payroll calculation');
    }

    // 2. Fetch or create Payroll record
    let payroll = await this.prisma.payroll.findFirst({
      where: { customerId: numCustomerId, month, year, departmentId: numDeptId || null },
    });

    if (!payroll) {
      payroll = await this.prisma.payroll.create({
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
    const itemsData = [];

    for (const emp of employees) {
      const structure = emp.salaryStructures[0];
      const basic = structure ? structure.basicSalary : 35000;
      const hra = structure ? structure.hra : 15000;
      const allowances = structure ? structure.allowances : 5000;
      const specialAllowance = structure ? structure.specialAllowance : 5000;
      const bonus = structure ? structure.bonus : 0;
      const commission = structure ? structure.commission : 0;
      const overtime = structure ? structure.overtime : 0;
      const otherEarnings = structure ? structure.otherEarnings : 0;

      const pf = structure ? structure.pf : Math.round(basic * 0.12);
      const esi = structure ? structure.esi : Math.round(basic * 0.0075);
      const profTax = structure ? structure.professionalTax : 200;
      const tds = structure ? structure.tds : 1500;
      const otherDeductions = structure ? structure.otherDeductions : 0;

      const gross = basic + hra + allowances + specialAllowance + bonus + commission + overtime + otherEarnings;
      const deductions = pf + esi + profTax + tds + otherDeductions;
      const net = gross - deductions;

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
        pf,
        esi,
        professionalTax: profTax,
        tds,
        otherDeductions,
        grossSalary: gross,
        totalDeductions: deductions,
        netSalary: net,
        status: 'CALCULATED',
      });
    }

    // Clear old items and recreate
    await this.prisma.payrollItem.deleteMany({
      where: { payrollId: payroll.id },
    });

    await this.prisma.payrollItem.createMany({
      data: itemsData,
    });

    const updatedPayroll = await this.prisma.payroll.update({
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
            employee: true,
          },
        },
      },
    });

    return updatedPayroll;
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
      },
    });

    return {
      month,
      year,
      totalEmployees: employees.length,
      estimatedGross: employees.length * 65000,
      estimatedDeductions: employees.length * 8500,
      estimatedNet: employees.length * 56500,
      employees: employees.map((e) => ({
        id: e.id,
        code: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`,
        department: e.departmentId ? String(e.departmentId) : 'Engineering',
        basic: e.salaryStructures[0]?.basicSalary || 35000,
        net: e.salaryStructures[0]?.netSalary || 56500,
      })),
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
      // Auto-calculate current month payroll if none exists
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
      throw new NotFoundException('Payroll record not found');
    }

    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const payPeriod = `${monthNames[payroll.month]} ${payroll.year}`;

    for (const item of payroll.items) {
      const slipNum = `SLIP-${payroll.year}${payroll.month.toString().padStart(2, '0')}-${item.employeeId.toString().padStart(4, '0')}`;
      
      const existing = await this.prisma.salarySlip.findFirst({
        where: { payrollItemId: item.id, customerId: numCustomerId },
      });

      if (!existing) {
        await this.prisma.salarySlip.create({
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
      }
    }

    const updated = await this.prisma.payroll.update({
      where: { id: payroll.id },
      data: {
        status: 'GENERATED',
      },
    });

    return {
      success: true,
      message: `Salary slips generated for payroll #${payroll.id}`,
      data: updated,
    };
  }

  async disbursePayroll(customerId: number | string | undefined, payrollId?: number | string) {
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
      throw new NotFoundException('No payroll batch found to disburse. Please calculate and approve payroll first.');
    }

    const updated = await this.prisma.payroll.update({
      where: { id: payroll.id },
      data: {
        status: 'PAID',
        disbursedAt: new Date(),
      },
    });

    return {
      success: true,
      message: `Payroll batch #${payroll.id} disbursed successfully`,
      data: updated,
    };
  }

  async getPayrolls(
    customerId?: number | string,
    query?: { page?: number; limit?: number; month?: number; year?: number },
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { customerId: numCustomerId };
    if (query?.month) where.month = Number(query.month);
    if (query?.year) where.year = Number(query.year);

    const [items, total] = await Promise.all([
      this.prisma.payroll.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          items: true,
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
            employee: true,
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
    if (query?.month) where.month = Number(query.month);
    if (query?.year) where.year = Number(query.year);

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
          employee: true,
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
        employee: true,
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
      // Default generated rolling history based on active employees if no locked payrolls
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

    return payrolls.reverse().map((p) => ({
      month: monthNames[p.month - 1] || `M${p.month}`,
      year: p.year,
      gross: p.grossSalary,
      net: p.netSalary,
      deductions: p.totalDeductions,
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
}

