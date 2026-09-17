import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClaimDto, UpdateClaimDto, ApproveClaimDto, RejectClaimDto, PayClaimDto } from './dto/claim.dto';
import { ClaimStatus } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ClaimService {
  private readonly logger = new Logger(ClaimService.name);

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
    query?: {
      user?: any;
      status?: ClaimStatus;
      category?: string;
      employeeId?: number;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const cid = this.resolveCustomerId(customerId);
    const page = Math.max(Number(query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { customerId: cid };

    // If calling user is an Employee role, auto-scope to their own employee ID
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
    } else if (query?.employeeId) {
      where.employeeId = Number(query.employeeId);
    }

    if (query?.status) {
      where.status = query.status;
    }
    if (query?.category && query.category !== 'ALL') {
      where.category = query.category;
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

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: items.map((c) => ({
        ...c,
        employeeName: `${c.employee?.firstName || ''} ${c.employee?.lastName || ''}`.trim() || 'Staff Member',
        department: c.employee?.department?.name || 'General',
        designation: c.employee?.designation?.name || 'Staff',
      })),
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

  async create(customerId: any, dto: CreateClaimDto, user?: any) {
    const cid = this.resolveCustomerId(customerId);

    let employeeId = dto.employeeId;
    if (!employeeId && user) {
      const emp = await this.prisma.employee.findFirst({
        where: {
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
      throw new NotFoundException('Employee ID is required to submit a claim');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId: cid },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID #${employeeId} not found`);
    }

    const claimDate = dto.claimDate ? new Date(dto.claimDate) : new Date();

    return this.prisma.employeeClaim.create({
      data: {
        customerId: cid,
        employeeId: employeeId,
        category: (dto.category || 'GENERAL').toUpperCase(),
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
    const existing = await this.findOne(cid, id);

    if (existing.status === ClaimStatus.APPROVED || existing.status === ClaimStatus.PAID) {
      return existing;
    }

    const approvedAmount = dto.approvedAmount !== undefined && dto.approvedAmount !== null ? dto.approvedAmount : existing.amount;

    const updated = await this.prisma.employeeClaim.update({
      where: { id: Number(id) },
      data: {
        status: ClaimStatus.APPROVED,
        approvedAmount,
        reviewedById: reviewer?.id || null,
        reviewedByName: reviewer ? `${reviewer.firstName || ''} ${reviewer.lastName || ''}`.trim() : 'HR Administrator',
        reviewedAt: new Date(),
      },
    });

    // Fire notification non-blocking
    if (this.notificationService && updated.employeeId) {
      this.notificationService
        .sendClaimNotification(updated.employeeId, updated, true)
        .catch((err) => this.logger.error(`Claim approve notification failed: ${err?.message}`));
    }

    return updated;
  }

  async reject(customerId: any, id: string | number, dto: RejectClaimDto, reviewer?: any) {
    const cid = this.resolveCustomerId(customerId);
    const existing = await this.findOne(cid, id);

    if (existing.status === ClaimStatus.REJECTED) {
      return existing;
    }

    const updated = await this.prisma.employeeClaim.update({
      where: { id: Number(id) },
      data: {
        status: ClaimStatus.REJECTED,
        rejectionReason: dto.rejectionReason || 'Declined by Administrator / HR',
        reviewedById: reviewer?.id || null,
        reviewedByName: reviewer ? `${reviewer.firstName || ''} ${reviewer.lastName || ''}`.trim() : 'HR Administrator',
        reviewedAt: new Date(),
      },
    });

    // Fire notification non-blocking
    if (this.notificationService && updated.employeeId) {
      this.notificationService
        .sendClaimNotification(updated.employeeId, updated, false)
        .catch((err) => this.logger.error(`Claim reject notification failed: ${err?.message}`));
    }

    return updated;
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
