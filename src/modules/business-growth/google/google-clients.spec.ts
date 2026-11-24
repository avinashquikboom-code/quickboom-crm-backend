import { GoogleAdsClient } from './google-ads.client';
import { GoogleReviewsClient, GooglePerformanceClient } from './google-business.client';
import { GoogleCredentialsCrypto } from './google-credentials.crypto';

describe('Google provider clients', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, GOOGLE_ADS_DEVELOPER_TOKEN: 'test', GOOGLE_INTEGRATION_ENCRYPTION_KEY: 'ab'.repeat(32) }; });
  afterAll(() => { process.env = originalEnv; });

  it('encrypts credentials with distinct nonces and detects tampering', () => {
    const crypto = new GoogleCredentialsCrypto();
    const a = crypto.encrypt('refresh-token');
    expect(a).not.toContain('refresh-token');
    expect(a).not.toEqual(crypto.encrypt('refresh-token'));
    expect(crypto.decrypt(a)).toEqual('refresh-token');
    const parts = a.split('.'); parts[2] = Buffer.alloc(16).toString('base64url');
    expect(() => crypto.decrypt(parts.join('.'))).toThrow();
  });
  it('converts Google Ads micros to account currency units', async () => {
    const request = jest.fn().mockResolvedValue([{ results: [{ campaign: { id: '1' }, campaignBudget: { amountMicros: '2500000' }, metrics: { costMicros: '1250000', averageCpc: '500000', costPerConversion: '625000', clicks: '2' } }] }]);
    const result = await new GoogleAdsClient({ request } as any).campaigns('token', '123-456-7890', '2026-01-01', '2026-01-31');
    expect(result[0]).toMatchObject({ budgetDaily: 2.5, cost: 1.25, cpc: 0.5, costPerConversion: 0.625, clicks: 2 });
  });
  it('reads every review page and retains authoritative summary', async () => {
    const request = jest.fn().mockResolvedValueOnce({ reviews: [{ name: 'one' }], averageRating: 4.8, totalReviewCount: 2, nextPageToken: 'next' }).mockResolvedValueOnce({ reviews: [{ name: 'two' }] });
    const result = await new GoogleReviewsClient({ request } as any).list('token', 'accounts/123', 'locations/456');
    expect(result.reviews).toHaveLength(2); expect(result.averageRating).toBe(4.8); expect(result.totalReviewCount).toBe(2);
    expect(request.mock.calls[1][1].searchParams.get('pageToken')).toBe('next');
  });
  it('uses the location ID and selected performance date range', async () => {
    const request = jest.fn().mockResolvedValue({});
    await new GooglePerformanceClient({ request } as any).daily('token', 'locations/456', '2026-01-02', '2026-01-31');
    const url: URL = request.mock.calls[0][1];
    expect(url.pathname).toContain('/locations/456:fetchMultiDailyMetricsTimeSeries');
    expect(url.searchParams.get('dailyRange.start_date.day')).toBe('2');
    expect(url.searchParams.getAll('dailyMetrics')).toContain('WEBSITE_CLICKS');
  });
});
