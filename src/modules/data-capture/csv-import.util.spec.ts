import { BadRequestException } from '@nestjs/common';
import { parseCsvBuffer, mapCsvRow, validateCsvLeadRow } from './csv-import.util';

describe('CSV lead import parsing and validation', () => {
  it('parses quoted commas, escaped quotes, CRLF and UTF-8 BOM', () => {
    const csv = '\uFEFFName,Company,Email\r\n"Riya, Mehta","Mehta ""Foods""",riya@example.com\r\n';
    const parsed = parseCsvBuffer(Buffer.from(csv));
    expect(parsed.headers).toEqual(['Name', 'Company', 'Email']);
    expect(parsed.rows).toEqual([{ rowNumber: 2, values: ['Riya, Mehta', 'Mehta "Foods"', 'riya@example.com'] }]);
  });

  it('preserves blank and malformed-width records so they can be reported', () => {
    const parsed = parseCsvBuffer(Buffer.from('Name,Phone\n,\nOnly one value\n'));
    expect(parsed.rows).toEqual([
      { rowNumber: 2, values: ['', ''] },
      { rowNumber: 3, values: ['Only one value'], error: 'Expected 2 columns but found 1.' },
    ]);
  });

  it('rejects malformed quotes, duplicate headers and more than 100 rows', () => {
    expect(() => parseCsvBuffer(Buffer.from('Name\n"unfinished'))).toThrow(BadRequestException);
    expect(() => parseCsvBuffer(Buffer.from('Name,name\nA,B'))).toThrow(BadRequestException);
    const rows = ['Name', ...Array.from({ length: 101 }, (_, index) => `Lead ${index}`)].join('\n');
    expect(() => parseCsvBuffer(Buffer.from(rows))).toThrow(BadRequestException);
  });

  it('maps selected fields and validates required name, email, phone and URL formats', () => {
    const fields = mapCsvRow(['Name', 'Email', 'Phone', 'Site'], ['Riya', 'bad-email', '123', 'javascript:alert(1)'], {
      title: 'Name', email: 'Email', phone: 'Phone', website: 'Site',
    });
    expect(validateCsvLeadRow(fields)).toEqual([
      'Email address is invalid.',
      'Mobile number must contain 8–15 digits.',
      'Website URL is invalid.',
    ]);
    expect(validateCsvLeadRow({ title: 'Lead without company' })).toEqual([]);
    expect(validateCsvLeadRow({})).toContain('Lead name or company name is required.');
  });
});
