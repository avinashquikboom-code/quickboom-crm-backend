import { Injectable, ForbiddenException } from '@nestjs/common';
import { WorkType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Validates assignment targets; visibility is enforced by recorded work/team assignments. */
@Injectable()
export class WorkAssignmentService {
  constructor(private readonly prisma: PrismaService) {}
  async getEmployeeActivityTypes(employeeId: number, _legacyScope?: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id: Number(employeeId) }, select: { id: true, status: true } });
    if (!employee || employee.status !== 'ACTIVE') throw new ForbiddenException('Active employee profile required');
    return { designation: 'Employee', allowedTypes: new Set<string>([
      ...Object.values(WorkType), ...Object.values(WORK_MODULE_TO_ACTIVITY_TYPES).flat(),
    ]), isFullAccess: true, isProductionManager: false };
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
