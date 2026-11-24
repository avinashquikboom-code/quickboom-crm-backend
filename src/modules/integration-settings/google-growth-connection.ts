import axios from 'axios';

/** Read-only credential and API access checks. No Google response bodies or tokens are exposed. */
export async function testGoogleGrowthConnection(credentials: Record<string, any>, config: Record<string, any>) {
  const clientId = String(credentials.clientId || process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(credentials.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = String(credentials.refreshToken || process.env.GOOGLE_BUSINESS_GROWTH_REFRESH_TOKEN || '').trim();
  const developerToken = String(credentials.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();
  const version = String(config.apiVersion || process.env.GOOGLE_ADS_API_VERSION || 'v26').trim();
  const missing = [!clientId && 'Google OAuth client ID', !clientSecret && 'Google OAuth client secret', !refreshToken && 'Google OAuth refresh token in Integration Settings'].filter(Boolean);
  if (missing.length) return { success: false, status: 'NOT_CONFIGURED', message: `To test Google access, configure: ${missing.join(', ')}.` };
  if (!/^v\d+$/.test(version)) return { success: false, status: 'ERROR', message: 'Google Ads API version is invalid; use a value such as v26.' };
  try {
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 12000, validateStatus: () => true });
    if (tokenResponse.status !== 200 || typeof tokenResponse.data?.access_token !== 'string') return { success: false, status: 'ERROR', message: 'Google OAuth authorization failed. Check the client credentials and refresh token, and reauthorize the Google account if needed.' };
    const headers = { Authorization: `Bearer ${tokenResponse.data.access_token}` };
    const [ads, business] = await Promise.allSettled([
      axios.get(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, { headers: { ...headers, ...(developerToken ? { 'developer-token': developerToken } : {}) }, timeout: 12000, validateStatus: () => true }),
      axios.get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers, timeout: 12000, validateStatus: () => true }),
    ]);
    const describe = (result: PromiseSettledResult<any>) => result.status === 'fulfilled' ? result.value.status : 'network error';
    const adsOk = ads.status === 'fulfilled' && ads.value.status === 200;
    const businessOk = business.status === 'fulfilled' && business.value.status === 200;
    if (!adsOk || !businessOk) return { success: false, status: 'ERROR', message: `Google access check failed: Ads ${describe(ads)}, Business Profile ${describe(business)}. Check API access, scopes, developer token and account permissions.`, details: { ads: adsOk, businessProfile: businessOk } };
    return { success: true, status: 'VERIFIED', message: 'Google Ads and Business Profile API access verified. Business Growth features remain unavailable until the integration is implemented.', details: { ads: true, businessProfile: true } };
  } catch {
    return { success: false, status: 'ERROR', message: 'Google connection check could not reach Google. Check backend network access and try again.' };
  }
}
