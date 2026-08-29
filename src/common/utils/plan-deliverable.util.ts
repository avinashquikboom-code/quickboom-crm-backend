import { WorkType } from '@prisma/client';

export interface DeliverableQuota {
  serviceName: string;
  totalQty: number;
  workType: WorkType;
}

/**
 * Map a human-readable service / deliverable name to standard WorkType enum.
 */
export function mapNameToWorkType(name: string): WorkType {
  const lower = name.toLowerCase().trim();
  if (lower.includes('product reel') || lower.includes('influencer reel') || lower.includes('reel')) {
    return WorkType.REEL;
  }
  if (lower.includes('post') || lower.includes('creative') || lower.includes('graphic') || lower.includes('banner')) {
    return WorkType.CREATIVE_POST;
  }
  if (lower.includes('story') || lower.includes('stories')) {
    return WorkType.STORY;
  }
  if (lower.includes('influencer') || lower.includes('promo')) {
    return WorkType.INFLUENCER_PROMOTION;
  }
  if (lower.includes('video') || lower.includes('shoot') || lower.includes('edit')) {
    return WorkType.VIDEO;
  }
  if (lower.includes('ads') || lower.includes('campaign') || lower.includes('meta') || lower.includes('google')) {
    return WorkType.META_ADS;
  }
  if (lower.includes('content') || lower.includes('blog') || lower.includes('article') || lower.includes('writing')) {
    return WorkType.CONTENT_WRITING;
  }
  if (lower.includes('report') || lower.includes('analytics')) {
    return WorkType.PERFORMANCE_REPORT;
  }
  return WorkType.REEL;
}

/**
 * Clean deliverable name by stripping extraneous notes, prices, or total calculations.
 */
export function sanitizeServiceName(rawName: string): string {
  let name = rawName.trim();
  // Strip parenthetical content like "(Total 10 Reels)", "(₹500/mo)", etc.
  name = name.replace(/\s*\([^)]*\)/g, '').trim();
  // Standardize capitalization
  if (name.length > 0) {
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }
  return name;
}

/**
 * Extract exact deliverable quotas from plan features.
 * Supports:
 * 1. String arrays: e.g. ["4 Reels", "3 Creative Posts", "1 Influencer Promotion", "3 Stories", "Blogs: 0"]
 * 2. Object arrays: e.g. [{ name: "Reels", quantity: 3 }, { name: "Blogs", quantity: 0 }]
 * 3. Key-Value maps: e.g. { reels: 3, creativePosts: 5, stories: 10, influencerPromotion: 1, productReels: 2, blogs: 0 }
 * 
 * Rules:
 * - Read only services with quantity > 0.
 * - If quantity is 0 or unquantified, ignore it.
 * - No hardcoded fallback or fake activity creation.
 */
