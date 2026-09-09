import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkAccessRequestStatus, AccessOverrideType } from '@prisma/client';

export interface WorkModuleMeta {
  key: string;
  name: string;
  description: string;
  icon: string;
  isRoleSpecific: boolean;
}

export const COMMON_MODULES: { key: string; name: string }[] = [
  { key: 'dashboard', name: 'Dashboard' },
  { key: 'attendance', name: 'Attendance' },
  { key: 'leave', name: 'Leave & Requests' },
  { key: 'calendar', name: 'Calendar' },
  { key: 'profile', name: 'Profile' },
];

export const STANDARD_WORK_MODULES: WorkModuleMeta[] = [
  {
    key: 'leads',
    name: 'Leads & CRM',
    description: 'Leads pipeline, follow-ups, quotes, proposals, and customer acquisition.',
    icon: 'team',
    isRoleSpecific: true,
  },
  {
    key: 'video_edit',
    name: 'Video Edit',
    description: 'Video post-production, timeline cuts, transitions, and audio sync.',
    icon: 'video_camera',
    isRoleSpecific: true,
  },
  {
    key: 'post_design',
    name: 'Post Design',
    description: 'Social media post graphic creation, branding assets, and creatives.',
    icon: 'image',
    isRoleSpecific: true,
  },
  {
    key: 'story_design',
    name: 'Story Design',
    description: 'Vertical social story designs, interactive stickers, and highlights.',
    icon: 'layout',
    isRoleSpecific: true,
  },
  {
    key: 'reel_shoot',
    name: 'Reel Shoot',
    description: 'On-site camera shooting, footage capture, reel & short video shoots.',
    icon: 'camera',
    isRoleSpecific: true,
  },
  {
    key: 'reel_post',
    name: 'Reel Post',
    description: 'Reel publishing, captioning, hashtag strategy, and feed scheduling.',
    icon: 'share_forward',
    isRoleSpecific: true,
  },
  {
    key: 'story_post',
    name: 'Story Post',
    description: 'Live story upload, interactive stickers, and highlight publishing.',
    icon: 'share_forward',
    isRoleSpecific: true,
  },
  {
    key: 'influencer_promo',
    name: 'Influencer Promo',
    description: 'Influencer collaborations, promo campaigns, and brand partnerships.',
    icon: 'user_star',
    isRoleSpecific: true,
  },
];

