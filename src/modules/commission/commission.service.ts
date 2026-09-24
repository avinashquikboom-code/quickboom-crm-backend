import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
    const { customerId, purchaseId, purchaseAmount, planId, orderId } = params;
    const db = params.tx || this.prisma;

    if (!purchaseId) {
      this.logger.warn(`[COMMISSION] Missing purchaseId for customer #${customerId}`);
      return null;
    }

    // 1. Idempotency Check: prevent duplicate commission for same purchaseId
    const existingCommission = await db.commission.findUnique({
      where: { purchaseId },
    });

    if (existingCommission) {
      this.logger.log(
        `[COMMISSION] Commission already exists for purchaseId #${purchaseId} (Commission #${existingCommission.id}). Skipping duplicate creation.`,
      );
      return existingCommission;
    }

    // 2. Fetch Customer and trace Lead conversion / assigned employee
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      include: {
        originLead: true,
        assignedEmployeeRel: {
          include: {
            commissionConfig: true,
            designation: true,
          },
        },
        createdByEmployeeRel: {
          include: {
            commissionConfig: true,
            designation: true,
          },
        },
      },
    });

    if (!customer) {
      this.logger.warn(`[COMMISSION] Customer #${customerId} not found`);
      return null;
    }

    // 3. Resolve Employee who won/converted the Lead
    // Priority 1: customer.assignedEmployeeId
    // Priority 2: customer.createdByEmployeeId
    // Priority 3: customer.originLead.employeeId
    // Priority 4: employee linked to customer.originLead.assignedToId
    let employeeId: number | null = customer.assignedEmployeeId || customer.createdByEmployeeId;
    let employee = customer.assignedEmployeeRel || customer.createdByEmployeeRel;

    if (!employeeId && customer.originLead?.employeeId) {
      employeeId = customer.originLead.employeeId;
    }

    if (!employee && employeeId) {
      employee = await db.employee.findUnique({
        where: { id: employeeId },
        include: {
          commissionConfig: true,
          designation: true,
        },
      });
    }

    if (!employee && customer.originLead?.assignedToId) {
      employee = await db.employee.findFirst({
        where: {
          userId: Number(customer.originLead.assignedToId),
          status: 'ACTIVE',
        },
        include: {
          commissionConfig: true,
          designation: true,
        },
      });
      if (employee) {
        employeeId = employee.id;
      }
    }

    if (!employee || !employeeId) {
      this.logger.log(
        `[COMMISSION] No converting employee found for Customer #${customerId}. No commission awarded.`,
      );
      return null;
    }

    // 4. Check Commission Eligibility & Rate
    // Rule:
    // A. Check employee-specific CommissionConfig override:
    //    If active, use that config. If inactive, employee is NOT eligible.
    // B. If no employee config, check employee's designation:
    //    If designation.commissionEnabled is true, use designation rate.
    // C. Otherwise, employee is NOT eligible.
    let commissionType: CommissionType = CommissionType.PERCENTAGE;
    let commissionRate = 0;
    let isEligible = false;

    if (employee.commissionConfig) {
      if (employee.commissionConfig.status === CommissionConfigStatus.ACTIVE) {
        commissionType = employee.commissionConfig.commissionType;
        commissionRate = employee.commissionConfig.commissionValue;
        isEligible = true;
      } else {
        this.logger.log(
          `[COMMISSION] Employee #${employeeId} (${employee.firstName} ${employee.lastName}) has INACTIVE commission config. Skipping commission.`,
        );
        return null;
      }
    } else if (employee.designation?.commissionEnabled) {
      commissionType = employee.designation.commissionType;
      commissionRate = employee.designation.commissionRate;
      isEligible = true;
    }

    if (!isEligible || commissionRate <= 0) {
      this.logger.log(
        `[COMMISSION] Employee #${employeeId} (${employee.firstName} ${employee.lastName}, designation: ${employee.designation?.name || 'None'}) is not commission eligible (Rate: ${commissionRate}). Skipping.`,
      );
      return null;
    }

    // 5. Calculate Commission
    let commissionAmount = 0;
    if (commissionType === CommissionType.PERCENTAGE) {
      commissionAmount = Math.round(((purchaseAmount * commissionRate) / 100) * 100) / 100;
    } else {
      commissionAmount = commissionRate;
    }

    // 6. Persist Commission Record
    const leadId = customer.leadId || customer.originLead?.id || null;
    const resolvedPlanId = planId || null;

    try {
      const commission = await db.commission.create({
        data: {
          customerId,
          employeeId,
          leadId,
          planId: resolvedPlanId,
          purchaseId,
          orderId: orderId || null,
          commissionType,
          commissionRate,
          purchaseAmount,
          commissionAmount,
          status: CommissionStatus.APPROVED, // Approved / Earned upon confirmed plan purchase
        },
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
              title: true,
            },
          },
          plan: { select: { id: true, name: true, price: true } },
        },
      });

      this.logger.log(
        `[COMMISSION] Commission generated: #${commission.id} for Employee #${employeeId} (${employee.firstName} ${employee.lastName}) | Amount: ₹${commissionAmount} (${commissionRate}${commissionType === 'PERCENTAGE' ? '%' : ' Fixed'}) on Purchase ₹${purchaseAmount}`,
      );
      return commission;
    } catch (err: any) {
      // If concurrent request created it in the meantime, handle gracefully
      if (err.code === 'P2002') {
        this.logger.warn(`[COMMISSION] Unique constraint conflict on purchaseId #${purchaseId}, returning existing commission.`);
        return db.commission.findUnique({ where: { purchaseId } });
      }
      this.logger.error(`[COMMISSION] Failed to create commission: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Handle payment refund or cancellation by invalidating the commission record.
   */
  async handleRefundOrCancellation(purchaseId: number, customerId: number): Promise<void> {
    try {
      const commission = await this.prisma.commission.findUnique({
        where: { purchaseId },
      });

      if (commission && commission.customerId === customerId && commission.status !== CommissionStatus.CANCELLED) {
        await this.prisma.commission.update({
          where: { id: commission.id },
          data: { status: CommissionStatus.CANCELLED },
        });
        this.logger.log(`[COMMISSION] Commission #${commission.id} CANCELLED due to refund/cancellation of purchase #${purchaseId}`);
      }
    } catch (err: any) {
      this.logger.error(`[COMMISSION] Error handling refund for purchase #${purchaseId}: ${err.message}`, err.stack);
    }
  }

  /**
   * Admin API: List all commissions with filters, pagination, and KPI totals.
   */
  async getAdminCommissions(customerId: number, query: CommissionFilterDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CommissionWhereInput = {
      customerId,
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
      where.OR = [
        { employee: { firstName: { contains: search, mode: 'insensitive' } } },
        { employee: { lastName: { contains: search, mode: 'insensitive' } } },
        { employee: { employeeCode: { contains: search, mode: 'insensitive' } } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { companyName: { contains: search, mode: 'insensitive' } } },
        { lead: { firstName: { contains: search, mode: 'insensitive' } } },
        { lead: { lastName: { contains: search, mode: 'insensitive' } } },
        { lead: { companyName: { contains: search, mode: 'insensitive' } } },
        { orderId: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Fetch items with relations
    const [commissions, total] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
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
              price: true,
              billingCycle: true,
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
      where: { customerId },
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

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CommissionWhereInput = {
      customerId,
      employeeId: employee.id,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [commissions, total] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              title: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              companyName: true,
            },
          },
          plan: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
          purchase: {
            select: {
              id: true,
              orderNumber: true,
              paymentId: true,
              amount: true,
              totalAmount: true,
            },
          },
        },
      }),
      this.prisma.commission.count({ where }),
    ]);

    // Employee summary totals
    const summaryAgg = await this.prisma.commission.groupBy({
      by: ['status'],
      where: { customerId, employeeId: employee.id },
      _sum: {
        commissionAmount: true,
      },
      _count: {
        id: true,
      },
    });

    let totalAmount = 0;
    let pendingAmount = 0;
    let approvedAmount = 0;
    let paidAmount = 0;
    let totalCount = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let paidCount = 0;

    for (const group of summaryAgg) {
      const amount = group._sum.commissionAmount || 0;
      const count = group._count.id || 0;
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
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName || ''}`.trim(),
        employeeCode: employee.employeeCode,
        designation: employee.designation?.name || 'Staff',
      },
    };
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

    if (!commission || commission.customerId !== customerId) {
      throw new NotFoundException('Commission record not found');
    }

    const updateData: Prisma.CommissionUpdateInput = {
      status: dto.status,
    };

    if (dto.status === CommissionStatus.PAID) {
      updateData.paidAt = new Date();
    } else if (dto.status !== CommissionStatus.PAID && commission.paidAt) {
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
