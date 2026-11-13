import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
    const row = await this.prisma.employee.findFirst({
      where: { customerId, userId },
      include: { designation: true },
    });
    if (!row) throw new NotFoundException('Employee profile not found');
    return row;
  }

  private range(query: { period?: string; startDate?: string; endDate?: string }) {
    if (query.startDate || query.endDate) {
      const gte = query.startDate ? new Date(query.startDate) : undefined;
      const lte = query.endDate ? new Date(query.endDate) : undefined;
      if ((gte && !Number.isFinite(+gte)) || (lte && !Number.isFinite(+lte))) throw new BadRequestException('Invalid date range.');
      if (lte) lte.setHours(23, 59, 59, 999);
      if (gte && lte && gte > lte) throw new BadRequestException('Start date must precede end date.');
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
    if (period !== 'this_month') throw new BadRequestException('Unsupported earnings period.');
    return { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
  }

  private async summary(customerId: number, employeeId: number, createdAt?: { gte?: Date; lte?: Date }, db: Prisma.TransactionClient = this.prisma) {
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
    const [earned, reserved, paidOut, closed, leadSales] = await Promise.all([
      db.commission.aggregate({ where: earnedWhere, _sum: { commissionAmount: true, purchaseAmount: true }, _count: { id: true } }),
      db.commissionWithdrawal.aggregate({ where: { ...withdrawalWhere, status: { in: ['PENDING', 'APPROVED'] } }, _sum: { amount: true } }),
      db.commissionWithdrawal.aggregate({ where: { ...withdrawalWhere, status: 'PAID' }, _sum: { amount: true } }),
      db.commission.groupBy({ by: ['leadId'], where: { ...earnedWhere, leadId: { not: null } } }),
      db.commission.aggregate({ where: { ...earnedWhere, leadId: { not: null } }, _sum: { purchaseAmount: true, commissionAmount: true } }),
    ]);
    const totalEarned = this.round(earned._sum.commissionAmount || 0);
    const totalWithdrawn = this.round(paidOut._sum.amount || 0);
    const pendingWithdrawal = this.round(reserved._sum.amount || 0);
    const sales = this.round(leadSales._sum.purchaseAmount || 0);
    return {
      currency: 'INR',
      totalEarned,
      totalWithdrawn,
      pendingWithdrawal,
      availableBalance: this.round(Math.max(0, totalEarned - pendingWithdrawal - totalWithdrawn)),
      leadsClosed: closed.length,
      totalSalesValue: sales,
      averageCommissionRate: sales > 0 ? this.round(((leadSales._sum.commissionAmount || 0) / sales) * 100) : 0,
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

  private roleNames(roles: unknown) {
    if (Array.isArray(roles)) return roles.map((role) => String(role).trim().toLowerCase());
    if (typeof roles === 'string' && roles.trim()) return roles.split(',').map((role) => role.trim().toLowerCase());
    return [];
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
    const current = await this.summary(customerId, employee.id);
    return { ...totals, availableBalance: current.availableBalance, period: query.period || 'this_month', daily: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })) };
  }

  async rules(customerId: number, userId: number) {
    const employee = await this.employee(customerId, userId);
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
    })).filter((slab) => {
      const names = this.roleNames(slab.roles);
      return names.length === 0 || names.includes(roleName);
    });
    const config = await this.prisma.commissionConfig.findUnique({ where: { employeeId: employee.id } });
    const rate = config
      ? { type: config.commissionType, value: config.commissionValue, status: config.status }
      : employee.designation?.commissionEnabled
        ? { type: employee.designation.commissionType, value: employee.designation.commissionRate, status: 'ACTIVE' }
        : null;
    const eligible = rate?.status === 'ACTIVE' && rate.value > 0;
    return {
      source: config ? 'EMPLOYEE_RATE' : 'DESIGNATION_RATE',
      eligible,
      note: 'Configured sale-amount slabs are shown for your designation. Credits always use the rate recorded by the commission engine at purchase time; historical credits are not recalculated.',
      slabs,
      employeeRate: rate,
      calculationMethod: rate?.type === 'FIXED'
        ? 'Fixed configured amount per eligible purchase.'
        : 'Purchase amount × recorded commission percentage ÷ 100, rounded to two decimal places.',
      conditions: [
        'An active employee override takes precedence over designation eligibility. An inactive override disables commission.',
        'Commission is generated after successful customer plan payment and attributed to the converting or assigned employee. Closing a lead alone does not create a wallet credit.',
        'Only approved and paid commission records contribute to earnings. Cancelled records are excluded.',
        'This commission engine records one recipient per purchase; no team distribution is configured in this model.',
      ],
      withdrawalRules: 'Use a saved bank or UPI account. Amount must be positive and cannot exceed available funds. Pending and approved requests reserve funds. No additional withdrawal limits or processing SLA are configured. Supported statuses: PENDING, APPROVED, REJECTED, PAID.',
    };
  }

  async transactions(customerId: number, userId: number, query: { page?: string; limit?: string; type?: string; status?: string }) {
    const employee = await this.employee(customerId, userId);
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const limit = Math.max(1, Math.min(50, Math.floor(Number(query.limit) || 20)));
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit)) throw new BadRequestException('Invalid pagination.');
    if (query.type && !['COMMISSION_EARNED', 'WITHDRAWAL', 'REVERSAL'].includes(query.type)) throw new BadRequestException('Invalid transaction type.');
    if (query.status && !['PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'].includes(query.status)) throw new BadRequestException('Invalid transaction status.');
    // UNION pagination avoids truncating either ledger at an arbitrary row cap.
    const ledger = Prisma.sql`
      SELECT 'earn-' || id::text AS id, 'COMMISSION_EARNED' AS type, "leadId", "commissionAmount" AS amount, status::text AS status, 'CREDIT' AS direction, "createdAt"
      FROM commissions WHERE "customerId" = ${customerId} AND "employeeId" = ${employee.id} AND status IN ('APPROVED', 'PAID')
      UNION ALL
      SELECT 'wd-' || id::text, 'WITHDRAWAL', NULL::integer, amount, status::text, 'DEBIT', "requestedAt"
      FROM commission_withdrawals WHERE "customerId" = ${customerId} AND "employeeId" = ${employee.id}
      UNION ALL
      SELECT 'rev-' || id::text, 'REVERSAL', "leadId", "commissionAmount", status::text, 'DEBIT', "updatedAt"
      FROM commissions WHERE "customerId" = ${customerId} AND "employeeId" = ${employee.id} AND status = 'CANCELLED'
    `;
    const filter = Prisma.sql`WHERE (${query.type || null}::text IS NULL OR type = ${query.type || null}) AND (${query.status || null}::text IS NULL OR status = ${query.status || null})`;
    const [data, count] = await Promise.all([
      this.prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM (${ledger}) ledger ${filter} ORDER BY "createdAt" DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
      this.prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total FROM (${ledger}) ledger ${filter}`),
    ]);
    return { data, meta: { page, limit, total: Number(count[0].total) } };
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
    if (body.paymentMethod && (typeof body.paymentMethod !== 'string' || body.paymentMethod.toUpperCase() !== account.paymentMethod)) {
      throw new BadRequestException('Payment method does not match the saved account.');
    }
    const rawAmount = Number(body.amount);
    if (!Number.isFinite(rawAmount) || Math.abs(rawAmount * 100 - Math.round(rawAmount * 100)) > 0.00001) throw new BadRequestException('Amount must have at most two decimal places.');
    const amount = this.round(rawAmount);
    if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 128) throw new BadRequestException('A valid idempotency key is required.');
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Enter a valid withdrawal amount.');
    return this.prisma.$transaction(async (tx) => {
      // Serialize balance checks and reservations for this employee, including retries.
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employee.id} AND "customerId" = ${customerId} FOR UPDATE`;
      if (body.idempotencyKey) {
        const existing = await tx.commissionWithdrawal.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
        if (existing) {
          if (existing.customerId !== customerId || existing.employeeId !== employee.id || existing.amount !== amount || existing.accountRef !== account.id) {
            throw new ConflictException('Idempotency key is already in use for another request.');
          }
          return existing;
        }
      }
      const balance = await this.summary(customerId, employee.id, undefined, tx);
      if (amount > balance.availableBalance) throw new BadRequestException('Amount exceeds the available commission balance.');
      const created = await tx.commissionWithdrawal.create({
        data: {
          customerId,
          employeeId: employee.id,
          amount,
          method: account.paymentMethod,
          accountRef: account.id,
          accountLabel: account.label,
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
          totalEarned,
          totalWithdrawn,
          pendingWithdrawal,
          availableBalance: this.round(Math.max(0, totalEarned - pendingWithdrawal - totalWithdrawn)),
          walletStatus: totalEarned - pendingWithdrawal - totalWithdrawn > 0 ? 'AVAILABLE' : 'SETTLED',
        };
      }),
    };
  }

  async adminWithdrawals(customerId: number) {
    return {
      data: await this.prisma.commissionWithdrawal.findMany({
        where: { customerId },
        include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
        orderBy: { requestedAt: 'desc' },
        take: 100,
      }),
    };
  }

  async adminRules(customerId: number) {
    return { data: await this.prisma.commissionSlab.findMany({ where: { customerId }, orderBy: { minAmount: 'asc' } }) };
  }

  async saveSlab(customerId: number, body: { name?: string; minAmount?: number; maxAmount?: number | null; ratePercent?: number; roles?: unknown; startsAt?: string; endsAt?: string }) {
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
        maxAmount: body.maxAmount == null ? null : Number(body.maxAmount),
        ratePercent: rate,
        roles: body.roles == null ? undefined : body.roles as Prisma.InputJsonValue,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        isActive: true,
      },
    });
  }

  async setWithdrawalStatus(customerId: number, id: number, action: string, userId?: number, confirmation?: { paymentReference?: string; processingConfirmed?: boolean }) {
    const next = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : action === 'paid' ? 'PAID' : '';
    if (!next) throw new BadRequestException('Unknown withdrawal action.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM commission_withdrawals WHERE id = ${id} AND "customerId" = ${customerId} FOR UPDATE`;
      const row = await tx.commissionWithdrawal.findFirst({ where: { id, customerId } });
      if (!row) throw new NotFoundException('Withdrawal not found.');
      const reference = typeof confirmation?.paymentReference === 'string' ? confirmation.paymentReference.trim() : row.paymentReference;
      if (next === 'PAID' && (row.status !== 'APPROVED' || !reference || confirmation?.processingConfirmed !== true)) {
        throw new BadRequestException('Payment requires an approved withdrawal and a recorded processing reference.');
      }
      if (row.status === 'PAID' || row.status === 'REJECTED') {
        throw new BadRequestException(`A ${row.status.toLowerCase()} withdrawal cannot be changed.`);
      }
      return tx.commissionWithdrawal.update({
        where: { id: row.id },
        data: {
          status: next as any,
          decidedAt: row.decidedAt ?? new Date(),
          paidAt: next === 'PAID' ? new Date() : null,
          ...(next === 'PAID' ? { paymentReference: reference } : {}),
          decidedById: userId || row.decidedById,
        },
      });
    });
  }
}
