/**
 * Timezone and business date utilities for Asia/Kolkata (Indian Standard Time, UTC+05:30).
 */

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns 'YYYY-MM-DD' representing the business date in Asia/Kolkata.
 */
export function getBusinessDate(date: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

/**
 * Returns UTC start and end Date objects corresponding to 00:00:00.000 and 23:59:59.999
 * for a business day in Asia/Kolkata (+05:30).
 */
export function getBusinessDayRange(
  dateInput?: string | Date,
  timeZone: string = BUSINESS_TIMEZONE,
): { dateStr: string; start: Date; end: Date } {
  let dateStr: string;

  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    dateStr = dateInput.trim();
  } else if (dateInput instanceof Date) {
    dateStr = getBusinessDate(dateInput, timeZone);
  } else if (typeof dateInput === 'string' && dateInput.trim().length > 0) {
    const parsed = new Date(dateInput);
    dateStr = isNaN(parsed.getTime()) ? getBusinessDate(new Date(), timeZone) : getBusinessDate(parsed, timeZone);
  } else {
    dateStr = getBusinessDate(new Date(), timeZone);
  }

  // In Asia/Kolkata (+05:30), 00:00:00 IST is 18:30:00 UTC of previous day
  // and 23:59:59.999 IST is 18:29:59.999 UTC of the same day.
  const start = new Date(`${dateStr}T00:00:00.000+05:30`);
  const end = new Date(`${dateStr}T23:59:59.999+05:30`);

  return { dateStr, start, end };
}

/**
 * Format a Date object as 'hh:mm A' in Asia/Kolkata (e.g. '07:14 PM').
 */
export function formatTimeInTimezone(
  date: Date | string | null | undefined,
  timeZone: string = BUSINESS_TIMEZONE,
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    const hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${h12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
  }
}

/**
 * Format total minutes as 'Xh Ym' (e.g. 0 -> '0h 0m', 1 -> '0h 1m', 30 -> '0h 30m', 60 -> '1h 0m', 90 -> '1h 30m', 125 -> '2h 5m').
 */
export function formatDurationHoursMinutes(minutes: number | string | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes === '') {
    return '0h 0m';
  }

  let totalMins = 0;
  if (typeof minutes === 'string') {
    const trimmed = minutes.trim();
    if (/^\d+h\s+\d+m$/i.test(trimmed)) {
      return trimmed;
    }
    const minMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:min|m)?$/i);
    if (minMatch) {
      totalMins = Math.round(parseFloat(minMatch[1]));
    } else {
      const parsed = parseFloat(trimmed);
      totalMins = isNaN(parsed) ? 0 : Math.round(parsed);
    }
  } else {
    totalMins = Math.max(0, Math.round(Number(minutes)));
  }

  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hours}h ${mins}m`;
}
