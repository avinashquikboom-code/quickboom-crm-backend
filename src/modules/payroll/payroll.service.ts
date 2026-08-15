import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  async calculatePayroll(tenantId: string, month: number, year: number, departmentId?: string) {
    // 1. Fetch active employees
    const whereClause: any = { tenantId, status: 'ACTIVE' };
    if (departmentId) {
      whereClause.departmentId = departmentId;
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
      where: { tenantId, month, year, departmentId: departmentId || null },
    });

    if (!payroll) {
      payroll = await this.prisma.payroll.create({
        data: {
          tenantId,
          month,
          year,
          departmentId: departmentId || null,
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
        tenantId,
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

  async previewPayroll(tenantId: string, month: number, year: number, departmentId?: string) {
    const whereClause: any = { tenantId, status: 'ACTIVE' };
    if (departmentId) {
      whereClause.departmentId = departmentId;
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
        department: e.departmentId || 'Engineering',
        basic: e.salaryStructures[0]?.basicSalary || 35000,
        net: e.salaryStructures[0]?.netSalary || 56500,
      })),
    };
  }

  async approvePayroll(tenantId: string, payrollId: string) {
    return this.prisma.payroll.update({
      where: { id: payrollId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });
  }

  async generatePayroll(tenantId: string, payrollId: string) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      include: { items: true },
    });

    if (!payroll) {
      throw new NotFoundException('Payroll record not found');
    }

    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const payPeriod = `${monthNames[payroll.month]} ${payroll.year}`;

    for (const item of payroll.items) {
      const slipNum = `SLIP-${payroll.year}${payroll.month.toString().padStart(2, '0')}-${item.employeeId.slice(0, 5).toUpperCase()}`;
      
      const existing = await this.prisma.salarySlip.findFirst({
        where: { payrollItemId: item.id },
      });

      if (!existing) {
        await this.prisma.salarySlip.create({
          data: {
            tenantId,
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

    return this.prisma.payroll.update({
      where: { id: payrollId },
      data: {
        status: 'GENERATED',
      },
    });
  }

  async disbursePayroll(tenantId: string, payrollId: string) {
    return this.prisma.payroll.update({
      where: { id: payrollId },
      data: {
        status: 'PAID',
        disbursedAt: new Date(),
      },
    });
  }

  async getPayrolls(tenantId: string) {
    return this.prisma.payroll.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
      },
    });
  }

  async getPayrollById(tenantId: string, id: string) {
    return this.prisma.payroll.findFirst({
      where: { id, tenantId },
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

  async getSalarySlips(tenantId: string) {
    return this.prisma.salarySlip.findMany({
      where: { tenantId },
      orderBy: { generatedAt: 'desc' },
      include: {
        employee: true,
      },
    });
  }

  async getSalarySlipById(tenantId: string, id: string) {
    return this.prisma.salarySlip.findFirst({
      where: { id, tenantId },
      include: {
        employee: true,
        payrollItem: true,
      },
    });
  }
}