export function extractDeliverableQuotas(features: any): DeliverableQuota[] {
  const quotas: DeliverableQuota[] = [];
  if (!features) return quotas;

  // 1. Key-Value Map: { reels: 3, creativePosts: 5, blogs: 0, ... }
  if (typeof features === 'object' && !Array.isArray(features)) {
    for (const [rawKey, val] of Object.entries(features)) {
      let qty = 0;
      if (typeof val === 'number') {
        qty = val;
      } else if (typeof val === 'object' && val !== null) {
        qty = Number((val as any).quantity ?? (val as any).totalQty ?? (val as any).qty ?? 0);
      } else if (typeof val === 'string') {
        qty = parseInt(val, 10);
      }

      if (!isNaN(qty) && qty > 0) {
        // Format camelCase key into words: creativePosts -> Creative Posts
        let readableKey = rawKey.replace(/([A-Z])/g, ' $1').trim();
        readableKey = readableKey.charAt(0).toUpperCase() + readableKey.slice(1);
        const serviceName = sanitizeServiceName(readableKey);
        quotas.push({
          serviceName,
          totalQty: qty,
          workType: mapNameToWorkType(serviceName),
        });
      }
    }
    return quotas;
  }

  // 2. Array format
  if (Array.isArray(features)) {
    for (const item of features) {
      if (!item) continue;

      // 2a. Array of objects: e.g. { name: "Reels", quantity: 3 }
      if (typeof item === 'object') {
        const rawName = (item.name || item.serviceName || item.title || item.code || '').toString().trim();
        const qty = Number(item.quantity ?? item.totalQty ?? item.qty ?? item.count ?? 0);
        if (rawName && !isNaN(qty) && qty > 0) {
          const serviceName = sanitizeServiceName(rawName);
          quotas.push({
            serviceName,
            totalQty: qty,
            workType: mapNameToWorkType(serviceName),
          });
        }
        continue;
      }

      // 2b. Array of strings: e.g. "4 Reels", "3x Creative Posts", "1 Influencer Promotion", "Stories: 5", "Blogs = 0"
      if (typeof item === 'string') {
        const text = item.trim();

        // Pattern 1: "4 Reels" or "3x Creative Posts" or "10 Stories (Monthly)"
        const matchLeadingQty = text.match(/^(\d+)\s*x?\s+(.+)$/i);
        if (matchLeadingQty) {
          const qty = parseInt(matchLeadingQty[1], 10);
          const rawName = matchLeadingQty[2].trim();
          const serviceName = sanitizeServiceName(rawName);
          if (qty > 0 && serviceName) {
            quotas.push({
              serviceName,
              totalQty: qty,
              workType: mapNameToWorkType(serviceName),
            });
          }
          continue;
        }

        // Pattern 2: "Reels: 3" or "Stories = 5" or "Blogs = 0"
        const matchTrailingQty = text.match(/^([^:=]+)[:=]\s*(\d+)$/i);
        if (matchTrailingQty) {
          const rawName = matchTrailingQty[1].trim();
          const qty = parseInt(matchTrailingQty[2], 10);
          const serviceName = sanitizeServiceName(rawName);
          if (qty > 0 && serviceName) {
            quotas.push({
              serviceName,
              totalQty: qty,
              workType: mapNameToWorkType(serviceName),
            });
          }
          continue;
        }
      }
    }
  }

  return quotas;
}

export interface ReelActivityDefinition {
  reelNumber: number;
  activityType: 'SHOOT' | 'EDITING' | 'POST';
  workType: WorkType;
  title: string;
  description: string;
  scheduledDate: Date;
  scheduledTime: string;
  stepOrder: number;
}

/**
 * Extract total Reel count dynamically from plan features or custom features.
 * Supports:
 * - Numeric values / direct reel count
 * - String arrays: "4 Reels", "1 Reel", "8 Influencer Reels", "2 Product Reels"
 * - Object arrays: [{ name: "Reels", quantity: 4 }]
 * - Object maps: { reels: 4 }, { OPT_REELS: 4 }
 */
