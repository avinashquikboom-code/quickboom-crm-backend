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

  async findAll(customerId: any, filters?: { status?: LoanStatus; employeeId?: number; search?: string }) {
    const cid = this.resolveCustomerId(customerId);
    const where: any = { customerId: cid };

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.employeeId) {
      where.employeeId = Number(filters.employeeId);
    }
    if (filters?.search) {
      const q = filters.search.trim();
      where.OR = [
        { reason: { contains: q, mode: 'insensitive' } },
        { employee: { firstName: { contains: q, mode: 'insensitive' } } },
        { employee: { lastName: { contains: q, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const items = await this.prisma.employeeLoan.findMany({
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
    });

    return items.map((loan) => ({
      ...loan,
      employeeName: `${loan.employee?.firstName || ''} ${loan.employee?.lastName || ''}`.trim() || 'Staff Member',
      department: loan.employee?.department?.name || 'General',
      designation: loan.employee?.designation?.name || 'Staff',
    }));
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

  async create(customerId: any, dto: CreateLoanDto) {
    const cid = this.resolveCustomerId(customerId);
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, customerId: cid },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID #${dto.employeeId} not found`);
    }

    const termMonths = dto.termMonths || 12;
    const monthlyEmi = dto.monthlyEmi || Math.round((dto.loanAmount / termMonths) * 100) / 100;

    return this.prisma.employeeLoan.create({
      data: {
        customerId: cid,
        employeeId: dto.employeeId,
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

    const termMonths = dto.termMonths || existing.termMonths || 12;
    const monthlyEmi = dto.monthlyEmi || Math.round((dto.approvedAmount / termMonths) * 100) / 100;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();

    return this.prisma.employeeLoan.update({
      where: { id: Number(id) },
      data: {
        status: LoanStatus.ACTIVE,
        approvedAmount: dto.approvedAmount,
        termMonths,
        monthlyEmi,
        startDate,
        remainingBalance: dto.approvedAmount,
        approvedById: reviewer?.id || null,
        approvedByName: reviewer ? `${reviewer.firstName || ''} ${reviewer.lastName || ''}`.trim() : 'HR Administrator',
        notes: dto.notes || existing.notes,
      },
    });
  }

  async reject(customerId: any, id: string | number, dto: RejectLoanDto, reviewer?: any) {
    const cid = this.resolveCustomerId(customerId);
    await this.findOne(cid, id);

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
