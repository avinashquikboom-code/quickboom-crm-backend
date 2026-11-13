import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';

const EARNED = ['APPROVED', 'PAID'] as const;

@Injectable()
export class CommissionWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadLimits: LeadLimitService,
  ) {}

  private round(value: number) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private async employee(customerId: number, userId: number) {
    const row = await this.prisma.employee.findFirst({ where: { customerId, userId } });
    if (!row) throw new NotFoundException('Employee profile not found');
    return row;
  }

  private range(query: { period?: string; startDate?: string; endDate?: string }) {
    if (query.startDate || query.endDate) {
      const gte = query.startDate ? new Date(query.startDate) : undefined;
      const lte = query.endDate ? new Date(query.endDate) : undefined;
      if (lte) lte.setHours(23, 59, 59, 999);
      return { gte, lte };
    }
    const now = new Date();
    const start = new Date(now);
    const period = String(query.period || 'this_month');
    if (period === 'today') {
      start.setHours(0, 0, 0, 0);
      return { gte: start };
    }
    if (period === 'this_week') {
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      return { gte: start };
    }
    if (period === 'last_month') {
      return {
        gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        lte: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      };
    }
    return { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
  }

  private async summary(customerId: number, employeeId: number, createdAt?: { gte?: Date; lte?: Date }) {
    const earnedWhere: Prisma.CommissionWhereInput = {
      customerId,
      employeeId,
      status: { in: [...EARNED] },
      ...(createdAt ? { createdAt } : {}),
    };
    const withdrawalWhere: Prisma.CommissionWithdrawalWhereInput = {
      customerId,
      employeeId,
      ...(createdAt ? { requestedAt: createdAt } : {}),
    };
    const [earned, reserved, paidOut, closed] = await Promise.all([
      this.prisma.commission.aggregate({ where: earnedWhere, _sum: { commissionAmount: true, purchaseAmount: true }, _count: { id: true } }),
      this.prisma.commissionWithdrawal.aggregate({ where: { ...withdrawalWhere, status: { in: ['PENDING', 'APPROVED'] } }, _sum: { amount: true } }),
      this.prisma.commissionWithdrawal.aggregate({ where: { ...withdrawalWhere, status: 'PAID' }, _sum: { amount: true } }),
      this.prisma.commission.count({ where: { ...earnedWhere, leadId: { not: null } } }),
    ]);
    const totalEarned = this.round(earned._sum.commissionAmount || 0);
    const totalWithdrawn = this.round(paidOut._sum.amount || 0);
    const pendingWithdrawal = this.round(reserved._sum.amount || 0);
    const sales = this.round(earned._sum.purchaseAmount || 0);
    return {
      currency: 'INR',
      totalEarned,
      totalWithdrawn,
      pendingWithdrawal,
      availableBalance: this.round(Math.max(0, totalEarned - pendingWithdrawal - totalWithdrawn)),
      leadsClosed: closed,
      totalSalesValue: sales,
      averageCommissionRate: sales > 0 ? this.round((totalEarned / sales) * 100) : 0,
    };
  }

  private accounts(bankDetails: unknown) {
    const bank = bankDetails && typeof bankDetails === 'object' ? bankDetails as Record<string, unknown> : {};
    const rows = [];
    const upi = String(bank.upiId || bank.upi || bank.vpa || '').trim();
    const account = String(bank.accountNumber || bank.accountNo || '').trim();
    if (upi) rows.push({ id: 'upi', paymentMethod: 'UPI', label: `UPI ${upi.slice(0, 2)}•••${upi.slice(-3)}` });
    if (account) rows.push({ id: 'bank', paymentMethod: 'BANK', label: `Bank ••••${account.slice(-4)}` });
    return rows;
  }

  async wallet(customerId: number, userId: number) {
    const employee = await this.employee(customerId, userId);
    return { ...(await this.summary(customerId, employee.id)), paymentAccounts: this.accounts(employee.bankDetails) };
  }

  async earnings(customerId: number, userId: number, query: { period?: string; startDate?: string; endDate?: string }) {
    const employee = await this.employee(customerId, userId);
    const createdAt = this.range(query);
    const totals = await this.summary(customerId, employee.id, createdAt);
    const rows = await this.prisma.commission.findMany({
      where: { customerId, employeeId: employee.id, status: { in: [...EARNED] }, createdAt },
      select: { commissionAmount: true, createdAt: true },
    });
    const byDay = new Map<string, number>();
    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10);
      byDay.set(key, this.round((byDay.get(key) || 0) + row.commissionAmount));
    }
    return { ...totals, period: query.period || 'this_month', daily: [...byDay.entries()].map(([date, amount]) => ({ date, amount })) };
  }

  async rules(customerId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { customerId, userId },
      include: { designation: { select: { name: true } } },
    });
    if (!employee) throw new NotFoundException('Employee profile not found');
    const now = new Date();
    const roleName = String(employee.designation?.name || '').trim().toLowerCase();
    const slabs = (await this.prisma.commissionSlab.findMany({
      where: {
        customerId,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { minAmount: 'asc' },
    })).filter((slab) => !slab.roles?.trim() || slab.roles.split(',').map((role) => role.trim().toLowerCase()).includes(roleName));
    const config = await this.prisma.commissionConfig.findUnique({ where: { employeeId: employee.id } });
    return {
      source: slabs.length ? 'COMMISSION_SLAB' : 'EMPLOYEE_OR_DESIGNATION_RATE',
      note: 'Wallet credits use existing approved commission records. Slabs are the admin sale-amount rules. If none are active, the employee or designation rate already stored on each commission applies.',
      slabs,
      employeeRate: config ? { type: config.commissionType, value: config.commissionValue, status: config.status } : null,
    };
  }

  async transactions(customerId: number, userId: number, query: { page?: string; limit?: string; type?: string; status?: string }) {
    const employee = await this.employee(customerId, userId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
    const [credits, debits, reversals] = await Promise.all([
      this.prisma.commission.findMany({
        where: { customerId, employeeId: employee.id, status: { in: [...EARNED] } },
        select: { id: true, leadId: true, commissionAmount: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.commissionWithdrawal.findMany({
        where: { customerId, employeeId: employee.id },
        orderBy: { requestedAt: 'desc' },
        take: 200,
      }),
      this.prisma.commission.findMany({
        where: { customerId, employeeId: employee.id, status: 'CANCELLED' },
        select: { id: true, leadId: true, commissionAmount: true, status: true, createdAt: true },
        take: 100,
      }),
    ]);
    let rows = [
      ...credits.map((row) => ({ id: `earn-${row.id}`, type: 'COMMISSION_EARNED', leadId: row.leadId, amount: row.commissionAmount, status: row.status, direction: 'CREDIT', createdAt: row.createdAt })),
      ...debits.map((row) => ({ id: `wd-${row.id}`, type: 'WITHDRAWAL', leadId: null, amount: row.amount, status: row.status, direction: 'DEBIT', createdAt: row.requestedAt })),
      ...reversals.map((row) => ({ id: `rev-${row.id}`, type: 'REVERSAL', leadId: row.leadId, amount: row.commissionAmount, status: row.status, direction: 'DEBIT', createdAt: row.createdAt })),
    ];
    if (query.type) rows = rows.filter((row) => row.type === query.type);
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return { data: rows.slice((page - 1) * limit, page * limit), meta: { page, limit, total: rows.length } };
  }

  async withdrawals(customerId: number, userId: number) {
    const employee = await this.employee(customerId, userId);
    return { data: await this.prisma.commissionWithdrawal.findMany({ where: { customerId, employeeId: employee.id }, orderBy: { requestedAt: 'desc' }, take: 50 }) };
  }

  async requestWithdrawal(customerId: number, userId: number, body: { amount?: number; paymentMethod?: string; paymentAccountId?: string; idempotencyKey?: string }) {
    const employee = await this.employee(customerId, userId);
    const accounts = this.accounts(employee.bankDetails);
    const account = accounts.find((item) => item.id === body.paymentAccountId);
    if (!account) throw new BadRequestException('Select a saved UPI or bank account from your employee profile.');
    if (body.paymentMethod && body.paymentMethod.toUpperCase() !== account.paymentMethod) {
      throw new BadRequestException('Payment method does not match the saved account.');
    }
    const amount = this.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Enter a valid withdrawal amount.');
    return this.prisma.$transaction(async (tx) => {
      if (body.idempotencyKey) {
        const existing = await tx.commissionWithdrawal.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
        if (existing) return existing;
      }
      const balance = await this.summary(customerId, employee.id);
      if (amount > balance.availableBalance) throw new BadRequestException('Amount exceeds the available commission balance.');
      const created = await tx.commissionWithdrawal.create({
        data: {
          customerId,
          employeeId: employee.id,
          amount,
          paymentMethod: account.paymentMethod,
          accountId: account.id,
          idempotencyKey: body.idempotencyKey || null,
          status: 'PENDING',
        },
      });
      return { ...created, availableBalance: this.round(balance.availableBalance - amount) };
    });
  }

  async quota(customerId: number, user: any) {
    const raw = await this.leadLimits.getMyLeadLimit(customerId, user);
    return {
      dailyLimit: raw.daily.limit,
      dailyUsed: raw.daily.used,
      dailyRemaining: raw.daily.remaining,
      monthlyLimit: raw.monthly.limit,
      monthlyUsed: raw.monthly.used,
      monthlyRemaining: raw.monthly.remaining,
      reset: { daily: 'Start of the next calendar day', monthly: 'First day of the next calendar month' },
      source: raw.source,
    };
  }

  async adminDashboard(customerId: number) {
    const [earned, paidOut, pending, closed] = await Promise.all([
      this.prisma.commission.aggregate({ where: { customerId, status: { in: [...EARNED] } }, _sum: { commissionAmount: true, purchaseAmount: true } }),
      this.prisma.commissionWithdrawal.aggregate({ where: { customerId, status: 'PAID' }, _sum: { amount: true } }),
      this.prisma.commissionWithdrawal.aggregate({ where: { customerId, status: { in: ['PENDING', 'APPROVED'] } }, _sum: { amount: true }, _count: { id: true } }),
      this.prisma.commission.count({ where: { customerId, status: { in: [...EARNED] }, leadId: { not: null } } }),
    ]);
    const totalGenerated = this.round(earned._sum.commissionAmount || 0);
    const totalPaid = this.round(paidOut._sum.amount || 0);
    const pendingWithdrawals = this.round(pending._sum.amount || 0);
    return {
      totalGenerated,
      totalPaid,
      pendingWithdrawals,
      pendingCount: pending._count.id,
      availableLiability: this.round(Math.max(0, totalGenerated - totalPaid - pendingWithdrawals)),
      totalClosedLeads: closed,
      totalSalesValue: this.round(earned._sum.purchaseAmount || 0),
    };
  }

  async adminEmployees(customerId: number) {
    const [earned, reserved, paid, employees] = await Promise.all([
      this.prisma.commission.groupBy({ by: ['employeeId'], where: { customerId, status: { in: [...EARNED] } }, _sum: { commissionAmount: true, purchaseAmount: true }, _count: { id: true } }),
      this.prisma.commissionWithdrawal.groupBy({ by: ['employeeId'], where: { customerId, status: { in: ['PENDING', 'APPROVED'] } }, _sum: { amount: true } }),
      this.prisma.commissionWithdrawal.groupBy({ by: ['employeeId'], where: { customerId, status: 'PAID' }, _sum: { amount: true } }),
      this.prisma.employee.findMany({ where: { customerId }, select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } }),
    ]);
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    const ids = new Set([...earned.map((row) => row.employeeId), ...reserved.map((row) => row.employeeId), ...paid.map((row) => row.employeeId)]);
    return {
      data: [...ids].map((id) => {
        const employee = byId.get(id);
        const credit = earned.find((row) => row.employeeId === id);
        const hold = reserved.find((row) => row.employeeId === id);
        const settled = paid.find((row) => row.employeeId === id);
        const totalEarned = this.round(credit?._sum.commissionAmount || 0);
        const pendingWithdrawal = this.round(hold?._sum.amount || 0);
        const totalWithdrawn = this.round(settled?._sum.amount || 0);
        const sales = this.round(credit?._sum.purchaseAmount || 0);
        return {
          employeeId: id,
          name: `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim(),
          employeeCode: employee?.employeeCode || '',
          department: employee?.department?.name || '',
          currency: 'INR',
          totalEarned,
          totalWithdrawn,
          pendingWithdrawal,
          availableBalance: this.round(Math.max(0, totalEarned - pendingWithdrawal - totalWithdrawn)),
          leadsClosed: credit?._count.id || 0,
          totalSalesValue: sales,
          averageCommissionRate: sales > 0 ? this.round((totalEarned / sales) * 100) : 0,
          walletStatus: totalEarned - pendingWithdrawal - totalWithdrawn > 0 ? 'AVAILABLE' : 'SETTLED',
        };
      }),
    };
  }

  async adminWithdrawals(customerId: number) {
    const rows = await this.prisma.commissionWithdrawal.findMany({
      where: { customerId },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    return {
      data: rows.map((row) => ({ ...row, method: row.paymentMethod, accountRef: row.accountId })),
    };
  }

  async adminRules(customerId: number) {
    return { data: await this.prisma.commissionSlab.findMany({ where: { customerId }, orderBy: { minAmount: 'asc' } }) };
  }

  async saveSlab(customerId: number, body: { name?: string; minAmount?: number; maxAmount?: number | null; ratePercent?: number; roles?: string; startsAt?: string; endsAt?: string }) {
    const rate = Number(body.ratePercent);
    const minAmount = Number(body.minAmount);
    if (!body.name?.trim()) throw new BadRequestException('Slab name is required.');
    if (!Number.isFinite(rate) || rate <= 0) throw new BadRequestException('Commission percentage must be greater than zero.');
    if (!Number.isFinite(minAmount) || minAmount < 0) throw new BadRequestException('Minimum sale amount is invalid.');
    return this.prisma.commissionSlab.create({
      data: {
        customerId,
        name: body.name.trim(),
        minAmount,
        maxAmount: body.maxAmount == null || body.maxAmount === ('' as any) ? null : Number(body.maxAmount),
        ratePercent: rate,
        roles: body.roles || null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        isActive: true,
      },
    });
  }

  async setWithdrawalStatus(customerId: number, id: number, action: string) {
    const next = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : action === 'paid' ? 'PAID' : '';
    if (!next) throw new BadRequestException('Unknown withdrawal action.');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.commissionWithdrawal.findFirst({ where: { id, customerId } });
      if (!row) throw new NotFoundException('Withdrawal not found.');
      if (row.status === 'PAID' || row.status === 'REJECTED') {
        throw new BadRequestException(`A ${row.status.toLowerCase()} withdrawal cannot be changed.`);
      }
      return tx.commissionWithdrawal.update({
        where: { id: row.id },
        data: {
          status: next as any,
          decidedAt: row.decidedAt ?? new Date(),
          paidAt: next === 'PAID' ? new Date() : null,
        },
      });
    });
  }
}
