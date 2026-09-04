import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkAccessRequestStatus } from '@prisma/client';

export interface WorkModuleMeta {
  key: string;
  name: string;
  description: string;
  icon: string;
}

export const STANDARD_WORK_MODULES: WorkModuleMeta[] = [
  {
    key: 'video_edit',
    name: 'Video Edit',
    description: 'Video post-production, timeline cuts, transitions, and audio sync.',
    icon: 'video_camera',
  },
  {
    key: 'post_design',
    name: 'Post Design',
    description: 'Social media post graphic creation, branding assets, and creatives.',
    icon: 'image',
  },
  {
    key: 'story_design',
    name: 'Story Design',
    description: 'Vertical social story designs, interactive stickers, and highlights.',
    icon: 'layout',
  },
  {
    key: 'reel_shoot',
    name: 'Reel Shoot',
    description: 'On-site camera shooting, footage capture, reel & short video shoots.',
    icon: 'camera',
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
  'Admin': ['video_edit', 'post_design', 'story_design', 'reel_shoot'],
  'Super Admin': ['video_edit', 'post_design', 'story_design', 'reel_shoot'],
  'ADMIN': ['video_edit', 'post_design', 'story_design', 'reel_shoot'],
  'SUPER_ADMIN': ['video_edit', 'post_design', 'story_design', 'reel_shoot'],
};

@Injectable()
export class WorkPermissionService {
  private readonly logger = new Logger(WorkPermissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  getWorkModules(): WorkModuleMeta[] {
    return STANDARD_WORK_MODULES;
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
    if (trimmed.toLowerCase().includes('video edit')) return ['video_edit'];
    if (trimmed.toLowerCase().includes('graphic') || trimmed.toLowerCase().includes('designer')) return ['post_design', 'story_design'];
    if (trimmed.toLowerCase().includes('photo') || trimmed.toLowerCase().includes('shoot')) return ['reel_shoot'];
    if (trimmed.toLowerCase().includes('admin')) return ['video_edit', 'post_design', 'story_design', 'reel_shoot'];
    return [];
  }

  async getRoleWorkPermissions(customerId: number) {
    const custId = Number(customerId);

    // 1. Fetch designations / roles available for this customer
    const [designations, customRoles, dbPermissions] = await Promise.all([
      this.prisma.designation.findMany({
        where: { customerId: custId },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.role.findMany({
        where: { customerId: custId, deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.roleWorkPermission.findMany({
        where: { customerId: custId },
      }),
    ]);

    // Build role set including standard roles
    const roleNames = new Set<string>([
      'Video Editor',
      'Graphic Designer',
      'Photographer',
      'Admin',
    ]);

    designations.forEach((d) => roleNames.add(d.name));
    customRoles.forEach((r) => roleNames.add(r.name));

    // Map existing permissions by roleName -> workModule -> isEnabled
    const permMap = new Map<string, Map<string, boolean>>();
    for (const p of dbPermissions) {
      if (!permMap.has(p.roleName)) {
        permMap.set(p.roleName, new Map<string, boolean>());
      }
      permMap.get(p.roleName)!.set(p.workModule, p.isEnabled);
    }

    const result = Array.from(roleNames).map((roleName) => {
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

      return {
        roleName,
        modules,
      };
    });

    return {
      customerId: custId,
      roles: result,
      availableModules: STANDARD_WORK_MODULES,
    };
  }

  async updateRoleWorkPermissions(
    customerId: number,
    roleName: string,
    permissions: Record<string, boolean>,
  ) {
    const custId = Number(customerId);
    const normalizedRole = roleName.trim();

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
      message: `Permissions updated for role ${normalizedRole}`,
      roleName: normalizedRole,
      permissions,
    };
  }

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
        },
      });
    }

    if (!employee) {
      // Fallback if user is customer admin
      return {
        employeeId: null,
        employeeCode: null,
        role: 'Admin',
        workPermissions: STANDARD_WORK_MODULES.map((m) => m.key),
      };
    }

    // Determine primary role name from designation or user roles
    const roleCandidate =
      employee.designation?.name ||
      (employee.user?.userRoles && employee.user.userRoles.length > 0
        ? employee.user.userRoles[0].role.name
        : employee.user?.role) ||
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

    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      role: normalizedRole,
      workPermissions: Array.from(activePermissions),
    };
  }

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

    const updated = await this.prisma.workAccessRequest.update({
      where: { id: reqId },
      data: {
        status: WorkAccessRequestStatus.APPROVED,
        approvedById: adminUserId ? Number(adminUserId) : null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      },
    });

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
        `Forbidden: You do not have permission to access the '${workModule}' work module. Submit an Access Request to Admin to get access.`,
      );
    }
    return true;
  }
}
