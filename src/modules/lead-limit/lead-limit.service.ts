import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkPermissionService } from '../work/work-permission.service';
import { SetRoleLeadLimitDto, SetEmployeeLeadLimitDto } from './dto/lead-limit.dto';
import {
  BUSINESS_TIMEZONE,
  getBusinessDayRange,
  getBusinessMonthRange,
} from '../../common/utils/timezone.util';
import { Prisma } from '@prisma/client';

export interface LeadLimitPeriodInfo {
  limit: number;
  used: number;
  remaining: number;
}

export interface EmployeeLeadLimitResponse {
  daily: LeadLimitPeriodInfo;
  monthly: LeadLimitPeriodInfo;
  hasLeadsPermission: boolean;
  roleName?: string;
  isCustom?: boolean;
  source?: 'EMPLOYEE_OVERRIDE' | 'ROLE_DEFAULT';
}

const DEFAULT_ROLE_LIMITS: Record<string, { daily: number; monthly: number }> = {
  'Sales Executive': { daily: 10, monthly: 200 },
  'SALES_EXECUTIVE': { daily: 10, monthly: 200 },
  'Telecaller': { daily: 15, monthly: 300 },
  'TELECALLER': { daily: 15, monthly: 300 },
  'Sales': { daily: 10, monthly: 200 },
  'Admin': { daily: 50, monthly: 1000 },
  'ADMIN': { daily: 50, monthly: 1000 },
  'Super Admin': { daily: 100, monthly: 2000 },
  'SUPER_ADMIN': { daily: 100, monthly: 2000 },
  'General Employee': { daily: 5, monthly: 100 },
};

@Injectable()
export class LeadLimitService {
  private readonly logger = new Logger(LeadLimitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workPermissionService: WorkPermissionService,
  ) {}

  // ===========================================================================
  // 1. ROLE-WISE LIMITS (ADMIN CONFIGURATION)
  // ===========================================================================

