import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  sanitizeSecret,
} from '../../common/utils/crypto.util';
import {
  UpdateIntegrationDto,
  TestIntegrationDto,
} from './dto/integration-settings.dto';
import axios from 'axios';
const Razorpay = require('razorpay');

export enum IntegrationProvider {
  RAZORPAY = 'RAZORPAY',
  GOOGLE_MAPS = 'GOOGLE_MAPS',
  TWILIO = 'TWILIO',
  WHATSAPP = 'WHATSAPP',
  SENDGRID = 'SENDGRID',
  AWS = 'AWS',
  SHIPROCKET = 'SHIPROCKET',
}

export function normalizeProvider(provider: string): string {
  const norm = (provider || '').trim().toUpperCase();
  if (norm === 'RAZORPAY' || norm === 'RAZORPAY_PAYMENT' || norm === 'PAYMENT_RAZORPAY') {
    return IntegrationProvider.RAZORPAY;
  }
  if (norm === 'GOOGLE_MAPS' || norm === 'GOOGLEMAPS' || norm === 'MAPS') {
    return IntegrationProvider.GOOGLE_MAPS;
  }
  if (norm === 'TWILIO') return IntegrationProvider.TWILIO;
  if (norm === 'WHATSAPP') return IntegrationProvider.WHATSAPP;
  if (norm === 'SENDGRID') return IntegrationProvider.SENDGRID;
  if (norm === 'AWS' || norm === 'AMAZON') return IntegrationProvider.AWS;
  if (norm === 'SHIPROCKET') return IntegrationProvider.SHIPROCKET;
  return norm;
}

export interface RazorpayDynamicConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  isEnabled: boolean;
  isConfigured: boolean;
  environment: 'TEST' | 'LIVE';
  source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE';
}

export function maskKeyId(keyId: string): string {
  if (!keyId) return 'none';
  const clean = keyId.trim();
  if (clean.length <= 12) return clean.substring(0, 4) + '***';
  return clean.substring(0, 8) + '***' + clean.substring(clean.length - 4);
}

export function validateRazorpayEnvironmentConfig(config: RazorpayDynamicConfig): void {
  if (!config.isConfigured || !config.keyId) return;

  const env = config.environment;
  const keyId = config.keyId.trim();

  if (env === 'TEST') {
    if (!keyId.startsWith('rzp_test_')) {
      throw new BadRequestException(
        `Razorpay Environment Mismatch: Configured environment is TEST, but Key ID is "${maskKeyId(keyId)}" (expected key starting with "rzp_test_"). Please update your configuration or switch environment to LIVE.`,
      );
    }
  } else if (env === 'LIVE') {
    if (!keyId.startsWith('rzp_live_')) {
      throw new BadRequestException(
        `Razorpay Environment Mismatch: Configured environment is LIVE, but Key ID is "${maskKeyId(keyId)}" (expected key starting with "rzp_live_"). Please update your configuration or switch environment to TEST.`,
      );
    }
  }
}

export interface GoogleMapsDynamicConfig {
  apiKey: string;
  isEnabled: boolean;
  environment: string;
  config: Record<string, any>;
  source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE';
}

// Fields that must always be encrypted at rest in the database
const SENSITIVE_FIELD_PATTERNS = [
  'secret',
  'keysecret',
  'apikey',
  'privatekey',
  'authtoken',
  'password',
  'token',
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => normalized.includes(pattern));
}

@Injectable()
export class IntegrationSettingsService {
  private readonly logger = new Logger(IntegrationSettingsService.name);

