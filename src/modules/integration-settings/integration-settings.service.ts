import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
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
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
const Razorpay = require('razorpay');
import {
  initializeApp as initFirebaseAdminApp,
  deleteApp as deleteFirebaseAdminApp,
  cert as firebaseAdminCert,
  getApps as getFirebaseAdminApps,
} from 'firebase-admin/app';
import { getMessaging as getFirebaseAdminMessaging } from 'firebase-admin/messaging';
import { maskAccessToken, resolveCleanAccessToken } from '../whatsapp/whatsapp.util';

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
  FIREBASE = 'FIREBASE',
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
  if (norm === 'FIREBASE' || norm === 'FCM' || norm === 'FIREBASE_MESSAGING') return IntegrationProvider.FIREBASE;
  return norm;
}

export interface FirebaseDynamicConfig {
  projectId: string;
  clientEmail?: string;
  privateKey?: string;
  messagingSenderId?: string;
  apiKey?: string;
  appId?: string;
  authDomain?: string;
  storageBucket?: string;
  vapidKey?: string;
  isEnabled: boolean;
  isConfigured: boolean;
  source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE';
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
  // Webhook verify tokens must be readable by admins to paste into Meta Developer Dashboard
  if (normalized.includes('verifytoken') || normalized.includes('webhookverifytoken')) {
    return false;
  }
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

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private getFcmService(): any {
    try {
      if (!this.moduleRef) return null;
      // Lazy lookup by service token name to prevent circular import
      return this.moduleRef.get('FcmService', { strict: false });
    } catch {
      return null;
    }
  }

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
  async getIntegrationConfig(provider: string, options?: { forceFresh?: boolean }): Promise<any> {
    const normProvider = normalizeProvider(provider);

    // 1. Check in-memory cache unless fresh retrieval requested
    if (!options?.forceFresh) {
      const cached = this.cache.get(normProvider);
      if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
        return cached.config;
      }
    }

    // 2. Query PostgreSQL IntegrationSetting table
    let dbRecord: any = null;
    try {
      dbRecord = await this.prisma.integrationSetting.findUnique({
        where: { provider: normProvider },
      });
      if (!dbRecord && typeof this.prisma.integrationSetting?.findFirst === 'function') {
        dbRecord = await this.prisma.integrationSetting.findFirst({
          where: { provider: { equals: normProvider, mode: 'insensitive' } },
        });
      }
    } catch (dbErr: any) {
      this.logger.error(`[INTEGRATION_DB_ERROR] Failed querying DB for ${normProvider}: ${dbErr?.message}`);
    }

    let result: any = null;

