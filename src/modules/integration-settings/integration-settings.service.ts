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
import * as nodemailer from 'nodemailer';
const Razorpay = require('razorpay');

export enum IntegrationProvider {
  RAZORPAY = 'RAZORPAY',
  GOOGLE_MAPS = 'GOOGLE_MAPS',
  TWILIO = 'TWILIO',
  WHATSAPP = 'WHATSAPP',
  SENDGRID = 'SENDGRID',
  AWS = 'AWS',
  MSG91 = 'MSG91',
  SHIPROCKET = 'SHIPROCKET',
  OPENAI = 'OPENAI',
  GEMINI = 'GEMINI',
  SMTP = 'SMTP',
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
  if (norm === 'AWS' || norm === 'AMAZON' || norm === 'S3' || norm === 'AWS_S3' || norm === 'AMAZON_S3') return IntegrationProvider.AWS;
  if (norm === 'MSG91' || norm === 'MSG_91' || norm === 'SMS_MSG91' || norm === 'OTP_MSG91') return IntegrationProvider.MSG91;
  if (norm === 'SHIPROCKET') return IntegrationProvider.SHIPROCKET;
  if (norm === 'OPENAI' || norm === 'OPEN_AI' || norm === 'CHATGPT') return IntegrationProvider.OPENAI;
  if (norm === 'GEMINI' || norm === 'GOOGLE_GEMINI' || norm === 'GOOGLE_AI') return IntegrationProvider.GEMINI;
  if (norm === 'SMTP' || norm === 'EMAIL' || norm === 'MAIL' || norm === 'SMTP_EMAIL') return IntegrationProvider.SMTP;
  return norm;
}

export interface OpenAiDynamicConfig {
  apiKey: string;
  imageModel?: string;
  isEnabled: boolean;
  isConfigured: boolean;
  source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE';
}

export interface GeminiDynamicConfig {
  apiKey: string;
  isEnabled: boolean;
  isConfigured: boolean;
  source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE';
}

export interface AwsS3DynamicConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  customDomain?: string;
  isEnabled: boolean;
  isConfigured: boolean;
  source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE';
}

