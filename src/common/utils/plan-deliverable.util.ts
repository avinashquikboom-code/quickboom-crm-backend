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

/**
 * Distribute N activity dates evenly across working days (skipping Sundays) within [startDate, endDate].
 * Guarantees all returned dates are within the subscription validity window.
 */
export function distributeDatesAcrossWorkingDays(
  startDate: Date,
  endDate: Date,
  activityCount: number,
): Date[] {
  if (activityCount <= 0) return [];

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Collect all working days (Mon-Sat, skipping Sunday = 0)
  const workingDays: Date[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    if (cursor.getDay() !== 0) {
      // Mon-Sat: Valid working day
      workingDays.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Fallback if validity window has zero non-Sundays
  if (workingDays.length === 0) {
    workingDays.push(new Date(start));
  }

  const distributedDates: Date[] = [];

  if (activityCount === 1) {
    // Single activity scheduled around 3rd working day or midpoint
    const midIdx = Math.min(2, Math.floor(workingDays.length / 2));
    distributedDates.push(workingDays[midIdx]);
    return distributedDates;
  }

  // Evenly step through available working days
  const step = (workingDays.length - 1) / (activityCount - 1);

  for (let i = 0; i < activityCount; i++) {
    const dayIndex = Math.min(
      Math.round(i * step),
      workingDays.length - 1,
    );
    distributedDates.push(new Date(workingDays[dayIndex]));
  }

  return distributedDates;
}