// Default business configuration
export const DEFAULT_ROLE_WORK_MAPPINGS: Record<string, string[]> = {
  'Video Editor': ['video_edit'],
  'VIDEO_EDITOR': ['video_edit'],
  'Graphic Designer': ['post_design', 'story_design'],
  'GRAPHIC_DESIGNER': ['post_design', 'story_design'],
  'Photographer': ['reel_shoot'],
  'PHOTOGRAPHER': ['reel_shoot'],
  'Reel Shooter': ['reel_shoot'],
  'REEL_SHOOTER': ['reel_shoot'],
  'Videographer': ['reel_shoot'],
  'VIDEOGRAPHER': ['reel_shoot'],
  'Social Media Executive': ['reel_post', 'story_post', 'post_publish'],
  'SOCIAL_MEDIA_EXECUTIVE': ['reel_post', 'story_post', 'post_publish'],
  'Social Media Manager': ['reel_post', 'story_post', 'post_publish'],
  'SOCIAL_MEDIA_MANAGER': ['reel_post', 'story_post', 'post_publish'],
  'Influencer Executive': ['influencer_promo'],
  'INFLUENCER_EXECUTIVE': ['influencer_promo'],
  'Influencer Lead': ['influencer_promo'],
  'INFLUENCER_LEAD': ['influencer_promo'],
  'Telecaller': ['leads'],
  'TELECALLER': ['leads'],
  'Sales Executive': ['leads'],
  'SALES_EXECUTIVE': ['leads'],
  'Sales': ['leads'],
  'SALES': ['leads'],
  'Admin': ['leads', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'Super Admin': ['leads', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'ADMIN': ['leads', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'SUPER_ADMIN': ['leads', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
};

@Injectable()
export class WorkPermissionService {
  private readonly logger = new Logger(WorkPermissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  getWorkModules(): WorkModuleMeta[] {
    return STANDARD_WORK_MODULES;
  }

  getCommonModules() {
    return COMMON_MODULES;
  }

  normalizeRoleKey(roleName?: string | null): string {
    if (!roleName) return 'General Employee';
    return roleName.trim();
  }

  getDefaultPermissionsForRole(roleName: string): string[] {
    const trimmed = roleName.trim();
    if (DEFAULT_ROLE_WORK_MAPPINGS[trimmed]) {
      return DEFAULT_ROLE_WORK_MAPPINGS[trimmed];
    }
    const upper = trimmed.toUpperCase().replace(/\s+/g, '_');
    if (DEFAULT_ROLE_WORK_MAPPINGS[upper]) {
      return DEFAULT_ROLE_WORK_MAPPINGS[upper];
    }
    // Partial match checks
    const lower = trimmed.toLowerCase();
    if (lower.includes('video edit') || lower.includes('editor')) return ['video_edit'];
    if (lower.includes('graphic') || lower.includes('designer')) return ['post_design', 'story_design'];
    if (lower.includes('photo') || lower.includes('shoot') || lower.includes('videograph')) return ['reel_shoot'];
    if (lower.includes('social') || lower.includes('smm') || lower.includes('executive')) return ['reel_post', 'story_post', 'post_publish'];
    if (lower.includes('influencer')) return ['influencer_promo'];
    if (lower.includes('telecall') || lower.includes('sales') || lower.includes('lead')) return ['leads'];
    if (lower.includes('admin')) return ['leads', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'];
    return [];
  }

  private async resolveCustomerId(customerId?: number | string): Promise<number> {
    if (customerId && !isNaN(Number(customerId)) && Number(customerId) > 0) {
      return Number(customerId);
    }
    const firstCustomer = await this.prisma.customer.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return firstCustomer?.id || 1;
  }

  // ===========================================================================
  // ROLE PERMISSIONS
  // ===========================================================================

  async getRoleWorkPermissions(customerId: number | string) {
    const custId = await this.resolveCustomerId(customerId);

    // 1. Fetch designations / roles available for this customer
    const [designations, customRoles, dbPermissions] = await Promise.all([
      this.prisma.designation.findMany({
        where: { customerId: custId, isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          employees: {
            select: { id: true, status: true },
          },
        },
        orderBy: [{ level: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.role.findMany({
        where: {
          customerId: custId,
          deletedAt: null,
          NOT: { name: { in: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CUSTOMER'] } },
        },
        select: {
          id: true,
          name: true,
          userRoles: {
            select: {
              user: {
                select: {
                  employee: {
                    select: { id: true, status: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.roleWorkPermission.findMany({
        where: { customerId: custId },
      }),
    ]);

    // Map existing permissions by roleName -> workModule -> isEnabled
    const permMap = new Map<string, Map<string, boolean>>();
    for (const p of dbPermissions) {
      if (!permMap.has(p.roleName)) {
        permMap.set(p.roleName, new Map<string, boolean>());
      }
      permMap.get(p.roleName)!.set(p.workModule, p.isEnabled);
    }

    const seenNames = new Set<string>();
    const rolesList: any[] = [];

    // 1. Process designations first (primary source for employee roles)
    for (const d of designations) {
      const roleName = d.name.trim();
      seenNames.add(roleName.toLowerCase());

      const rolePerms = permMap.get(roleName);
      const defaultAllowed = this.getDefaultPermissionsForRole(roleName);

      const modules = STANDARD_WORK_MODULES.map((mod) => {
        let isEnabled = false;
        if (rolePerms && rolePerms.has(mod.key)) {
          isEnabled = rolePerms.get(mod.key)!;
        } else {
          isEnabled = defaultAllowed.includes(mod.key);
        }
        return {
          module: mod.key,
          name: mod.name,
          isEnabled,
        };
      });

      const totalEmployeesCount = d.employees ? d.employees.length : 0;
      const activeEmployeesCount = d.employees
        ? d.employees.filter((e) => (e.status || '').toUpperCase() === 'ACTIVE').length
        : 0;

      rolesList.push({
        id: String(d.id),
        roleId: String(d.id),
        designationId: d.id,
        roleName: d.name,
        name: d.name,
        code: d.code,
        activeEmployeesCount,
        totalEmployeesCount,
        modules,
      });
    }

    // 2. Process custom roles if not already present as a designation
    for (const r of customRoles) {
      const roleName = r.name.trim();
      if (seenNames.has(roleName.toLowerCase())) continue;
      seenNames.add(roleName.toLowerCase());

      const rolePerms = permMap.get(roleName);
      const defaultAllowed = this.getDefaultPermissionsForRole(roleName);

      const modules = STANDARD_WORK_MODULES.map((mod) => {
        let isEnabled = false;
        if (rolePerms && rolePerms.has(mod.key)) {
          isEnabled = rolePerms.get(mod.key)!;
        } else {
          isEnabled = defaultAllowed.includes(mod.key);
        }
        return {
          module: mod.key,
          name: mod.name,
          isEnabled,
        };
      });

      const employees = (r.userRoles || [])
        .map((ur) => ur.user?.employee)
        .filter(Boolean);
      const totalEmployeesCount = employees.length;
      const activeEmployeesCount = employees.filter(
        (e) => (e?.status || '').toUpperCase() === 'ACTIVE',
      ).length;

      rolesList.push({
        id: `role_${r.id}`,
        roleId: `role_${r.id}`,
        designationId: null,
        roleName: r.name,
        name: r.name,
        code: r.name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6) || 'ROLE',
        activeEmployeesCount,
        totalEmployeesCount,
        modules,
      });
    }

    return {
      customerId: custId,
      roles: rolesList,
      availableModules: STANDARD_WORK_MODULES,
      commonModules: COMMON_MODULES,
    };
  }

  async updateRoleWorkPermissions(
    customerId: number | string,
    roleIdentifier: string,
    permissions: Record<string, boolean>,
  ) {
    const custId = await this.resolveCustomerId(customerId);
    let normalizedRole = (roleIdentifier || '').trim();

    // Check if roleIdentifier is numeric ID (e.g. "3") or prefixed ID (e.g. "desig_3" or "role_6")
    const numericMatch = normalizedRole.match(/^(?:desig_|role_)?(\d+)$/i);
    if (numericMatch) {
      const numericId = parseInt(numericMatch[1], 10);
      if (normalizedRole.startsWith('role_')) {
        const foundRole = await this.prisma.role.findFirst({
          where: { id: numericId, customerId: custId },
          select: { name: true },
        });
        if (foundRole) normalizedRole = foundRole.name.trim();
      } else {
        const foundDesig = await this.prisma.designation.findFirst({
          where: { id: numericId, customerId: custId },
          select: { name: true },
        });
        if (foundDesig) {
          normalizedRole = foundDesig.name.trim();
        } else {
          const foundRole = await this.prisma.role.findFirst({
            where: { id: numericId, customerId: custId },
            select: { name: true },
          });
          if (foundRole) normalizedRole = foundRole.name.trim();
        }
      }
    }

    const updates = Object.entries(permissions).map(async ([moduleKey, isEnabled]) => {
      return this.prisma.roleWorkPermission.upsert({
        where: {
          customerId_roleName_workModule: {
            customerId: custId,
            roleName: normalizedRole,
            workModule: moduleKey,
          },
        },
        create: {
          customerId: custId,
          roleName: normalizedRole,
          workModule: moduleKey,
          isEnabled: Boolean(isEnabled),
        },
        update: {
          isEnabled: Boolean(isEnabled),
          updatedAt: new Date(),
        },
      });
    });

    await Promise.all(updates);

    return {
      success: true,
      roleName: normalizedRole,
      roleIdentifier,
      permissions,
      message: `Permissions updated for role ${normalizedRole}`,
    };
  }

  // ===========================================================================
  // EMPLOYEE SPECIFIC OVERRIDES
  // ===========================================================================

  async getEmployeesWithOverrides(customerId: number) {
    const custId = Number(customerId);

    const employees = await this.prisma.employee.findMany({
      where: { customerId: custId },
      include: {
        designation: true,
        user: {
          include: {
            userRoles: {
              include: { role: true },
            },
          },
        },
        employeeModuleOverrides: true,
      },
      orderBy: { firstName: 'asc' },
    });

    return employees.map((emp: any) => {
      const roleCandidate =
        emp.designation?.name ||
        (emp.user?.userRoles && emp.user.userRoles.length > 0
          ? emp.user.userRoles[0].role.name
          : emp.user?.designation || emp.user?.role) ||
        'Employee';
      const normalizedRole = this.normalizeRoleKey(roleCandidate);
      const defaultRolePerms = this.getDefaultPermissionsForRole(normalizedRole);

      const overridesMap: Record<string, AccessOverrideType> = {};
      if (emp.employeeModuleOverrides) {
        emp.employeeModuleOverrides.forEach((ov: any) => {
          overridesMap[ov.moduleKey] = ov.override;
        });
      }

      return {
        id: emp.id,
        employeeCode: emp.employeeCode,
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        role: normalizedRole,
        defaultRolePermissions: defaultRolePerms,
        overrides: overridesMap,
      };
    });
  }

  async getEmployeeOverrides(customerId: number, employeeId: number) {
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
        employeeModuleOverrides: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee #${empId} not found`);
    }

    const roleCandidate =
      employee.designation?.name ||
      ((employee as any).user?.userRoles && (employee as any).user.userRoles.length > 0
        ? (employee as any).user.userRoles[0].role.name
        : (employee as any).user?.designation || (employee as any).user?.role) ||
      'Employee';
    const normalizedRole = this.normalizeRoleKey(roleCandidate);

    // Get base role permissions
    const dbRolePerms = await this.prisma.roleWorkPermission.findMany({
      where: { customerId: custId, roleName: normalizedRole },
    });

    const rolePermMap: Record<string, boolean> = {};
    if (dbRolePerms.length > 0) {
      dbRolePerms.forEach((p) => {
        rolePermMap[p.workModule] = p.isEnabled;
      });
    } else {
      const defaults = this.getDefaultPermissionsForRole(normalizedRole);
      STANDARD_WORK_MODULES.forEach((m) => {
        rolePermMap[m.key] = defaults.includes(m.key);
      });
    }

    const overrideMap: Record<string, AccessOverrideType> = {};
    if (employee.employeeModuleOverrides) {
      employee.employeeModuleOverrides.forEach((ov) => {
        overrideMap[ov.moduleKey] = ov.override;
      });
    }

    const modules = STANDARD_WORK_MODULES.map((mod) => {
      const roleAccess = Boolean(rolePermMap[mod.key]);
      const override = overrideMap[mod.key] || AccessOverrideType.DEFAULT;
      let effective = roleAccess;
      if (override === AccessOverrideType.ALLOW) effective = true;
      if (override === AccessOverrideType.DENY) effective = false;

      const source =
        override !== AccessOverrideType.DEFAULT
          ? `Employee Override (${override})`
          : `Inherited from Role (${roleAccess ? 'ALLOW' : 'DENY'})`;

      return {
        moduleKey: mod.key,
        moduleName: mod.name,
        roleAccess,
        override,
        effective,
        source,
      };
    });

    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      name: `${employee.firstName} ${employee.lastName || ''}`.trim(),
      role: normalizedRole,
      modules,
    };
  }

  async updateEmployeeOverrides(
    customerId: number,
    employeeId: number,
    overrides: Record<string, AccessOverrideType | 'DEFAULT' | 'ALLOW' | 'DENY'>,
  ) {
    const custId = Number(customerId);
    const empId = Number(employeeId);

    const employee = await this.prisma.employee.findFirst({
      where: { id: empId, customerId: custId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee #${empId} not found`);
    }

    const ops = Object.entries(overrides).map(async ([moduleKey, overrideVal]) => {
      const enumVal = overrideVal as AccessOverrideType;
      if (enumVal === AccessOverrideType.DEFAULT) {
        // If set to DEFAULT, delete override record to cleanly inherit role setting
        return this.prisma.employeeModuleOverride.deleteMany({
          where: { customerId: custId, employeeId: empId, moduleKey },
        });
      }

      return this.prisma.employeeModuleOverride.upsert({
        where: {
          customerId_employeeId_moduleKey: {
            customerId: custId,
            employeeId: empId,
            moduleKey,
          },
        },
        create: {
          customerId: custId,
          employeeId: empId,
          moduleKey,
          override: enumVal,
        },
        update: {
          override: enumVal,
          updatedAt: new Date(),
        },
      });
    });

    await Promise.all(ops);

    return {
      success: true,
      message: `Employee #${empId} access overrides updated`,
      employeeId: empId,
      overrides,
    };
  }

  // ===========================================================================
  // EFFECTIVE PERMISSIONS RESOLUTION
  // ===========================================================================

  async getEmployeeEffectivePermissions(
    customerId: number,
    identifier: { employeeId?: number; userId?: number; email?: string },
  ) {
    const custId = Number(customerId);

    // 1. Resolve employee
    let employee = null;
    if (identifier.employeeId) {
      employee = await this.prisma.employee.findFirst({
        where: { id: Number(identifier.employeeId), customerId: custId },
        include: {
          designation: true,
          user: {
            include: {
              userRoles: {
                include: { role: true },
              },
            },
          },
          employeeModuleOverrides: true,
        },
      });
    } else if (identifier.userId) {
      employee = await this.prisma.employee.findFirst({
        where: { userId: Number(identifier.userId), customerId: custId },
        include: {
          designation: true,
          user: {
            include: {
              userRoles: {
                include: { role: true },
              },
            },
          },
          employeeModuleOverrides: true,
        },
      });
    } else if (identifier.email) {
      employee = await this.prisma.employee.findFirst({
        where: { email: identifier.email, customerId: custId },
        include: {
          designation: true,
          user: {
            include: {
              userRoles: {
                include: { role: true },
              },
            },
          },
          employeeModuleOverrides: true,
        },
      });
    }

    if (!employee) {
      // Fallback if user is customer admin
      const allModules = STANDARD_WORK_MODULES.map((m) => m.key);
      const effectiveMap: Record<string, boolean> = {};
      STANDARD_WORK_MODULES.forEach((m) => {
        effectiveMap[m.key] = true;
      });

      return {
        employeeId: null,
        employeeCode: null,
        role: 'Admin',
        workPermissions: allModules,
        effectivePermissions: effectiveMap,
        commonModules: COMMON_MODULES.map((m) => m.key),
      };
    }

    // Determine primary role name from designation or user roles
    const roleCandidate =
      employee.designation?.name ||
      ((employee as any).user?.userRoles && (employee as any).user.userRoles.length > 0
        ? (employee as any).user.userRoles[0].role.name
        : (employee as any).user?.designation || (employee as any).user?.role) ||
      'Employee';

    const normalizedRole = this.normalizeRoleKey(roleCandidate);

    // 2. Fetch role work permissions from DB
    const dbRolePermissions = await this.prisma.roleWorkPermission.findMany({
      where: {
        customerId: custId,
        roleName: normalizedRole,
      },
    });

    const activePermissions = new Set<string>();

    if (dbRolePermissions.length > 0) {
      for (const p of dbRolePermissions) {
        if (p.isEnabled) {
          activePermissions.add(p.workModule);
        }
      }
    } else {
      // Use defaults
      const defaults = this.getDefaultPermissionsForRole(normalizedRole);
      defaults.forEach((p) => activePermissions.add(p));
    }

    // 3. Fetch approved employee specific access requests
    const approvedRequests = await this.prisma.workAccessRequest.findMany({
      where: {
        customerId: custId,
        employeeId: employee.id,
        status: WorkAccessRequestStatus.APPROVED,
      },
      select: { workModule: true },
    });

    approvedRequests.forEach((req) => activePermissions.add(req.workModule));

    // 4. Apply Employee-specific Overrides (ALLOW / DENY / DEFAULT)
    if (employee.employeeModuleOverrides && employee.employeeModuleOverrides.length > 0) {
      for (const ov of employee.employeeModuleOverrides) {
        if (ov.override === AccessOverrideType.ALLOW) {
          activePermissions.add(ov.moduleKey);
        } else if (ov.override === AccessOverrideType.DENY) {
          activePermissions.delete(ov.moduleKey);
        }
      }
    }

    // Build effective boolean map for fast lookups
    const effectiveMap: Record<string, boolean> = {};
    STANDARD_WORK_MODULES.forEach((m) => {
      effectiveMap[m.key] = activePermissions.has(m.key);
    });

    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      role: normalizedRole,
      workPermissions: Array.from(activePermissions),
      effectivePermissions: effectiveMap,
      commonModules: COMMON_MODULES.map((m) => m.key),
    };
  }

  // ===========================================================================
  // ACCESS REQUESTS
  // ===========================================================================

  async createAccessRequest(
    customerId: number,
    employeeId: number,
    workModule: string,
    reason?: string,
  ) {
    const custId = Number(customerId);
    const empId = Number(employeeId);

    // Validate module
    const valid = STANDARD_WORK_MODULES.some((m) => m.key === workModule);
    if (!valid) {
      throw new BadRequestException(`Invalid work module: ${workModule}`);
    }

    // Verify employee belongs to customer
    const employee = await this.prisma.employee.findFirst({
      where: { id: empId, customerId: custId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${empId} not found in this workspace`);
    }

    // Check if request already exists in PENDING
    const existing = await this.prisma.workAccessRequest.findFirst({
      where: {
        customerId: custId,
        employeeId: empId,
        workModule,
        status: WorkAccessRequestStatus.PENDING,
      },
    });

    if (existing) {
      return {
        ...existing,
        message: 'An access request for this module is already pending approval',
      };
    }

    const created = await this.prisma.workAccessRequest.create({
      data: {
        customerId: custId,
        employeeId: empId,
        workModule,
        status: WorkAccessRequestStatus.PENDING,
        reason: reason?.trim() || null,
      },
    });

    return created;
  }

  async getMyAccessRequests(customerId: number, employeeId: number) {
    const custId = Number(customerId);
    const empId = Number(employeeId);

    return this.prisma.workAccessRequest.findMany({
      where: {
        customerId: custId,
        employeeId: empId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllAccessRequests(customerId: number, status?: WorkAccessRequestStatus) {
    const custId = Number(customerId);

    return this.prisma.workAccessRequest.findMany({
      where: {
        customerId: custId,
        ...(status ? { status } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            designation: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveAccessRequest(customerId: number, requestId: number, adminUserId?: number) {
    const custId = Number(customerId);
    const reqId = Number(requestId);

    const request = await this.prisma.workAccessRequest.findFirst({
      where: { id: reqId, customerId: custId },
    });

    if (!request) {
      throw new NotFoundException(`Access request #${reqId} not found`);
    }

    const [updated] = await Promise.all([
      this.prisma.workAccessRequest.update({
        where: { id: reqId },
        data: {
          status: WorkAccessRequestStatus.APPROVED,
          approvedById: adminUserId ? Number(adminUserId) : null,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      }),
      this.prisma.employeeModuleOverride.upsert({
        where: {
          customerId_employeeId_moduleKey: {
            customerId: custId,
            employeeId: request.employeeId,
            moduleKey: request.workModule,
          },
        },
        create: {
          customerId: custId,
          employeeId: request.employeeId,
          moduleKey: request.workModule,
          override: AccessOverrideType.ALLOW,
        },
        update: {
          override: AccessOverrideType.ALLOW,
          updatedAt: new Date(),
        },
      }),
    ]);

    return {
      success: true,
      message: `Access request for ${request.workModule} approved`,
      request: updated,
    };
  }

  async rejectAccessRequest(
    customerId: number,
    requestId: number,
    rejectionReason?: string,
    adminUserId?: number,
  ) {
    const custId = Number(customerId);
    const reqId = Number(requestId);

    const request = await this.prisma.workAccessRequest.findFirst({
      where: { id: reqId, customerId: custId },
    });

    if (!request) {
      throw new NotFoundException(`Access request #${reqId} not found`);
    }

    const updated = await this.prisma.workAccessRequest.update({
      where: { id: reqId },
      data: {
        status: WorkAccessRequestStatus.REJECTED,
        rejectionReason: rejectionReason?.trim() || 'Access request was rejected by admin.',
        approvedById: adminUserId ? Number(adminUserId) : null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return {
      success: true,
      message: `Access request for ${request.workModule} rejected`,
      request: updated,
    };
  }

  async checkPermission(customerId: number, employeeId: number, workModule: string) {
    const effective = await this.getEmployeeEffectivePermissions(customerId, { employeeId });
    if (!effective.workPermissions.includes(workModule)) {
      throw new ForbiddenException(
        `Forbidden: You do not have permission to access the '${workModule}' module. Submit an Access Request to Admin to get access.`,
      );
    }
    return true;
  }

  /**
   * Get allowed normalized activity types for an employee based on their effective permissions/role.
   */
  async getAllowedActivityTypesForEmployee(
    employeeId: number,
    customerId?: number,
  ): Promise<{
    role: string;
    allowedTypes: Set<string>;
    isFullAccess: boolean;
    workPermissions: string[];
  }> {
    const custId = await this.resolveCustomerId(customerId);
    const effective = await this.getEmployeeEffectivePermissions(custId, { employeeId });

    const roleName = (effective.role || '').toUpperCase();
    const isFullAccess =
      roleName.includes('ADMIN') ||
      roleName.includes('SUPER') ||
      roleName.includes('DIRECTOR') ||
      roleName.includes('OWNER') ||
      (roleName.includes('MANAGER') && !roleName.includes('SOCIAL'));

    const allowedTypes = new Set<string>();

    if (isFullAccess) {
      [
        'REEL_SHOOT',
        'REEL_EDIT',
        'REEL_POST',
        'STORY_DESIGN',
        'STORY_POST',
        'POST_DESIGN',
        'INFLUENCER_PROMO',
        'VIDEO_EDITING',
        'SHOOT',
        'UPLOADING',
        'GRAPHIC_DESIGN',
      ].forEach((t) => allowedTypes.add(t));
      return {
        role: effective.role,
        allowedTypes,
        isFullAccess: true,
        workPermissions: effective.workPermissions,
      };
    }

    for (const mod of effective.workPermissions) {
      const types = WORK_MODULE_TO_ACTIVITY_TYPES[mod] || [];
      for (const t of types) {
        allowedTypes.add(t);
      }
    }

    return {
      role: effective.role,
      allowedTypes,
      isFullAccess: false,
      workPermissions: effective.workPermissions,
    };
  }
}

export const WORK_MODULE_TO_ACTIVITY_TYPES: Record<string, string[]> = {
  video_edit: ['REEL_EDIT', 'VIDEO_EDITING', 'VIDEO', 'EDITING'],
  post_design: ['POST_DESIGN', 'GRAPHIC_DESIGN', 'CREATIVE_POST'],
  story_design: ['STORY_DESIGN', 'STORY'],
  reel_shoot: ['REEL_SHOOT', 'SHOOT', 'REELS_SHOOT'],
  reel_post: ['REEL_POST', 'UPLOADING'],
  story_post: ['STORY_POST'],
  post_publish: ['REEL_POST', 'STORY_POST', 'POST_PUBLISHING', 'UPLOADING'],
  influencer_promo: ['INFLUENCER_PROMO', 'INFLUENCER_PROMOTION'],
};

export function normalizeActivityType(work: {
  workType?: string | null;
  title?: string | null;
  description?: string | null;
  serviceName?: string | null;
}): string {
  const text = `${work.title || ''} ${work.serviceName || ''} ${work.description || ''}`.toLowerCase();
  const rawType = (work.workType || '').toUpperCase();

  // 1. Reel Stages
  if (
    text.includes('reel shoot') ||
    text.includes('reels shoot') ||
    text.includes('video shoot') ||
    rawType === 'REELS_SHOOT' ||
    rawType === 'SHOOT'
  ) {
    return 'REEL_SHOOT';
  }
  if (
    text.includes('reel edit') ||
    text.includes('reels edit') ||
    text.includes('video editing') ||
    text.includes('color grading') ||
    rawType === 'VIDEO_EDITING' ||
    rawType === 'EDITING'
  ) {
    return 'REEL_EDIT';
  }
  if (
    text.includes('reel post') ||
    text.includes('reel publish') ||
    text.includes('reels post') ||
    rawType === 'UPLOADING'
  ) {
    return 'REEL_POST';
  }

  // 2. Story Stages
  if (
    text.includes('story post') ||
    text.includes('story publish') ||
    rawType === 'STORY_POST'
  ) {
    return 'STORY_POST';
  }
  if (
    text.includes('story design') ||
    text.includes('story creative') ||
    rawType === 'STORY_DESIGN' ||
    (rawType === 'STORY' && !text.includes('post'))
  ) {
    return 'STORY_DESIGN';
  }

  // 3. Post Stages
  if (
    text.includes('post design') ||
    text.includes('creative post design') ||
    text.includes('graphic design') ||
    rawType === 'POST_DESIGN' ||
    rawType === 'GRAPHIC_DESIGN'
  ) {
    return 'POST_DESIGN';
  }
  if (
    text.includes('post publish') ||
    text.includes('post upload') ||
    text.includes('post publishing')
  ) {
    return 'REEL_POST';
  }

  // 4. Influencer
  if (text.includes('influencer') || rawType.includes('INFLUENCER')) {
    return 'INFLUENCER_PROMO';
  }

  // 5. Raw Type Fallbacks
  if (rawType === 'REEL') {
    if (text.includes('edit')) return 'REEL_EDIT';
    if (text.includes('post') || text.includes('publish')) return 'REEL_POST';
    return 'REEL_SHOOT';
  }
  if (rawType === 'CREATIVE_POST') {
    if (text.includes('publish') || text.includes('post')) return 'REEL_POST';
    return 'POST_DESIGN';
  }
  if (rawType === 'VIDEO') return 'REEL_EDIT';
  if (rawType === 'STORY') return 'STORY_DESIGN';

  return rawType || 'REEL_SHOOT';
}
