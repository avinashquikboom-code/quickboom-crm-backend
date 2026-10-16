import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkAccessRequestStatus, AccessOverrideType } from '@prisma/client';
import { isUserSuperAdmin, isUserAdmin } from '../../common/utils/role.util';

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
    key: 'data_capture',
    name: 'Data Capture',
    description: 'Google Places extraction, lead discovery, prospect capture, and CRM import.',
    icon: 'crosshair',
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
  'Telecaller': ['leads', 'data_capture'],
  'TELECALLER': ['leads', 'data_capture'],
  'Telesales Executive': ['leads', 'data_capture'],
  'TELESALES_EXECUTIVE': ['leads', 'data_capture'],
  'Telesales': ['leads', 'data_capture'],
  'TELESALES': ['leads', 'data_capture'],
  'Teleseller': ['leads', 'data_capture'],
  'TELESELLER': ['leads', 'data_capture'],
  'Sales Executive': ['leads', 'data_capture'],
  'SALES_EXECUTIVE': ['leads', 'data_capture'],
  'Sales Head': ['leads', 'data_capture'],
  'SALES_HEAD': ['leads', 'data_capture'],
  'Sales': ['leads', 'data_capture'],
  'SALES': ['leads', 'data_capture'],
  'BPO': ['leads', 'data_capture'],
  'BPO Executive': ['leads', 'data_capture'],
  'BPO_EXECUTIVE': ['leads', 'data_capture'],
  'Production Manager': ['video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'PRODUCTION_MANAGER': ['video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'Production Lead': ['video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'PRODUCTION_LEAD': ['video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'Admin': ['leads', 'data_capture', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'Super Admin': ['leads', 'data_capture', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'ADMIN': ['leads', 'data_capture', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
  'SUPER_ADMIN': ['leads', 'data_capture', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'],
};

@Injectable()
export class WorkPermissionService {
  private readonly logger = new Logger(WorkPermissionService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    if (lower.includes('telecall') || lower.includes('telesales') || lower.includes('sales') || lower.includes('lead') || lower.includes('bpo')) return ['leads', 'data_capture'];
    if (lower.includes('video edit') || lower.includes('editor')) return ['video_edit'];
    if (lower.includes('graphic') || lower.includes('designer')) return ['post_design', 'story_design'];
    if (lower.includes('photo') || lower.includes('shoot') || lower.includes('videograph')) return ['reel_shoot'];
    if (lower.includes('social') || lower.includes('smm')) return ['reel_post', 'story_post', 'post_publish'];
    if (lower.includes('influencer')) return ['influencer_promo'];
    if (lower.includes('admin')) return ['leads', 'video_edit', 'post_design', 'story_design', 'reel_shoot', 'reel_post', 'story_post', 'influencer_promo'];
    return [];
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
    const isUserAdm = employee.user && (isUserSuperAdmin(employee.user) || isUserAdmin(employee.user));
    const roleCandidate = isUserAdm
      ? 'SUPER_ADMIN'
      : (employee.designation?.name ||
        ((employee as any).user?.userRoles && (employee as any).user.userRoles.length > 0
          ? (employee as any).user.userRoles[0].role.name
          : (employee as any).user?.designation || (employee as any).user?.role) ||
        'Employee');

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

    const isCrmEligible = employee.designation?.crmMobileAccess !== undefined && employee.designation?.crmMobileAccess !== null
      ? Boolean(employee.designation.crmMobileAccess)
      : (
          (employee.designation?.name || '').toUpperCase().includes('TELE') ||
          (employee.designation?.name || '').toUpperCase().includes('BPO')
        );

    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      role: normalizedRole,
      isCrmEligible,
      crmMobileAccess: isCrmEligible,
      workPermissions: Array.from(activePermissions),
      effectivePermissions: effectiveMap,
      commonModules: COMMON_MODULES.map((m) => m.key),
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
    isProductionManager: boolean;
    workPermissions: string[];
  }> {
    const custId = customerId ? Number(customerId) : 1;
    const effective = await this.getEmployeeEffectivePermissions(custId, { employeeId });

    const roleName = (effective.role || '').toUpperCase();
    const isProductionManager =
      roleName.includes('PRODUCTION_MANAGER') ||
      roleName.includes('PRODUCTION MANAGER') ||
      roleName.includes('PROD_MGR') ||
      roleName.includes('PROD MGR') ||
      roleName.includes('PRODUCTION_LEAD') ||
      roleName.includes('PRODUCTION LEAD');

    const isFullAccess =
      isProductionManager ||
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
        isProductionManager,
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
      isProductionManager: false,
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
