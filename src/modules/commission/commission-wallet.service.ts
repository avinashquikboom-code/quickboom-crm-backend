import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';

const EARNED = ['APPROVED', 'PAID'] as const;
const RESERVED = ['PENDING', 'APPROVED', 'PAID'] as const;

@Injectable()
export class CommissionWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadLimits: LeadLimitService,
  ) {}

  private async employeeForUser(customerId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { customerId, userId },
    });
    if (!employee) throw new NotFoundException('Employee profile not found');
    return employee;
  }

  private round(value: number) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private async totals(customerId: number, employeeId: number, range?: { gte?: Date; lte?: Date }) {
    const earnedWhere: Prisma.CommissionWhereInput = {
      customerId,
      employeeId,
      status: { in: [...EARNED] },
      ...(range ? { createdAt: range } : {}),
    };
    const withdrawalWhere: Prisma.CommissionWithdrawalWhereInput = {
      customerId,
      employeeId,
      status: { in: [...RESERVED] },
      ...(range ? { requestedAt: range } : {}),
    };
    const [earned, reserved, paidOut, pendingHold, closed] = await Promise.all([
      this.prisma.commission.aggregate({ where: earnedWhere, _sum: { commissionAmount: true, purchaseAmount: true }, _count: { id: true } }),
      this.prisma.commissionWithdrawal.aggregate({ where: withdrawalWhere, _sum: { amount: true } }),
      this.prisma.commissionWithdrawal.aggregate({
        where: { ...withdrawalWhere, status: 'PAID' },
        _sum: { amount: true },
      }),
      this.prisma.commissionWithdrawal.aggregate({
        where: { customerId, employeeId, status: { in: ['PENDING', 'APPROVED'] }, ...(range ? { requestedAt: range } : {}) },
        _sum: { amount: true },
      }),
      this.prisma.commission.count({ where: { ...earnedWhere, leadId: { not: null } } }),
    ]);
    const totalEarned = this.round(earned._sum.commissionAmount || 0);
    const totalWithdrawn = this.round(paidOut._sum.amount || 0);
    const pendingWithdrawal = this.round(pendingHold._sum.amount || 0);
    const reservedAmount = this.round(reserved._sum.amount || 0);
    const sales = this.round(earned._sum.purchaseAmount || 0);
    return {
      totalEarned,
      totalWithdrawn,
      pendingWithdrawal,
      availableBalance: this.round(Math.max(0, totalEarned - reservedAmount)),
      leadsClosed: closed,
      totalSalesValue: sales,
      averageRate: sales > 0 ? this.round((totalEarned / sales) * 100) : 0,
    };
  }

  private range(query: { preset?: string; startDate?: string; endDate?: string }) {
    const now = new Date();
    const start = new Date(now);
    if (query.startDate || query.endDate) {
      const gte = query.startDate ? new Date(query.startDate) : undefined;
      const lte = query.endDate ? new Date(query.endDate) : undefined;
      if (lte) lte.setHours(23, 59, 59, 999);
      return { gte, lte };
    }
    const preset = String(query.preset || 'month').toLowerCase();
    if (preset === 'today') {
      start.setHours(0, 0, 0, 0);
      return { gte: start };
    }
    if (preset === 'week') {
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      return { gte: start };
    }
    if (preset === 'last_month') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { gte: from, lte: to };
    }
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return { gte: start };
  }

  async wallet(customerId: number, userId: number) {
    const employee = await this.employeeForUser(customerId, userId);
    const summary = await this.totals(customerId, employee.id);
    return { employeeId: employee.id, ...summary };
  }

  async earnings(customerId: number, userId: number, query: { preset?: string; startDate?: string; endDate?: string }) {
    const employee = await this.employeeForUser(customerId, userId);
    const summary = await this.totals(customerId, employee.id, this.range(query));
    return { employeeId: employee.id, preset: query.preset || 'month', ...summary };
  }

  async rules(customerId: number) {
    const now = new Date();
    const slabs = await this.prisma.commissionSlab.findMany({
      where: {
        customerId,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { minAmount: 'asc' },
    });
    return { slabs };
  }

  async transactions(customerId: number, userId: number, query: { page?: string; limit?: string; type?: string }) {
    const employee = await this.employeeForUser(customerId, userId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
    const [credits, debits] = await Promise.all([
      this.prisma.commission.findMany({
        where: { customerId, employeeId: employee.id, status: { in: [...EARNED] } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, leadId: true, commissionAmount: true, status: true, createdAt: true },
      }),
      this.prisma.commissionWithdrawal.findMany({
        where: { customerId, employeeId: employee.id },
        orderBy: { requestedAt: 'desc' },
        take: 100,
      }),
    ]);
    let rows = [
      ...credits.map((row) => ({
        id: `c-${row.id}`,
        type: 'COMMISSION_EARNED',
        leadId: row.leadId,
        amount: row.commissionAmount,
        status: row.status,
        direction: 'CREDIT',
        createdAt: row.createdAt,
      })),
      ...debits.map((row) => ({
        id: `w-${row.id}`,
        type: 'WITHDRAWAL',
        leadId: null,
        amount: row.amount,
        status: row.status,
        direction: 'DEBIT',
        createdAt: row.requestedAt,
      })),
    ];
    if (query.type) rows = rows.filter((row) => row.type === query.type);
    rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const start = (page - 1) * limit;
    return { data: rows.slice(start, start + limit), meta: { page, limit, total: rows.length } };
  }

  async requestWithdrawal(
    customerId: number,
    userId: number,
    dto: { amount: number; method: string; accountLabel?: string; accountRef?: string; idempotencyKey?: string },
  ) {
    const employee = await this.employeeForUser(customerId, userId);
    const amount = this.round(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Enter a valid withdrawal amount.');
    if (!['BANK', 'UPI'].includes(String(dto.method || '').toUpperCase())) {
      throw new BadRequestException('Select a bank account or UPI method.');
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.idempotencyKey) {
        const existing = await tx.commissionWithdrawal.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
        if (existing) return existing;
      }
      const summary = await this.totals(customerId, employee.id);
      if (amount > summary.availableBalance) {
        throw new BadRequestException('Withdrawal amount exceeds the available commission balance.');
      }
      return tx.commissionWithdrawal.create({
        data: {
          customerId,
          employeeId: employee.id,
          amount,
          method: dto.method.toUpperCase(),
          accountLabel: dto.accountLabel?.trim() || null,
          accountRef: dto.accountRef?.trim() || null,
          idempotencyKey: dto.idempotencyKey || null,
          status: 'PENDING',
        },
      });
    });
  }

  async myWithdrawals(customerId: number, userId: number) {
    const employee = await this.employeeForUser(customerId, userId);
    const rows = await this.prisma.commissionWithdrawal.findMany({
      where: { customerId, employeeId: employee.id },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    });
    return { data: rows };
  }

  async quota(customerId: number, userId: number, user: any) {
    const employee = await this.employeeForUser(customerId, userId);
    return this.leadLimits.getEmployeeLimitById(customerId, employee.id, user);
  }

  async adminDashboard(customerId: number) {
    const [earned, paidOut, pending, sales, leads] = await Promise.all([
      this.prisma.commission.aggregate({ where: { customerId, status: { in: [...EARNED] } }, _sum: { commissionAmount: true, purchaseAmount: true } }),
      this.prisma.commissionWithdrawal.aggregate({ where: { customerId, status: 'PAID' }, _sum: { amount: true } }),
      this.prisma.commissionWithdrawal.aggregate({ where: { customerId, status: { in: ['PENDING', 'APPROVED'] } }, _sum: { amount: true }, _count: { id: true } }),
      this.prisma.commission.aggregate({ where: { customerId, status: { in: [...EARNED] } }, _sum: { purchaseAmount: true } }),
      this.prisma.commission.count({ where: { customerId, status: { in: [...EARNED] }, leadId: { not: null } } }),
    ]);
    const generated = this.round(earned._sum.commissionAmount || 0);
    const paid = this.round(paidOut._sum.amount || 0);
    const reserved = this.round(pending._sum.amount || 0);
    return {
      totalGenerated: generated,
      totalPaid: paid,
      pendingWithdrawals: pending._count.id || 0,
      pendingWithdrawalAmount: reserved,
      availableLiability: this.round(Math.max(0, generated - paid - reserved)),
      totalClosedLeads: leads,
      totalSalesValue: this.round(sales._sum.purchaseAmount || 0),
    };
  }

  async adminEmployees(customerId: number) {
    const employees = await this.prisma.employee.findMany({
      where: { customerId },
      select: { id: true, employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } } },
      take: 200,
    });
    const rows = [];
    for (const employee of employees) {
      const summary = await this.totals(customerId, employee.id);
      if (!summary.totalEarned && !summary.pendingWithdrawal) continue;
      rows.push({
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        department: employee.department?.name || '',
        ...summary,
        walletStatus: summary.availableBalance > 0 ? 'ACTIVE' : 'SETTLED',
      });
    }
    return { data: rows };
  }

  async setWithdrawalStatus(
    customerId: number,
    id: number,
    status: 'APPROVED' | 'REJECTED' | 'PAID',
    actorUserId: number,
    body: { remarks?: string; paymentReference?: string },
  ) {
    const row = await this.prisma.commissionWithdrawal.findFirst({ where: { id, customerId } });
    if (!row) throw new NotFoundException('Withdrawal request not found');
    if (row.status === 'PAID') throw new BadRequestException('This withdrawal is already paid.');
    if (row.status === 'REJECTED') throw new BadRequestException('This withdrawal was rejected.');
    if (status === 'APPROVED' && row.status !== 'PENDING') throw new BadRequestException('Only pending requests can be approved.');
    if (status === 'PAID' && !['PENDING', 'APPROVED'].includes(row.status)) {
      throw new BadRequestException('Only approved requests can be marked paid.');
    }
    return this.prisma.commissionWithdrawal.update({
      where: { id: row.id },
      data: {
        status,
        remarks: body.remarks?.trim() || row.remarks,
        paymentReference: body.paymentReference?.trim() || row.paymentReference,
        decidedById: actorUserId,
        decidedAt: status === 'PAID' ? row.decidedAt || new Date() : new Date(),
        paidAt: status === 'PAID' ? new Date() : null,
      },
    });
  }

  async upsertSlab(customerId: number, dto: { id?: number; name: string; minAmount: number; maxAmount?: number; ratePercent: number; isActive?: boolean }) {
    const data = {
      customerId,
      name: dto.name.trim(),
      minAmount: Number(dto.minAmount) || 0,
      maxAmount: dto.maxAmount == null ? null : Number(dto.maxAmount),
      ratePercent: Number(dto.ratePercent) || 0,
      isActive: dto.isActive !== false,
    };
    if (dto.id) {
      const existing = await this.prisma.commissionSlab.findFirst({ where: { id: dto.id, customerId } });
      if (!existing) throw new NotFoundException('Commission slab not found');
      return this.prisma.commissionSlab.update({ where: { id: existing.id }, data });
    }
    return this.prisma.commissionSlab.create({ data });
  }

  async listSlabs(customerId: number) {
    return { data: await this.prisma.commissionSlab.findMany({ where: { customerId }, orderBy: { minAmount: 'asc' } }) };
  }

  async listWithdrawals(customerId: number, status?: string) {
    return {
      data: await this.prisma.commissionWithdrawal.findMany({
        where: { customerId, ...(status ? { status: status as any } : {}) },
        include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
        orderBy: { requestedAt: 'desc' },
        take: 100,
      }),
    };
  }
}
