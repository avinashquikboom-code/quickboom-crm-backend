import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLoanDto, UpdateLoanDto, ApproveLoanDto, RejectLoanDto } from './dto/loan.dto';
import { LoanStatus } from '@prisma/client';

@Injectable()
export class LoanService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveCustomerId(customerId: any): number {
    const num = Number(customerId);
    return isNaN(num) || num <= 0 ? 1 : num;
  }

  async getMetrics(customerId: any) {
    const cid = this.resolveCustomerId(customerId);
    const [total, pending, active, approved, rejected, paid] = await Promise.all([
      this.prisma.employeeLoan.count({ where: { customerId: cid } }),
      this.prisma.employeeLoan.count({ where: { customerId: cid, status: LoanStatus.PENDING } }),
      this.prisma.employeeLoan.count({ where: { customerId: cid, status: LoanStatus.ACTIVE } }),
      this.prisma.employeeLoan.count({ where: { customerId: cid, status: LoanStatus.APPROVED } }),
      this.prisma.employeeLoan.count({ where: { customerId: cid, status: LoanStatus.REJECTED } }),
      this.prisma.employeeLoan.count({ where: { customerId: cid, status: LoanStatus.PAID } }),
    ]);

    const activeLoans = await this.prisma.employeeLoan.findMany({
      where: { customerId: cid, status: { in: [LoanStatus.ACTIVE, LoanStatus.APPROVED] } },
      select: { remainingBalance: true, approvedAmount: true, loanAmount: true },
    });

    const totalDisbursed = activeLoans.reduce((sum, l) => sum + (l.approvedAmount || l.loanAmount || 0), 0);
    const totalOutstanding = activeLoans.reduce((sum, l) => sum + (l.remainingBalance || l.approvedAmount || l.loanAmount || 0), 0);

    return {
      totalLoans: total,
      pendingLoans: pending,
      activeLoans: active,
      approvedLoans: approved,
      rejectedLoans: rejected,
      completedLoans: paid,
      totalDisbursed,
      totalOutstanding,
    };
  }

  async findAll(
    customerId: any,
    query?: { user?: any; status?: LoanStatus; employeeId?: number; search?: string; page?: number; limit?: number },
  ) {
    const cid = this.resolveCustomerId(customerId);
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { customerId: cid };

    // If calling user is an Employee role, auto-scope to their own employee ID
    if (query?.user && (String(query.user.role).toUpperCase() === 'EMPLOYEE' || query.user.roleType === 'EMPLOYEE')) {
      const emp = await this.prisma.employee.findFirst({
        where: {
          customerId: cid,
          OR: [
            { userId: query.user.id },
            { email: { equals: query.user.email?.trim().toLowerCase(), mode: 'insensitive' } },
          ],
        },
      });
      if (emp) {
        where.employeeId = emp.id;
      }
    } else if (query?.employeeId) {
      where.employeeId = Number(query.employeeId);
    }

    if (query?.status) {
      where.status = query.status;
    }

    if (query?.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { reason: { contains: q, mode: 'insensitive' } },
        { employee: { firstName: { contains: q, mode: 'insensitive' } } },
        { employee: { lastName: { contains: q, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.employeeLoan.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              department: { select: { name: true } },
              designation: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.employeeLoan.count({ where }),
    ]);

    const formatted = items.map((loan) => ({
      ...loan,
      employeeName: `${loan.employee?.firstName || ''} ${loan.employee?.lastName || ''}`.trim() || 'Staff Member',
      department: loan.employee?.department?.name || 'General',
      designation: loan.employee?.designation?.name || 'Staff',
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: formatted,
      items: formatted,
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

  async findOne(customerId: any, id: string | number) {
    const cid = this.resolveCustomerId(customerId);
    const loan = await this.prisma.employeeLoan.findFirst({
      where: { id: Number(id), customerId: cid },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException(`Loan record with ID #${id} not found`);
    }

    return {
      ...loan,
      employeeName: `${loan.employee?.firstName || ''} ${loan.employee?.lastName || ''}`.trim() || 'Staff Member',
      department: loan.employee?.department?.name || 'General',
      designation: loan.employee?.designation?.name || 'Staff',
    };
  }

  async create(customerId: any, dto: CreateLoanDto, user?: any) {
    const cid = this.resolveCustomerId(customerId);
    let employeeId = dto.employeeId;

    if (!employeeId && user) {
      const emp = await this.prisma.employee.findFirst({
        where: {
          customerId: cid,
          OR: [
            { userId: user.id },
            { email: { equals: user.email?.trim().toLowerCase(), mode: 'insensitive' } },
          ],
        },
      });
      if (emp) {
        employeeId = emp.id;
      }
    }

    if (!employeeId) {
      throw new BadRequestException('Employee ID is required to submit a loan request');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId: cid },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID #${employeeId} not found`);
    }

    const termMonths = dto.termMonths || 12;
    const monthlyEmi = dto.monthlyEmi || Math.round((dto.loanAmount / termMonths) * 100) / 100;

    return this.prisma.employeeLoan.create({
      data: {
        customerId: cid,
        employeeId,
        loanAmount: dto.loanAmount,
        reason: dto.reason,
        termMonths,
        monthlyEmi,
        interestRate: dto.interestRate || 0.0,
        remainingBalance: dto.loanAmount,
        status: LoanStatus.PENDING,
        documents: dto.documents || [],
        notes: dto.notes,
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async update(customerId: any, id: string | number, dto: UpdateLoanDto) {
    const cid = this.resolveCustomerId(customerId);
    await this.findOne(cid, id);

    return this.prisma.employeeLoan.update({
      where: { id: Number(id) },
      data: {
        approvedAmount: dto.approvedAmount,
        monthlyEmi: dto.monthlyEmi,
        termMonths: dto.termMonths,
        remainingBalance: dto.remainingBalance,
        status: dto.status,
        notes: dto.notes,
      },
    });
  }

  async approve(customerId: any, id: string | number, dto: ApproveLoanDto, reviewer?: any) {
    const cid = this.resolveCustomerId(customerId);
    const existing = await this.findOne(cid, id);

    // Idempotency: If already ACTIVE or APPROVED, do not overwrite remaining balance or repeat deduction
    if (existing.status === LoanStatus.ACTIVE || existing.status === LoanStatus.APPROVED) {
      return existing;
    }

    const approvedAmount = dto.approvedAmount || existing.loanAmount;
    const termMonths = dto.termMonths || existing.termMonths || 12;
    const monthlyEmi = dto.monthlyEmi || Math.round((approvedAmount / termMonths) * 100) / 100;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();

    return this.prisma.employeeLoan.update({
      where: { id: Number(id) },
      data: {
        status: LoanStatus.ACTIVE,
        approvedAmount,
        termMonths,
        monthlyEmi,
        startDate,
        remainingBalance: approvedAmount,
        approvedById: reviewer?.id || null,
        approvedByName: reviewer ? `${reviewer.firstName || ''} ${reviewer.lastName || ''}`.trim() : 'HR Administrator',
        notes: dto.notes || existing.notes,
      },
    });
  }

  async reject(customerId: any, id: string | number, dto: RejectLoanDto, reviewer?: any) {
    const cid = this.resolveCustomerId(customerId);
    const existing = await this.findOne(cid, id);

    if (existing.status === LoanStatus.REJECTED) {
      return existing;
    }

    return this.prisma.employeeLoan.update({
      where: { id: Number(id) },
      data: {
        status: LoanStatus.REJECTED,
        rejectionReason: dto.rejectionReason,
        approvedById: reviewer?.id || null,
        approvedByName: reviewer ? `${reviewer.firstName || ''} ${reviewer.lastName || ''}`.trim() : 'HR Administrator',
      },
    });
  }

  async remove(customerId: any, id: string | number) {
    const cid = this.resolveCustomerId(customerId);
    await this.findOne(cid, id);

    return this.prisma.employeeLoan.delete({
      where: { id: Number(id) },
    });
  }
}
