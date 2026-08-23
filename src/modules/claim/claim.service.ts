import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClaimDto, UpdateClaimDto, ApproveClaimDto, RejectClaimDto, PayClaimDto } from './dto/claim.dto';
import { ClaimStatus } from '@prisma/client';

@Injectable()
export class ClaimService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveCustomerId(customerId: any): number {
    const num = Number(customerId);
    return isNaN(num) || num <= 0 ? 1 : num;
  }

  async getMetrics(customerId: any) {
    const cid = this.resolveCustomerId(customerId);
    const [total, pending, approved, rejected, paid] = await Promise.all([
      this.prisma.employeeClaim.count({ where: { customerId: cid } }),
      this.prisma.employeeClaim.count({ where: { customerId: cid, status: ClaimStatus.PENDING } }),
      this.prisma.employeeClaim.count({ where: { customerId: cid, status: ClaimStatus.APPROVED } }),
      this.prisma.employeeClaim.count({ where: { customerId: cid, status: ClaimStatus.REJECTED } }),
      this.prisma.employeeClaim.count({ where: { customerId: cid, status: ClaimStatus.PAID } }),
    ]);

    const claims = await this.prisma.employeeClaim.findMany({
      where: { customerId: cid },
      select: { amount: true, approvedAmount: true, status: true },
    });

    const totalClaimed = claims.reduce((sum, c) => sum + (c.amount || 0), 0);
    const totalApproved = claims
      .filter((c) => c.status === ClaimStatus.APPROVED || c.status === ClaimStatus.PAID)
      .reduce((sum, c) => sum + (c.approvedAmount || c.amount || 0), 0);
    const totalPaid = claims
      .filter((c) => c.status === ClaimStatus.PAID)
      .reduce((sum, c) => sum + (c.approvedAmount || c.amount || 0), 0);

    return {
      totalClaims: total,
      pendingClaims: pending,
      approvedClaims: approved,
      rejectedClaims: rejected,
      paidClaims: paid,
      totalClaimed,
      totalApproved,
      totalPaid,
    };
  }

  async findAll(
    customerId: any,
    query?: { status?: ClaimStatus; category?: string; employeeId?: number; search?: string; page?: number; limit?: number },
  ) {
    const cid = this.resolveCustomerId(customerId);
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { customerId: cid };

    if (query?.status) {
      where.status = query.status;
    }
    if (query?.category && query.category !== 'ALL') {
      where.category = query.category;
    }
    if (query?.employeeId) {
      where.employeeId = Number(query.employeeId);
    }
    if (query?.search) {
      const q = query.search.trim();
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
        { employee: { firstName: { contains: q, mode: 'insensitive' } } },
        { employee: { lastName: { contains: q, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.employeeClaim.findMany({
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
      this.prisma.employeeClaim.count({ where }),
    ]);

    const formatted = items.map((claim) => ({
      ...claim,
      employeeName: `${claim.employee?.firstName || ''} ${claim.employee?.lastName || ''}`.trim() || 'Staff Member',
      department: claim.employee?.department?.name || 'General',
      designation: claim.employee?.designation?.name || 'Staff',
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
    const claim = await this.prisma.employeeClaim.findFirst({
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

    if (!claim) {
      throw new NotFoundException(`Expense Claim record with ID #${id} not found`);
    }

    return {
      ...claim,
      employeeName: `${claim.employee?.firstName || ''} ${claim.employee?.lastName || ''}`.trim() || 'Staff Member',
      department: claim.employee?.department?.name || 'General',
      designation: claim.employee?.designation?.name || 'Staff',
    };
  }

  async create(customerId: any, dto: CreateClaimDto) {
    const cid = this.resolveCustomerId(customerId);
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, customerId: cid },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID #${dto.employeeId} not found`);
    }

    const claimDate = dto.claimDate ? new Date(dto.claimDate) : new Date();

    return this.prisma.employeeClaim.create({
      data: {
        customerId: cid,
        employeeId: dto.employeeId,
        category: dto.category.toUpperCase(),
        amount: dto.amount,
        description: dto.description,
        claimDate,
        receiptUrl: dto.receiptUrl,
        status: ClaimStatus.PENDING,
        paymentStatus: 'UNPAID',
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

  async update(customerId: any, id: string | number, dto: UpdateClaimDto) {
    const cid = this.resolveCustomerId(customerId);
    await this.findOne(cid, id);

    return this.prisma.employeeClaim.update({
      where: { id: Number(id) },
      data: {
        category: dto.category ? dto.category.toUpperCase() : undefined,
        amount: dto.amount,
        approvedAmount: dto.approvedAmount,
        description: dto.description,
        receiptUrl: dto.receiptUrl,
        status: dto.status,
      },
    });
  }

  async approve(customerId: any, id: string | number, dto: ApproveClaimDto, reviewer?: any) {
    const cid = this.resolveCustomerId(customerId);
    await this.findOne(cid, id);

    return this.prisma.employeeClaim.update({
      where: { id: Number(id) },
      data: {
        status: ClaimStatus.APPROVED,
        approvedAmount: dto.approvedAmount,
        reviewedById: reviewer?.id || null,
        reviewedByName: reviewer ? `${reviewer.firstName || ''} ${reviewer.lastName || ''}`.trim() : 'HR Administrator',
        reviewedAt: new Date(),
      },
    });
  }

  async reject(customerId: any, id: string | number, dto: RejectClaimDto, reviewer?: any) {
    const cid = this.resolveCustomerId(customerId);
    await this.findOne(cid, id);

    return this.prisma.employeeClaim.update({
      where: { id: Number(id) },
      data: {
        status: ClaimStatus.REJECTED,
        rejectionReason: dto.rejectionReason,
        reviewedById: reviewer?.id || null,
        reviewedByName: reviewer ? `${reviewer.firstName || ''} ${reviewer.lastName || ''}`.trim() : 'HR Administrator',
        reviewedAt: new Date(),
      },
    });
  }

  async markAsPaid(customerId: any, id: string | number, dto?: PayClaimDto) {
    const cid = this.resolveCustomerId(customerId);
    await this.findOne(cid, id);

    return this.prisma.employeeClaim.update({
      where: { id: Number(id) },
      data: {
        status: ClaimStatus.PAID,
        paymentStatus: 'PAID',
        paidAt: new Date(),
      },
    });
  }

  async remove(customerId: any, id: string | number) {
    const cid = this.resolveCustomerId(customerId);
    await this.findOne(cid, id);

    return this.prisma.employeeClaim.delete({
      where: { id: Number(id) },
    });
  }
}