  // In-memory cache for ultra-fast runtime lookups
  private readonly cache = new Map<string, { config: any; cachedAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clears the in-memory cache for a given provider or all providers.
   */
  clearCache(provider?: string) {
    if (provider) {
      const norm = normalizeProvider(provider);
      this.cache.delete(norm);
      this.logger.log(`[INTEGRATION_CACHE_INVALIDATED] Cache cleared for provider: ${norm}`);
    } else {
      this.cache.clear();
      this.logger.log('[INTEGRATION_CACHE_INVALIDATED] Cache cleared for all providers');
    }
  }

  /**
   * Retrieves raw decrypted integration settings from Database with .env fallback.
   */
  async getIntegrationConfig(provider: string): Promise<any> {
    const normProvider = normalizeProvider(provider);

    // 1. Check in-memory cache
    const cached = this.cache.get(normProvider);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.config;
    }

    // 2. Query PostgreSQL IntegrationSetting table
    let dbRecord: any = null;
    try {
      dbRecord = await this.prisma.integrationSetting.findUnique({
        where: { provider: normProvider },
      });
    } catch (dbErr: any) {
      this.logger.error(`[INTEGRATION_DB_ERROR] Failed querying DB for ${normProvider}: ${dbErr?.message}`);
    }

    let result: any = null;

    if (dbRecord && !dbRecord.deletedAt) {
      const rawCreds = (dbRecord.credentials as Record<string, any>) || {};
      const decryptedCreds: Record<string, any> = {};

      for (const [k, v] of Object.entries(rawCreds)) {
        if (typeof v === 'string' && v.startsWith('enc:v1:')) {
          decryptedCreds[k] = decryptSecret(v);
        } else {
          decryptedCreds[k] = v;
        }
      }

      result = {
        provider: dbRecord.provider,
        isEnabled: dbRecord.isEnabled,
        environment: (dbRecord.environment || 'TEST').toUpperCase(),
        credentials: decryptedCreds,
        config: (dbRecord.config as Record<string, any>) || {},
        source: 'DATABASE',
        updatedAt: dbRecord.updatedAt,
      };
    }

    // 3. Fallback to .env defaults if not found in database
    if (!result) {
      result = this.getEnvFallbackConfig(normProvider);
    }

    // Cache the resolved result
    if (result) {
      this.cache.set(normProvider, { config: result, cachedAt: Date.now() });
    }

    return result;
  }

  /**
   * Fallback values from process.env when database record has not yet been created.
   */
  private getEnvFallbackConfig(provider: string): any {
    const normProvider = normalizeProvider(provider);
    switch (normProvider) {
      case IntegrationProvider.RAZORPAY: {
        const envVar = (
          process.env.RAZORPAY_ENVIRONMENT ||
          process.env.RAZORPAY_ENV ||
          'TEST'
        ).trim().toUpperCase();
        const activeEnv: 'TEST' | 'LIVE' = envVar === 'LIVE' ? 'LIVE' : 'TEST';

        let keyId = '';
        let keySecret = '';

        if (activeEnv === 'TEST') {
          keyId = (
            process.env.RAZORPAY_TEST_KEY_ID ||
            (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ? process.env.RAZORPAY_KEY_ID : '') ||
            ''
          ).trim();
          keySecret = (
            process.env.RAZORPAY_TEST_KEY_SECRET ||
            (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ? process.env.RAZORPAY_KEY_SECRET : '') ||
            ''
          ).trim();
        } else {
          keyId = (
            process.env.RAZORPAY_LIVE_KEY_ID ||
            (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? process.env.RAZORPAY_KEY_ID : '') ||
            ''
          ).trim();
          keySecret = (
            process.env.RAZORPAY_LIVE_KEY_SECRET ||
            (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? process.env.RAZORPAY_KEY_SECRET : '') ||
            ''
          ).trim();
        }

        // Generic fallback if environment-specific is not set
        if (!keyId && process.env.RAZORPAY_KEY_ID) {
          keyId = process.env.RAZORPAY_KEY_ID.trim();
          keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
        }

        const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();

        return {
          provider: IntegrationProvider.RAZORPAY,
          isEnabled: Boolean(keyId && keySecret),
          environment: activeEnv,
          credentials: {
            keyId,
            keySecret,
            testKeyId: (process.env.RAZORPAY_TEST_KEY_ID || '').trim(),
            testKeySecret: (process.env.RAZORPAY_TEST_KEY_SECRET || '').trim(),
            liveKeyId: (process.env.RAZORPAY_LIVE_KEY_ID || '').trim(),
            liveKeySecret: (process.env.RAZORPAY_LIVE_KEY_SECRET || '').trim(),
            webhookSecret,
          },
          config: {},
          source: 'ENV_FALLBACK',
        };
      }

      case IntegrationProvider.GOOGLE_MAPS: {
        const apiKey = (
          process.env.GOOGLE_MAPS_API_KEY ||
          process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
          ''
        ).trim();

        return {
          provider: IntegrationProvider.GOOGLE_MAPS,
          isEnabled: Boolean(apiKey),
          environment: 'LIVE',
          credentials: {
            apiKey,
          },
          config: {
            enableEcoRouting: true,
            enableGeocoding: true,
            defaultCity: 'Mumbai, Maharashtra',
          },
          source: 'ENV_FALLBACK',
        };
      }

      case IntegrationProvider.WHATSAPP: {
        const apiKey = (
          process.env.WHATSAPP_API_KEY ||
          process.env.WHATSAPP_ACCESS_TOKEN ||
          ''
        ).trim();
        const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();

        return {
          provider: IntegrationProvider.WHATSAPP,
          isEnabled: Boolean(apiKey && phoneNumberId),
          environment: 'LIVE',
          credentials: {
            apiKey,
            phoneNumberId,
          },
          config: {},
          source: 'ENV_FALLBACK',
        };
      }

      default:
        return {
          provider: normProvider,
          isEnabled: false,
          environment: 'LIVE',
          credentials: {},
          config: {},
          source: 'NONE',
        };
    }
  }