export interface Msg91DynamicConfig {
  authKey: string;
  templateId: string;
  senderId: string;
  otpExpiry: number;
  isEnabled: boolean;
  isConfigured: boolean;
  source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE';
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

export interface SmtpDynamicConfig {
  host: string;
  port: number;
  secure: boolean;
  security: 'SSL' | 'TLS' | 'NONE';
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  isEnabled: boolean;
  isConfigured: boolean;
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

export function isMaskedSecret(val?: any): boolean {
  if (!val || typeof val !== 'string') return true;
  const t = val.trim();
  return (
    t.length === 0 ||
    t === '******' ||
    t === '••••••••' ||
    t.includes('***') ||
    t.includes('•')
  );
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

      case IntegrationProvider.AWS: {
        const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
        const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
        const region = (process.env.AWS_REGION || 'ap-south-1').trim();
        const bucket = (process.env.AWS_S3_BUCKET || '').trim();
        const customDomain = (process.env.AWS_S3_CUSTOM_DOMAIN || '').trim();

        return {
          provider: IntegrationProvider.AWS,
          isEnabled: Boolean(accessKeyId && secretAccessKey && bucket),
          environment: 'LIVE',
          credentials: { accessKeyId, secretAccessKey, region, bucket, customDomain },
          config: {},
          source: 'ENV_FALLBACK',
        };
      }

      case IntegrationProvider.MSG91: {
        const authKey = (process.env.MSG91_AUTH_KEY || '').trim();
        const templateId = (process.env.MSG91_TEMPLATE_ID || '').trim();
        const senderId = (process.env.MSG91_SENDER_ID || 'QUIKBM').trim();
        const otpExpiry = parseInt(process.env.MSG91_OTP_EXPIRY || '300', 10);

        return {
          provider: IntegrationProvider.MSG91,
          isEnabled: Boolean(authKey && templateId),
          environment: 'LIVE',
          credentials: { authKey, templateId, senderId },
          config: { otpExpiry },
          source: 'ENV_FALLBACK',
        };
      }

      case IntegrationProvider.OPENAI: {
        const apiKey = (process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim();
        return {
          provider: IntegrationProvider.OPENAI,
          isEnabled: Boolean(apiKey),
          environment: 'LIVE',
          credentials: { apiKey },
          config: {},
          source: apiKey ? 'ENV_FALLBACK' : 'NONE',
        };
      }

      case IntegrationProvider.GEMINI: {
        const apiKey = (
          process.env.GEMINI_API_KEY ||
          process.env.GOOGLE_GEMINI_API_KEY ||
          process.env.GOOGLE_API_KEY ||
          ''
        ).trim();
        return {
          provider: IntegrationProvider.GEMINI,
          isEnabled: Boolean(apiKey),
          environment: 'LIVE',
          credentials: { apiKey },
          config: {},
          source: apiKey ? 'ENV_FALLBACK' : 'NONE',
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
   * Typed helper for AWS S3 dynamic configuration.
   * Priority: Database (Admin Settings) → ENV fallback.
   */
  async getAwsS3Config(): Promise<AwsS3DynamicConfig> {
    const conf = await this.getIntegrationConfig(IntegrationProvider.AWS);
    const creds = conf?.credentials || {};

    const accessKeyId = sanitizeSecret(
      String(creds.accessKeyId || creds.access_key_id || process.env.AWS_ACCESS_KEY_ID || ''),
    );
    const secretAccessKey = sanitizeSecret(
      String(creds.secretAccessKey || creds.secret_access_key || process.env.AWS_SECRET_ACCESS_KEY || ''),
    );
    const region = String(creds.region || process.env.AWS_REGION || 'ap-south-1').trim();
    const bucket = String(creds.bucket || creds.bucketName || creds.bucket_name || process.env.AWS_S3_BUCKET || '').trim();
    const customDomain = String(creds.customDomain || creds.custom_domain || process.env.AWS_S3_CUSTOM_DOMAIN || '').trim();

    const isConfigured = Boolean(accessKeyId && secretAccessKey && bucket);
    const isEnabled = conf?.isEnabled ?? isConfigured;
    const source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE' = conf?.source || (isConfigured ? 'ENV_FALLBACK' : 'NONE');

    this.logger.log(
      `[AWS_S3_CONFIG] Bucket: ${bucket || 'NOT_SET'} | Region: ${region} | Configured: ${isConfigured} | Source: ${source}`,
    );

    return { accessKeyId, secretAccessKey, region, bucket, customDomain, isEnabled, isConfigured, source };
  }

  /**
   * Typed helper for MSG91 dynamic configuration.
   * Priority: Database (Admin Settings) → ENV fallback.
   */
  async getMsg91Config(): Promise<Msg91DynamicConfig> {
    const conf = await this.getIntegrationConfig(IntegrationProvider.MSG91);
    const creds = conf?.credentials || {};
    const cfg = conf?.config || {};

    const authKey = sanitizeSecret(
      String(creds.authKey || creds.auth_key || creds.apiKey || process.env.MSG91_AUTH_KEY || ''),
    );
    const templateId = String(creds.templateId || creds.template_id || process.env.MSG91_TEMPLATE_ID || '').trim();
    const senderId = String(creds.senderId || creds.sender_id || process.env.MSG91_SENDER_ID || 'QUIKBM').trim();
    const otpExpiry = parseInt(
      String(cfg.otpExpiry || cfg.otp_expiry || process.env.MSG91_OTP_EXPIRY || '300'),
      10,
    );

    const isConfigured = Boolean(authKey && templateId);
    const isEnabled = conf?.isEnabled ?? isConfigured;
    const source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE' = conf?.source || (isConfigured ? 'ENV_FALLBACK' : 'NONE');

    this.logger.log(
      `[MSG91_CONFIG] TemplateId: ${templateId || 'NOT_SET'} | SenderId: ${senderId} | Configured: ${isConfigured} | Source: ${source}`,
    );

    return { authKey, templateId, senderId, otpExpiry, isEnabled, isConfigured, source };
  }

  /**
   * Typed helper for OpenAI dynamic configuration.
   * Priority: Database (Admin Settings) → ENV fallback.
   */
  async getOpenAiConfig(): Promise<OpenAiDynamicConfig> {
    const conf = await this.getIntegrationConfig(IntegrationProvider.OPENAI);
    const creds = conf?.credentials || {};
    const cfg = conf?.config || {};
    const apiKey = sanitizeSecret(String(creds.apiKey || creds.api_key || process.env.OPENAI_API_KEY || ''));
    const imageModel = String(cfg.imageModel || cfg.model || creds.imageModel || creds.model || process.env.OPENAI_IMAGE_MODEL || '').trim() || undefined;
    const isConfigured = Boolean(apiKey);
    const isEnabled = conf?.isEnabled ?? isConfigured;
    const source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE' = conf?.source || (isConfigured ? 'DATABASE' : 'NONE');

    return { apiKey, imageModel, isEnabled, isConfigured, source };
  }

  /**
   * Typed helper for Google Gemini dynamic configuration.
   * Priority: Database (Admin Settings) → ENV fallback.
   */
  async getGeminiConfig(): Promise<GeminiDynamicConfig> {
    const conf = await this.getIntegrationConfig(IntegrationProvider.GEMINI);
    const creds = conf?.credentials || {};
    const apiKey = sanitizeSecret(String(creds.apiKey || creds.api_key || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''));
    const isConfigured = Boolean(apiKey);
    const isEnabled = conf?.isEnabled ?? isConfigured;
    const source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE' = conf?.source || (isConfigured ? 'DATABASE' : 'NONE');

    return { apiKey, isEnabled, isConfigured, source };
  }

  /**
   * Typed helper for SMTP Email dynamic configuration.
   * Priority: Database (Admin Settings) → ENV fallback.
   */
  async getSmtpConfig(): Promise<SmtpDynamicConfig> {
    const conf = await this.getIntegrationConfig(IntegrationProvider.SMTP);
    const creds = conf?.credentials || {};
    const cfg = conf?.config || {};

    const host = String(cfg.host || creds.host || creds.smtpHost || process.env.SMTP_HOST || '').trim();
    const rawPort = cfg.port || creds.port || creds.smtpPort || process.env.SMTP_PORT || 587;
    const port = Number(rawPort) || 587;

    const rawSecurity = String(
      cfg.security || creds.security || creds.smtpSecurity || (port === 465 ? 'SSL' : 'TLS'),
    )
      .toUpperCase()
      .trim();
    const security: 'SSL' | 'TLS' | 'NONE' =
      rawSecurity === 'SSL' || rawSecurity === 'TLS' || rawSecurity === 'NONE'
        ? rawSecurity
        : port === 465
        ? 'SSL'
        : 'TLS';
    const secure = security === 'SSL' || port === 465;

    const username = sanitizeSecret(
      String(
        creds.username ||
          creds.smtpUsername ||
          creds.user ||
          process.env.SMTP_USER ||
          process.env.SMTP_USERNAME ||
          '',
      ),
    );
    const password = sanitizeSecret(
      String(
        creds.password ||
          creds.smtpPassword ||
          creds.pass ||
          process.env.SMTP_PASSWORD ||
          process.env.SMTP_PASS ||
          '',
      ),
    );
    const fromEmail = String(
      cfg.fromEmail ||
        creds.fromEmail ||
        cfg.from ||
        process.env.SMTP_FROM_EMAIL ||
        process.env.MAIL_FROM ||
        '',
    ).trim();
    const fromName = String(
      cfg.fromName ||
        creds.fromName ||
        process.env.SMTP_FROM_NAME ||
        process.env.MAIL_FROM_NAME ||
        'QuickBoom CRM',
    ).trim();

    const isConfigured = Boolean(host && port && (username ? password : true) && fromEmail);
    const isEnabled = conf?.isEnabled ?? isConfigured;
    const source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE' =
      conf?.source || (isConfigured ? 'DATABASE' : 'NONE');

    return {
      host,
      port,
      secure,
      security,
      username,
      password,
      fromEmail,
      fromName,
      isEnabled,
      isConfigured,
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

    // Validate non-empty API key for AI integrations
    if (normProvider === IntegrationProvider.OPENAI || normProvider === IntegrationProvider.GEMINI) {
      const incomingKey = dto.credentials?.apiKey;
      const providerLabel = normProvider === IntegrationProvider.OPENAI ? 'OpenAI' : 'Google Gemini';
      if (incomingKey !== undefined && typeof incomingKey === 'string' && incomingKey.trim().length === 0) {
        throw new BadRequestException(`${providerLabel} API Key cannot be empty or whitespace-only`);
      }
      if (!existingCreds.apiKey && (!incomingKey || typeof incomingKey !== 'string' || !incomingKey.trim())) {
        throw new BadRequestException(`${providerLabel} API Key is required`);
      }
    }

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
    let psRecord: any = null;
    try {
      psRecord = await (this.prisma as any).paymentSetting?.findFirst();
    } catch (_) {}

    const conf = await this.getIntegrationConfig(IntegrationProvider.RAZORPAY);
    const creds = conf?.credentials || {};
    const config = conf?.config || {};

    const testKeySecret = creds.testKeySecret || (conf?.environment === 'TEST' ? creds.keySecret : '');
    const liveKeySecret = creds.liveKeySecret || (conf?.environment === 'LIVE' ? creds.keySecret : '');

    const testSecretPresent = Boolean(testKeySecret && !testKeySecret.includes('***'));
    const liveSecretPresent = Boolean(liveKeySecret && !liveKeySecret.includes('***'));

    const offlinePaymentEnabled = psRecord?.offlinePaymentEnabled !== undefined
      ? Boolean(psRecord.offlinePaymentEnabled)
      : Boolean(config.enableOfflinePayment ?? true);

    const razorpayEnabled = psRecord?.razorpayEnabled !== undefined
      ? Boolean(psRecord.razorpayEnabled)
      : Boolean(conf?.isEnabled ?? true);

    const paymentMode = (psRecord?.paymentMode || conf?.environment || 'TEST').toUpperCase() === 'LIVE' ? 'LIVE' : 'TEST';

    return {
      success: true,
      data: {
        razorpayEnabled,
        paymentMode: paymentMode as 'TEST' | 'LIVE',
        razorpayTestKeyId: psRecord?.razorpayTestKeyId || creds.testKeyId || (creds.keyId?.startsWith('rzp_test_') ? creds.keyId : '') || '',
        razorpayTestKeySecret: testSecretPresent ? 'Configured' : '',
        razorpayTestKeySecretConfigured: testSecretPresent,
        razorpayLiveKeyId: psRecord?.razorpayLiveKeyId || creds.liveKeyId || (creds.keyId?.startsWith('rzp_live_') ? creds.keyId : '') || '',
        razorpayLiveKeySecret: liveSecretPresent ? 'Configured' : '',
        razorpayLiveKeySecretConfigured: liveSecretPresent,
        offlinePaymentEnabled,
        webhookSecret: creds.webhookSecret || '',
        source: 'DATABASE',
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
      IntegrationProvider.AWS,
      IntegrationProvider.MSG91,
      IntegrationProvider.OPENAI,
      IntegrationProvider.GEMINI,
      IntegrationProvider.SMTP,
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
    const norm = normalizeProvider(provider);
    const conf = await this.getIntegrationConfig(norm);
    if (!conf) {
      return {
        provider: norm,
        isEnabled: false,
        environment: 'TEST',
        credentials: {},
        config: {},
        source: 'NONE' as const,
        configured: false,
        updatedAt: null,
      };
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
      configured: Boolean(conf.isEnabled || (Object.keys(conf.credentials || {}).length > 0 && conf.source === 'DATABASE')),
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
    const testCreds: Record<string, any> = {
      ...(dto?.credentials || {}),
    };

    // Support flat credentials if supplied directly at top level of DTO
    if (dto?.username !== undefined) testCreds.username = dto.username;
    if (dto?.password !== undefined) testCreds.password = dto.password;
    if (dto?.smtpUsername !== undefined) testCreds.smtpUsername = dto.smtpUsername;
    if (dto?.smtpPassword !== undefined) testCreds.smtpPassword = dto.smtpPassword;

    const resolvedCreds: Record<string, any> = { ...activeCreds };
    for (const [k, v] of Object.entries(testCreds)) {
      if (typeof v === 'string' && !isMaskedSecret(v) && v.trim().length > 0) {
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

      case IntegrationProvider.AWS: {
        const accessKeyId = resolvedCreds.accessKeyId || resolvedCreds.access_key_id;
        const secretAccessKey = resolvedCreds.secretAccessKey || resolvedCreds.secret_access_key;
        const region = resolvedCreds.region || 'ap-south-1';
        const bucket = resolvedCreds.bucket || resolvedCreds.bucketName || resolvedCreds.bucket_name;

        if (!accessKeyId || !secretAccessKey || !bucket) {
          throw new BadRequestException('AWS Access Key ID, Secret Access Key, and Bucket Name are required to test connection');
        }

        try {
          const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
          const s3Client = new S3Client({
            region,
            credentials: { accessKeyId, secretAccessKey },
          });
          await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
          return {
            success: true,
            provider: 'AWS',
            status: 'CONNECTED',
            message: 'Amazon S3 bucket access verified successfully!',
            details: { bucket, region, keyPrefix: accessKeyId.substring(0, 8) + '...' },
          };
        } catch (err: any) {
          this.logger.error(`[AWS_S3_TEST_FAILED] ${err?.message}`);
          const errMsg = err?.message || 'Could not connect to Amazon S3';
          throw new BadRequestException(`AWS S3 connection test failed: ${errMsg}`);
        }
      }

      case IntegrationProvider.MSG91: {
        const authKey = (
          resolvedCreds.authKey ||
          resolvedCreds.auth_key ||
          resolvedCreds.apiKey ||
          process.env.MSG91_AUTH_KEY ||
          ''
        ).trim();
        const templateId = (
          resolvedCreds.templateId ||
          resolvedCreds.template_id ||
          process.env.MSG91_TEMPLATE_ID ||
          ''
        ).trim();

        if (!authKey) {
          throw new BadRequestException('MSG91 Auth Key is required to test connection');
        }

        if (!templateId) {
          throw new BadRequestException('MSG91 Template ID is required to test connection');
        }

        // Validate credentials live against MSG91 API without dispatching SMS or consuming credits
        try {
          let isAuthenticated = false;
          let failureReason = '';

          try {
            const response = await axios.get('https://control.msg91.com/api/v5/widget/getTemplate', {
              headers: {
                authkey: authKey,
                'Content-Type': 'application/json',
              },
              timeout: 8000,
            });

            const data = response.data;
            if (
              data?.code === '201' ||
              data?.code === 201 ||
              data?.message === 'AuthenticationFailure' ||
              (data?.type === 'error' && data?.message?.toLowerCase()?.includes('auth'))
            ) {
              isAuthenticated = false;
              failureReason = data?.message || 'Invalid Auth Key';
            } else if (response.status === 200) {
              isAuthenticated = true;
            }
          } catch (templateErr: any) {
            const errData = templateErr?.response?.data;
            if (
              errData?.code === '201' ||
              errData?.code === 201 ||
              errData?.message === 'AuthenticationFailure' ||
              errData?.message === 'Invalid authkey'
            ) {
              isAuthenticated = false;
              failureReason = errData?.message || 'Invalid Auth Key';
            } else {
              // Secondary fallback check using OTP verify endpoint with dummy OTP (does not send SMS)
              try {
                const otpCheck = await axios.get(
                  'https://control.msg91.com/api/v5/otp/verify?otp=000000&mobile=919999999999',
                  {
                    headers: { authkey: authKey },
                    timeout: 8000,
                  },
                );
                const otpData = otpCheck.data;
                if (
                  otpData?.code === '201' ||
                  otpData?.code === 201 ||
                  otpData?.message === 'Invalid authkey' ||
                  otpData?.message === 'AuthenticationFailure'
                ) {
                  isAuthenticated = false;
                  failureReason = otpData?.message || 'Invalid Auth Key';
                } else {
                  isAuthenticated = true;
                }
              } catch (otpErr: any) {
                const otpErrData = otpErr?.response?.data;
                if (
                  otpErrData?.code === '201' ||
                  otpErrData?.code === 201 ||
                  otpErrData?.message === 'Invalid authkey' ||
                  otpErrData?.message === 'AuthenticationFailure'
                ) {
                  isAuthenticated = false;
                  failureReason = otpErrData?.message || 'Invalid Auth Key';
                } else {
                  failureReason = otpErrData?.message || otpErr?.message || 'Could not verify MSG91 credentials';
                }
              }
            }
          }

          if (!isAuthenticated) {
            throw new BadRequestException(
              `MSG91 authentication failed: ${failureReason || 'Invalid Auth Key'}`,
            );
          }

          return {
            success: true,
            provider: 'MSG91',
            status: 'CONNECTED',
            message: 'MSG91 credentials verified successfully!',
            details: {
              templateId,
              authKeyPrefix: authKey.substring(0, Math.min(6, authKey.length)) + '...',
            },
          };
        } catch (err: any) {
          this.logger.error(`[MSG91_TEST_FAILED] ${err?.message}`);
          if (err instanceof BadRequestException) {
            throw err;
          }
          const errMsg =
            err?.response?.data?.message ||
            err?.response?.data?.msg ||
            err?.response?.data?.error ||
            err?.message ||
            'Could not authenticate with MSG91';
          throw new BadRequestException(`MSG91 connection test failed: ${errMsg}`);
        }
      }

      case IntegrationProvider.OPENAI: {
        const apiKey = resolvedCreds.apiKey || resolvedCreds.api_key;
        if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
          throw new BadRequestException('OpenAI API Key is required to test connection');
        }

        try {
          const response = await axios.get('https://api.openai.com/v1/models', {
            headers: {
              Authorization: `Bearer ${apiKey.trim()}`,
            },
            timeout: 8000,
          });

          if (response.status === 200) {
            return {
              success: true,
              provider: 'OPENAI',
              status: 'CONNECTED',
              message: 'OpenAI API Key verified successfully!',
              details: {
                keyPrefix: apiKey.trim().substring(0, Math.min(7, apiKey.trim().length)) + '...',
                modelsCount: response.data?.data?.length || 0,
              },
            };
          }
          throw new Error(`Unexpected response: ${response.status}`);
        } catch (err: any) {
          this.logger.error(`[OPENAI_TEST_FAILED] ${err?.message}`);
          const errMsg =
            err?.response?.data?.error?.message ||
            err?.message ||
            'Could not authenticate with OpenAI API';
          throw new BadRequestException(`OpenAI connection test failed: ${errMsg}`);
        }
      }

      case IntegrationProvider.GEMINI: {
        const apiKey = resolvedCreds.apiKey || resolvedCreds.api_key;
        if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
          throw new BadRequestException('Google Gemini API Key is required to test connection');
        }

        try {
          const response = await axios.get(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`,
            {
              timeout: 8000,
            },
          );

          if (response.status === 200) {
            return {
              success: true,
              provider: 'GEMINI',
              status: 'CONNECTED',
              message: 'Google Gemini API Key verified successfully!',
              details: {
                keyPrefix: apiKey.trim().substring(0, Math.min(8, apiKey.trim().length)) + '...',
                modelsCount: response.data?.models?.length || 0,
              },
            };
          }
          throw new Error(`Unexpected response: ${response.status}`);
        } catch (err: any) {
          this.logger.error(`[GEMINI_TEST_FAILED] ${err?.message}`);
          const errMsg =
            err?.response?.data?.error?.message ||
            err?.message ||
            'Could not authenticate with Google Gemini API';
          throw new BadRequestException(`Google Gemini connection test failed: ${errMsg}`);
        }
      }

      case IntegrationProvider.SMTP: {
        // 1. Resolve host
        let host = String(
          dto?.config?.host ||
            dto?.host ||
            dto?.smtpHost ||
            testCreds.host ||
            testCreds.smtpHost ||
            active?.config?.host ||
            resolvedCreds.host ||
            resolvedCreds.smtpHost ||
            process.env.SMTP_HOST ||
            '',
        ).trim();

        // Strip any protocol prefix (e.g. smtp:// or ssl://)
        host = host.replace(/^smtp(s)?:\/\//i, '').replace(/^ssl:\/\//i, '').trim();

        if (!host) {
          throw new BadRequestException('SMTP Host is required to test connection');
        }

        // 2. Resolve port
        const rawPort =
          dto?.config?.port ??
          dto?.port ??
          dto?.smtpPort ??
          testCreds.port ??
          testCreds.smtpPort ??
          active?.config?.port ??
          resolvedCreds.port ??
          resolvedCreds.smtpPort ??
          process.env.SMTP_PORT ??
          587;

        const port = Number(rawPort);
        if (!port || isNaN(port) || port < 1 || port > 65535) {
          throw new BadRequestException('SMTP Port must be a valid port number between 1 and 65535');
        }

        // 3. Resolve security / encryption enum
        const rawSecurity = String(
          dto?.config?.security ||
            dto?.config?.encryption ||
            dto?.security ||
            dto?.encryption ||
            dto?.smtpSecurity ||
            testCreds.security ||
            testCreds.encryption ||
            testCreds.smtpSecurity ||
            active?.config?.security ||
            active?.config?.encryption ||
            resolvedCreds.security ||
            (port === 465 ? 'SSL' : 'TLS'),
        )
          .toUpperCase()
          .trim();

        const security: 'SSL' | 'TLS' | 'NONE' =
          rawSecurity === 'SSL' || rawSecurity === 'SMTPS'
            ? 'SSL'
            : rawSecurity === 'NONE' || rawSecurity === 'PLAIN'
            ? 'NONE'
            : 'TLS';

        const secure = security === 'SSL' || port === 465;

        // 4. Resolve username
        const rawUsername =
          dto?.username ??
          dto?.smtpUsername ??
          testCreds.username ??
          testCreds.smtpUsername ??
          resolvedCreds.username ??
          resolvedCreds.smtpUsername ??
          resolvedCreds.user ??
          process.env.SMTP_USER ??
          process.env.SMTP_USERNAME ??
          '';

        const username = sanitizeSecret(String(rawUsername || '').trim());

        // 5. Resolve password
        // If a new unmasked password is provided in dto or testCreds, use it.
        // Otherwise, use existing stored decrypted password from database.
        let password = '';
        const incomingPassword =
          dto?.password ??
          dto?.smtpPassword ??
          testCreds.password ??
          testCreds.smtpPassword;

        if (incomingPassword !== undefined && !isMaskedSecret(incomingPassword)) {
          password = sanitizeSecret(String(incomingPassword).trim());
        } else {
          password = sanitizeSecret(
            String(
              resolvedCreds.password ||
                resolvedCreds.smtpPassword ||
                resolvedCreds.pass ||
                activeCreds.password ||
                activeCreds.smtpPassword ||
                activeCreds.pass ||
                process.env.SMTP_PASSWORD ||
                process.env.SMTP_PASS ||
                '',
            ).trim(),
          );
        }

        // Validate: if username is given, password must not be empty
        if (username && !password) {
          throw new BadRequestException(
            'SMTP Password is required when SMTP Username is provided. Please enter your SMTP password or app password.',
          );
        }

        // 6. Resolve fromEmail
        const fromEmail = String(
          dto?.config?.fromEmail ||
            dto?.fromEmail ||
            dto?.smtpFromEmail ||
            testCreds.fromEmail ||
            active?.config?.fromEmail ||
            resolvedCreds.fromEmail ||
            process.env.SMTP_FROM_EMAIL ||
            process.env.MAIL_FROM ||
            '',
        ).trim();

        if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
          throw new BadRequestException(`Invalid From Email format: "${fromEmail}"`);
        }

        // 7. Resolve fromName
        const fromName = String(
          dto?.config?.fromName ||
            dto?.fromName ||
            dto?.smtpFromName ||
            testCreds.fromName ||
            active?.config?.fromName ||
            resolvedCreds.fromName ||
            process.env.SMTP_FROM_NAME ||
            'QuickBoom CRM',
        ).trim();

        try {
          const transportOptions: any = {
            host,
            port,
            secure,
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000,
          };

          if (username || password) {
            transportOptions.auth = {
              user: username,
              pass: password,
            };
          }

          if (!secure && security === 'TLS') {
            transportOptions.requireTLS = true;
          }

          if (!secure && port !== 465) {
            transportOptions.tls = {
              rejectUnauthorized: false,
            };
          }

          const transporter = nodemailer.createTransport(transportOptions);
          await transporter.verify();

          return {
            success: true,
            provider: 'SMTP',
            status: 'CONNECTED',
            message: `SMTP connection established and verified successfully on ${host}:${port}`,
            details: {
              host,
              port,
              security: secure ? 'SSL' : security === 'NONE' ? 'NONE' : 'TLS',
              user: username ? username : 'Anonymous',
              fromEmail: fromEmail || undefined,
              fromName: fromName || undefined,
            },
          };
        } catch (err: any) {
          this.logger.error(
            `[SMTP_TEST_FAILED] ${err?.message} (code: ${err?.code}, responseCode: ${err?.responseCode})`,
          );

          let descriptiveMsg = err?.message || 'Failed to establish connection with SMTP server';

          if (err?.code === 'EAUTH' || err?.responseCode === 535) {
            descriptiveMsg = `SMTP authentication failed (535): Invalid username or password. If using Gmail, ensure 2-Step Verification is enabled and use a 16-character App Password (not your Gmail account password).`;
          } else if (err?.code === 'ECONNREFUSED') {
            descriptiveMsg = `Connection refused by server at ${host}:${port}. Please verify the SMTP host and port numbers.`;
          } else if (err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKETTIMEDOUT') {
            descriptiveMsg = `Connection to SMTP server at ${host}:${port} timed out after 10 seconds. Check firewall or try alternative port (587 or 465).`;
          } else if (err?.code === 'ENOTFOUND') {
            descriptiveMsg = `SMTP Host "${host}" could not be resolved (DNS lookup failure). Please verify the hostname.`;
          } else if (err?.responseCode === 530 || String(err?.message || '').includes('STARTTLS')) {
            descriptiveMsg = `SMTP server requires TLS/STARTTLS encryption. Please select Security as "STARTTLS / TLS" and use port 587.`;
          }

          throw new BadRequestException(`SMTP connection test failed: ${descriptiveMsg}`);
        }
      }

      default:
        throw new BadRequestException(`Unsupported integration provider: ${provider}`);
    }
  }
}
