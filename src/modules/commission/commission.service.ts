import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isBpoPayrollEmployee } from '../payroll/payroll-attendance';
import {
  CommissionType,
  CommissionConfigStatus,
  CommissionStatus,
  Prisma,
} from '@prisma/client';
import {
  CommissionFilterDto,
  UpdateCommissionStatusDto,
  UpsertEmployeeCommissionConfigDto,
  UpdateDesignationCommissionDto,
} from './dto/commission.dto';

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Main commission generator triggered when a Customer Plan Purchase payment is successful.
   * STRICT IDEMPOTENCY: Duplicate payment webhooks/calls will NOT generate duplicate commissions.
   */
  async calculateAndAwardCommission(params: {
    customerId: number;
    purchaseId: number;
    purchaseAmount: number;
    planId?: number | null;
    orderId?: string | null;
    tx?: Prisma.TransactionClient;
  }): Promise<any> {
    if (!params.tx) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.prisma.$transaction(tx => this.calculateAndAwardCommission({ ...params, tx }), { isolationLevel: 'Serializable' });
        } catch (error: any) {
          if (error.code === 'P2002') {
            const payment = await this.prisma.paymentHistory.findUnique({ where: { id: params.purchaseId } });
            const existing = await this.prisma.commission.findFirst({ where: { OR: [{ purchaseId: params.purchaseId }, ...(payment?.paymentId ? [{ sourceKey: `gateway:${payment.paymentMethod}:${payment.paymentId}` }] : [])] }, include: { shares: true } });
            if (!existing || existing.customerId !== params.customerId) throw error;
            return existing;
          }
          if (error.code !== 'P2034' || attempt === 2) throw error;
        }
      }
    }
    const db = params.tx!;
    const existing = await db.commission.findUnique({ where: { purchaseId: params.purchaseId }, include: { shares: true } });
    if (existing) {
      if (existing.customerId !== params.customerId) throw new BadRequestException('Purchase customer mismatch');
      return existing;
    } // Historical entries are never resplit.
    const payment = await db.paymentHistory.findUnique({ where: { id: params.purchaseId } });
    if (!payment || payment.customerId !== params.customerId || payment.deletedAt || payment.status !== 'SUCCESS') return null;
    const sourceKey = payment.paymentId ? `gateway:${payment.paymentMethod}:${payment.paymentId}` : `purchase:${payment.id}`;
    if (payment.paymentId) {
      const duplicate = await db.commission.findFirst({ where: { OR: [{ sourceKey }, { purchase: { paymentId: payment.paymentId, paymentMethod: payment.paymentMethod } }] }, include: { shares: true } });
      if (duplicate) {
        if (duplicate.customerId !== params.customerId) throw new BadRequestException('Payment source customer mismatch');
        return duplicate;
      }
    }
    const customer = await db.customer.findUnique({ where: { id: payment.customerId }, include: { originLead: true } });
    if (!customer || customer.deletedAt) return null;
    const lead = customer.originLead;
    // Persisted sale attribution, never the current caller/customer creator.
    let employeeId = lead?.convertedByEmployeeId || lead?.employeeId || customer.assignedEmployeeId;
    if (!employeeId && lead?.assignedToId) {
      const assigned = await db.employee.findFirst({ where: { userId: lead.assignedToId, customerId: lead.customerId } });
      employeeId = assigned?.id;
    }
    const employee = employeeId ? await db.employee.findUnique({ where: { id: employeeId }, include: { designation: true, department: true, commissionConfig: true } }) : null;
    const tenantId = lead?.customerId || employee?.customerId || customer.id;
    let reviewReason: string | null = !employee ? 'SALE_EMPLOYEE_UNRESOLVED' : employee.customerId !== tenantId ? 'EMPLOYEE_TENANT_MISMATCH' : employee.status !== 'ACTIVE' ? 'EMPLOYEE_INACTIVE' : null;
    const bpo = isBpoPayrollEmployee;
    if (employee && !bpo(employee)) return null;
    const config = employee?.commissionConfig;
    if (config && config.status !== CommissionConfigStatus.ACTIVE) return null;
    if (employee && !config && !employee.designation?.commissionEnabled) return null;
    const commissionType = config?.commissionType || employee?.designation?.commissionType || CommissionType.PERCENTAGE;
    const commissionRate = Number(config?.commissionValue ?? employee?.designation?.commissionRate ?? 0);
    if (!Number.isFinite(commissionRate) || commissionRate < 0) throw new BadRequestException('Invalid commission configuration');
    const rateUpdatedAt = config?.updatedAt || employee?.designation?.updatedAt;
    if (!reviewReason && rateUpdatedAt && rateUpdatedAt > payment.createdAt) reviewReason = 'HISTORICAL_RATE_REVIEW_REQUIRED';
    if (employee && commissionRate === 0) return null;
    const purchaseAmount = Number(payment.amount); // Existing tax-exclusive paid base.
    if (!Number.isFinite(purchaseAmount) || purchaseAmount < 0) throw new BadRequestException('Invalid commission base');
    const commissionAmount = Math.round((commissionType === CommissionType.PERCENTAGE ? purchaseAmount * commissionRate / 100 : commissionRate) * 100) / 100;
    const memberships = employee ? await db.teamMember.findMany({ where: { employeeId: employee.id, joinedAt: { lte: payment.createdAt }, team: { customerId: tenantId, isActive: true } }, include: { team: { include: { leader: { include: { designation: true, department: true } } } } } }) : [];
    const teams = memberships.filter(m => /bpo|telecall|telesales|business process/i.test(`${m.team.name} ${m.team.description || ''}`));
    const team = teams.length === 1 ? teams[0].team : null;
    const leader = team?.leader;
    if (!reviewReason && !team) reviewReason = teams.length > 1 ? 'AMBIGUOUS_BPO_TEAM' : 'BPO_TEAM_UNRESOLVED';
    if (!reviewReason && (!leader || leader.id === employeeId || leader.customerId !== tenantId || leader.status !== 'ACTIVE' || !bpo(leader))) reviewReason = 'BPO_LEADER_UNRESOLVED';
    // Membership/leader history is not stored. Do not guess historical leadership.
    if (!reviewReason && team!.updatedAt > payment.createdAt) reviewReason = 'HISTORICAL_TEAM_REVIEW_REQUIRED';
    const employeeAmount = Math.round(commissionAmount * 100 / 2) / 100;
    const leaderAmount = Math.round((commissionAmount - employeeAmount) * 100) / 100;
    return db.commission.create({
      data: {
        customerId: customer.id, tenantId, sourceKey, employeeId: employee?.id || null, leadId: customer.leadId || null,
        planId: payment.planId || params.planId || null, purchaseId: payment.id, orderId: payment.orderId || params.orderId || null,
        purchaseAmount, commissionType, commissionRate, commissionAmount, qualifyingAt: payment.createdAt,
        teamId: team?.id || null, leaderId: leader?.id || null, reviewReason,
        status: reviewReason ? CommissionStatus.PENDING : CommissionStatus.APPROVED,
        shares: reviewReason ? undefined : { create: [
          { employeeId: employee!.id, recipientRole: 'EMPLOYEE', effectiveRate: commissionRate / 2, amount: employeeAmount },
          { employeeId: leader!.id, recipientRole: 'LEADER', effectiveRate: commissionRate / 2, amount: leaderAmount },
        ] },
        history: [{ action: reviewReason ? 'REVIEW_REQUIRED' : 'SPLIT_AWARDED', at: new Date().toISOString(), reason: reviewReason }],
      }, include: { shares: true },
    });
  }

  /**
   * Handle payment refund or cancellation by invalidating the commission record.
   */
  async handleRefundOrCancellation(purchaseId: number, customerId: number, reference = `purchase-${purchaseId}`, partial = false): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const event = await tx.commission.findUnique({ where: { purchaseId }, include: { shares: true } });
      if (!event || event.customerId !== customerId) return;
      const history = Array.isArray(event.history) ? event.history : [];
      if (history.some((entry: any) => entry?.reference === reference)) return;
      const paid = event.status === CommissionStatus.PAID || event.shares.some(s => s.status === CommissionStatus.PAID);
      await tx.commission.update({ where: { id: event.id }, data: {
        ...(paid || partial ? { reviewReason: paid ? 'PAID_REVERSAL_REQUIRES_AUTHORIZED_ADJUSTMENT' : 'PARTIAL_REFUND_REQUIRES_REVIEW' } : { status: CommissionStatus.CANCELLED }),
        history: [...history, { action: 'REFUND_REQUESTED', at: new Date().toISOString(), paid, partial, reference }],
      } });
      await tx.commissionShare.updateMany({ where: { commissionId: event.id, status: { not: CommissionStatus.PAID } }, data: { status: partial ? CommissionStatus.PENDING : CommissionStatus.CANCELLED } });
    }, { isolationLevel: 'Serializable' });
  }

  /**
   * Admin API: List all commissions with filters, pagination, and KPI totals.
   */
  async getAdminCommissions(customerId: number, query: CommissionFilterDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CommissionWhereInput = {
      OR: [{ tenantId: customerId }, { tenantId: null, employee: { customerId } }],
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.employeeId) {
      where.employeeId = Number(query.employeeId);
    }

    if (query.designationId) {
      where.employee = {
        designationId: Number(query.designationId),
      };
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (query.search && query.search.trim()) {
      const search = query.search.trim();
      where.AND = [{ OR: [
        { employee: { firstName: { contains: search, mode: 'insensitive' } } },
        { employee: { lastName: { contains: search, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: search, mode: 'insensitive' } } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { companyName: { contains: search, mode: 'insensitive' } } },
        { lead: { firstName: { contains: search, mode: 'insensitive' } } },
        { lead: { lastName: { contains: search, mode: 'insensitive' } } },
        { lead: { companyName: { contains: search, mode: 'insensitive' } } },
        { orderId: { contains: search, mode: 'insensitive' } },
      ] }];
    }

    // Fetch items with relations
    const [commissions, total] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          shares: { include: { employee: { select: { id: true, firstName: true, lastName: true } }, payrollItem: { select: { id: true, payroll: { select: { month: true, year: true } } } } } },
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              email: true,
              designation: {
                select: { id: true, name: true, code: true },
              },
            },
          },
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              title: true,
              phone: true,
              email: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              companyName: true,
              email: true,
              phone: true,
            },
          },
          plan: {
            select: {
              id: true,
              name: true,
              monthlyPrice: true,
              yearlyPrice: true,
            },
          },
          purchase: {
            select: {
              id: true,
              orderNumber: true,
              paymentId: true,
              amount: true,
              totalAmount: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.commission.count({ where }),
    ]);

    // Summary totals calculated across entire tenant dataset (or filtered search)
    const summaryAgg = await this.prisma.commission.groupBy({
      by: ['status'],
      where: { OR: [{ tenantId: customerId }, { tenantId: null, employee: { customerId } }] },
      _sum: {
        commissionAmount: true,
      },
      _count: {
        id: true,
      },
    });

    let totalAmount = 0;
    let pendingAmount = 0;
    let approvedAmount = 0; // Earned
    let paidAmount = 0;
    let totalCount = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let paidCount = 0;

    for (const group of summaryAgg) {
      const amount = group._sum.commissionAmount || 0;
      const count = group._count.id || 0;
      if (group.status === CommissionStatus.CANCELLED) continue;
      totalCount += count;
      totalAmount += amount;

      if (group.status === CommissionStatus.PENDING) {
        pendingAmount += amount;
        pendingCount += count;
      } else if (group.status === CommissionStatus.APPROVED) {
        approvedAmount += amount;
        approvedCount += count;
      } else if (group.status === CommissionStatus.PAID) {
        paidAmount += amount;
        paidCount += count;
      }
    }

    return {
      data: commissions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalCommission: totalAmount,
        pendingCommission: pendingAmount,
        approvedCommission: approvedAmount,
        paidCommission: paidAmount,
        totalCount,
        pendingCount,
        approvedCount,
        paidCount,
      },
    };
  }

  /**
   * Employee Self-Service API: List authenticated employee's commissions only.
   */
  async getEmployeeCommissions(customerId: number, userId: number, query: CommissionFilterDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId: Number(userId), customerId },
      include: { designation: true },
    });

    if (!employee) {
      throw new NotFoundException('Employee profile not found for authenticated user');
    }

    return this.recipientLedger(customerId, employee, query);
  }

  private async recipientLedger(tenantId: number, employee: any, query: CommissionFilterDto, leaderOnly = false) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const events = await this.prisma.commission.findMany({
      where: { OR: [
        { tenantId, shares: { some: { employeeId: employee.id, ...(leaderOnly ? { recipientRole: 'LEADER' } : {}) } } },
        ...(!leaderOnly ? [{ tenantId: null, employeeId: employee.id, employee: { customerId: tenantId } }, { tenantId, employeeId: employee.id, reviewReason: { not: null } }] : []),
      ] }, orderBy: { createdAt: 'desc' },
      include: { shares: { include: { payrollItem: { include: { payroll: true } } } }, customer: { select: { id: true, name: true, companyName: true } }, lead: { select: { id: true, title: true, companyName: true } }, plan: { select: { id: true, name: true } }, purchase: { select: { id: true, amount: true, totalAmount: true, orderNumber: true, createdAt: true } }, employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    const records = events.map(event => {
      const share = event.shares.find(s => s.employeeId === employee.id && (!leaderOnly || s.recipientRole === 'LEADER'));
      const unresolved = !share && event.tenantId !== null && !!event.reviewReason;
      return { ...event, shares: undefined, originalCommissionRate: event.commissionRate, totalCommissionAmount: event.commissionAmount,
        commissionRate: share?.effectiveRate ?? (unresolved ? 0 : event.commissionRate), commissionAmount: share?.amount ?? (unresolved ? 0 : event.commissionAmount),
        employeeShareAmount: share?.recipientRole === 'LEADER' ? Math.round((event.commissionAmount - share.amount) * 100) / 100 : share?.amount, leaderShareAmount: share?.recipientRole === 'LEADER' ? share.amount : share ? Math.round((event.commissionAmount - share.amount) * 100) / 100 : null,
        status: share?.status ?? event.status, paidAt: share?.paidAt ?? event.paidAt, recipientRole: share?.recipientRole ?? 'LEGACY',
        employeeShareStatus: share?.recipientRole === 'LEADER' ? event.shares.find(s => s.recipientRole === 'EMPLOYEE')?.status : undefined,
        payrollItemId: share?.payrollItemId, payrollPeriod: share?.payrollItem ? `${share.payrollItem.payroll.year}-${String(share.payrollItem.payroll.month).padStart(2, '0')}` : null,
      };
    });
    const summary = { totalCommission: 0, pendingCommission: 0, approvedCommission: 0, paidCommission: 0, totalCount: 0, pendingCount: 0, approvedCount: 0, paidCount: 0 };
    for (const record of records) {
      if (record.status === 'CANCELLED') continue;
      summary.totalCommission += record.commissionAmount;
      summary.totalCount++;
      const prefix = record.status === 'PAID' ? 'paid' : record.status === 'APPROVED' ? 'approved' : 'pending';
      summary[`${prefix}Commission`] += record.commissionAmount;
      summary[`${prefix}Count`]++;
    }
    const customerTotals = new Map<number, number>();
    for (const record of records) if (record.status !== 'CANCELLED') customerTotals.set(record.customerId, (customerTotals.get(record.customerId) || 0) + record.commissionAmount);
    const filtered = records.filter(r => (!query.status || r.status === query.status) && (!query.startDate || r.createdAt >= new Date(query.startDate)) && (!query.endDate || r.createdAt < new Date(new Date(query.endDate).getTime() + 86400000)))
      .map(record => ({ ...record, customerCommissionTotal: Math.round((customerTotals.get(record.customerId) || 0) * 100) / 100 }));
    return { data: filtered.slice((page - 1) * limit, page * limit), meta: { total: filtered.length, page, limit }, summary, employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName || ''}`.trim(), employeeCode: employee.employeeCode, designation: employee.designation?.name || 'Staff' } };
  }

  async getLeaderCommissions(tenantId: number, userId: number, query: CommissionFilterDto) {
    const leader = await this.prisma.employee.findFirst({ where: { userId, customerId: tenantId }, include: { designation: true, department: true } });
    if (!leader || !/bpo|telecall|telesales|business process/i.test(`${leader.designation?.name || ''} ${leader.department?.name || ''}`)) throw new ForbiddenException('BPO leader account required');
    // A historical snapshot recipient retains their own leader entries after team changes.
    const ledger = await this.recipientLedger(tenantId, leader, query, true);
    return { ...ledger, data: ledger.data.filter(e => e.recipientRole === 'LEADER') };
  }

  /**
   * Update commission status (e.g. Mark as PAID, APPROVE, or CANCEL).
   */
  async updateCommissionStatus(
    customerId: number,
    commissionId: number,
    dto: UpdateCommissionStatusDto,
    adminUser: any,
  ) {
    const commission = await this.prisma.commission.findUnique({
      where: { id: commissionId },
      include: { employee: true },
    });

    if (!commission || (commission.tenantId ?? commission.employee?.customerId) !== customerId) {
      throw new NotFoundException('Commission record not found');
    }

    if (commission.paidAt || commission.status === CommissionStatus.PAID) throw new BadRequestException('Paid commissions require the authorized adjustment process');
    const shares = await this.prisma.commissionShare.count({ where: { commissionId } });
    if (shares || commission.reviewReason) throw new BadRequestException('Split commissions settle through payroll; unresolved events require review');

    const updateData: Prisma.CommissionUpdateInput = {
      status: dto.status,
    };

    if (dto.status === CommissionStatus.PAID) {
      updateData.paidAt = new Date();
    } else if (commission.paidAt) {
      updateData.paidAt = null;
    }

    const updated = await this.prisma.commission.update({
      where: { id: commissionId },
      data: updateData,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            designation: { select: { id: true, name: true } },
          },
        },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
        plan: true,
        purchase: true,
      },
    });

    this.logger.log(
      `[COMMISSION] Admin #${adminUser?.id || 'Unknown'} updated Commission #${commissionId} status to ${dto.status}`,
    );

    return updated;
  }

  /**
   * Get all Designations with commission settings for Admin Panel configuration.
   */
  async getDesignationCommissionConfigs(customerId: number) {
    const designations = await this.prisma.designation.findMany({
      where: { customerId, isActive: true },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    });

    return designations.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      description: d.description,
      commissionEnabled: d.commissionEnabled,
      commissionType: d.commissionType,
      commissionRate: d.commissionRate,
      employeeCount: d._count.employees,
      crmMobileAccess: d.crmMobileAccess,
    }));
  }

  /**
   * Update designation commission settings.
   */
  async updateDesignationCommission(
    customerId: number,
    designationId: number,
    dto: UpdateDesignationCommissionDto,
  ) {
    const designation = await this.prisma.designation.findUnique({
      where: { id: designationId },
    });

    if (!designation || designation.customerId !== customerId) {
      throw new NotFoundException('Designation not found');
    }

    const updated = await this.prisma.designation.update({
      where: { id: designationId },
      data: {
        commissionEnabled: dto.commissionEnabled,
        commissionType: dto.commissionType || CommissionType.PERCENTAGE,
        commissionRate: Number(dto.commissionRate) || 0,
      },
    });

    return updated;
  }

  /**
   * Get all employee-level commission overrides.
   */
  async getEmployeeCommissionConfigs(customerId: number) {
    const configs = await this.prisma.commissionConfig.findMany({
      where: { customerId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            designation: {
              select: { id: true, name: true, commissionEnabled: true, commissionRate: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return configs;
  }

  /**
   * Upsert employee-level commission config override.
   */
  async upsertEmployeeCommissionConfig(
    customerId: number,
    dto: UpsertEmployeeCommissionConfigDto,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee || employee.customerId !== customerId) {
      throw new NotFoundException('Employee not found in this company');
    }

    const config = await this.prisma.commissionConfig.upsert({
      where: { employeeId: dto.employeeId },
      create: {
        customerId,
        employeeId: dto.employeeId,
        commissionType: dto.commissionType,
        commissionValue: Number(dto.commissionValue) || 0,
        status: dto.status || CommissionConfigStatus.ACTIVE,
      },
      update: {
        commissionType: dto.commissionType,
        commissionValue: Number(dto.commissionValue) || 0,
        status: dto.status || CommissionConfigStatus.ACTIVE,
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            designation: true,
          },
        },
      },
    });

    return config;
  }
}