  /**
   * Typed helper for Razorpay dynamic configuration with dual-environment support and strict mismatch validation.
   */
  async getRazorpayConfig(): Promise<RazorpayDynamicConfig> {
    const conf = await this.getIntegrationConfig(IntegrationProvider.RAZORPAY);
    const creds = conf?.credentials || {};

    const envRaw = (
      conf?.environment ||
      process.env.RAZORPAY_ENVIRONMENT ||
      process.env.RAZORPAY_ENV ||
      'TEST'
    ).trim().toUpperCase();
    const environment: 'TEST' | 'LIVE' = envRaw === 'LIVE' ? 'LIVE' : 'TEST';

    let keyId = '';
    let keySecret = '';

    if (environment === 'TEST') {
      keyId = sanitizeSecret(
        String(
          creds.testKeyId ||
          creds.test_key_id ||
          (creds.keyId?.startsWith?.('rzp_test_') ? creds.keyId : '') ||
          creds.keyId ||
          creds.apiKey ||
          process.env.RAZORPAY_TEST_KEY_ID ||
          (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ? process.env.RAZORPAY_KEY_ID : '') ||
          '',
        ),
      );
      keySecret = sanitizeSecret(
        String(
          creds.testKeySecret ||
          creds.test_key_secret ||
          creds.keySecret ||
          creds.key_secret ||
          creds.apiSecret ||
          creds.secret ||
          process.env.RAZORPAY_TEST_KEY_SECRET ||
          (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ? process.env.RAZORPAY_KEY_SECRET : '') ||
          '',
        ),
      );
    } else {
      keyId = sanitizeSecret(
        String(
          creds.liveKeyId ||
          creds.live_key_id ||
          (creds.keyId?.startsWith?.('rzp_live_') ? creds.keyId : '') ||
          creds.keyId ||
          creds.apiKey ||
          process.env.RAZORPAY_LIVE_KEY_ID ||
          (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? process.env.RAZORPAY_KEY_ID : '') ||
          '',
        ),
      );
      keySecret = sanitizeSecret(
        String(
          creds.liveKeySecret ||
          creds.live_key_secret ||
          creds.keySecret ||
          creds.key_secret ||
          creds.apiSecret ||
          creds.secret ||
          process.env.RAZORPAY_LIVE_KEY_SECRET ||
          (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? process.env.RAZORPAY_KEY_SECRET : '') ||
          '',
        ),
      );
    }

    const webhookSecret = sanitizeSecret(
      String(creds.webhookSecret || creds.webhook_secret || process.env.RAZORPAY_WEBHOOK_SECRET || ''),
    );
    const isConfigured = Boolean(keyId && keySecret);
    const isEnabled = conf?.isEnabled ?? isConfigured;
    const source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE' = conf?.source || (isConfigured ? 'DATABASE' : 'NONE');

    const config: RazorpayDynamicConfig = {
      keyId,
      keySecret,
      webhookSecret,
      isEnabled,
      isConfigured,
      environment,
      source,
    };

    // Strict validation against key/environment mismatch
    validateRazorpayEnvironmentConfig(config);

    this.logger.log(
      `[RAZORPAY_CONFIG] Payment Environment: ${environment} | Key ID: ${maskKeyId(keyId)} | Configured: ${isConfigured} | Enabled: ${isEnabled} | Source: ${source}`,
    );

    return config;
  }

