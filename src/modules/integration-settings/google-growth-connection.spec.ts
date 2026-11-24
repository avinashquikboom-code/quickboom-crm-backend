import axios from 'axios';
import { testGoogleGrowthConnection } from './google-growth-connection';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

describe('Google Growth connection test', () => {
  const originalEnv = process.env;
  const credentials = { clientId: 'client', clientSecret: 'secret', developerToken: 'developer' };
  beforeEach(() => { process.env = { ...originalEnv, GOOGLE_BUSINESS_GROWTH_REFRESH_TOKEN: 'refresh' }; jest.resetAllMocks(); });
  afterAll(() => { process.env = originalEnv; });
  it('reports missing authorization without contacting Google', async () => {
    delete process.env.GOOGLE_BUSINESS_GROWTH_REFRESH_TOKEN;
    expect(await testGoogleGrowthConnection(credentials, {})).toMatchObject({ success: false, status: 'NOT_CONFIGURED' });
    expect(http.post).not.toHaveBeenCalled();
  });
  it('verifies both APIs using the refreshed access token', async () => {
    http.post.mockResolvedValue({ status: 200, data: { access_token: 'access' } });
    http.get.mockResolvedValue({ status: 200, data: {} });
    const result = await testGoogleGrowthConnection(credentials, {});
    expect(result).toMatchObject({ success: true, details: { ads: true, businessProfile: true } });
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('refresh');
    expect(JSON.stringify(result)).not.toContain('developer');
    expect(JSON.stringify(result)).not.toContain('Bearer');
  });
  it('uses a refresh token supplied through Integration Settings', async () => {
    delete process.env.GOOGLE_BUSINESS_GROWTH_REFRESH_TOKEN;
    http.post.mockResolvedValue({ status: 200, data: { access_token: 'access' } });
    http.get.mockResolvedValue({ status: 200, data: {} });
    const result = await testGoogleGrowthConnection({ ...credentials, refreshToken: 'settings-refresh' }, {});
    expect(result.success).toBe(true);
    expect(new URLSearchParams(http.post.mock.calls[0][1] as string).get('refresh_token')).toBe('settings-refresh');
    expect(JSON.stringify(result)).not.toContain('settings-refresh');
  });
  it('tests Cloud-managed Ads access without a developer token', async () => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    http.post.mockResolvedValue({ status: 200, data: { access_token: 'access' } });
    http.get.mockResolvedValue({ status: 200, data: {} });
    expect((await testGoogleGrowthConnection({ clientId: 'client', clientSecret: 'secret' }, {})).success).toBe(true);
    expect(http.get.mock.calls[0][1]?.headers).not.toHaveProperty('developer-token');
  });
  it('fails when either API rejects access', async () => {
    http.post.mockResolvedValue({ status: 200, data: { access_token: 'access' } });
    http.get.mockResolvedValueOnce({ status: 403 }).mockResolvedValueOnce({ status: 200 });
    expect(await testGoogleGrowthConnection(credentials, {})).toMatchObject({ success: false, details: { ads: false, businessProfile: true } });
  });
  it('rejects invalid versions before making a request', async () => {
    expect(await testGoogleGrowthConnection(credentials, { apiVersion: '../bad' })).toMatchObject({ success: false });
    expect(http.post).not.toHaveBeenCalled();
  });
});
