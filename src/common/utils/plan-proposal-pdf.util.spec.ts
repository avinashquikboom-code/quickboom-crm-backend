import * as zlib from 'zlib';
import { generatePlanProposalPdfBuffer } from './plan-proposal-pdf.util';

function extractPdfStreams(buf: Buffer): string {
  const latin = buf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    let chunk = m[1];
    try {
      chunk = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      // uncompressed stream
    }
    // Decode PDFKit hex-encoded TJ arrays: [<50> 40 <616765...>] TJ -> "Page..."
    const decoded = chunk.replace(/\[([^\]]+)\]\s*TJ/g, (_, inner) => {
      const parts: string[] = [];
      inner.replace(/<([0-9a-fA-F]+)>/g, (__, hex) => {
        parts.push(Buffer.from(hex, 'hex').toString('latin1'));
        return '';
      });
      return parts.join('');
    });
    out.push(decoded);
  }
  return out.join('\n');
}

describe('generatePlanProposalPdfBuffer pagination', () => {
  it('generates a single page with no trailing blank page for standard proposals', async () => {
    const buf = await generatePlanProposalPdfBuffer({
      proposalNo: 'PLAN-101-1',
      leadId: 101,
      leadName: 'Aarvee Creation',
      businessName: 'Aarvee Creation – Kurti Wholesaler',
      companyName: 'QuikBoom',
      planName: 'Business Growth Plan',
      planCode: 'BGP-001',
      billingCycle: 'MONTHLY',
      planPrice: 9000,
      proposalType: 'DEFAULT',
      features: [
        '5 Reels',
        '1 Influencer Promotion',
        'Social Media Account Management',
        'Content Writing & Captions',
        'Trending Hashtags',
      ],
      terms: 'Pricing is exclusive of applicable taxes.',
    });

    const raw = buf.toString('latin1');
    const pageCountMatches = raw.match(/\/Type\s*\/Page\b(?!s)/g) || [];
    expect(pageCountMatches.length).toBe(1);
    const text = extractPdfStreams(buf);
    expect(text).toContain('Page 1 of 1');
  });

  it('paginates multi-page feature lists cleanly without extra trailing blank pages', async () => {
    const features = Array.from({ length: 35 }, (_, i) => `Deliverable item #${i + 1} with detailed execution scope`);
    const buf = await generatePlanProposalPdfBuffer({
      proposalNo: 'PLAN-102-1',
      leadId: 102,
      leadName: 'Large Enterprise Client',
      businessName: 'Large Enterprise Pvt Ltd',
      companyName: 'QuikBoom',
      planName: 'Enterprise Custom',
      planCode: 'ENT-001',
      billingCycle: 'YEARLY',
      planPrice: 120000,
      proposalType: 'CUSTOM',
      features,
      terms: 'Standard enterprise terms apply.',
    });

    const raw = buf.toString('latin1');
    const pageCountMatches = raw.match(/\/Type\s*\/Page\b(?!s)/g) || [];
    expect(pageCountMatches.length).toBe(2);
    const text = extractPdfStreams(buf);
    expect(text).toContain('Page 1 of 2');
    expect(text).toContain('Page 2 of 2');
    expect(text).not.toContain('Page 3 of');
  });
});