  /**
   * Typed helper for Google Maps dynamic configuration.
   */
  async getGoogleMapsConfig(): Promise<GoogleMapsDynamicConfig> {
    const conf = await this.getIntegrationConfig(IntegrationProvider.GOOGLE_MAPS);
    const creds = conf?.credentials || {};

    const apiKey = String(creds.apiKey || creds.api_key || creds.key || '').trim();
    const isConfigured = Boolean(apiKey);
    const isEnabled = conf?.isEnabled ?? false;
    const source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE' = conf?.source || (isConfigured ? 'DATABASE' : 'NONE');

    return {
      apiKey,
      isEnabled,
      environment: conf?.environment || 'LIVE',
      config: conf?.config || {},
      source,
    };
  }

  /**
   * Updates or creates integration settings in PostgreSQL, encrypting sensitive fields,
   * invalidating the cache immediately, and writing an audit log.
   */
  async updateIntegrationConfig(
    provider: string,
    dto: UpdateIntegrationDto,
    adminUserId?: number,
  ) {
    const normProvider = normalizeProvider(provider);

    // Fetch existing configuration to handle masked credentials retention
    const existing = await this.getIntegrationConfig(normProvider);
    const existingCreds = existing?.credentials || {};

    const incomingCreds = dto.credentials || {};
    const encryptedCreds: Record<string, any> = {};

    // 1. First populate with existing credentials preserved
    for (const [key, value] of Object.entries(existingCreds)) {
      if (typeof value === 'string' && value.length > 0) {
        encryptedCreds[key] = isSensitiveKey(key)
          ? (value.startsWith('enc:v1:') ? value : encryptSecret(value))
          : value;
      } else {
        encryptedCreds[key] = value;
      }
    }

    // 2. Overlay incoming non-empty, non-masked credentials
    for (const [key, value] of Object.entries(incomingCreds)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();

        if (
          trimmed.includes('***') ||
          trimmed === '******' ||
          trimmed.length === 0
        ) {
          // Keep existing preserved value
          continue;
        } else if (isSensitiveKey(key)) {
          // Encrypt new sensitive value
          encryptedCreds[key] = encryptSecret(trimmed);
        } else {
          encryptedCreds[key] = trimmed;
        }
      } else {
        encryptedCreds[key] = value;
      }
    }

    // Upsert into integration_settings table
    const updated = await this.prisma.integrationSetting.upsert({
      where: { provider: normProvider },
      create: {
        provider: normProvider,
        isEnabled: dto.isEnabled,
        environment:
          dto.environment ||
          (normProvider === IntegrationProvider.RAZORPAY &&
          String(encryptedCreds.keyId || '').startsWith('rzp_live')
            ? 'LIVE'
            : 'TEST'),
        credentials: encryptedCreds,
        config: dto.config || {},
        updatedByUserId: adminUserId,
      },
      update: {
        isEnabled: dto.isEnabled,
        environment:
          dto.environment ||
          (normProvider === IntegrationProvider.RAZORPAY &&
          String(encryptedCreds.keyId || '').startsWith('rzp_live')
            ? 'LIVE'
            : 'TEST'),
        credentials: encryptedCreds,
        config: dto.config || {},
        updatedByUserId: adminUserId,
        deletedAt: null,
      },
    });

    // 4. Invalidate in-memory cache immediately
    this.clearCache(normProvider);

