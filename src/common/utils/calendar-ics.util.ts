/**
 * Standard iCalendar (RFC 5545) .ics event generator.
 * Produces compliant, cross-client calendar invitations compatible with
 * Google Calendar, Apple Calendar, Outlook, and other CalDAV clients.
 */

export interface CalendarInviteOptions {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  timezone?: string;
  organizerName?: string;
  organizerEmail: string;
  attendeeName?: string;
  attendeeEmail: string;
  status?: string; // e.g. "CONFIRMED"
  url?: string;
}

/**
 * Formats a Date object to UTC iCalendar format: YYYYMMDDTHHMMSSZ
 */
export function formatICSUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Formats a Date object to local time in a specified IANA timezone: YYYYMMDDTHHMMSS
 */
export function formatICSLocal(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const hour = getPart('hour');
    const minute = getPart('minute');
    const second = getPart('second');
    return `${year}${month}${day}T${hour}${minute}${second}`;
  } catch {
    return formatICSUtc(date).replace('Z', '');
  }
}

/**
 * Escapes characters according to RFC 5545 section 3.3.11.
 * \ -> \\, ; -> \;, , -> \,, and newlines -> \n
 */
export function escapeICSText(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds lines longer than 75 octets per RFC 5545 section 3.1.
 * A line is folded by inserting CRLF followed by a single space.
 */
export function foldICSLine(line: string): string {
  const maxLen = 75;
  if (line.length <= maxLen) return line;

  let result = '';
  let current = line;

  while (current.length > maxLen) {
    result += current.substring(0, maxLen) + '\r\n ';
    current = current.substring(maxLen);
  }
  result += current;
  return result;
}

/**
 * Generates standard RFC 5545 iCalendar content string.
 */
export function generateICalendarInvite(options: CalendarInviteOptions): string {
  const dtstamp = formatICSUtc(new Date());
  const tz = options.timezone?.trim();

  let dtStartProp: string;
  let dtEndProp: string;

  if (tz) {
    const localStart = formatICSLocal(options.startDate, tz);
    const localEnd = formatICSLocal(options.endDate, tz);
    dtStartProp = `DTSTART;TZID=${tz}:${localStart}`;
    dtEndProp = `DTEND;TZID=${tz}:${localEnd}`;
  } else {
    dtStartProp = `DTSTART:${formatICSUtc(options.startDate)}`;
    dtEndProp = `DTEND:${formatICSUtc(options.endDate)}`;
  }

  const cleanOrgEmail = (options.organizerEmail || 'support@quikboom.com').trim();
  const orgCn = options.organizerName ? `CN="${options.organizerName.replace(/"/g, '')}":` : '';
  const organizerProp = `ORGANIZER;${orgCn}mailto:${cleanOrgEmail}`;

  const cleanAttEmail = (options.attendeeEmail || '').trim();
  const attCn = options.attendeeName ? `CN="${options.attendeeName.replace(/"/g, '')}":` : '';
  const attendeeProp = `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;${attCn}mailto:${cleanAttEmail}`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QuikBoom CRM//Calendar Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${options.uid}`,
    `DTSTAMP:${dtstamp}`,
    dtStartProp,
    dtEndProp,
    `SUMMARY:${escapeICSText(options.title)}`,
    options.description ? `DESCRIPTION:${escapeICSText(options.description)}` : '',
    options.location ? `LOCATION:${escapeICSText(options.location)}` : '',
    options.url ? `URL:${options.url.trim()}` : '',
    `STATUS:${options.status || 'CONFIRMED'}`,
    organizerProp,
    attendeeProp,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  const folded = lines.map(foldICSLine).join('\r\n') + '\r\n';
  return folded;
}
