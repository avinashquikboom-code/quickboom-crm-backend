import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const APIS = ['Places API', 'Geocoding API', 'Directions API', 'Maps JavaScript API'] as const;

@Injectable()
export class GoogleMapsUsageService {
  private readonly logger = new Logger(GoogleMapsUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  private period(timeZone: string, now = new Date()) {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return { day, month: day.slice(0, 7) };
  }

  private async quota(customerId: number) {
    return this.prisma.googleMapsQuota.upsert({
      where: { customerId },
      update: {},
      create: { customerId, warningThresholds: [80, 90, 95] },
    });
  }

  async execute<T>(customerId: number | undefined, apiName: string, run: () => Promise<T>): Promise<T> {
    const tenantId = Number(customerId);
    if (!Number.isInteger(tenantId) || tenantId <= 0) return run();
    const settings = await this.quota(tenantId);
    const { day, month } = this.period(settings.timezone || 'Asia/Kolkata');
    const [daily, monthly] = await Promise.all([
      this.prisma.googleMapsUsageDaily.aggregate({ where: { customerId: tenantId, day }, _sum: { requests: true } }),
      this.prisma.googleMapsUsageDaily.aggregate({
        where: { customerId: tenantId, day: { startsWith: month } },
        _sum: { requests: true },
      }),
    ]);
    const usedDay = daily._sum.requests || 0;
    const usedMonth = monthly._sum.requests || 0;
    if (settings.enforcementEnabled && (usedDay >= settings.dailyLimit || usedMonth >= settings.monthlyLimit)) {
      const scope = usedDay >= settings.dailyLimit ? 'daily' : 'monthly';
      throw new HttpException(
        `Google Maps ${scope} quota is exhausted for this workspace. New Places requests are paused until the quota resets.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    let ok = false;
    try {
      const result = await run();
      ok = true;
      return result;
    } finally {
      await this.record(tenantId, apiName, ok, settings, day, month, usedDay + 1, usedMonth + 1).catch((error) => {
        this.logger.warn(`Google Maps usage was not recorded: ${error?.message || error}`);
      });
    }
  }

  private async record(
    customerId: number,
    apiName: string,
    success: boolean,
    settings: { dailyLimit: number; monthlyLimit: number; alertsEnabled: boolean; warningThresholds: unknown; timezone: string },
    day: string,
    month: string,
    nextDay: number,
    nextMonth: number,
  ) {
    await this.prisma.googleMapsUsageDaily.upsert({
      where: { customerId_apiName_day: { customerId, apiName, day } },
      update: {
        requests: { increment: 1 },
        success: { increment: success ? 1 : 0 },
        failed: { increment: success ? 0 : 1 },
      },
      create: { customerId, apiName, day, requests: 1, success: success ? 1 : 0, failed: success ? 0 : 1 },
    });
    if (!settings.alertsEnabled) return;
    const thresholds = Array.isArray(settings.warningThresholds) ? settings.warningThresholds.map(Number) : [80, 90, 95];
    const checks = [
      { scope: 'DAILY', periodKey: day, used: nextDay, limit: settings.dailyLimit },
      { scope: 'MONTHLY', periodKey: month, used: nextMonth, limit: settings.monthlyLimit },
    ];
    for (const check of checks) {
      if (!check.limit) continue;
      const percent = (check.used / check.limit) * 100;
      const hits = [...thresholds, 100].filter((threshold) => percent >= threshold);
      for (const threshold of hits) {
        const message = threshold >= 100
          ? `Google Maps ${check.scope.toLowerCase()} quota is exhausted (${check.used}/${check.limit}).`
          : `Google Maps ${check.scope.toLowerCase()} usage reached ${threshold}% (${check.used}/${check.limit}).`;
        await this.prisma.googleMapsUsageAlert.upsert({
          where: {
            customerId_periodKey_scope_threshold_apiName: {
              customerId,
              periodKey: check.periodKey,
              scope: check.scope,
              threshold,
              apiName: 'ALL',
            },
          },
          update: {},
          create: { customerId, periodKey: check.periodKey, scope: check.scope, threshold, apiName: 'ALL', message },
        });
      }
    }
  }

  async overview(customerId: number, query: { from?: string; to?: string }) {
    const settings = await this.quota(customerId);
    const { day, month } = this.period(settings.timezone || 'Asia/Kolkata');
    const range = this.range(query, day, month);
    const rows = await this.prisma.googleMapsUsageDaily.findMany({
      where: { customerId, day: { gte: range.from, lte: range.to } },
    });
    const sum = (list: typeof rows) => list.reduce((acc, row) => {
      acc.requests += row.requests;
      acc.success += row.success;
      acc.failed += row.failed;
      return acc;
    }, { requests: 0, success: 0, failed: 0 });
    const today = sum(rows.filter((row) => row.day === day));
    const monthly = sum(rows.filter((row) => row.day.startsWith(month)));
    const selected = sum(rows);
    const pct = (used: number, limit: number) => limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;
    return {
      source: 'INTERNAL_BACKEND',
      note: 'Counts are QB Suite backend Places, Geocoding, Directions, and Maps calls. They are not Google Cloud billing quotas. Browser map loads that never reach this API are not included.',
      timezone: settings.timezone,
      today: { ...today, limit: settings.dailyLimit, remaining: Math.max(0, settings.dailyLimit - today.requests), percent: pct(today.requests, settings.dailyLimit) },
      month: { ...monthly, limit: settings.monthlyLimit, remaining: Math.max(0, settings.monthlyLimit - monthly.requests), percent: pct(monthly.requests, settings.monthlyLimit) },
      selected,
      enforcementEnabled: settings.enforcementEnabled,
    };
  }

  private range(query: { from?: string; to?: string }, day: string, month: string) {
    if (query.from || query.to) return { from: query.from || '1970-01-01', to: query.to || day };
    return { from: `${month}-01`, to: day };
  }

  async breakdown(customerId: number, query: { from?: string; to?: string; api?: string }) {
    const settings = await this.quota(customerId);
    const { day, month } = this.period(settings.timezone || 'Asia/Kolkata');
    const range = this.range(query, day, month);
    const rows = await this.prisma.googleMapsUsageDaily.groupBy({
      by: ['apiName'],
      where: {
        customerId,
        day: { gte: range.from, lte: range.to },
        ...(query.api ? { apiName: { contains: query.api, mode: 'insensitive' } } : {}),
      },
      _sum: { requests: true, success: true, failed: true },
    });
    const limits = (settings.apiLimits && typeof settings.apiLimits === 'object' ? settings.apiLimits : {}) as Record<string, { daily?: number; monthly?: number }>;
    const present = new Set(rows.map((row) => row.apiName));
    return {
      source: 'INTERNAL_BACKEND',
      apis: APIS.filter((name) => present.has(name) || !query.api).map((name) => {
        const row = rows.find((item) => item.apiName === name);
        const requests = row?._sum.requests || 0;
        const limit = limits[name]?.monthly || settings.monthlyLimit;
        return {
          apiName: name,
          requests,
          success: row?._sum.success || 0,
          failed: row?._sum.failed || 0,
          dailyQuota: limits[name]?.daily || settings.dailyLimit,
          monthlyQuota: limit,
          percent: limit ? Math.round((requests / limit) * 1000) / 10 : 0,
          status: requests ? 'Used' : 'Not used in this period',
          tracked: present.has(name),
        };
      }).filter((row) => !query.api || row.apiName.toLowerCase().includes(query.api.toLowerCase())),
    };
  }

  async history(customerId: number, query: { from?: string; to?: string; api?: string }) {
    const settings = await this.quota(customerId);
    const { day, month } = this.period(settings.timezone || 'Asia/Kolkata');
    const range = this.range(query, day, month);
    const rows = await this.prisma.googleMapsUsageDaily.findMany({
      where: {
        customerId,
        day: { gte: range.from, lte: range.to },
        ...(query.api ? { apiName: query.api } : {}),
      },
      orderBy: { day: 'asc' },
    });
    return { source: 'INTERNAL_BACKEND', timezone: settings.timezone, month, rows };
  }

  async getQuota(customerId: number) {
    return this.quota(customerId);
  }

  async saveQuota(customerId: number, body: any) {
    const dailyLimit = Number(body.dailyLimit);
    const monthlyLimit = Number(body.monthlyLimit);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || !Number.isInteger(monthlyLimit) || monthlyLimit < 0) {
      throw new HttpException('Daily and monthly quotas must be zero or a positive whole number.', HttpStatus.BAD_REQUEST);
    }
    if (monthlyLimit < dailyLimit) {
      throw new HttpException('Monthly quota cannot be lower than the daily quota.', HttpStatus.BAD_REQUEST);
    }
    return this.prisma.googleMapsQuota.upsert({
      where: { customerId },
      update: {
        dailyLimit,
        monthlyLimit,
        warningThresholds: Array.isArray(body.warningThresholds) ? body.warningThresholds : [80, 90, 95],
        alertsEnabled: Boolean(body.alertsEnabled),
        enforcementEnabled: Boolean(body.enforcementEnabled),
        recipients: body.recipients ? String(body.recipients).slice(0, 500) : null,
        timezone: body.timezone || 'Asia/Kolkata',
        apiLimits: body.apiLimits || undefined,
      },
      create: {
        customerId,
        dailyLimit,
        monthlyLimit,
        warningThresholds: [80, 90, 95],
        alertsEnabled: true,
        enforcementEnabled: false,
        timezone: 'Asia/Kolkata',
      },
    });
  }

  async alerts(customerId: number) {
    return {
      data: await this.prisma.googleMapsUsageAlert.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    };
  }

  async testAlert(customerId: number) {
    const settings = await this.quota(customerId);
    const { day } = this.period(settings.timezone || 'Asia/Kolkata');
    return this.prisma.googleMapsUsageAlert.upsert({
      where: {
        customerId_periodKey_scope_threshold_apiName: {
          customerId,
          periodKey: day,
          scope: 'DAILY',
          threshold: 0,
          apiName: 'TEST',
        },
      },
      update: { message: 'Test alert: Google Maps usage notifications are connected.' },
      create: {
        customerId,
        periodKey: day,
        scope: 'DAILY',
        threshold: 0,
        apiName: 'TEST',
        message: 'Test alert: Google Maps usage notifications are connected.',
      },
    });
  }
}