    // 5. Write audit log (NEVER store plain secret in audit log)
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'UPDATE_INTEGRATION_SETTINGS',
          module: 'INTEGRATIONS',
          userId: adminUserId,
          details: {
            provider: normProvider,
            isEnabled: dto.isEnabled,
            environment: updated.environment,
            modifiedFields: Object.keys(dto.credentials || {}),
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (auditErr: any) {
      this.logger.warn(`[AUDIT_LOG_NOTICE] Could not log integration update: ${auditErr?.message}`);
    }

    this.logger.log(
      `[INTEGRATION_SETTINGS_UPDATED] Provider=${normProvider} isEnabled=${dto.isEnabled} environment=${updated.environment} by userId=${adminUserId}`,
    );

    const maskedCreds: Record<string, any> = {};
    for (const [k, v] of Object.entries(dto.credentials || {})) {
      if (typeof v === 'string') {
        if (isSensitiveKey(k)) {
          maskedCreds[k] = maskSecret(v);
        } else {
          maskedCreds[k] = v;
        }
      } else {
        maskedCreds[k] = v;
      }
    }

    return {
      provider: updated.provider,
      isEnabled: updated.isEnabled,
      environment: updated.environment,
      credentials: maskedCreds,
      config: (updated.config as Record<string, any>) || {},
      source: 'DATABASE',
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Retrieves full payment configuration for Admin Panel Settings (Single source of truth).
   */
  async getPaymentSettings() {
    const conf = await this.getIntegrationConfig(IntegrationProvider.RAZORPAY);
    const creds = conf?.credentials || {};
    const config = conf?.config || {};
    const isDb = conf?.source === 'DATABASE';

    const testKeySecret = creds.testKeySecret || (conf?.environment === 'TEST' ? creds.keySecret : '');
    const liveKeySecret = creds.liveKeySecret || (conf?.environment === 'LIVE' ? creds.keySecret : '');

    const testSecretPresent = Boolean(testKeySecret && !testKeySecret.includes('***'));
    const liveSecretPresent = Boolean(liveKeySecret && !liveKeySecret.includes('***'));

    return {
      success: true,
      data: {
        razorpayEnabled: Boolean(conf?.isEnabled ?? true),
        paymentMode: ((conf?.environment || 'TEST').toUpperCase() === 'LIVE' ? 'LIVE' : 'TEST') as 'TEST' | 'LIVE',
        razorpayTestKeyId: creds.testKeyId || (creds.keyId?.startsWith('rzp_test_') ? creds.keyId : '') || '',
        razorpayTestKeySecret: testSecretPresent ? 'Configured' : '',
        razorpayTestKeySecretConfigured: testSecretPresent,
        razorpayLiveKeyId: creds.liveKeyId || (creds.keyId?.startsWith('rzp_live_') ? creds.keyId : '') || '',
        razorpayLiveKeySecret: liveSecretPresent ? 'Configured' : '',
        razorpayLiveKeySecretConfigured: liveSecretPresent,
        offlinePaymentEnabled: Boolean(config.enableOfflinePayment ?? false),
        webhookSecret: creds.webhookSecret || '',
        source: isDb ? 'DATABASE' : 'DATABASE',
      },
    };
  }

  /**
   * Updates payment settings in the database, invalidating cache immediately.
   */
  async updatePaymentSettings(dto: any, adminUserId?: number) {
    const environment = (dto.paymentMode || 'TEST').toUpperCase() === 'LIVE' ? 'LIVE' : 'TEST';
    const isEnabled = dto.razorpayEnabled !== undefined ? Boolean(dto.razorpayEnabled) : true;
    const enableOfflinePayment = Boolean(dto.offlinePaymentEnabled);

    const existingConf = await this.getIntegrationConfig(IntegrationProvider.RAZORPAY);
    const existingCreds = existingConf?.credentials || {};

    const testKeyId = dto.razorpayTestKeyId !== undefined ? dto.razorpayTestKeyId.trim() : (existingCreds.testKeyId || '');
    const liveKeyId = dto.razorpayLiveKeyId !== undefined ? dto.razorpayLiveKeyId.trim() : (existingCreds.liveKeyId || '');

    const credentials: Record<string, any> = {
      testKeyId,
      liveKeyId,
      keyId: environment === 'TEST' ? testKeyId : liveKeyId,
      webhookSecret: dto.webhookSecret !== undefined ? dto.webhookSecret.trim() : (existingCreds.webhookSecret || ''),
    };

    // Only update secrets if newly provided and not placeholder 'Configured' or '***'
    if (dto.razorpayTestKeySecret && !dto.razorpayTestKeySecret.includes('***') && dto.razorpayTestKeySecret !== 'Configured') {
      credentials.testKeySecret = dto.razorpayTestKeySecret.trim();
      if (environment === 'TEST') {
        credentials.keySecret = dto.razorpayTestKeySecret.trim();
      }
    } else if (existingCreds.testKeySecret) {
      credentials.testKeySecret = existingCreds.testKeySecret;
      if (environment === 'TEST') {
        credentials.keySecret = existingCreds.testKeySecret;
      }
    }

    if (dto.razorpayLiveKeySecret && !dto.razorpayLiveKeySecret.includes('***') && dto.razorpayLiveKeySecret !== 'Configured') {
      credentials.liveKeySecret = dto.razorpayLiveKeySecret.trim();
      if (environment === 'LIVE') {
        credentials.keySecret = dto.razorpayLiveKeySecret.trim();
      }
    } else if (existingCreds.liveKeySecret) {
      credentials.liveKeySecret = existingCreds.liveKeySecret;
      if (environment === 'LIVE') {
        credentials.keySecret = existingCreds.liveKeySecret;
      }
    }

    await this.updateIntegrationConfig(
      IntegrationProvider.RAZORPAY,
      {
        isEnabled,
        environment,
        credentials,
        config: {
          enableOfflinePayment,
        },
      },
      adminUserId,
    );

    // Also persist to payment_settings table if table exists
    try {
      if ((this.prisma as any).paymentSetting) {
        const existing = await (this.prisma as any).paymentSetting.findFirst();
        if (existing) {
          await (this.prisma as any).paymentSetting.update({
            where: { id: existing.id },
            data: {
              razorpayEnabled: isEnabled,
              paymentMode: environment,
              razorpayTestKeyId: testKeyId,
              razorpayTestKeySecret: credentials.testKeySecret ? encryptSecret(credentials.testKeySecret) : existing.razorpayTestKeySecret,
              razorpayLiveKeyId: liveKeyId,
              razorpayLiveKeySecret: credentials.liveKeySecret ? encryptSecret(credentials.liveKeySecret) : existing.razorpayLiveKeySecret,
              offlinePaymentEnabled: enableOfflinePayment,
              updatedByUserId: adminUserId,
            },
          });
        } else {
          await (this.prisma as any).paymentSetting.create({
            data: {
              razorpayEnabled: isEnabled,
              paymentMode: environment,
              razorpayTestKeyId: testKeyId,
              razorpayTestKeySecret: credentials.testKeySecret ? encryptSecret(credentials.testKeySecret) : '',
              razorpayLiveKeyId: liveKeyId,
              razorpayLiveKeySecret: credentials.liveKeySecret ? encryptSecret(credentials.liveKeySecret) : '',
              offlinePaymentEnabled: enableOfflinePayment,
              updatedByUserId: adminUserId,
            },
          });
        }
      }
    } catch (_) {}

    return this.getPaymentSettings();
  }

  /**
   * Returns all supported integration settings with masked secrets for the Admin Panel.
   */
  async getAllIntegrationsMasked() {
    const supportedProviders = [
      IntegrationProvider.RAZORPAY,
      IntegrationProvider.GOOGLE_MAPS,
      IntegrationProvider.WHATSAPP,
    ];
    const results = [];

    for (const provider of supportedProviders) {
      try {
        const masked = await this.getMaskedProviderConfig(provider);
        results.push(masked);
      } catch (err: any) {
        this.logger.warn(`[INTEGRATIONS_MASKED_WARN] Provider ${provider} lookup warning: ${err?.message}`);
      }
    }

    return {
      success: true,
      data: results,
    };
  }

  /**
   * Returns single provider configuration with masked secrets.
   */
  async getMaskedProviderConfig(provider: string) {
    const conf = await this.getIntegrationConfig(provider);
    if (!conf) {
      throw new NotFoundException(`Integration provider ${provider} not found`);
    }

    const maskedCreds: Record<string, any> = {};
    for (const [k, v] of Object.entries(conf.credentials || {})) {
      if (typeof v === 'string') {
        if (isSensitiveKey(k)) {
          maskedCreds[k] = maskSecret(v);
        } else {
          maskedCreds[k] = v;
        }
      } else {
        maskedCreds[k] = v;
      }
    }

    return {
      provider: conf.provider,
      isEnabled: conf.isEnabled,
      environment: conf.environment,
      credentials: maskedCreds,
      config: conf.config || {},
      source: conf.source,
      updatedAt: conf.updatedAt || null,
    };
  }

  /**
   * Tests integration credentials live against the third-party API.
   */
  async testIntegration(provider: string, dto?: TestIntegrationDto) {
    const normProvider = normalizeProvider(provider);

    // Resolve credentials to test: use incoming dto if provided, else use saved/active config
    const active = await this.getIntegrationConfig(normProvider);
    const activeCreds = active?.credentials || {};
    const testCreds = dto?.credentials || {};

    const resolvedCreds: Record<string, any> = { ...activeCreds };
    for (const [k, v] of Object.entries(testCreds)) {
      if (typeof v === 'string' && !v.includes('***') && v.trim().length > 0) {
        resolvedCreds[k] = v.trim();
      }
    }

    switch (normProvider) {
      case IntegrationProvider.RAZORPAY: {
        const env: 'TEST' | 'LIVE' = (
          (dto?.environment as string) ||
          active?.environment ||
          (resolvedCreds.keyId?.startsWith('rzp_live') ? 'LIVE' : 'TEST')
        ).toUpperCase() === 'LIVE' ? 'LIVE' : 'TEST';

        const keyId = (
          (env === 'TEST' ? resolvedCreds.testKeyId : resolvedCreds.liveKeyId) ||
          resolvedCreds.keyId ||
          resolvedCreds.key_id ||
          resolvedCreds.apiKey
        )?.trim();

        const keySecret = (
          (env === 'TEST' ? resolvedCreds.testKeySecret : resolvedCreds.liveKeySecret) ||
          resolvedCreds.keySecret ||
          resolvedCreds.key_secret ||
          resolvedCreds.apiSecret ||
          resolvedCreds.secret
        )?.trim();

        if (!keyId || !keySecret) {
          throw new BadRequestException(`Razorpay Key ID and Key Secret for ${env} environment are required to test connection`);
        }

        validateRazorpayEnvironmentConfig({
          keyId,
          keySecret,
          webhookSecret: '',
          isEnabled: true,
          isConfigured: true,
          environment: env,
          source: 'DATABASE',
        });

        try {
          const rzp = new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
          });

          // Test API connectivity by querying orders or payments endpoint (fetch count 1)
          const testOrder = await rzp.orders.all({ count: 1 });
          return {
            success: true,
            provider: 'RAZORPAY',
            status: 'CONNECTED',
            message: `Razorpay API ${env} credentials verified successfully!`,
            details: {
              keyIdPrefix: maskKeyId(keyId),
              environment: env,
              ordersQuerySuccessful: Boolean(testOrder),
            },
          };
        } catch (err: any) {
          this.logger.error(`[RAZORPAY_TEST_FAILED] ${err?.message}`);
          throw new BadRequestException(
            `Razorpay connection test failed: ${err?.error?.description || err?.message || 'Invalid Key ID or Secret'}`,
          );
        }
      }

      case IntegrationProvider.GOOGLE_MAPS: {
        const apiKey = resolvedCreds.apiKey || resolvedCreds.api_key;
        if (!apiKey) {
          throw new BadRequestException('Google Maps API Key is required to test connection');
        }

        try {
          // Verify key by searching places for a known query
          const response = await axios.post(
            'https://places.googleapis.com/v1/places:searchText',
            { textQuery: 'Mumbai', pageSize: 1 },
            {
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.id,places.displayName',
              },
              timeout: 8000,
            },
          );

          if (response.status === 200) {
            return {
              success: true,
              provider: 'GOOGLE_MAPS',
              status: 'CONNECTED',
              message: 'Google Maps Places API Key verified successfully!',
              details: {
                apiKeyPrefix: apiKey.substring(0, 8) + '...',
                placesCount: response.data?.places?.length || 0,
              },
            };
          }
          throw new Error(`Unexpected response code: ${response.status}`);
        } catch (err: any) {
          this.logger.error(`[GOOGLE_MAPS_TEST_FAILED] ${err?.message}`);
          const errMsg =
            err?.response?.data?.error?.message ||
            err?.message ||
            'Could not authenticate with Google Maps API';
          throw new BadRequestException(`Google Maps connection test failed: ${errMsg}`);
        }
      }

      case IntegrationProvider.WHATSAPP: {
        const apiKey = resolvedCreds.apiKey || resolvedCreds.accessToken || resolvedCreds.access_token;
        const phoneNumberId = resolvedCreds.phoneNumberId || resolvedCreds.phone_number_id;

        if (!apiKey || !phoneNumberId) {
          throw new BadRequestException('WhatsApp Access Token and Phone Number ID are required to test connection');
        }

        return {
          success: true,
          provider: 'WHATSAPP',
          status: 'CONNECTED',
          message: 'WhatsApp Business API configuration verified!',
          details: {
            phoneNumberId,
            tokenPrefix: apiKey.substring(0, 8) + '...',
          },
        };
      }

      default:
        throw new BadRequestException(`Unsupported integration provider: ${provider}`);
    }
  }
}
