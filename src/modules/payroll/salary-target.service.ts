import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { agreedMonthlySalary, eligibleTargetSalary } from './salary-calculation';

@Injectable()
export class SalaryTargetService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: number, month: number, year: number) {
    this.assertPeriod(month, year);
    const [policies, employees, teams] = await Promise.all([
      this.prisma.salaryTargetPolicy.findMany({
        where: { customerId, enabled: true },
        include: {
          employee: { include: { department: true, salaryStructures: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 } } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.employee.findMany({
        where: { customerId, status: 'ACTIVE' },
        include: { department: true, salaryStructures: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 } },
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
      rows.push(await this.resolveForPayroll(this.prisma, customerId, policy.employee, policy.employee.salaryStructures?.[0], year, month, { persist: true }));
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
    const monthlyTarget = Number(body.monthlyTarget);
    const belowTargetSalary = Number(body.belowTargetSalary);
    if (!(monthlyTarget > 0)) throw new BadRequestException('Monthly target must be greater than zero');
    if (!(belowTargetSalary >= 0)) throw new BadRequestException('Below-target salary is required');
    const fullSalary = body.fullSalary === undefined || body.fullSalary === null || body.fullSalary === '' ? null : Number(body.fullSalary);
    if (fullSalary !== null && !(fullSalary >= 0)) throw new BadRequestException('Full-target salary is invalid');
    const enabled = body.enabled !== false;

    if (body.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: Number(body.teamId), customerId },
        include: { members: { include: { employee: true } } },
      });
      if (!team) throw new NotFoundException('Team not found');
      const activeMembers = team.members.filter((member) => member.employee?.status === 'ACTIVE');
      for (const member of activeMembers) {
        await this.upsertPolicy(customerId, member.employeeId, { monthlyTarget, belowTargetSalary, fullSalary, enabled }, user);
      }
      await this.audit(customerId, user, 'SALARY_TARGET_TEAM_ASSIGNED', team.id, `Assigned target salary to ${activeMembers.length} members of ${team.name}`);
      return { teamId: team.id, assigned: activeMembers.length };
    }

    const employeeId = Number(body.employeeId);
    if (!employeeId) throw new BadRequestException('Choose an employee or a team');
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, customerId, status: 'ACTIVE' } });
    if (!employee) throw new NotFoundException('Active employee not found');
    const policy = await this.upsertPolicy(customerId, employeeId, { monthlyTarget, belowTargetSalary, fullSalary, enabled }, user);
    await this.audit(customerId, user, 'SALARY_TARGET_ASSIGNED', policy.id, `Assigned target salary to employee ${employeeId}`);
    return policy;
  }

  async approve(customerId: number, body: any, user: any) {
    const month = Number(body.month);
    const year = Number(body.year);
    const employeeId = Number(body.employeeId);
    this.assertPeriod(month, year);
    await this.assertOpen(customerId, employeeId, month, year);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, customerId },
      include: { department: true, salaryStructures: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const review = await this.resolveForPayroll(this.prisma, customerId, employee, employee.salaryStructures?.[0], year, month, { persist: true, approve: true, user });
    if (!review) throw new BadRequestException('This employee is not on a target-based salary policy');
    await this.audit(customerId, user, 'SALARY_TARGET_APPROVED', review.reviewId, `Approved ${month}/${year} target performance for employee ${employeeId}`);
    return review;
  }

  async resolveForPayroll(db: any, customerId: number, employee: any, structure: any, year: number, month: number, options?: { persist?: boolean; approve?: boolean; user?: any }) {
    if (!db?.salaryTargetPolicy?.findUnique || !employee?.id) return null;
    const policy = await db.salaryTargetPolicy.findUnique({ where: { employeeId: employee.id } });
    if (!policy || !policy.enabled || policy.customerId !== customerId) return null;

    const registeredSalary = agreedMonthlySalary(structure);
    const fullSalary = policy.fullSalary != null && Number(policy.fullSalary) > 0 ? Number(policy.fullSalary) : registeredSalary;
    const locked = await this.lockedPayroll(db, customerId, employee.id, month, year);
    const existing = db.salaryTargetReview?.findUnique
      ? await db.salaryTargetReview.findUnique({ where: { customerId_employeeId_month_year: { customerId, employeeId: employee.id, month, year } } })
      : null;

    if (locked && existing) return this.present(employee, existing, true);
    if (existing?.reviewStatus === 'APPROVED' && !options?.approve) return this.present(employee, existing, false);

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
      return this.present(employee, saved, false);
    }
    return this.present(employee, { ...record, id: existing?.id }, Boolean(locked));
  }

  private present(employee: any, review: any, payrollLocked: boolean) {
    return {
      assigned: true,
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
      where: { customerId, employeeId, payroll: { month, year, status: 'PAID' } },
      select: { id: true },
    });
    return Boolean(item);
  }

  private async assertOpen(customerId: number, employeeId: number, month: number, year: number) {
    if (await this.lockedPayroll(this.prisma, customerId, employeeId, month, year)) {
      throw new BadRequestException('Paid payroll for this month is closed. Reopen it before changing target salary.');
    }
  }

  private upsertPolicy(customerId: number, employeeId: number, input: { monthlyTarget: number; belowTargetSalary: number; fullSalary: number | null; enabled: boolean }, user: any) {
    const data = {
      customerId,
      monthlyTarget: input.monthlyTarget,
      belowTargetSalary: input.belowTargetSalary,
      fullSalary: input.fullSalary,
      enabled: input.enabled,
      updatedById: user?.id ? Number(user.id) : null,
    };
    return this.prisma.salaryTargetPolicy.upsert({
      where: { employeeId },
      create: { ...data, employeeId, createdById: user?.id ? Number(user.id) : null },
      update: data,
    });
  }

  private async employeeForUser(customerId: number, user: any) {
    const userId = Number(user?.id);
    if (!userId) return null;
    return this.prisma.employee.findFirst({
      where: { customerId, userId },
      include: { department: true, salaryStructures: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  private assertPeriod(month: number, year: number) {
    if (!(month >= 1 && month <= 12) || !(year >= 2000)) throw new BadRequestException('A valid month and year are required');
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
