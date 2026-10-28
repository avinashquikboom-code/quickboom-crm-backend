import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLoanDto, UpdateLoanDto, ApproveLoanDto, RejectLoanDto } from './dto/loan.dto';
import { LoanStatus } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class LoanService {
  private readonly logger = new Logger(LoanService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notificationService?: NotificationService,
  ) {}

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

    const where: any = {};
    if (customerId && Number(customerId) > 0) {
      where.customerId = Number(customerId);
    } else {
      where.customerId = cid;
    }

    // Role-based employee scoping:
    // If authenticated user is an Employee (not Super Admin / Tenant Admin), scope to their own employee ID
    const isEmployee =
      query?.user &&
      !['SUPER_ADMIN', 'CUSTOMER_ADMIN', 'COMPANY_ADMIN', 'ADMIN'].includes(String(query.user.role).toUpperCase()) &&
      (String(query.user.role).toUpperCase() === 'EMPLOYEE' || query.user.roleType === 'EMPLOYEE' || query.user.employee != null);

    if (isEmployee) {
      const empId = query.user.employee?.id;
      if (empId) {
        where.employeeId = empId;
      } else {
        const emp = await this.prisma.employee.findFirst({
          where: {
            OR: [
              { userId: query.user.id },
              ...(query.user.email ? [{ email: { equals: query.user.email.trim().toLowerCase(), mode: 'insensitive' as const } }] : []),
            ],
          },
        });
        if (emp) {
          where.employeeId = emp.id;
        }
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
    const numId = Number(id);
    if (!numId || isNaN(numId)) {
      throw new NotFoundException(`Invalid loan ID`);
    }

    const loan = await this.prisma.employeeLoan.findUnique({
      where: { id: numId },
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
    let cid = this.resolveCustomerId(customerId);
    let employeeId = dto.employeeId ? Number(dto.employeeId) : user?.employee?.id;

    if (!employeeId && user) {
      const emp = await this.prisma.employee.findFirst({
        where: {
          OR: [
            { userId: user.id },
            ...(user.email ? [{ email: { equals: user.email.trim().toLowerCase(), mode: 'insensitive' as const } }] : []),
          ],
        },
      });
      if (emp) {
        employeeId = emp.id;
        if (!customerId && emp.customerId) {
          cid = emp.customerId;
        }
      }
    }

    if (!employeeId) {
      throw new BadRequestException('Employee ID is required to submit a loan request');
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID #${employeeId} not found`);
    }

    if (employee.customerId) {
      cid = employee.customerId;
    }

    const loanAmount = Number(dto.loanAmount);
    if (!loanAmount || isNaN(loanAmount) || loanAmount <= 0) {
      throw new BadRequestException('Valid positive loan amount is required');
    }

    const termMonths = Number(dto.termMonths) > 0 ? Number(dto.termMonths) : 12;
    const monthlyEmi = dto.monthlyEmi && dto.monthlyEmi > 0
      ? dto.monthlyEmi
      : Math.round((loanAmount / termMonths) * 100) / 100;

    return this.prisma.employeeLoan.create({
      data: {
        customerId: cid,
        employeeId,
        loanAmount,
        reason: dto.reason?.trim() || 'Employee loan request',
        termMonths,
        monthlyEmi,
        interestRate: dto.interestRate || 0.0,
        remainingBalance: loanAmount,
        status: LoanStatus.PENDING,
        documents: dto.documents || [],
        notes: dto.notes || null,
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
    const startDate = dto.startDate && !isNaN(Date.parse(dto.startDate)) ? new Date(dto.startDate) : new Date();

    const updated = await this.prisma.employeeLoan.update({
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

    // Fire notification non-blocking
    if (this.notificationService && updated.employeeId) {
      this.notificationService
        .sendLoanNotification(updated.employeeId, updated, true)
        .catch((err) => this.logger.error(`Loan approve notification failed: ${err?.message}`));
    }

    return updated;
  }

  async reject(customerId: any, id: string | number, dto: RejectLoanDto, reviewer?: any) {
    const cid = this.resolveCustomerId(customerId);
    const existing = await this.findOne(cid, id);

    if (existing.status === LoanStatus.REJECTED) {
      return existing;
    }

    const updated = await this.prisma.employeeLoan.update({
      where: { id: Number(id) },
      data: {
        status: LoanStatus.REJECTED,
        rejectionReason: dto.rejectionReason,
        approvedById: reviewer?.id || null,
        approvedByName: reviewer ? `${reviewer.firstName || ''} ${reviewer.lastName || ''}`.trim() : 'HR Administrator',
      },
    });

    // Fire notification non-blocking
    if (this.notificationService && updated.employeeId) {
      this.notificationService
        .sendLoanNotification(updated.employeeId, updated, false)
        .catch((err) => this.logger.error(`Loan reject notification failed: ${err?.message}`));
    }

    return updated;
  }

  async remove(customerId: any, id: string | number) {
    const cid = this.resolveCustomerId(customerId);
    await this.findOne(cid, id);

    return this.prisma.employeeLoan.delete({
      where: { id: Number(id) },
    });
  }
}
