import { BadRequestException, Injectable } from '@nestjs/common';
import { GoogleApiClient } from './google-api.client';

function reference(value: string, kind: 'accounts' | 'locations') {
  if (!new RegExp(`^${kind}/[0-9]+$`).test(value)) throw new BadRequestException(`Invalid ${kind} reference`);
  return value;
}

@Injectable()
export class GoogleBusinessClient {
  constructor(private readonly api: GoogleApiClient) {}
  async accounts(token: string) {
    const items: any[] = []; let pageToken: string | undefined;
    do {
      const url = new URL('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const result = await this.api.request<{ accounts?: any[]; nextPageToken?: string }>('business_accounts', url, token);
      items.push(...(result.accounts || [])); pageToken = result.nextPageToken;
    } while (pageToken);
    return items;
  }
  async locations(token: string, account: string) {
    const items: any[] = []; let pageToken: string | undefined;
    do {
      const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${reference(account, 'accounts')}/locations`);
      url.searchParams.set('readMask', 'name,title,categories,profile,phoneNumbers,websiteUri,storefrontAddress,regularHours,specialHours,metadata');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const result = await this.api.request<{ locations?: any[]; nextPageToken?: string }>('business_locations', url, token);
      items.push(...(result.locations || [])); pageToken = result.nextPageToken;
    } while (pageToken);
    return items;
  }
}

@Injectable()
export class GoogleReviewsClient {
  constructor(private readonly api: GoogleApiClient) {}
  async list(token: string, account: string, location: string) {
    const reviews: any[] = []; let pageToken: string | undefined; let averageRating: number | undefined; let totalReviewCount: number | undefined;
    do {
      const url = new URL(`https://mybusiness.googleapis.com/v4/${reference(account, 'accounts')}/${reference(location, 'locations')}/reviews`);
      url.searchParams.set('pageSize', '50'); if (pageToken) url.searchParams.set('pageToken', pageToken);
      const result = await this.api.request<{ reviews?: any[]; averageRating?: number; totalReviewCount?: number; nextPageToken?: string }>('reviews', url, token);
      reviews.push(...(result.reviews || [])); averageRating ??= result.averageRating; totalReviewCount ??= result.totalReviewCount; pageToken = result.nextPageToken;
    } while (pageToken);
    return { reviews, averageRating, totalReviewCount };
  }
  async reply(token: string, account: string, location: string, reviewId: string, comment: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(reviewId)) throw new BadRequestException('Invalid review ID');
    const url = new URL(`https://mybusiness.googleapis.com/v4/${reference(account, 'accounts')}/${reference(location, 'locations')}/reviews/${reviewId}/reply`);
    return this.api.request('reviews', url, token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }) });
  }
}

@Injectable()
export class GooglePerformanceClient {
  constructor(private readonly api: GoogleApiClient) {}
  async daily(token: string, location: string, start: string, end: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new BadRequestException('Invalid date range');
    const url = new URL(`https://businessprofileperformance.googleapis.com/v1/${reference(location, 'locations')}:fetchMultiDailyMetricsTimeSeries`);
    for (const metric of ['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'WEBSITE_CLICKS', 'CALL_CLICKS', 'BUSINESS_DIRECTION_REQUESTS']) url.searchParams.append('dailyMetrics', metric);
    for (const [label, value] of [['start_date', start], ['end_date', end]]) {
      const [year, month, day] = value.split('-');
      for (const [part, val] of Object.entries({ year, month, day })) url.searchParams.set(`dailyRange.${label}.${part}`, String(Number(val)));
    }
    return this.api.request('business_performance', url, token);
  }
}