  async getRoleLimits(customerId: number) {
    const custId = Number(customerId);

    const [designations, customRoles, dbRoleLimits] = await Promise.all([
      this.prisma.designation.findMany({
        where: { customerId: custId },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.role.findMany({
        where: { customerId: custId, deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.roleLeadLimit.findMany({
        where: { customerId: custId },
      }),
    ]);

    const roleNames = new Set<string>([
      'Sales Executive',
      'Telecaller',
      'Admin',
      'Video Editor',
      'Graphic Designer',
      'Photographer',
      'General Employee',
    ]);

    designations.forEach((d) => roleNames.add(d.name.trim()));
    customRoles.forEach((r) => roleNames.add(r.name.trim()));
    dbRoleLimits.forEach((l) => roleNames.add(l.roleName.trim()));

    const dbLimitMap = new Map<string, (typeof dbRoleLimits)[0]>();
    dbRoleLimits.forEach((l) => {
      const key = l.roleName.trim().toLowerCase();
      dbLimitMap.set(key, l);
      dbLimitMap.set(key.replace(/_/g, ' '), l);
      dbLimitMap.set(key.replace(/\s+/g, '_'), l);
    });

    return Array.from(roleNames).map((roleName) => {
      const key = roleName.trim().toLowerCase();
      const match =
        dbLimitMap.get(key) ||
        dbLimitMap.get(key.replace(/_/g, ' ')) ||
        dbLimitMap.get(key.replace(/\s+/g, '_'));
      const defaultVal =
        DEFAULT_ROLE_LIMITS[roleName] ||
        DEFAULT_ROLE_LIMITS[roleName.toUpperCase()] ||
        DEFAULT_ROLE_LIMITS[roleName.replace(/_/g, ' ')] || { daily: 10, monthly: 200 };

      return {
        id: match?.id ?? null,
        roleName,
        dailyLimit: match ? match.dailyLimit : defaultVal.daily,
        monthlyLimit: match ? match.monthlyLimit : defaultVal.monthly,
        isActive: match ? match.isActive : true,
        isCustom: Boolean(match),
        updatedAt: match?.updatedAt ?? null,
      };
    });
  }

  async upsertRoleLimit(customerId: number, dto: SetRoleLeadLimitDto) {
    const custId = Number(customerId);
    const roleName = dto.roleName.trim();

    return this.prisma.roleLeadLimit.upsert({
      where: {
        customerId_roleName: {
          customerId: custId,
          roleName,
        },
      },
      update: {
        dailyLimit: Number(dto.dailyLimit),
        monthlyLimit: Number(dto.monthlyLimit),
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
      },
      create: {
        customerId: custId,
        roleName,
        dailyLimit: Number(dto.dailyLimit),
        monthlyLimit: Number(dto.monthlyLimit),
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
      },
    });
  }

  // ===========================================================================
  // 2. EMPLOYEE EFFECTIVE LIMITS & USAGE
  // ===========================================================================

  async getEffectiveLimitForEmployee(customerId: number, employeeId: number) {
    const custId = Number(customerId);
    const empId = Number(employeeId);

    const employee = await this.prisma.employee.findFirst({
      where: { id: empId, customerId: custId },
      include: {
        designation: true,
        user: {
          include: {
            userRoles: {
              include: { role: true },
            },
          },
        },
        leadLimit: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee #${empId} not found in this company`);
    }

    const roleCandidate =
      employee.designation?.name ||
      (employee.user?.userRoles && employee.user.userRoles.length > 0
        ? employee.user.userRoles[0].role.name
        : employee.user?.designation || (employee.user as any)?.role) ||
      'Sales Executive';

    const normalizedRole = this.workPermissionService.normalizeRoleKey(roleCandidate);

    const candidateVariants = [
      normalizedRole,
      roleCandidate,
      normalizedRole.replace(/_/g, ' '),
      normalizedRole.replace(/\s+/g, '_'),
    ];

    // 1. Fetch role configuration from DB if present
    const roleConfig = await this.prisma.roleLeadLimit.findFirst({
      where: {
        customerId: custId,
        OR: candidateVariants.map((v) => ({
          roleName: {
            equals: v,
            mode: 'insensitive',
          },
        })),
      },
    });

    const defaultRoleLimit =
      DEFAULT_ROLE_LIMITS[normalizedRole] ||
      DEFAULT_ROLE_LIMITS[normalizedRole.toUpperCase()] ||
      DEFAULT_ROLE_LIMITS[normalizedRole.replace(/_/g, ' ')] || { daily: 10, monthly: 200 };

    const roleDaily = roleConfig ? roleConfig.dailyLimit : defaultRoleLimit.daily;
    const roleMonthly = roleConfig ? roleConfig.monthlyLimit : defaultRoleLimit.monthly;
    const roleIsActive = roleConfig ? roleConfig.isActive : true;

    // 2. Resolve employee-specific override (per-field override)
    const customLimit = employee.leadLimit;
    const hasCustomDaily = customLimit?.dailyLimit !== null && customLimit?.dailyLimit !== undefined;
    const hasCustomMonthly =
      customLimit?.monthlyLimit !== null && customLimit?.monthlyLimit !== undefined;

    let effectiveDailyLimit = hasCustomDaily ? customLimit!.dailyLimit! : roleDaily;
    let effectiveMonthlyLimit = hasCustomMonthly ? customLimit!.monthlyLimit! : roleMonthly;

    if (!roleIsActive && !hasCustomDaily) effectiveDailyLimit = 0;
    if (!roleIsActive && !hasCustomMonthly) effectiveMonthlyLimit = 0;

    return {
      employee,
      normalizedRole,
      effectiveDailyLimit: Math.max(0, effectiveDailyLimit),
      effectiveMonthlyLimit: Math.max(0, effectiveMonthlyLimit),
      customDailyLimit: customLimit?.dailyLimit ?? null,
      customMonthlyLimit: customLimit?.monthlyLimit ?? null,
      roleDailyLimit: roleDaily,
      roleMonthlyLimit: roleMonthly,
      roleIsActive,
      isCustom: hasCustomDaily || hasCustomMonthly,
    };
  }

  async getEmployeeUsage(
    customerId: number,
    employeeId: number,
    userId?: number | null,
    prismaClient?: Prisma.TransactionClient | PrismaService,
  ) {
    const client = prismaClient || this.prisma;
    const custId = Number(customerId);
    const empId = Number(employeeId);

    const dayRange = getBusinessDayRange();
    const monthRange = getBusinessMonthRange();

    const employeeFilter: Prisma.LeadWhereInput = {
      customerId: custId,
      deletedAt: null,
      OR: [
        { employeeId: empId },
        ...(userId ? [{ createdById: userId }] : []),
      ],
    };

    const [usedToday, usedThisMonth] = await Promise.all([
      client.lead.count({
        where: {
          ...employeeFilter,
          createdAt: {
            gte: dayRange.start,
            lte: dayRange.end,
          },
        },
      }),
      client.lead.count({
        where: {
          ...employeeFilter,
          createdAt: {
            gte: monthRange.start,
            lte: monthRange.end,
          },
        },
      }),
    ]);

    return {
      usedToday,
      usedThisMonth,
      dayRange,
      monthRange,
    };
  }

  // ===========================================================================
  // 3. EMPLOYEE "MY LIMIT" API (MOBILE CLIENT)
  // ===========================================================================

  async getMyLeadLimit(customerId: number, user: any): Promise<EmployeeLeadLimitResponse> {
    const custId = Number(customerId);

    // Find employee record
    let employeeId =
      typeof user === 'number'
        ? user
        : user?.employeeId || user?.employee?.id;
    let employee = user?.employee;
    const userId = typeof user === 'number' ? undefined : user?.id;

    if (!employeeId && userId) {
      employee = await this.prisma.employee.findFirst({
        where: { customerId: custId, userId },
      });
      if (employee) employeeId = employee.id;
    }

    // If caller is super-admin or customer-admin with no linked employee record
    if (!employeeId) {
      return {
        daily: { limit: 9999, used: 0, remaining: 9999 },
        monthly: { limit: 99999, used: 0, remaining: 99999 },
        hasLeadsPermission: true,
        roleName: user?.role || 'Admin',
        isCustom: false,
        source: 'ROLE_DEFAULT',
      };
    }

    // Check permissions
    const permResult = await this.workPermissionService.getEmployeeEffectivePermissions(
      custId,
      { employeeId },
    );
    const hasLeadsPermission = permResult.effectivePermissions['leads'] === true;

    // Resolve effective limit & usage
    const limitInfo = await this.getEffectiveLimitForEmployee(custId, employeeId);
    const usage = await this.getEmployeeUsage(custId, employeeId, userId);

    const remainingDaily = Math.max(0, limitInfo.effectiveDailyLimit - usage.usedToday);
    const remainingMonthly = Math.max(0, limitInfo.effectiveMonthlyLimit - usage.usedThisMonth);

    return {
      daily: {
        limit: limitInfo.effectiveDailyLimit,
        used: usage.usedToday,
        remaining: remainingDaily,
      },
      monthly: {
        limit: limitInfo.effectiveMonthlyLimit,
        used: usage.usedThisMonth,
        remaining: remainingMonthly,
      },
      hasLeadsPermission,
      roleName: limitInfo.normalizedRole,
      isCustom: limitInfo.isCustom,
      source: limitInfo.isCustom ? 'EMPLOYEE_OVERRIDE' : 'ROLE_DEFAULT',
    };
  }

  // ===========================================================================
  // 4. ADMIN EMPLOYEE LIST WITH USAGE & LIMITS
  // ===========================================================================

  async getEmployeeLimits(customerId: number) {
    const custId = Number(customerId);

    const employees = await this.prisma.employee.findMany({
      where: { customerId: custId, status: 'ACTIVE' },
      include: {
        designation: true,
        user: {
          include: {
            userRoles: {
              include: { role: true },
            },
          },
        },
        leadLimit: true,
      },
      orderBy: { firstName: 'asc' },
    });

    const dayRange = getBusinessDayRange();
    const monthRange = getBusinessMonthRange();

    // Fetch all role configs
    const roleConfigs = await this.prisma.roleLeadLimit.findMany({
      where: { customerId: custId },
    });
    const roleMap = new Map<string, (typeof roleConfigs)[0]>();
    roleConfigs.forEach((r) => roleMap.set(r.roleName.trim().toLowerCase(), r));

    return Promise.all(
      employees.map(async (emp) => {
        const roleCandidate =
          emp.designation?.name ||
          (emp.user?.userRoles && emp.user.userRoles.length > 0
            ? emp.user.userRoles[0].role.name
            : emp.user?.designation || (emp.user as any)?.role) ||
          'Sales Executive';
        const normalizedRole = this.workPermissionService.normalizeRoleKey(roleCandidate);

        const rConfig = roleMap.get(normalizedRole.toLowerCase());
        const defaultVal =
          DEFAULT_ROLE_LIMITS[normalizedRole] ||
          DEFAULT_ROLE_LIMITS[normalizedRole.toUpperCase()] || { daily: 10, monthly: 200 };

        const roleDaily = rConfig ? rConfig.dailyLimit : defaultVal.daily;
        const roleMonthly = rConfig ? rConfig.monthlyLimit : defaultVal.monthly;
        const roleIsActive = rConfig ? rConfig.isActive : true;

        const custom = emp.leadLimit;
        const hasCustomDaily = custom?.dailyLimit !== null && custom?.dailyLimit !== undefined;
        const hasCustomMonthly =
          custom?.monthlyLimit !== null && custom?.monthlyLimit !== undefined;

        let effDaily = hasCustomDaily ? custom!.dailyLimit! : roleDaily;
        let effMonthly = hasCustomMonthly ? custom!.monthlyLimit! : roleMonthly;

        if (!roleIsActive && !hasCustomDaily) effDaily = 0;
        if (!roleIsActive && !hasCustomMonthly) effMonthly = 0;

        // Query usage for this employee
        const [usedToday, usedThisMonth] = await Promise.all([
          this.prisma.lead.count({
            where: {
              customerId: custId,
              deletedAt: null,
              OR: [
                { employeeId: emp.id },
                ...(emp.userId ? [{ createdById: emp.userId }] : []),
              ],
              createdAt: { gte: dayRange.start, lte: dayRange.end },
            },
          }),
          this.prisma.lead.count({
            where: {
              customerId: custId,
              deletedAt: null,
              OR: [
                { employeeId: emp.id },
                ...(emp.userId ? [{ createdById: emp.userId }] : []),
              ],
              createdAt: { gte: monthRange.start, lte: monthRange.end },
            },
          }),
        ]);

        return {
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          name: `${emp.firstName} ${emp.lastName || ''}`.trim(),
          email: emp.email,
          role: normalizedRole,
          effectiveDailyLimit: effDaily,
          effectiveMonthlyLimit: effMonthly,
          usedToday,
          remainingToday: Math.max(0, effDaily - usedToday),
          usedThisMonth,
          remainingThisMonth: Math.max(0, effMonthly - usedThisMonth),
          customDailyLimit: custom?.dailyLimit ?? null,
          customMonthlyLimit: custom?.monthlyLimit ?? null,
          isCustom: hasCustomDaily || hasCustomMonthly,
          roleDailyLimit: roleDaily,
          roleMonthlyLimit: roleMonthly,
          roleIsActive,
        };
      }),
    );
  }

  async getEmployeeLimitById(customerId: number, employeeId: number) {
    const custId = Number(customerId);
    const empId = Number(employeeId);

    const limitInfo = await this.getEffectiveLimitForEmployee(custId, empId);
    const usage = await this.getEmployeeUsage(custId, empId, limitInfo.employee.userId);

    return {
      employeeId: empId,
      employeeCode: limitInfo.employee.employeeCode,
      name: `${limitInfo.employee.firstName} ${limitInfo.employee.lastName || ''}`.trim(),
      email: limitInfo.employee.email,
      role: limitInfo.normalizedRole,
      effectiveDailyLimit: limitInfo.effectiveDailyLimit,
      effectiveMonthlyLimit: limitInfo.effectiveMonthlyLimit,
      usedToday: usage.usedToday,
      remainingToday: Math.max(0, limitInfo.effectiveDailyLimit - usage.usedToday),
      usedThisMonth: usage.usedThisMonth,
      remainingThisMonth: Math.max(0, limitInfo.effectiveMonthlyLimit - usage.usedThisMonth),
      customDailyLimit: limitInfo.customDailyLimit,
      customMonthlyLimit: limitInfo.customMonthlyLimit,
      isCustom: limitInfo.isCustom,
    };
  }

  async upsertEmployeeLimit(
    customerId: number,
    employeeId: number,
    dto: SetEmployeeLeadLimitDto,
  ) {
    const custId = Number(customerId);
    const empId = Number(employeeId);

    const employee = await this.prisma.employee.findFirst({
      where: { id: empId, customerId: custId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee #${empId} not found in this company`);
    }

    const daily = dto.dailyLimit !== undefined && dto.dailyLimit !== null ? Number(dto.dailyLimit) : null;
    const monthly = dto.monthlyLimit !== undefined && dto.monthlyLimit !== null ? Number(dto.monthlyLimit) : null;

    return this.prisma.employeeLeadLimit.upsert({
      where: { employeeId: empId },
      update: {
        customerId: custId,
        dailyLimit: daily,
        monthlyLimit: monthly,
      },
      create: {
        customerId: custId,
        employeeId: empId,
        dailyLimit: daily,
        monthlyLimit: monthly,
      },
    });
  }

  async clearEmployeeLimit(customerId: number, employeeId: number) {
    const custId = Number(customerId);
    const empId = Number(employeeId);

    await this.prisma.employeeLeadLimit.deleteMany({
      where: { customerId: custId, employeeId: empId },
    });

    return { success: true, message: `Custom limits cleared for employee #${empId}` };
  }

  // ===========================================================================
  // 5. ATOMIC VALIDATION & CONSUMPTION DURING LEAD CREATION
  // ===========================================================================

  async validateAndConsumeLeadLimit(
    tx: Prisma.TransactionClient,
    customerId: number | string,
    user: any,
  ): Promise<{ employeeId: number | null }> {
    const custId = Number(customerId);
    const userId = Number(user.id);

    // Identify employee record
    let employeeId = user.employee?.id;
    let employee = user.employee;

    if (!employeeId) {
      employee = await tx.employee.findFirst({
        where: { customerId: custId, userId },
      });
      if (employee) employeeId = employee.id;
    }

    // If super admin or customer admin creating a lead directly with no employee record
    if (!employeeId) {
      return { employeeId: null };
    }

    // 1. Check Lead permission
    const permResult = await this.workPermissionService.getEmployeeEffectivePermissions(
      custId,
      { employeeId },
    );
    if (permResult.effectivePermissions['leads'] !== true) {
      throw new ForbiddenException('You do not have permission to access or generate leads.');
    }

    // 2. Concurrency Control: Acquire PostgreSQL row-level lock on Employee record
    // This serializes concurrent lead generation requests for this employee
    await tx.$queryRawUnsafe(
      'SELECT id FROM "Employee" WHERE id = $1 AND "customerId" = $2 FOR UPDATE',
      employeeId,
      custId,
    );

    // 3. Resolve effective limit
    const limitInfo = await this.getEffectiveLimitForEmployee(custId, employeeId);

    // 4. Calculate usage within the transaction
    const dayRange = getBusinessDayRange();
    const monthRange = getBusinessMonthRange();

    const employeeFilter: Prisma.LeadWhereInput = {
      customerId: custId,
      deletedAt: null,
      OR: [{ employeeId }, { createdById: userId }],
    };

    const [usedToday, usedThisMonth] = await Promise.all([
      tx.lead.count({
        where: {
          ...employeeFilter,
          createdAt: {
            gte: dayRange.start,
            lte: dayRange.end,
          },
        },
      }),
      tx.lead.count({
        where: {
          ...employeeFilter,
          createdAt: {
            gte: monthRange.start,
            lte: monthRange.end,
          },
        },
      }),
    ]);

    // 5. Enforce Limits
    if (usedToday >= limitInfo.effectiveDailyLimit) {
      this.logger.warn(
        `[LIMIT_REACHED] Employee #${employeeId} daily lead limit reached: used ${usedToday}/${limitInfo.effectiveDailyLimit}`,
      );
      throw new BadRequestException('Daily lead generation limit reached.');
    }

    if (usedThisMonth >= limitInfo.effectiveMonthlyLimit) {
      this.logger.warn(
        `[LIMIT_REACHED] Employee #${employeeId} monthly lead limit reached: used ${usedThisMonth}/${limitInfo.effectiveMonthlyLimit}`,
      );
      throw new BadRequestException('Monthly lead generation limit reached.');
    }

    return { employeeId };
  }
}
