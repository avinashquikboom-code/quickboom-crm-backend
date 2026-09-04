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
 * Returns UTC start and end Date objects corresponding to the 1st of the month at 00:00:00.000
 * and the last day of the month at 23:59:59.999 in Asia/Kolkata (+05:30).
 */
export function getBusinessMonthRange(
  dateInput?: string | Date,
  timeZone: string = BUSINESS_TIMEZONE,
): { start: Date; end: Date; yearMonth: string } {
  let dateObj: Date;
  if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else if (typeof dateInput === 'string' && dateInput.trim()) {
    const parsed = new Date(dateInput);
    dateObj = isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    dateObj = new Date();
  }

  const dateStr = getBusinessDate(dateObj, timeZone);
  const [yearStr, monthStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const startStr = `${yearStr}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endStr = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const start = new Date(`${startStr}T00:00:00.000+05:30`);
  const end = new Date(`${endStr}T23:59:59.999+05:30`);

  return { start, end, yearMonth: `${yearStr}-${monthStr}` };
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

/**
 * Parses time string (e.g. '09:00 AM', '06:00 PM', '09:30', '18:30') into minutes from midnight (0-1439).
 */
export function parseTimeToMinutes(timeStr?: string | null): number {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const trimmed = timeStr.trim();
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const mins = parseInt(match12[2], 10);
    const ampm = match12[3].toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return hours * 60 + mins;
  }
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const mins = parseInt(match24[2], 10);
    return hours * 60 + mins;
  }
  return 0;
}

/**
 * Returns current minutes from midnight in the specified timezone (default Asia/Kolkata).
 */
export function getCurrentTimeMinutesInTimezone(
  date: Date = new Date(),
  timeZone: string = BUSINESS_TIMEZONE,
): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let hour = 0;
  let min = 0;
  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10);
    if (part.type === 'minute') min = parseInt(part.value, 10);
  }
  if (hour === 24) hour = 0;
  return hour * 60 + min;
}

/**
 * Evaluates whether an approved Remote Work request is actively in effect right now
 * (based on authoritative server time in Asia/Kolkata and start/end time window).
 */
export function isRemoteWorkActiveNow(
  remoteRequest: {
    status?: string | null;
    fromDate: Date | string;
    toDate: Date | string;
    startTime?: string | null;
    endTime?: string | null;
  } | null | undefined,
  nowDate: Date = new Date(),
  timeZone: string = BUSINESS_TIMEZONE,
): boolean {
  if (!remoteRequest || remoteRequest.status !== 'APPROVED') {
    return false;
  }

  const currentDateStr = getBusinessDate(nowDate, timeZone);
  const fromDateStr = getBusinessDate(
    typeof remoteRequest.fromDate === 'string' ? new Date(remoteRequest.fromDate) : remoteRequest.fromDate,
    timeZone,
  );
  const toDateStr = getBusinessDate(
    typeof remoteRequest.toDate === 'string' ? new Date(remoteRequest.toDate) : remoteRequest.toDate,
    timeZone,
  );

  if (currentDateStr < fromDateStr || currentDateStr > toDateStr) {
    return false;
  }

  const startMins = parseTimeToMinutes(remoteRequest.startTime || '09:00 AM');
  const endMins = parseTimeToMinutes(remoteRequest.endTime || '06:00 PM');
  const currentMins = getCurrentTimeMinutesInTimezone(nowDate, timeZone);

  if (endMins >= startMins) {
    return currentMins >= startMins && currentMins <= endMins;
  } else {
    // Window crosses midnight
    return currentMins >= startMins || currentMins <= endMins;
  }
}

