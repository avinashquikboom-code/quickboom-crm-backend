/**
 * Existing work categories for a designation. Department alone matches nothing.
 * Keys follow the designation labels already stored on employees.
 */
const DESIGNATION_WORK_RULES: { pattern: RegExp; types: string[] }[] = [
  { pattern: /content writer|copywriter|copy writer/, types: ['CONTENT_WRITING'] },
  { pattern: /reel editor|video editor|\beditor\b|video edit|editing/, types: ['EDITING', 'VIDEO_EDITING', 'VIDEO'] },
  { pattern: /reel shoot|shooter|photographer|videographer|\bphoto\b|camera/, types: ['SHOOT', 'REELS_SHOOT'] },
  { pattern: /graphic|designer|\bdesign\b/, types: ['POST_DESIGN', 'GRAPHIC_DESIGN', 'CREATIVE_POST', 'STORY_DESIGN'] },
  { pattern: /social media/, types: ['UPLOADING', 'SOCIAL_MEDIA_MANAGEMENT'] },
  { pattern: /influencer/, types: ['INFLUENCER_PROMO', 'INFLUENCER_PROMOTION'] },
];

export function workTypesForDesignation(designation?: string | null): string[] {
  const text = String(designation || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const matched = new Set<string>();
  for (const rule of DESIGNATION_WORK_RULES) {
    if (rule.pattern.test(text)) {
      rule.types.forEach((type) => matched.add(type));
    }
  }
  return Array.from(matched);
}

/** Stored WorkType plus the normalized names the calendar already uses. */
export function workMatchesDesignation(designation?: string | null, workType?: string | null): boolean {
  const types = new Set(workTypesForDesignation(designation));
  const raw = String(workType || '').toUpperCase();
  if (!raw || types.size === 0) return false;
  if (types.has(raw)) return true;
  if ((types.has('SHOOT') || types.has('REELS_SHOOT')) && raw === 'REEL_SHOOT') return true;
  if (
    (types.has('EDITING') || types.has('VIDEO_EDITING') || types.has('VIDEO')) &&
    raw === 'REEL_EDIT'
  ) {
    return true;
  }
  if (
    (types.has('UPLOADING') || types.has('SOCIAL_MEDIA_MANAGEMENT')) &&
    (raw === 'REEL_POST' || raw === 'STORY_POST')
  ) {
    return true;
  }
  if (
    (types.has('POST_DESIGN') || types.has('GRAPHIC_DESIGN') || types.has('STORY_DESIGN') || types.has('CREATIVE_POST')) &&
    raw === 'STORY'
  ) {
    return true;
  }
  return false;
}

/** Accepts month=10&year=2026 and month=YYYY-MM. */
export function parseCalendarMonthYear(
  month?: string,
  year?: string,
): { month?: number; year?: number } {
  const rawMonth = month?.trim();
  if (rawMonth && /^\d{4}-\d{1,2}$/.test(rawMonth)) {
    const [yearPart, monthPart] = rawMonth.split('-').map((part) => parseInt(part, 10));
    if (yearPart >= 1970 && monthPart >= 1 && monthPart <= 12) {
      return { year: yearPart, month: monthPart };
    }
  }
  const parsedMonth = rawMonth ? parseInt(rawMonth, 10) : NaN;
  const parsedYear = year?.trim() ? parseInt(year.trim(), 10) : NaN;
  return {
    month: parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : undefined,
    year: parsedYear >= 1970 ? parsedYear : undefined,
  };
}
