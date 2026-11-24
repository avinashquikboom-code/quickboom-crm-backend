import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GoogleApiClient } from './google-api.client';

@Injectable()
export class GoogleAdsClient {
  constructor(private readonly api: GoogleApiClient) {}

  private headers() {
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!developerToken) throw new ServiceUnavailableException('GOOGLE_ADS_DEVELOPER_TOKEN is not configured');
    const manager = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '');
    if (manager && !/^\d+$/.test(manager)) throw new ServiceUnavailableException('Invalid GOOGLE_ADS_LOGIN_CUSTOMER_ID');
    return { 'developer-token': developerToken, ...(manager ? { 'login-customer-id': manager } : {}) };
  }

  private base() {
    const version = process.env.GOOGLE_ADS_API_VERSION || 'v26';
    if (!/^v\d+$/.test(version)) throw new ServiceUnavailableException('Invalid GOOGLE_ADS_API_VERSION');
    return `https://googleads.googleapis.com/${version}`;
  }

  async accessibleCustomers(token: string) {
    return this.api.request<{ resourceNames?: string[] }>('google_ads', new URL(`${this.base()}/customers:listAccessibleCustomers`), token, { headers: this.headers() });
  }

  async search(token: string, customerId: string, query: string) {
    const id = customerId.replace(/-/g, '');
    if (!/^\d+$/.test(id)) throw new BadRequestException('Invalid Google Ads customer ID');
    return this.api.request<Array<{ results?: any[] }>>('google_ads', new URL(`${this.base()}/customers/${id}/googleAds:searchStream`), token, {
      method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    });
  }

  async campaigns(token: string, customerId: string, start: string, end: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new BadRequestException('Invalid date range');
    const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`;
    const chunks = await this.search(token, customerId, query);
    return chunks.flatMap(chunk => chunk.results || []).map(row => ({
      id: row.campaign?.id, name: row.campaign?.name, status: row.campaign?.status,
      channelType: row.campaign?.advertisingChannelType,
      budgetDaily: Number(row.campaignBudget?.amountMicros ?? 0) / 1e6,
      impressions: Number(row.metrics?.impressions ?? 0), clicks: Number(row.metrics?.clicks ?? 0),
      cost: Number(row.metrics?.costMicros ?? 0) / 1e6, ctr: Number(row.metrics?.ctr ?? 0),
      cpc: Number(row.metrics?.averageCpc ?? 0) / 1e6, conversions: Number(row.metrics?.conversions ?? 0),
      conversionValue: Number(row.metrics?.conversionsValue ?? 0), costPerConversion: Number(row.metrics?.costPerConversion ?? 0) / 1e6,
    }));
  }
}