export function extractReelCount(features: any): number {
  if (!features) return 0;

  if (typeof features === 'number') {
    return Math.max(0, Math.floor(features));
  }

  // Key-value object map
  if (typeof features === 'object' && !Array.isArray(features)) {
    let total = 0;
    for (const [key, val] of Object.entries(features)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('reel')) {
        let count = 0;
        if (typeof val === 'number') count = val;
        else if (typeof val === 'string') count = parseInt(val, 10);
        else if (typeof val === 'object' && val !== null) {
          count = Number((val as any).quantity ?? (val as any).totalQty ?? (val as any).qty ?? (val as any).count ?? 0);
        }
        if (!isNaN(count) && count > 0) {
          total += count;
        }
      }
    }
    if (total > 0) return total;
  }

  // Array format
  if (Array.isArray(features)) {
    let total = 0;
    for (const item of features) {
      if (!item) continue;

      if (typeof item === 'object') {
        const name = (item.name || item.serviceName || item.title || item.code || '').toString().toLowerCase();
        if (name.includes('reel')) {
          const qty = Number(item.quantity ?? item.totalQty ?? item.qty ?? item.count ?? 0);
          if (!isNaN(qty) && qty > 0) {
            total += qty;
          }
        }
        continue;
      }

      if (typeof item === 'string') {
        const text = item.trim();
        const lower = text.toLowerCase();
        if (lower.includes('reel')) {
          // Check parenthetical total first: "(Total 10 Reels)"
          const parenMatch = text.match(/\(Total\s+(\d+)\s+Reels?\)/i);
          if (parenMatch) {
            return parseInt(parenMatch[1], 10);
          }

          // "4 Reels", "1 Reel", "2 Product Reels", "8 Influencer Reels"
          const leadingMatch = text.match(/^(\d+)\s*x?\s+(.*reel.*)$/i);
          if (leadingMatch) {
            const qty = parseInt(leadingMatch[1], 10);
            if (!isNaN(qty) && qty > 0) {
              total += qty;
            }
            continue;
          }

          // "Reels: 4" or "Reels = 4"
          const trailingMatch = text.match(/^([^:=]*reel[^:=]*)[:=]\s*(\d+)$/i);
          if (trailingMatch) {
            const qty = parseInt(trailingMatch[2], 10);
            if (!isNaN(qty) && qty > 0) {
              total += qty;
            }
            continue;
          }
        }
      }
    }
    if (total > 0) return total;
  }

  return 0;
}

export interface PlanActivityDefinition {
  serviceName: string;
  itemNumber: number;
  activityType: string;
  workType: WorkType;
  title: string;
  description: string;
  scheduledDate: Date;
  scheduledTime: string;
  stepOrder: number;
}

/**
 * Generate weekly Reel workflow activities dynamically according to the core business rule:
 * ONE REEL = ONE WEEK.
 * Each Reel produces:
 * 1. SHOOT: startDate + (reelIndex * 7 days)
 * 2. EDITING: shootDate + 2 days
 * 3. POST: shootDate + 4 days (editingDate + 2 days)
 *
 * All dates are calculated safely from startDate and bounded within endDate.
 */
export function generateReelWorkflowActivities(
  startDate: Date,
  endDate: Date,
  reelCount: number,
): ReelActivityDefinition[] {
  if (reelCount <= 0) return [];

  const activities: ReelActivityDefinition[] = [];
  const start = new Date(startDate);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth();
  const startDay = start.getUTCDate();
  const endLimit = new Date(endDate);

  for (let reelIndex = 0; reelIndex < reelCount; reelIndex++) {
    const reelNumber = reelIndex + 1;

    // Reel Shoot: startDate + (reelIndex * 7 days)
    const shootDate = new Date(Date.UTC(startYear, startMonth, startDay + (reelIndex * 7), 10, 0, 0, 0));
    // Reel Editing: shootDate + 2 days
    const editingDate = new Date(Date.UTC(startYear, startMonth, startDay + (reelIndex * 7) + 2, 10, 0, 0, 0));
    // Reel Post: shootDate + 4 days
    const postDate = new Date(Date.UTC(startYear, startMonth, startDay + (reelIndex * 7) + 4, 10, 0, 0, 0));

    // 1. Shoot Activity
    if (shootDate <= endLimit) {
      activities.push({
        reelNumber,
        activityType: 'SHOOT',
        workType: WorkType.SHOOT,
        title: `Reel #${reelNumber}: Shoot`,
        description: `Reel #${reelNumber} Video & Asset Shoot on location`,
        scheduledDate: shootDate,
        scheduledTime: '10:00 AM',
        stepOrder: 1,
      });
    }

    // 2. Editing Activity
    if (editingDate <= endLimit) {
      activities.push({
        reelNumber,
        activityType: 'EDITING',
        workType: WorkType.EDITING,
        title: `Reel #${reelNumber}: Editing`,
        description: `Reel #${reelNumber} Video Editing, Color Grading & Audio Sync`,
        scheduledDate: editingDate,
        scheduledTime: '10:00 AM',
        stepOrder: 2,
      });
    }

    // 3. Post Activity
    if (postDate <= endLimit) {
      activities.push({
        reelNumber,
        activityType: 'POST',
        workType: WorkType.POST_DESIGN,
        title: `Reel #${reelNumber}: Post`,
        description: `Reel #${reelNumber} Final Review & Publishing`,
        scheduledDate: postDate,
        scheduledTime: '10:00 AM',
        stepOrder: 3,
      });
    }
  }

  return activities;
}

