import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { agreedMonthlySalary, eligibleTargetSalary } from './salary-calculation';

@Injectable()
export class SalaryTargetService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: number, month: number, year: number) {
    this.assertTenant(customerId);
    this.assertPeriod(month, year);
    const [policies, employees, teams] = await Promise.all([
      this.prisma.salaryTargetPolicy.findMany({
        where: { customerId, OR: [{ month, year }, { month: 0, year: 0 }] },
        include: {
          employee: { include: { department: true, designation: true, salaryStructures: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 } } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.employee.findMany({
        where: { customerId, status: 'ACTIVE' },
        include: { department: true, designation: true, salaryStructures: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.team.findMany({
        where: { customerId, isActive: true },
        include: { _count: { select: { members: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);

    const rows = [];
    for (const policy of policies) {
      if (policy.month === 0 && policies.some((other) => other.employeeId === policy.employeeId && other.month === month && other.year === year)) continue;
      rows.push(await this.resolveForPayroll(this.prisma, customerId, policy.employee, policy.employee.salaryStructures?.[0], year, month, { persist: false }));
    }
    return {
      month,
      year,
      rows: rows.filter(Boolean),
      employees: employees.map((employee) => ({
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        code: employee.employeeCode,
        department: employee.department?.name || '',
        registeredSalary: agreedMonthlySalary(employee.salaryStructures?.[0]),
      })),
      teams: teams.map((team) => ({ id: team.id, name: team.name, memberCount: team._count.members })),
    };
  }

  async mine(customerId: number, user: any, month?: number, year?: number) {
    const now = new Date();
    const periodMonth = month || now.getUTCMonth() + 1;
    const periodYear = year || now.getUTCFullYear();
    const employee = await this.employeeForUser(customerId, user);
    if (!employee) return { assigned: false, month: periodMonth, year: periodYear };
    const structure = employee.salaryStructures?.[0];
    const result = await this.resolveForPayroll(this.prisma, customerId, employee, structure, periodYear, periodMonth, { persist: true });
    return result || { assigned: false, month: periodMonth, year: periodYear };
  }

  async assign(customerId: number, body: any, user: any) {
    this.assertTenant(customerId);
    const month = Number(body.month), year = Number(body.year);
    this.assertPeriod(month, year);
    const input = this.policyInput(body);
    let ids = Array.isArray(body.employeeIds) ? body.employeeIds.map(Number) : [Number(body.employeeId)];
    if (body.teamId) {
      const team = await this.prisma.team.findFirst({ where: { id: Number(body.teamId), customerId }, include: { members: true } });
      if (!team) throw new NotFoundException('Team not found');
      ids = team.members.map((member) => member.employeeId);
    }
    ids = [...new Set<number>(ids)];
    if (!ids.length || ids.length > 100 || ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new BadRequestException('Choose 1–100 employees.');
    const results = [];
    for (const employeeId of ids) {
      try {
        const policy = await this.prisma.$transaction(async (tx) => {
          await this.lockPeriod(tx, customerId, month, year);
          await this.assertMutable(tx, customerId, employeeId, month, year);
          const employee = await tx.employee.findFirst({ where: { id: employeeId, customerId, status: 'ACTIVE' } });
          if (!employee) throw new NotFoundException('Active employee not found');
          return tx.salaryTargetPolicy.create({ data: { customerId, employeeId, month, year, ...input, createdById: Number(user.id), updatedById: Number(user.id) } });
        });
        await this.audit(customerId, user, 'SALARY_TARGET_ASSIGNED', policy.id, `Assigned target salary for ${month}/${year}`);
        results.push({ employeeId, assignmentId: policy.id, success: true });
      } catch (error: any) {
        results.push({ employeeId, success: false, error: error.code === 'P2002' ? 'An assignment already exists for this period.' : error.message });
      }
    }
    return { assigned: results.filter((result) => result.success).length, failed: results.filter((result) => !result.success).length, results };
  }

  async changeAssignment(customerId: number, assignmentId: number, body: any, user: any, remove = false) {
    this.assertTenant(customerId);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) throw new BadRequestException('Invalid assignment ID');
    const month = Number(body.month), year = Number(body.year);
    this.assertPeriod(month, year);
    const input = remove ? null : this.policyInput(body);
    const result = await this.prisma.$transaction(async (tx) => {
      const policy = await tx.salaryTargetPolicy.findFirst({ where: { id: assignmentId, customerId, deletedAt: null } });
      if (!policy) throw new NotFoundException('Target assignment not found');
      const originalMonth = policy.month || month, originalYear = policy.year || year;
      for (const period of [...new Set([originalYear * 100 + originalMonth, year * 100 + month])].sort((a, b) => a - b)) await this.lockPeriod(tx, customerId, period % 100, Math.floor(period / 100));
      await this.assertMutable(tx, customerId, policy.employeeId, originalMonth, originalYear);
      const employeeId = remove ? policy.employeeId : Number(body.employeeId || policy.employeeId);
      await this.assertMutable(tx, customerId, employeeId, month, year);
      if (!await tx.employee.findFirst({ where: { id: employeeId, customerId, status: 'ACTIVE' } })) throw new NotFoundException('Active employee not found');
      // Legacy defaults remain unchanged: editing/deleting a displayed month creates an override.
      const data = { ...(input || {}), employeeId, month, year, updatedById: Number(user.id),
        ...(remove ? { enabled: false, deletedAt: new Date() } : {}) };
      if (policy.month === 0) return tx.salaryTargetPolicy.create({ data: { ...policy, id: undefined, ...data, createdAt: undefined, updatedAt: undefined } });
      return tx.salaryTargetPolicy.update({ where: { id: policy.id }, data });
    }).catch((error) => { if (error.code === 'P2002') throw new BadRequestException('An assignment already exists for this employee and period.'); throw error; });
    await this.audit(customerId, user, remove ? 'SALARY_TARGET_DEACTIVATED' : 'SALARY_TARGET_UPDATED', result.id, `${month}/${year} assignment ${remove ? 'deactivated' : 'updated'}; payroll history retained`);
    return result;
  }

  private policyInput(body: any) {
    const monthlyTarget = Number(body.monthlyTarget), belowTargetSalary = Number(body.belowTargetSalary);
    const fullSalary = body.fullSalary === '' || body.fullSalary == null ? null : Number(body.fullSalary);
    if (!Number.isFinite(monthlyTarget) || monthlyTarget <= 0 || body.belowTargetSalary === '' || body.belowTargetSalary == null || !Number.isFinite(belowTargetSalary) || belowTargetSalary < 0 || (fullSalary !== null && (!Number.isFinite(fullSalary) || fullSalary < 0))) throw new BadRequestException('Enter valid target and salary amounts.');
    return { monthlyTarget, belowTargetSalary, fullSalary, enabled: true };
  }

  private async lockPeriod(db: any, customerId: number, month: number, year: number) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(${customerId}::integer, ${year * 100 + month}::integer)`;
  }

  private async assertMutable(db: any, customerId: number, employeeId: number, month: number, year: number) {
    const approved = await db.salaryTargetReview.findFirst({ where: { customerId, employeeId, month, year, reviewStatus: 'APPROVED' } });
    const payroll = await db.payrollItem.findFirst({ where: { customerId, employeeId, payroll: { month, year, status: { notIn: ['DRAFT', 'CANCELLED', 'FAILED'] } } } });
    if (approved || payroll) throw new BadRequestException('This period has approved performance or payroll dependencies. Its assignment cannot be changed.');
  }

  private assertTenant(customerId: number) {
    if (!Number.isInteger(customerId) || customerId <= 0) throw new BadRequestException('An authenticated tenant is required.');
  }

  async approve(customerId: number, body: any, user: any) {
    const month = Number(body.month);
    const year = Number(body.year);
    const employeeId = Number(body.employeeId);
    this.assertPeriod(month, year);
    this.assertTenant(customerId);
    const review = await this.prisma.$transaction(async (tx) => {
      await this.lockPeriod(tx, customerId, month, year);
      await this.assertMutable(tx, customerId, employeeId, month, year);
      const employee = await tx.employee.findFirst({ where: { id: employeeId, customerId }, include: { department: true, designation: true, salaryStructures: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 } } });
      if (!employee) throw new NotFoundException('Employee not found');
      const result = await this.resolveForPayroll(tx, customerId, employee, employee.salaryStructures?.[0], year, month, { persist: true, approve: true, user });
      if (!result) throw new BadRequestException('This employee has no target assignment for this period');
      return result;
    });
    await this.audit(customerId, user, 'SALARY_TARGET_APPROVED', review.reviewId, `Approved ${month}/${year} target performance for employee ${employeeId}`);
    return review;
  }

  async resolveForPayroll(db: any, customerId: number, employee: any, structure: any, year: number, month: number, options?: { persist?: boolean; approve?: boolean; user?: any }) {
    if (!db?.salaryTargetPolicy?.findFirst || !employee?.id) return null;
    const policy = await db.salaryTargetPolicy.findFirst({ where: { customerId, employeeId: employee.id, month, year } })
      || await db.salaryTargetPolicy.findFirst({ where: { customerId, employeeId: employee.id, month: 0, year: 0 } });
    const locked = await this.lockedPayroll(db, customerId, employee.id, month, year);
    const existing = await db.salaryTargetReview.findUnique({ where: { customerId_employeeId_month_year: { customerId, employeeId: employee.id, month, year } } });
    if (existing && (locked || (existing.reviewStatus === 'APPROVED' && !options?.approve))) return this.present(employee, existing, Boolean(locked), policy);
    if (!policy || !policy.enabled || policy.deletedAt) return null;
    const registeredSalary = agreedMonthlySalary(structure);
    const fullSalary = policy.fullSalary != null && Number(policy.fullSalary) > 0 ? Number(policy.fullSalary) : registeredSalary;

    const achieved = await this.achievement(db, customerId, employee, year, month);
    const decision = eligibleTargetSalary({
      achieved,
      target: policy.monthlyTarget,
      fullSalary,
      belowTargetSalary: policy.belowTargetSalary,
    });
    const reviewStatus = options?.approve ? 'APPROVED' : existing?.reviewStatus || 'PENDING';
    const record = {
      customerId,
      employeeId: employee.id,
      month,
      year,
      monthlyTarget: decision.target,
      registeredSalary,
      fullSalary: decision.fullSalary,
      belowTargetSalary: decision.belowTargetSalary,
      achievedAmount: decision.achieved,
      achievementPercent: decision.achievementPercent,
      remainingAmount: decision.remainingAmount,
      eligibleSalary: decision.eligibleSalary,
      targetStatus: decision.targetStatus,
      reviewStatus,
      approvedById: options?.approve ? Number(options.user?.id) || null : existing?.approvedById || null,
      approvedAt: options?.approve ? new Date() : existing?.approvedAt || null,
    };
    if (options?.persist !== false && db.salaryTargetReview?.upsert && !locked) {
      const saved = await db.salaryTargetReview.upsert({
        where: { customerId_employeeId_month_year: { customerId, employeeId: employee.id, month, year } },
        create: record,
        update: record,
      });
      return this.present(employee, saved, false, policy);
    }
    return this.present(employee, { ...record, id: existing?.id }, Boolean(locked), policy);
  }

  private present(employee: any, review: any, payrollLocked: boolean, policy?: any) {
    return {
      assigned: true,
      assignmentId: policy?.id || null,
      legacyPolicy: policy?.month === 0,
      designation: employee.designation?.name || '',
      approvedById: review.approvedById || null,
      reviewId: review.id || null,
      employeeId: employee.id,
      employeeName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      employeeCode: employee.employeeCode || '',
      department: employee.department?.name || '',
      month: review.month,
      year: review.year,
      compensationMode: 'TARGET',
      registeredSalary: review.registeredSalary,
      fullSalary: review.fullSalary,
      belowTargetSalary: review.belowTargetSalary,
      monthlyTarget: review.monthlyTarget,
      achievedAmount: review.achievedAmount,
      remainingAmount: review.remainingAmount,
      achievementPercent: review.achievementPercent,
      targetStatus: review.targetStatus,
      reviewStatus: review.reviewStatus,
      eligibleSalary: review.eligibleSalary,
      payrollLocked,
      approvedAt: review.approvedAt || null,
    };
  }

  private async achievement(db: any, customerId: number, employee: any, year: number, month: number) {
    if (!db.lead?.findMany) return 0;
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const owner = [
      { employeeId: employee.id },
      { convertedByEmployeeId: employee.id },
      ...(employee.userId ? [{ assignedToId: employee.userId }] : []),
    ];
    const leads = await db.lead.findMany({
      where: {
        customerId,
        deletedAt: null,
        status: { in: ['WON', 'CONVERTED'] },
        convertedAt: { gte: start, lte: end },
        OR: owner,
      },
      select: { id: true, value: true, paidAmount: true },
    });
    const seen = new Set<number>();
    return leads.reduce((sum, lead) => {
      if (seen.has(lead.id)) return sum;
      seen.add(lead.id);
      const collected = Number(lead.paidAmount) > 0 ? Number(lead.paidAmount) : Number(lead.value) || 0;
      return sum + collected;
    }, 0);
  }

  private async lockedPayroll(db: any, customerId: number, employeeId: number, month: number, year: number) {
    if (!db.payrollItem?.findFirst) return false;
    const item = await db.payrollItem.findFirst({
      where: { customerId, employeeId, payroll: { month, year, status: { notIn: ['DRAFT', 'CANCELLED', 'FAILED'] } } },
      select: { id: true },
    });
    return Boolean(item);
  }

  private async assertOpen(customerId: number, employeeId: number, month: number, year: number) {
    if (await this.lockedPayroll(this.prisma, customerId, employeeId, month, year)) {
      throw new BadRequestException('Paid payroll for this month is closed. Reopen it before changing target salary.');
    }
  }

  private async employeeForUser(customerId: number, user: any) {
    const userId = Number(user?.id);
    if (!userId) return null;
    return this.prisma.employee.findFirst({
      where: { customerId, userId },
      include: { department: true, designation: true, salaryStructures: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  private assertPeriod(month: number, year: number) {
    if (!Number.isInteger(month) || !Number.isInteger(year) || !(month >= 1 && month <= 12) || !(year >= 2000 && year <= 9999)) throw new BadRequestException('A valid month and year are required');
  }

  private async audit(customerId: number, user: any, action: string, id: number, description: string) {
    if (!this.prisma.auditLog?.create) return;
    await this.prisma.auditLog.create({
      data: {
        customerId,
        userId: user?.id ? Number(user.id) : null,
        userName: user?.name || user?.email || 'Admin',
        userRole: user?.role || null,
        action,
        module: 'Payroll',
        description,
        entityType: 'SalaryTarget',
        entityId: String(id),
        status: 'SUCCESS',
      },
    }).catch(() => undefined);
  }
}