    if (dbRecord && !dbRecord.deletedAt) {
      const rawCreds = (dbRecord.credentials as Record<string, any>) || {};
      const decryptedCreds: Record<string, any> = {};

      for (const [k, v] of Object.entries(rawCreds)) {
        if (typeof v === 'string' && v.startsWith('enc:v1:')) {
          const decrypted = decryptSecret(v);
          if (!decrypted && v) {
            this.logger.warn(
              `[INTEGRATION_DECRYPT_WARN] Failed to decrypt credential field "${k}" for provider "${normProvider}". ` +
              `This usually indicates ENCRYPTION_KEY or JWT_SECRET changed after the credential was stored.`,
            );
          }
          decryptedCreds[k] = decrypted;
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
        const businessAccountId = (
          process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
          process.env.WHATSAPP_WABA_ID ||
          ''
        ).trim();
        const verifyToken = (
          process.env.WHATSAPP_VERIFY_TOKEN ||
          process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
          process.env.META_VERIFY_TOKEN ||
          process.env.META_WEBHOOK_VERIFY_TOKEN ||
          '3f4e429cbf154b82ca819b5af5bc046110d18f336db6627a'
        ).trim();
        const appSecret = (
          process.env.WHATSAPP_APP_SECRET ||
          process.env.META_APP_SECRET ||
          ''
        ).trim();

        return {
          provider: IntegrationProvider.WHATSAPP,
          isEnabled: Boolean(apiKey && phoneNumberId),
          environment: 'LIVE',
          credentials: {
            apiKey,
            accessToken: apiKey,
            phoneNumberId,
            businessAccountId,
            verifyToken,
            appSecret,
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

      case IntegrationProvider.FIREBASE: {
        const projectId = (
          process.env.FIREBASE_PROJECT_ID ||
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          ''
        ).trim();
        const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
        const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
        const messagingSenderId = (
          process.env.FIREBASE_MESSAGING_SENDER_ID ||
          process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
          ''
        ).trim();
        const apiKey = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
        const appId = (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '').trim();
        const authDomain = (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '').trim();
        const storageBucket = (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim();
        const vapidKey = (process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || '').trim();

        const hasAny = Boolean(
          projectId || clientEmail || privateKey || messagingSenderId || apiKey || appId || authDomain || storageBucket || vapidKey,
        );
        const isConfigured = Boolean(
          projectId &&
            (clientEmail ||
              privateKey ||
              process.env.GOOGLE_APPLICATION_CREDENTIALS ||
              process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
              process.env.FIREBASE_SERVICE_ACCOUNT_PATH),
        );
        return {
          provider: IntegrationProvider.FIREBASE,
          isEnabled: isConfigured,
          environment: 'LIVE',
          credentials: {
            projectId: projectId || undefined,
            clientEmail: clientEmail || undefined,
            privateKey: privateKey || undefined,
            messagingSenderId: messagingSenderId || undefined,
            apiKey: apiKey || undefined,
            appId: appId || undefined,
            authDomain: authDomain || undefined,
            storageBucket: storageBucket || undefined,
            vapidKey: vapidKey || undefined,
          },
          config: {
            projectId: projectId || undefined,
            messagingSenderId: messagingSenderId || undefined,
            authDomain: authDomain || undefined,
            storageBucket: storageBucket || undefined,
          },
          source: hasAny ? 'ENV_FALLBACK' : 'NONE',
        };
      }

      case IntegrationProvider.SMTP: {
        const host = (process.env.SMTP_HOST || process.env.MAIL_HOST || '').trim();
        const rawPort = process.env.SMTP_PORT || process.env.MAIL_PORT || 587;
        const port = Number(rawPort) || 587;
        const username = (process.env.SMTP_USER || process.env.SMTP_USERNAME || process.env.MAIL_USER || '').trim();
        const password = (process.env.SMTP_PASSWORD || process.env.SMTP_PASS || process.env.MAIL_PASSWORD || '').trim();
        const fromEmail = (process.env.SMTP_FROM_EMAIL || process.env.MAIL_FROM || '').trim();
        const fromName = (process.env.SMTP_FROM_NAME || process.env.MAIL_FROM_NAME || 'QuickBoom CRM').trim();
        const security = (process.env.SMTP_SECURITY || (port === 465 ? 'SSL' : 'TLS')).trim().toUpperCase();

        const isConfigured = Boolean(host && fromEmail);
        return {
          provider: IntegrationProvider.SMTP,
          isEnabled: isConfigured,
          environment: 'LIVE',
          credentials: {
            username,
            password,
          },
          config: {
            host,
            port,
            security,
            fromEmail,
            fromName,
          },
          source: isConfigured ? 'ENV_FALLBACK' : 'NONE',
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
   * Typed helper for Firebase Cloud Messaging (FCM) dynamic configuration.
   * Priority: Database (Admin Settings) → ENV fallback.
   */
  async getFirebaseConfig(): Promise<FirebaseDynamicConfig> {
    const conf = await this.getIntegrationConfig(IntegrationProvider.FIREBASE);
    const creds = conf?.credentials || {};
    const cfg = conf?.config || {};

    const projectId = String(
      creds.projectId ||
        creds.project_id ||
        cfg.projectId ||
        process.env.FIREBASE_PROJECT_ID ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
        '',
    ).trim();
    const clientEmail = String(
      creds.clientEmail ||
        creds.client_email ||
        process.env.FIREBASE_CLIENT_EMAIL ||
        '',
    ).trim();
    const privateKey = String(
      creds.privateKey ||
        creds.private_key ||
        process.env.FIREBASE_PRIVATE_KEY ||
        '',
    ).trim();
    const messagingSenderId = String(
      creds.messagingSenderId ||
        creds.messaging_sender_id ||
        cfg.messagingSenderId ||
        process.env.FIREBASE_MESSAGING_SENDER_ID ||
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
        '',
    ).trim();
    const apiKey = String(
      creds.apiKey ||
        creds.api_key ||
        cfg.apiKey ||
        process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
        '',
    ).trim();
    const appId = String(
      creds.appId ||
        creds.app_id ||
        cfg.appId ||
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
        '',
    ).trim();
    const authDomain = String(
      creds.authDomain ||
        creds.auth_domain ||
        cfg.authDomain ||
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
        '',
    ).trim();
    const storageBucket = String(
      creds.storageBucket ||
        creds.storage_bucket ||
        cfg.storageBucket ||
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
        '',
    ).trim();
    const vapidKey = String(
      creds.vapidKey ||
        creds.vapid_key ||
        cfg.vapidKey ||
        process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ||
        '',
    ).trim();

    const hasAnyCreds = Boolean(
      projectId ||
        clientEmail ||
        privateKey ||
        messagingSenderId ||
        apiKey ||
        appId ||
        authDomain ||
        storageBucket ||
        vapidKey,
    );

    const isConfigured = Boolean(
      projectId &&
        (clientEmail ||
          privateKey ||
          process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
          process.env.FIREBASE_SERVICE_ACCOUNT_PATH),
    );
    const isEnabled = Boolean(conf?.isEnabled);
    let source: 'DATABASE' | 'ENV_FALLBACK' | 'NONE' = 'NONE';
    if (conf?.source === 'DATABASE' && hasAnyCreds) {
      source = 'DATABASE';
    } else if (hasAnyCreds) {
      source = 'ENV_FALLBACK';
    }

    return {
      projectId,
      clientEmail: clientEmail || undefined,
      privateKey: privateKey || undefined,
      messagingSenderId,
      apiKey: apiKey || undefined,
      appId: appId || undefined,
      authDomain,
      storageBucket,
      vapidKey: vapidKey || undefined,
      isEnabled,
      isConfigured,
      source,
    };
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
          isMaskedSecret(trimmed) ||
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

    const isEnabled = dto.isEnabled !== undefined ? Boolean(dto.isEnabled) : (existing?.isEnabled ?? false);
    const mergedConfig = {
      ...(existing?.config || {}),
      ...(dto.config || {}),
    };

    // Upsert into integration_settings table
    const updated = await this.prisma.integrationSetting.upsert({
      where: { provider: normProvider },
      create: {
        provider: normProvider,
        isEnabled,
        environment:
          dto.environment ||
          (normProvider === IntegrationProvider.RAZORPAY &&
          String(encryptedCreds.keyId || '').startsWith('rzp_live')
            ? 'LIVE'
            : 'TEST'),
        credentials: encryptedCreds,
        config: mergedConfig,
        updatedByUserId: adminUserId,
      },
      update: {
        isEnabled,
        environment:
          dto.environment ||
          (normProvider === IntegrationProvider.RAZORPAY &&
          String(encryptedCreds.keyId || '').startsWith('rzp_live')
            ? 'LIVE'
            : 'TEST'),
        credentials: encryptedCreds,
        config: mergedConfig,
        updatedByUserId: adminUserId,
        deletedAt: null,
      },
    });

    // 4. Invalidate in-memory cache immediately
    this.clearCache(normProvider);

    // 4b. If Firebase credentials were updated, reload FCM runtime instance
    if (normProvider === IntegrationProvider.FIREBASE) {
      const fcm = this.getFcmService();
      if (fcm) {
        try {
          const fbConf = await this.getFirebaseConfig();
          if (fbConf.isConfigured && fbConf.clientEmail && fbConf.privateKey) {
            await fcm.initializeWithCredentials({
              projectId: fbConf.projectId,
              clientEmail: fbConf.clientEmail,
              privateKey: fbConf.privateKey,
            });
          } else if (!fbConf.isEnabled) {
            await fcm.invalidateFirebaseInstance();
          }
        } catch (fcmErr: any) {
          this.logger.warn(`Failed to auto-reinitialize FCM on update: ${fcmErr?.message}`);
        }
      }
    }

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
   * Disconnects / removes an integration securely.
   * Clears credentials from DB, resets cache, and invalidates any runtime instances.
   */
  async disconnectIntegration(provider: string, adminUserId?: number) {
    const normProvider = normalizeProvider(provider);

    await this.prisma.integrationSetting.deleteMany({
      where: { provider: normProvider },
    });

    this.clearCache(normProvider);

    if (normProvider === IntegrationProvider.FIREBASE) {
      const fcm = this.getFcmService();
      if (fcm && typeof fcm.invalidateFirebaseInstance === 'function') {
        await fcm.invalidateFirebaseInstance();
      }
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'DISCONNECT_INTEGRATION',
          module: 'INTEGRATIONS',
          userId: adminUserId,
          details: {
            provider: normProvider,
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch {
      // ignore
    }

    this.logger.log(`[INTEGRATION_DISCONNECTED] Provider=${normProvider} by adminUserId=${adminUserId}`);

    return {
      success: true,
      provider: normProvider,
      status: 'NOT CONFIGURED',
      connected: false,
      isEnabled: false,
      message: `${normProvider} integration disconnected successfully.`,
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
      IntegrationProvider.FIREBASE,
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

    if (norm === IntegrationProvider.WHATSAPP) {
      const creds = conf.credentials || {};
      const hasToken = Boolean(creds.apiKey || creds.accessToken);
      const hasAppSecret = Boolean(creds.appSecret);
      if (!maskedCreds.verifyToken) {
        maskedCreds.verifyToken = '3f4e429cbf154b82ca819b5af5bc046110d18f336db6627a';
      }
      return {
        provider: conf.provider,
        isEnabled: conf.isEnabled,
        environment: conf.environment,
        credentials: {
          ...maskedCreds,
          phoneNumberId: creds.phoneNumberId || creds.phone_number_id || '',
          businessAccountId: creds.businessAccountId || creds.business_account_id || creds.wabaId || '',
          apiVersion: creds.apiVersion || 'v25.0',
          verifyToken: maskedCreds.verifyToken,
          appId: creds.appId || '',
          hasAccessToken: hasToken,
          hasAppSecret,
          isTokenSaved: hasToken,
          isAppSecretSaved: hasAppSecret,
        },
        config: {
          ...(conf.config || {}),
          webhookUrl: 'https://api.qbapp.online/api/v1/webhooks/whatsapp',
        },
        source: conf.source,
        configured: Boolean(conf.isEnabled || (Object.keys(conf.credentials || {}).length > 0 && conf.source === 'DATABASE')),
        updatedAt: conf.updatedAt || null,
      };
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
  async testIntegration(provider: string, dto?: TestIntegrationDto, adminUserId?: number) {
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
        const rawApiKey = resolvedCreds.apiKey || resolvedCreds.accessToken || resolvedCreds.access_token || '';
        const { token: apiKey, error: tokenErr } = resolveCleanAccessToken(rawApiKey);
        const phoneNumberId = (resolvedCreds.phoneNumberId || resolvedCreds.phone_number_id || '').trim();
        const apiVersion = (resolvedCreds.apiVersion || 'v25.0').trim();
        const testPhone = (testCreds.testPhone || testCreds.recipientPhone || testCreds.to || (dto?.credentials as any)?.testPhone || '').trim();

        if (tokenErr === 'TOKEN_DECRYPT_FAILED') {
          this.logger.error(
            `[WHATSAPP DEBUG]\n` +
            `tenant/company ID: ${adminUserId || 'SYSTEM_ADMIN'}\n` +
            `employee/user ID: ${adminUserId || 'SYSTEM_ADMIN'}\n` +
            `integration ID: WHATSAPP\n` +
            `Phone Number ID: ${phoneNumberId}\n` +
            `token decryption failed: encrypted token could not be decrypted (ENCRYPTION_KEY / JWT_SECRET mismatch)\n` +
            `token: MISSING`,
          );
          throw new BadRequestException(
            'WhatsApp configuration error: token decryption failed. Please re-save the WhatsApp token in Admin → Settings → Integrations → WhatsApp.',
          );
        }

        if (!apiKey || !phoneNumberId) {
          throw new BadRequestException('WhatsApp Access Token and Phone Number ID are required to test connection');
        }

        const graphUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
        try {
          // 1. Verify Phone Number ID & credentials against Meta Cloud API endpoint
          const response = await axios.get(
            graphUrl,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
              params: {
                fields: 'verified_name,code_verification_status,display_phone_number,quality_rating',
              },
              timeout: 10000,
            },
          );

          this.logger.log(
            `[WHATSAPP DEBUG] Test connection verified successfully with Meta API for Phone Number ID: ${phoneNumberId} (verified name: ${response.data?.verified_name}). Token: ${maskAccessToken(apiKey)}`,
          );

          let testMessageResult: any = null;
          // 2. If testPhone provided, send a real test text message
          if (testPhone) {
            const rawPhone = testPhone.replace(/\D/g, '');
            const normalizedPhone = rawPhone.length === 10 && /^[6-9]\d{9}$/.test(rawPhone) ? `91${rawPhone}` : rawPhone;
            const messagePayload = {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: normalizedPhone,
              type: 'text',
              text: {
                preview_url: false,
                body: testCreds.message || 'What can I help you with today?',
              },
            };

            const sendRes = await axios.post(
              `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
              messagePayload,
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                timeout: 10000,
              },
            );

            testMessageResult = {
              recipient: normalizedPhone,
              wamid: sendRes.data?.messages?.[0]?.id,
              status: 'SENT',
            };
          }

          return {
            success: true,
            provider: 'WHATSAPP',
            status: 'CONNECTED',
            message: testMessageResult
              ? `WhatsApp configuration verified & test message sent to ${testPhone} (wamid: ${testMessageResult.wamid})!`
              : 'WhatsApp Business API configuration verified with Meta!',
            details: {
              phoneNumberId,
              apiVersion,
              verifiedName: response.data?.verified_name,
              displayPhoneNumber: response.data?.display_phone_number,
              qualityRating: response.data?.quality_rating,
              codeVerificationStatus: response.data?.code_verification_status,
              testMessage: testMessageResult,
            },
          };
        } catch (err: any) {
          const fbError = err?.response?.data?.error;
          const errorCode = fbError?.code || err?.code || 'UNKNOWN';
          const errorType = fbError?.type;
          const errorSubcode = fbError?.error_subcode;
          const fbtraceId = fbError?.fbtrace_id;
          const rawErrMsg = fbError?.message || err?.message || 'Verification failed';
          const httpStatus = err?.response?.status as number | undefined;

          this.logger.error(
            `[WHATSAPP DEBUG]\n` +
            `tenant/company ID: ${adminUserId || 'SYSTEM_ADMIN'}\n` +
            `employee/user ID: ${adminUserId || 'SYSTEM_ADMIN'}\n` +
            `integration ID: WHATSAPP\n` +
            `Phone Number ID: ${phoneNumberId}\n` +
            `Graph API URL: ${graphUrl}\n` +
            `HTTP method: GET\n` +
            `HTTP status: ${httpStatus || 'N/A'}\n` +
            `Meta error code: ${errorCode}\n` +
            `Meta error type: ${errorType || 'N/A'}\n` +
            `Meta error message: ${rawErrMsg}\n` +
            `Meta error subcode: ${errorSubcode || 'N/A'}\n` +
            `Meta error fbtrace_id if available: ${fbtraceId || 'N/A'}\n` +
            `token: ${maskAccessToken(apiKey)}`,
          );

          if (String(errorCode) === '190' || errorType === 'OAuthException' || httpStatus === 401) {
            throw new BadRequestException(
              `WhatsApp Access Token is invalid or expired (Meta Error 190): ${rawErrMsg}. Please verify and update the Meta Access Token in Settings → Integrations → WhatsApp.`,
            );
          }

          if (httpStatus === 403) {
            throw new BadRequestException(
              `WhatsApp access is not permitted for this account (HTTP 403): ${rawErrMsg}. Check your Meta App permissions.`,
            );
          }

          if (httpStatus === 404) {
            throw new BadRequestException(
              `WhatsApp phone number configuration is invalid (HTTP 404): Phone Number ID was not found on Meta. Verify the Phone Number ID in Settings → Integrations → WhatsApp.`,
            );
          }

          throw new BadRequestException(
            `WhatsApp connection test failed (Code ${errorCode}): ${rawErrMsg}`,
          );
        }
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

      case IntegrationProvider.FIREBASE: {
        let rawPrivateKey = String(
          dto?.credentials?.privateKey || dto?.credentials?.private_key || '',
        ).trim();
        if (!rawPrivateKey || isMaskedSecret(rawPrivateKey)) {
          rawPrivateKey = String(
            resolvedCreds.privateKey ||
              resolvedCreds.private_key ||
              process.env.FIREBASE_PRIVATE_KEY ||
              '',
          ).trim();
        }

        let clientEmail = String(
          dto?.credentials?.clientEmail || dto?.credentials?.client_email || '',
        ).trim();
        if (!clientEmail || isMaskedSecret(clientEmail)) {
          clientEmail = String(
            resolvedCreds.clientEmail ||
              resolvedCreds.client_email ||
              process.env.FIREBASE_CLIENT_EMAIL ||
              '',
          ).trim();
        }

        const projectId = String(
          dto?.credentials?.projectId ||
            dto?.credentials?.project_id ||
            resolvedCreds.projectId ||
            resolvedCreds.project_id ||
            process.env.FIREBASE_PROJECT_ID ||
            process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
            '',
        ).trim();

        const hasEnvCreds = Boolean(
          process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
          process.env.FIREBASE_SERVICE_ACCOUNT_PATH
        );
        const hasExplicitKey = Boolean(rawPrivateKey && !isMaskedSecret(rawPrivateKey));

        this.logger.log(
          `[FIREBASE_TEST_DEBUG] Provider: FIREBASE | ProjectId: ${projectId || 'NONE'} | ClientEmail: ${clientEmail || 'NONE'} | HasKey: ${hasExplicitKey} | AppsCount: ${getFirebaseAdminApps().length}`,
        );

        if (!projectId || (!hasEnvCreds && (!clientEmail || !hasExplicitKey))) {
          return {
            connected: false,
            success: false,
            provider: 'FIREBASE',
            status: 'NOT CONFIGURED',
            projectId: projectId || undefined,
            message: 'FCM is not fully configured. Please add the required Firebase credentials to test the connection.',
          };
        }

        try {
          const now = new Date();

          // 1. If explicit credentials provided or resolved from database, test with dedicated app instance
          if (clientEmail && hasExplicitKey) {
            const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
            const testAppName = `test-firebase-${Date.now()}`;
            const testApp = initFirebaseAdminApp(
              {
                credential: firebaseAdminCert({
                  projectId,
                  clientEmail,
                  privateKey,
                }),
              },
              testAppName,
            );
            getFirebaseAdminMessaging(testApp);
            await deleteFirebaseAdminApp(testApp);

            // Also re-initialize the main FCM service instance if available
            const fcm = this.getFcmService();
            if (fcm) {
              await fcm.initializeWithCredentials({
                projectId,
                clientEmail,
                privateKey,
              });
            }
          } else {
            // Check if default initialized Firebase App exists on server
            const apps = getFirebaseAdminApps();
            if (apps.length > 0) {
              getFirebaseAdminMessaging(apps[0]);
            } else if (!hasEnvCreds) {
              return {
                connected: false,
                success: false,
                provider: 'FIREBASE',
                status: 'NOT CONFIGURED',
                projectId: projectId || undefined,
                message: 'FCM is not fully configured. Please add the required Firebase credentials to test the connection.',
              };
            }
          }

          await this.prisma.integrationSetting.updateMany({
            where: { provider: IntegrationProvider.FIREBASE },
            data: {
              config: {
                lastTestedAt: now.toISOString(),
                lastTestResult: 'SUCCESS',
                projectId,
              },
            },
          });

          return {
            connected: true,
            success: true,
            provider: 'FIREBASE',
            status: 'CONNECTED',
            projectId,
            lastTestedAt: now.toISOString(),
            lastTestResult: 'SUCCESS',
            message: 'Connection check successful',
          };
        } catch (err: any) {
          this.logger.error(`[FIREBASE_TEST_FAILED] ${err?.message}`);
          const errMsg = err?.message || 'Could not authenticate with Firebase Admin SDK';

          try {
            await this.prisma.integrationSetting.updateMany({
              where: { provider: IntegrationProvider.FIREBASE },
              data: {
                config: {
                  lastTestedAt: new Date().toISOString(),
                  lastTestResult: 'FAILED',
                  lastTestError: errMsg,
                  projectId,
                },
              },
            });
          } catch (_) {}

          return {
            connected: false,
            success: false,
            provider: 'FIREBASE',
            status: 'CONNECTION ERROR',
            projectId,
            lastTestedAt: new Date().toISOString(),
            lastTestResult: 'FAILED',
            message: `Connection failed: ${errMsg}`,
          };
        }
      }

      default:
        throw new BadRequestException(`Unsupported integration provider: ${provider}`);
    }
  }

  /**
   * Auto-subscribes the WhatsApp Business Account to webhook events using Meta Cloud API.
   * Calls: POST https://graph.facebook.com/{apiVersion}/{businessAccountId}/subscribed_apps
   */
  async subscribeWhatsappWebhook(credentials?: any) {
    const conf = await this.getIntegrationConfig(IntegrationProvider.WHATSAPP);
    const creds = { ...(conf?.credentials || {}), ...(credentials || {}) };
    const accessToken = (creds.apiKey || creds.accessToken || '').trim();
    const businessAccountId = (creds.businessAccountId || creds.wabaId || '').trim();
    const apiVersion = (creds.apiVersion || 'v25.0').trim();

    if (!accessToken || !businessAccountId) {
      throw new BadRequestException('Meta Access Token and WhatsApp Business Account ID are required to subscribe webhook');
    }

    try {
      const response = await axios.post(
        `https://graph.facebook.com/${apiVersion}/${businessAccountId}/subscribed_apps`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 10000,
        },
      );

      return {
        success: true,
        message: 'Successfully subscribed to WhatsApp webhook messages with Meta!',
        details: response.data,
      };
    } catch (err: any) {
      const fbError = err?.response?.data?.error;
      const msg = fbError?.message || err?.message || 'Failed to auto-subscribe webhook with Meta';
      this.logger.error(`[WHATSAPP_SUBSCRIBE_FAILED] ${msg}`);
      throw new BadRequestException(`Meta webhook subscription failed: ${msg}`);
    }
  }

  /**
   * Dispatches an FCM test push notification to targeted recipients from Admin Panel.
   */
  async sendFirebaseTestNotification(
    dto: {
      recipientType?: string;
      recipientId?: string | number;
      deviceToken?: string;
      title?: string;
      message?: string;
      body?: string;
    },
    currentAdminId?: number,
  ) {
    const title = (dto.title || 'QuikBoom Test Notification').trim();
    const body = (dto.message || dto.body || 'Firebase Cloud Messaging is working correctly.').trim();
    const recipientType = (dto.recipientType || (currentAdminId ? 'CURRENT_ADMIN' : 'ALL_ADMINS')).toUpperCase();

    this.logger.log(
      `[FCM_TEST_NOTIFICATION] Request from adminId=${currentAdminId || 'NONE'}, recipientType=${recipientType}, title="${title}"`,
    );

    // 1. Verify that Firebase integration is configured
    const conf = await this.getFirebaseConfig();
    const appsInitial = getFirebaseAdminApps();
    const hasEnvCreds = Boolean(
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    );
    const hasEnoughConfig = Boolean(
      conf.projectId &&
      (conf.clientEmail || hasEnvCreds) &&
      (conf.privateKey || hasEnvCreds)
    );

    if (!hasEnoughConfig && appsInitial.length === 0) {
      return {
        success: false,
        connected: false,
        deviceCount: 0,
        message: 'FCM is not configured. Please configure Firebase credentials before sending a test notification.',
      };
    }

    if (!conf.isEnabled) {
      return {
        success: false,
        connected: false,
        deviceCount: 0,
        message:
          'Firebase Cloud Messaging integration is currently disabled. Please enable it in Settings -> Integrations.',
      };
    }

    // 2. Ensure Firebase Admin SDK is ready
    let apps = getFirebaseAdminApps();
    if (apps.length === 0 && conf.clientEmail && conf.privateKey) {
      const fcm = this.getFcmService();
      if (fcm) {
        await fcm.initializeWithCredentials({
          projectId: conf.projectId,
          clientEmail: conf.clientEmail,
          privateKey: conf.privateKey,
        });
        apps = getFirebaseAdminApps();
      }
    }

    if (apps.length === 0 && !hasEnvCreds) {
      return {
        success: false,
        connected: false,
        deviceCount: 0,
        message: 'FCM is not configured. Please configure Firebase credentials before sending a test notification.',
      };
    }

    let tokens: string[] = [];
    let targetUserId: number | null = currentAdminId || null;
    let targetCustomerId: number | null = null;

    if (dto.deviceToken && dto.deviceToken.trim()) {
      tokens = [dto.deviceToken.trim()];
    } else if (recipientType === 'CURRENT_ADMIN' && currentAdminId) {
      const adminTokens = await this.prisma.userDeviceToken.findMany({
        where: {
          userId: currentAdminId,
          isActive: true,
        },
        select: { token: true },
      });
      tokens = Array.from(new Set(adminTokens.map((t) => t.token.trim()).filter(Boolean)));
      if (tokens.length === 0) {
        return {
          success: false,
          connected: true,
          deviceCount: 0,
          message: 'No FCM device token registered for this account.',
        };
      }
    } else if (recipientType === 'ALL_ADMINS') {
      // First check if current admin has active tokens
      if (currentAdminId) {
        const myTokens = await this.prisma.userDeviceToken.findMany({
          where: { userId: currentAdminId, isActive: true },
          select: { token: true },
        });
        if (myTokens.length > 0) {
          tokens = Array.from(new Set(myTokens.map((t) => t.token.trim()).filter(Boolean)));
        }
      }

      if (tokens.length === 0) {
        const adminUsers = await this.prisma.user.findMany({
          where: {
            isActive: true,
            deletedAt: null,
            OR: [
              { customerId: null },
              {
                userRoles: {
                  some: {
                    role: {
                      name: { in: ['SUPER_ADMIN', 'ADMIN', 'Super Admin', 'Admin'] },
                    },
                  },
                },
              },
            ],
          },
          select: { id: true },
        });
        const adminUserIds = adminUsers.map((u) => u.id);
        targetUserId = adminUserIds[0] || currentAdminId || null;

        const deviceTokens = await this.prisma.userDeviceToken.findMany({
          where: {
            isActive: true,
            userId: { in: adminUserIds },
          },
          select: { token: true },
        });
        tokens = Array.from(new Set(deviceTokens.map((t) => t.token.trim()).filter(Boolean)));
      }
    } else if (recipientType === 'CUSTOMER' && dto.recipientId) {
      targetCustomerId = Number(dto.recipientId);
      const customerUsers = await this.prisma.user.findMany({
        where: {
          customerId: targetCustomerId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      const userIds = customerUsers.map((u) => u.id);
      targetUserId = userIds[0] || null;

      const deviceTokens = await this.prisma.userDeviceToken.findMany({
        where: {
          isActive: true,
          userId: { in: userIds },
        },
        select: { token: true },
      });
      tokens = Array.from(new Set(deviceTokens.map((t) => t.token.trim()).filter(Boolean)));
    } else if (recipientType === 'EMPLOYEE' && dto.recipientId) {
      targetUserId = Number(dto.recipientId);
      const deviceTokens = await this.prisma.userDeviceToken.findMany({
        where: {
          isActive: true,
          userId: targetUserId,
        },
        select: { token: true },
      });
      tokens = Array.from(new Set(deviceTokens.map((t) => t.token.trim()).filter(Boolean)));
    } else {
      // Default: check current admin, then all active tokens
      if (currentAdminId) {
        const myTokens = await this.prisma.userDeviceToken.findMany({
          where: { userId: currentAdminId, isActive: true },
          select: { token: true },
        });
        if (myTokens.length > 0) {
          tokens = Array.from(new Set(myTokens.map((t) => t.token.trim()).filter(Boolean)));
        }
      }

      if (tokens.length === 0) {
        const deviceTokens = await this.prisma.userDeviceToken.findMany({
          where: { isActive: true },
          take: 50,
          select: { token: true, userId: true },
        });
        tokens = Array.from(new Set(deviceTokens.map((t) => t.token.trim()).filter(Boolean)));
        targetUserId = deviceTokens[0]?.userId || currentAdminId || null;
      }
    }

    if (tokens.length === 0) {
      return {
        success: false,
        connected: true,
        deviceCount: 0,
        message: 'No FCM device token registered for this account.',
      };
    }

    // 3. Create in-app notification record
    try {
      if (!targetCustomerId) {
        const firstCust = await this.prisma.customer.findFirst({ select: { id: true } });
        targetCustomerId = firstCust?.id || 1;
      }
      await this.prisma.notification.create({
        data: {
          customerId: targetCustomerId,
          userId: targetUserId,
          title,
          message: body,
          type: 'TEST_NOTIFICATION',
        },
      });
    } catch (_) {}

    // 4. Dispatch FCM Multicast
    const messaging = getFirebaseAdminMessaging(apps[0]);
    const multicastMessage = {
      tokens,
      notification: {
        title,
        body,
      },
      data: {
        type: 'TEST_NOTIFICATION',
        source: 'ADMIN_PANEL',
        route: '/notifications',
      },
      android: {
        priority: 'high' as const,
        notification: {
          sound: 'default',
          channelId: 'high_importance_channel',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          icon: 'ic_notification',
          color: '#23C45E',
          defaultSound: true,
          defaultVibrateTimings: true,
          visibility: 'public' as const,
        },
      },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title,
          body,
          icon: '/logo.png',
          requireInteraction: true,
        },
        fcmOptions: { link: '/notifications' },
      },
    };

    try {
      const response = await messaging.sendEachForMulticast(multicastMessage);
      this.logger.log(
        `[FCM] Test notification sent to ${tokens.length} token(s). Success: ${response.successCount}, Failed: ${response.failureCount}`,
      );

      // Clean invalid tokens automatically
      const invalidTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const code = resp.error.code;
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });
      if (invalidTokens.length > 0) {
        await this.prisma.userDeviceToken.updateMany({
          where: { token: { in: invalidTokens } },
          data: { isActive: false },
        });
        this.logger.log(`[FCM] Deactivated ${invalidTokens.length} stale/invalid tokens during test.`);
      }

      return {
        success: true,
        connected: true,
        deviceCount: tokens.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
        message: 'Test notification sent successfully!',
      };
    } catch (err: any) {
      this.logger.error(`[FCM] Test notification failed: ${err?.message}`);
      return {
        success: false,
        connected: true,
        deviceCount: tokens.length,
        message: `Failed to send test notification: ${err?.message || 'Firebase dispatch error'}`,
      };
    }
  }
}