/**
 * Generate comprehensive, evenly distributed calendar activities for ALL deliverable services
 * in a customer's purchased plan (Reels, Creative Posts, Stories, Influencer Promotions, etc.).
 */
export function generateAllPlanWorkflowActivities(
  startDate: Date,
  endDate: Date,
  quotas: DeliverableQuota[],
): PlanActivityDefinition[] {
  const activities: PlanActivityDefinition[] = [];
  if (!quotas || quotas.length === 0) return activities;

  const start = new Date(startDate);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth();
  const startDay = start.getUTCDate();
  const endLimit = new Date(endDate);

  const durationDays = Math.max(
    1,
    Math.round((endLimit.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );

  for (const quota of quotas) {
    const sName = quota.serviceName;
    const qty = quota.totalQty;
    if (qty <= 0) continue;

    const lower = sName.toLowerCase();

    if (lower.includes('reel')) {
      // 1. REEL WORKFLOW: Reel Shoot -> (2 Days Gap) -> Reel Edit -> (2 Days Gap) -> Reel Post
      for (let r = 0; r < qty; r++) {
        const reelNumber = r + 1;
        const intervalDays = Math.max(1, Math.floor(durationDays / qty));
        const baseDayOffset = Math.min(Math.max(0, durationDays - 5), r * intervalDays);

        const shootDate = new Date(Date.UTC(startYear, startMonth, startDay + baseDayOffset, 10, 0, 0, 0));
        const editingDate = new Date(Date.UTC(startYear, startMonth, startDay + baseDayOffset + 2, 10, 0, 0, 0));
        const postDate = new Date(Date.UTC(startYear, startMonth, startDay + baseDayOffset + 4, 10, 0, 0, 0));

        if (shootDate <= endLimit) {
          activities.push({
            serviceName: sName,
            itemNumber: reelNumber,
            activityType: 'REEL_SHOOT',
            workType: WorkType.SHOOT,
            title: `Reel #${reelNumber}: Shoot`,
            description: `Reel #${reelNumber} Video & Asset Shoot on location`,
            scheduledDate: shootDate,
            scheduledTime: '10:00 AM',
            stepOrder: 1,
          });
        }
        if (editingDate <= endLimit) {
          activities.push({
            serviceName: sName,
            itemNumber: reelNumber,
            activityType: 'REEL_EDIT',
            workType: WorkType.EDITING,
            title: `Reel #${reelNumber}: Edit`,
            description: `Reel #${reelNumber} Video Editing, Color Grading & Audio Sync`,
            scheduledDate: editingDate,
            scheduledTime: '10:00 AM',
            stepOrder: 2,
          });
        }
        if (postDate <= endLimit) {
          activities.push({
            serviceName: sName,
            itemNumber: reelNumber,
            activityType: 'REEL_POST',
            workType: WorkType.POST_DESIGN,
            title: `Reel #${reelNumber}: Post`,
            description: `Reel #${reelNumber} Final Review & Publishing`,
            scheduledDate: postDate,
            scheduledTime: '10:00 AM',
            stepOrder: 3,
          });
        }
      }
    } else if (lower.includes('story') || lower.includes('stories')) {
      // 2. STORY WORKFLOW: Story Design -> (1 Day Gap) -> Story Post
      for (let s = 0; s < qty; s++) {
        const storyNumber = s + 1;
        const intervalDays = Math.max(1, Math.floor(durationDays / qty));
        const baseDayOffset = Math.min(Math.max(0, durationDays - 2), s * intervalDays + (1 % intervalDays));

        const designDate = new Date(Date.UTC(startYear, startMonth, startDay + baseDayOffset, 10, 0, 0, 0));
        const postDate = new Date(Date.UTC(startYear, startMonth, startDay + baseDayOffset + 1, 10, 0, 0, 0));

        if (designDate <= endLimit) {
          activities.push({
            serviceName: sName,
            itemNumber: storyNumber,
            activityType: 'STORY_DESIGN',
            workType: WorkType.STORY_DESIGN,
            title: `Story #${storyNumber}: Design`,
            description: `Story #${storyNumber} Graphic & Layout Design`,
            scheduledDate: designDate,
            scheduledTime: '10:00 AM',
            stepOrder: 1,
          });
        }
        if (postDate <= endLimit) {
          activities.push({
            serviceName: sName,
            itemNumber: storyNumber,
            activityType: 'STORY_POST',
            workType: WorkType.UPLOADING,
            title: `Story #${storyNumber}: Post`,
            description: `Story #${storyNumber} Publishing & Engagement`,
            scheduledDate: postDate,
            scheduledTime: '10:00 AM',
            stepOrder: 2,
          });
        }
      }
    } else if (lower.includes('post') || lower.includes('creative')) {
      // 3. CREATIVE POST WORKFLOW: Post Design -> (2 Days Gap) -> Post Publish
      for (let p = 0; p < qty; p++) {
        const postNumber = p + 1;
        const intervalDays = Math.max(1, Math.floor(durationDays / qty));
        const baseDayOffset = Math.min(Math.max(0, durationDays - 3), p * intervalDays + (2 % intervalDays));

        const designDate = new Date(Date.UTC(startYear, startMonth, startDay + baseDayOffset, 10, 0, 0, 0));
        const publishDate = new Date(Date.UTC(startYear, startMonth, startDay + baseDayOffset + 2, 10, 0, 0, 0));

        if (designDate <= endLimit) {
          activities.push({
            serviceName: sName,
            itemNumber: postNumber,
            activityType: 'POST_DESIGN',
            workType: WorkType.POST_DESIGN,
            title: `Creative Post #${postNumber}: Design`,
            description: `Creative Post #${postNumber} Visual Design & Copywriting`,
            scheduledDate: designDate,
            scheduledTime: '10:00 AM',
            stepOrder: 1,
          });
        }
        if (publishDate <= endLimit) {
          activities.push({
            serviceName: sName,
            itemNumber: postNumber,
            activityType: 'POST_PUBLISH',
            workType: WorkType.UPLOADING,
            title: `Creative Post #${postNumber}: Publish`,
            description: `Creative Post #${postNumber} Final Review & Publishing`,
            scheduledDate: publishDate,
            scheduledTime: '10:00 AM',
            stepOrder: 2,
          });
        }
      }
    } else {
      // 4. OTHER DELIVERABLES (Influencer Promotions, Ads, Reports, Custom)
      const intervalDays = Math.max(1, Math.floor(durationDays / qty));
      let staggerOffset = 3;
      if (lower.includes('influencer')) staggerOffset = 5;
      else if (lower.includes('ads')) staggerOffset = 1;
      else if (lower.includes('report')) staggerOffset = Math.max(1, durationDays - 3);

      for (let i = 0; i < qty; i++) {
        const itemNumber = i + 1;
        const dayOffset = Math.min(
          durationDays - 1,
          Math.max(0, i * intervalDays + (staggerOffset % intervalDays)),
        );
        const schedDate = new Date(Date.UTC(startYear, startMonth, startDay + dayOffset, 10, 0, 0, 0));

        if (schedDate <= endLimit) {
          activities.push({
            serviceName: sName,
            itemNumber,
            activityType: 'DELIVERABLE',
            workType: quota.workType,
            title: `${sName} #${itemNumber}`,
            description: `${sName} #${itemNumber} content execution & deliverable`,
            scheduledDate: schedDate,
            scheduledTime: '10:00 AM',
            stepOrder: 1,
          });
        }
      }
    }
  }

  return activities;
}
