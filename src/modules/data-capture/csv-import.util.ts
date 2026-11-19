import { BadRequestException } from '@nestjs/common';

export const CSV_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_IMPORT_MAX_ROWS = 100;

export interface ParsedCsvRow {
  rowNumber: number;
  values: string[];
  error?: string;
}

export function parseCsvBuffer(buffer: Buffer): { headers: string[]; rows: ParsedCsvRow[] } {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new BadRequestException('The CSV file is empty.');
  if (buffer.length > CSV_IMPORT_MAX_BYTES) throw new BadRequestException('CSV files must be 5 MB or smaller.');
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (text.includes('\u0000')) throw new BadRequestException('The file is not valid UTF-8 CSV text.');

  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let malformed = false;
  let endedWithNewline = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      endedWithNewline = false;
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
      continue;
    }
    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n' && !/\s/.test(char)) malformed = true;
    if (char === '"' && field.length === 0 && !afterQuote) { quoted = true; endedWithNewline = false; }
    else if (char === ',' ) { record.push(field.trim()); field = ''; afterQuote = false; endedWithNewline = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field.trim());
      records.push(record);
      record = []; field = ''; afterQuote = false;
      endedWithNewline = true;
    } else if (char === '"' || afterQuote) {
      endedWithNewline = false;
      if (char === '"') malformed = true;
      else field += char;
    } else { field += char; endedWithNewline = false; }
  }
  if (quoted) malformed = true;
  if (!endedWithNewline || record.length > 0 || field.length > 0) {
    record.push(field.trim());
    records.push(record);
  }
  if (malformed) throw new BadRequestException('The CSV contains malformed quoting. Correct it and upload again.');
  const headers = (records.shift() || []).map((header) => header.trim());
  if (headers.length < 1 || headers.every((header) => !header)) throw new BadRequestException('The CSV must include a header row.');
  if (headers.some((header) => !header)) throw new BadRequestException('Every CSV column must have a header.');
  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) throw new BadRequestException('CSV column headers must be unique.');
  const rows = records.map((values, index) => ({
    rowNumber: index + 2,
    values,
    ...(values.length !== headers.length ? { error: `Expected ${headers.length} columns but found ${values.length}.` } : {}),
  }));
  if (rows.length > CSV_IMPORT_MAX_ROWS) throw new BadRequestException(`Import up to ${CSV_IMPORT_MAX_ROWS} CSV rows at a time.`);
  return { headers, rows };
}

export const CSV_LEAD_FIELDS = ['businessName', 'title', 'phone', 'email', 'website', 'address', 'city', 'state', 'country', 'category', 'source'] as const;
export type CsvLeadField = typeof CSV_LEAD_FIELDS[number];

export function mapCsvRow(headers: string[], values: string[], mapping: Record<string, string>) {
  const result: Partial<Record<CsvLeadField, string>> = {};
  for (const field of CSV_LEAD_FIELDS) {
    const header = mapping[field];
    if (!header) continue;
    const index = headers.indexOf(header);
    if (index >= 0) result[field] = String(values[index] ?? '').trim();
  }
  return result;
}

export function validateCsvLeadRow(fields: Partial<Record<CsvLeadField, string>>) {
  const issues: string[] = [];
  const name = fields.businessName?.trim();
  if (!name && !fields.title?.trim()) issues.push('Lead name or company name is required.');
  if (name && name.length > 500) issues.push('Company name must be 500 characters or fewer.');
  if (fields.title && fields.title.length > 500) issues.push('Lead name must be 500 characters or fewer.');
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) issues.push('Email address is invalid.');
  if (fields.phone) {
    const digits = fields.phone.replace(/\D/g, '');
    if (!/^\+?[\d\s().-]{8,25}$/.test(fields.phone) || digits.length < 8 || digits.length > 15) issues.push('Mobile number must contain 8–15 digits.');
  }
  if (fields.website) {
    try {
      const value = /^https?:\/\//i.test(fields.website) ? fields.website : `https://${fields.website}`;
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) issues.push('Website must be an HTTP or HTTPS URL.');
      else fields.website = url.toString();
    } catch { issues.push('Website URL is invalid.'); }
  }
  for (const key of ['address', 'city', 'state', 'country', 'category', 'source'] as const) {
    if ((fields[key] || '').length > 500) issues.push(`${key} must be 500 characters or fewer.`);
  }
  return issues;
}
