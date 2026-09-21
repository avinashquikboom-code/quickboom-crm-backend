import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as crypto from 'crypto';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  /** Machine-readable error code (use this for programmatic checks, not reason) */
  errorCode?: string;
  /** Human-readable safe error details */
  details?: string;
  skipped?: boolean;
  skippedDuplicate?: boolean;
  /** Machine-readable reason code (same as errorCode, kept for backward compat) */
  reason?: string;
  /** Raw upstream HTTP status (for logging only) */
  error?: string;
}

/**
 * Typed error codes for WhatsApp send failures.
 * Use these for programmatic differentiation — never put human messages here.
 */
export const WHATSAPP_ERROR_CODES = {
  AUTH_ERROR: 'WHATSAPP_AUTH_ERROR',             // 401 / OAuthException / code 190
  PERMISSION_ERROR: 'WHATSAPP_PERMISSION_ERROR',  // 403
  INVALID_REQUEST: 'WHATSAPP_INVALID_REQUEST',    // 400 (bad payload, template params)
  TEMPLATE_ERROR: 'WHATSAPP_TEMPLATE_ERROR',      // 400 / code 132001 (template not found/inactive)
  PHONE_NUMBER_ERROR: 'WHATSAPP_PHONE_NUMBER_ERROR', // 404 (wrong Phone Number ID)
  RATE_LIMIT: 'WHATSAPP_RATE_LIMIT',              // 429
  PROVIDER_ERROR: 'WHATSAPP_PROVIDER_ERROR',      // 5xx
  NETWORK_ERROR: 'WHATSAPP_NETWORK_ERROR',        // timeout / ECONNREFUSED
  CREDENTIALS_MISSING: 'CREDENTIALS_MISSING',
  CREDENTIALS_DECRYPT_FAILURE: 'WHATSAPP_DECRYPT_FAILURE', // ENCRYPTION_KEY rotated
  INTEGRATION_DISABLED: 'INTEGRATION_DISABLED',
  NO_PHONE: 'NO_PHONE',
  INVALID_PHONE: 'INVALID_PHONE',
  NO_TEMPLATE_OR_MESSAGE: 'NO_TEMPLATE_OR_MESSAGE',
} as const;

/** Maps Meta API HTTP status + error code to a typed WhatsApp error code. */
function classifyWhatsAppError(httpStatus?: number, metaCode?: string | number, metaType?: string): string {
  if (metaType === 'OAuthException' || String(metaCode) === '190') {
    return WHATSAPP_ERROR_CODES.AUTH_ERROR;
  }
  // Template not found / not approved
  if (metaCode === 132001 || String(metaCode) === '132001') {
    return WHATSAPP_ERROR_CODES.TEMPLATE_ERROR;
  }
  if (httpStatus === 401) return WHATSAPP_ERROR_CODES.AUTH_ERROR;
  if (httpStatus === 403) return WHATSAPP_ERROR_CODES.PERMISSION_ERROR;
  if (httpStatus === 404) return WHATSAPP_ERROR_CODES.PHONE_NUMBER_ERROR;
  if (httpStatus === 429) return WHATSAPP_ERROR_CODES.RATE_LIMIT;
  if (httpStatus && httpStatus >= 500) return WHATSAPP_ERROR_CODES.PROVIDER_ERROR;
  if (httpStatus === 400) return WHATSAPP_ERROR_CODES.INVALID_REQUEST;
  return WHATSAPP_ERROR_CODES.INVALID_REQUEST;
}

/** Returns a safe user-facing message for a given error code. */
export function friendlyWhatsAppErrorMessage(errorCode: string, metaMessage?: string): string {
  switch (errorCode) {
    case WHATSAPP_ERROR_CODES.AUTH_ERROR:
      return 'WhatsApp authentication failed. Please verify the WhatsApp Access Token in Settings → Integrations → WhatsApp.';
    case WHATSAPP_ERROR_CODES.PERMISSION_ERROR:
      return 'WhatsApp access denied. The token lacks the required permissions (e.g. whatsapp_business_messaging). Check your Meta App permissions.';
    case WHATSAPP_ERROR_CODES.TEMPLATE_ERROR:
      return 'WhatsApp template not found or not approved on Meta. Check your template status in Meta Business Manager.';
    case WHATSAPP_ERROR_CODES.PHONE_NUMBER_ERROR:
      return 'WhatsApp Phone Number ID is invalid or not linked to your Business Account. Verify the Phone Number ID in Settings → Integrations → WhatsApp.';
    case WHATSAPP_ERROR_CODES.RATE_LIMIT:
      return 'WhatsApp rate limit reached. Please try again in a few minutes.';
    case WHATSAPP_ERROR_CODES.PROVIDER_ERROR:
      return 'Meta WhatsApp API is temporarily unavailable. Please try again.';
    case WHATSAPP_ERROR_CODES.NETWORK_ERROR:
      return 'Could not reach Meta WhatsApp API. Check your server network connectivity.';
    case WHATSAPP_ERROR_CODES.CREDENTIALS_MISSING:
      return 'WhatsApp is not configured. Please add your Access Token and Phone Number ID in Settings → Integrations → WhatsApp.';
    case WHATSAPP_ERROR_CODES.CREDENTIALS_DECRYPT_FAILURE:
      return 'WhatsApp credentials could not be loaded (encryption key mismatch). Please re-save your WhatsApp token in Settings → Integrations → WhatsApp.';
    case WHATSAPP_ERROR_CODES.INTEGRATION_DISABLED:
      return 'WhatsApp integration is disabled in Admin Settings.';
    default:
      return metaMessage || 'WhatsApp message could not be delivered. Please try again.';
  }
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSettingsService: IntegrationSettingsService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private getNotificationService(): any {
    try {
      if (!this.moduleRef) return null;
      return this.moduleRef.get('NotificationService', { strict: false });
    } catch {
      return null;
    }
  }

  /**
   * Normalizes a phone number for WhatsApp Business API (E.164 digits without leading '+').
   * Examples:
   * - "+919876543210" -> "919876543210"
   * - "9876543210" (Indian 10-digit) -> "919876543210"
   * - "09876543210" -> "919876543210"
   * - "919876543210" -> "919876543210"
   * - "+1 (415) 555-2671" -> "14155552671"
   * Returns null if input is empty or invalid.
   */
  normalizePhoneNumber(phone?: string | null): string | null {
    if (!phone || typeof phone !== 'string') return null;

    // Strip whitespace, plus, dashes, parentheses, dots
    const cleaned = phone.replace(/\D/g, '');
    if (!cleaned) return null;

    // Handle leading 0 (e.g. 09876543210 -> 9876543210)
    let digits = cleaned;
    if (digits.startsWith('0') && digits.length === 11) {
      digits = digits.substring(1);
    }

    // Standard 10-digit Indian mobile number (starts with 6, 7, 8, or 9)
    if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
      return `91${digits}`;
    }

    // 12-digit Indian mobile number starting with 91
    if (digits.length === 12 && digits.startsWith('91') && /^91[6-9]\d{9}$/.test(digits)) {
      return digits;
    }

    // General international numbers: between 10 and 15 digits (ITU-T E.164)
    if (digits.length >= 10 && digits.length <= 15) {
      return digits;
    }

    return null;
  }

  /**
   * Masks a phone number for safe diagnostics/logging without exposing sensitive PII.
   */
  maskPhone(phone?: string | null): string {
    if (!phone) return 'none';
    const clean = phone.replace(/\D/g, '');
    if (clean.length <= 4) return '****';
    return `****${clean.slice(-4)}`;
  }

  /**
   * Dispatches a WhatsApp template message using existing Meta Business Cloud API configuration.
   * If template fails with code 132001 (Template not found) and fallbackText is provided,
   * gracefully falls back to sending a text message.
   */
  /**
   * Dispatches a WhatsApp template message using existing Meta Business Cloud API configuration.
   * If template fails with code 132001 (Template not found) and fallbackText is provided,
   * gracefully falls back to sending a text message.
   */
  async sendTemplate(
    to: string,
    templateName: string,
    parameters: Array<{ type: 'text'; text: string }> = [],
    languageCode = 'en_US',
    fallbackText?: string,
    stageName?: string,
  ): Promise<WhatsAppSendResult> {
    const normalizedTo = this.normalizePhoneNumber(to);
    if (!normalizedTo) {
      this.logger.warn(`[WHATSAPP] No customer phone number found: invalid or empty (${this.maskPhone(to)})`);
      return {
        success: false,
        error: 'INVALID_PHONE',
        errorCode: WHATSAPP_ERROR_CODES.NO_PHONE,
        reason: WHATSAPP_ERROR_CODES.NO_PHONE,
        details: friendlyWhatsAppErrorMessage(WHATSAPP_ERROR_CODES.NO_PHONE),
      };
    }

    // 1. Retrieve existing WhatsApp credentials from Integration Settings
    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP');
    if (!config?.isEnabled) {
      this.logger.log(`[WHATSAPP] WhatsApp integration is disabled in Admin Panel. Skipping message for ${this.maskPhone(normalizedTo)}.`);
      this.logger.log(`[LeadNotification] 7. Provider request started (Skipped: Integration disabled)`);
      this.logger.log(`[LeadNotification] 8. Provider response received\n[LeadNotification]\nWhatsApp provider response:\nHTTP: DISABLED\nError: WhatsApp integration is disabled in Admin Settings`);
      return {
        success: false,
        skipped: true,
        errorCode: WHATSAPP_ERROR_CODES.INTEGRATION_DISABLED,
        reason: WHATSAPP_ERROR_CODES.INTEGRATION_DISABLED,
        details: friendlyWhatsAppErrorMessage(WHATSAPP_ERROR_CODES.INTEGRATION_DISABLED),
      };
    }

    const creds = config.credentials || {};
    const apiKey = (creds.apiKey || creds.accessToken || creds.access_token || '').trim();
    const phoneNumberId = (creds.phoneNumberId || creds.phone_number_id || '').trim();
    const apiVersion = (creds.apiVersion || 'v25.0').trim();

    // Detect silent decryption failure: DATABASE source but empty token means ENCRYPTION_KEY mismatch
    if (!apiKey && config.source === 'DATABASE') {
      this.logger.error(
        '[WHATSAPP_CREDS_DECRYPT_FAILURE] WhatsApp Access Token is stored in database but decrypted to empty string. ' +
        'ENCRYPTION_KEY or JWT_SECRET likely changed since the token was saved. ' +
        'Action: Re-save the WhatsApp token in Admin → Settings → Integrations → WhatsApp.',
      );
      return {
        success: false,
        skipped: false,
        errorCode: WHATSAPP_ERROR_CODES.CREDENTIALS_DECRYPT_FAILURE,
        reason: WHATSAPP_ERROR_CODES.CREDENTIALS_DECRYPT_FAILURE,
        details: friendlyWhatsAppErrorMessage(WHATSAPP_ERROR_CODES.CREDENTIALS_DECRYPT_FAILURE),
      };
    }

    if (!apiKey || !phoneNumberId) {
      this.logger.warn(
        `[WHATSAPP] WhatsApp not configured: missing ${!apiKey ? 'Access Token' : 'Phone Number ID'} in Admin Settings`,
      );
      this.logger.log(`[LeadNotification] 7. Provider request started (Not configured)`);
      this.logger.log(`[LeadNotification] 8. Provider response received\n[LeadNotification]\nWhatsApp provider response:\nHTTP: 400 (CREDENTIALS_MISSING)\nError: WhatsApp Access Token or Phone Number ID not configured in Admin Settings`);
      return {
        success: false,
        skipped: true,
        errorCode: WHATSAPP_ERROR_CODES.CREDENTIALS_MISSING,
        reason: WHATSAPP_ERROR_CODES.CREDENTIALS_MISSING,
        details: friendlyWhatsAppErrorMessage(WHATSAPP_ERROR_CODES.CREDENTIALS_MISSING),
      };
    }

    const maskedPhone = this.maskPhone(normalizedTo);
    this.logger.log(
      `[WHATSAPP_REQUEST]\nProvider:\nMeta WhatsApp Cloud API\nVersion:\n${apiVersion}\nRecipient:\n${maskedPhone}\nTemplate:\n${templateName}\nStage:\n${stageName || 'N/A'}`
    );
    this.logger.log(`[LeadNotification] 7. Provider request started\n[LeadNotification]\nWhatsApp request started`);

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // 2. Build Meta Cloud API template payload
    const templatePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: parameters.length > 0
          ? [
              {
                type: 'body',
                parameters,
              },
            ]
          : undefined,
      },
    };

    try {
      const response = await axios.post(url, templatePayload, { headers, timeout: 10000 });
      const messageId = response.data?.messages?.[0]?.id;
      this.logger.log(
        `[WHATSAPP_RESPONSE]\nHTTP status:\n${response.status}\nProvider message ID:\n${messageId || 'N/A'}`
      );
      this.logger.log(
        `[LeadNotification] 8. Provider response received\n[LeadNotification]\nWhatsApp provider response:\nHTTP: ${response.status}\nMessage ID: ${messageId || 'N/A'}`
      );
      return { success: true, messageId };
    } catch (err: any) {
      const httpStatus = err?.response?.status as number | undefined;
      const fbError = err?.response?.data?.error;
      const metaCode = fbError?.code || err?.code;
      const metaMessage = fbError?.message || err?.message || 'Meta API error';
      const metaType = fbError?.type;
      const metaSubcode = fbError?.error_subcode;
      const fbtraceId = fbError?.fbtrace_id;
      const isNetworkError = !httpStatus && (err?.code === 'ECONNABORTED' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT');

      // Safe structured log — NO token content
      this.logger.warn(
        `[WHATSAPP_RESPONSE_ERROR]\nHTTP status:\n${httpStatus || 'N/A'}\nMeta error code:\n${metaCode || 'N/A'}\nMeta error type:\n${metaType || 'N/A'}\nMeta error subcode:\n${metaSubcode || 'N/A'}\nTrace ID:\n${fbtraceId || 'N/A'}\nMeta error message:\n${metaMessage}`,
      );
      this.logger.warn(
        `[LeadNotification] 8. Provider response received\n[LeadNotification]\nWhatsApp provider response:\nHTTP: ${httpStatus || 'FAILED'}\nMeta error code: ${metaCode || 'N/A'}\nMeta error message: ${metaMessage}`,
      );

      // Classify to typed error code
      const typedErrorCode = isNetworkError
        ? WHATSAPP_ERROR_CODES.NETWORK_ERROR
        : classifyWhatsAppError(httpStatus, metaCode, metaType);

      // If template not found and fallback text provided, attempt plain text message
      if (
        typedErrorCode === WHATSAPP_ERROR_CODES.TEMPLATE_ERROR &&
        fallbackText &&
        (metaCode === 132001 || String(metaCode) === '132001' || metaCode === 100 || String(metaMessage).toLowerCase().includes('template'))
      ) {
        this.logger.log(`[WHATSAPP] Template "${templateName}" not active on Meta. Falling back to direct text message.`);
        return this.sendMessage(normalizedTo, fallbackText, stageName);
      }

      if (typedErrorCode === WHATSAPP_ERROR_CODES.AUTH_ERROR) {
        this.logger.error(`[WHATSAPP_AUTH_FAILURE] Meta error code ${metaCode} / type ${metaType || 'N/A'}: ${metaMessage}`);
      } else {
        this.logger.error(`[WHATSAPP_SEND_FAILURE] ${typedErrorCode}: HTTP ${httpStatus || 'N/A'} Meta code ${metaCode || 'N/A'} — ${metaMessage}`);
      }

      return {
        success: false,
        error: String(httpStatus || metaCode || 'UNKNOWN'),
        errorCode: typedErrorCode,
        reason: typedErrorCode,
        details: friendlyWhatsAppErrorMessage(typedErrorCode, metaMessage),
      };
    }
  }

  /**
   * Dispatches a direct text message via Meta Business Cloud API.
   */
  async sendMessage(to: string, text: string, stageName?: string): Promise<WhatsAppSendResult> {
    const normalizedTo = this.normalizePhoneNumber(to);
    if (!normalizedTo) {
      this.logger.warn(`[WHATSAPP] No customer phone number found: invalid or empty (${this.maskPhone(to)})`);
      return {
        success: false,
        error: 'INVALID_PHONE',
        errorCode: WHATSAPP_ERROR_CODES.NO_PHONE,
        reason: WHATSAPP_ERROR_CODES.NO_PHONE,
        details: friendlyWhatsAppErrorMessage(WHATSAPP_ERROR_CODES.NO_PHONE),
      };
    }

    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP');
    if (!config?.isEnabled) {
      this.logger.log('[WHATSAPP] WhatsApp integration is disabled in Admin Panel. Skipping message.');
      this.logger.log(`[LeadNotification] 7. Provider request started (Skipped: Integration disabled)`);
      this.logger.log(`[LeadNotification] 8. Provider response received\n[LeadNotification]\nWhatsApp provider response:\nHTTP: DISABLED\nError: WhatsApp integration is disabled in Admin Settings`);
      return {
        success: false,
        skipped: true,
        errorCode: WHATSAPP_ERROR_CODES.INTEGRATION_DISABLED,
        reason: WHATSAPP_ERROR_CODES.INTEGRATION_DISABLED,
        details: friendlyWhatsAppErrorMessage(WHATSAPP_ERROR_CODES.INTEGRATION_DISABLED),
      };
    }

    const creds = config.credentials || {};
    const apiKey = (creds.apiKey || creds.accessToken || creds.access_token || '').trim();
    const phoneNumberId = (creds.phoneNumberId || creds.phone_number_id || '').trim();
    const apiVersion = (creds.apiVersion || 'v25.0').trim();

    // Detect silent decryption failure: DATABASE source but empty token means ENCRYPTION_KEY mismatch
    if (!apiKey && config.source === 'DATABASE') {
      this.logger.error(
        '[WHATSAPP_CREDS_DECRYPT_FAILURE] WhatsApp Access Token is stored in database but decrypted to empty string. ' +
        'ENCRYPTION_KEY or JWT_SECRET likely changed since the token was saved. ' +
        'Action: Re-save the WhatsApp token in Admin → Settings → Integrations → WhatsApp.',
      );
      return {
        success: false,
        skipped: false,
        errorCode: WHATSAPP_ERROR_CODES.CREDENTIALS_DECRYPT_FAILURE,
        reason: WHATSAPP_ERROR_CODES.CREDENTIALS_DECRYPT_FAILURE,
        details: friendlyWhatsAppErrorMessage(WHATSAPP_ERROR_CODES.CREDENTIALS_DECRYPT_FAILURE),
      };
    }

    if (!apiKey || !phoneNumberId) {
      this.logger.warn(
        `[WHATSAPP] WhatsApp not configured: missing ${!apiKey ? 'Access Token' : 'Phone Number ID'} in Admin Settings`,
      );
      this.logger.log(`[LeadNotification] 7. Provider request started (Not configured)`);
      this.logger.log(`[LeadNotification] 8. Provider response received\n[LeadNotification]\nWhatsApp provider response:\nHTTP: 400 (CREDENTIALS_MISSING)\nError: WhatsApp Access Token or Phone Number ID not configured in Admin Settings`);
      return {
        success: false,
        skipped: true,
        errorCode: WHATSAPP_ERROR_CODES.CREDENTIALS_MISSING,
        reason: WHATSAPP_ERROR_CODES.CREDENTIALS_MISSING,
        details: friendlyWhatsAppErrorMessage(WHATSAPP_ERROR_CODES.CREDENTIALS_MISSING),
      };
    }

    const maskedPhone = this.maskPhone(normalizedTo);
    this.logger.log(
      `[WHATSAPP_REQUEST]\nProvider:\nMeta WhatsApp Cloud API\nVersion:\n${apiVersion}\nRecipient:\n${maskedPhone}\nType:\ntext\nStage:\n${stageName || 'N/A'}`
    );
    this.logger.log(`[LeadNotification] 7. Provider request started\n[LeadNotification]\nWhatsApp request started`);

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    try {
      const response = await axios.post(url, payload, { headers, timeout: 10000 });
      const messageId = response.data?.messages?.[0]?.id;
      this.logger.log(
        `[WHATSAPP_RESPONSE]\nHTTP status:\n${response.status}\nProvider message ID:\n${messageId || 'N/A'}`
      );
      this.logger.log(
        `[LeadNotification] 8. Provider response received\n[LeadNotification]\nWhatsApp provider response:\nHTTP: ${response.status}\nMessage ID: ${messageId || 'N/A'}`
      );
      return { success: true, messageId };
    } catch (err: any) {
      const httpStatus = err?.response?.status as number | undefined;
      const fbError = err?.response?.data?.error;
      const metaCode = fbError?.code || err?.code;
      const metaMessage = fbError?.message || err?.message || 'Meta API error';
      const metaType = fbError?.type;
      const metaSubcode = fbError?.error_subcode;
      const fbtraceId = fbError?.fbtrace_id;
      const isNetworkError = !httpStatus && (err?.code === 'ECONNABORTED' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT');

      this.logger.error(
        `[WHATSAPP_RESPONSE_ERROR]\nHTTP status:\n${httpStatus || 'N/A'}\nMeta error code:\n${metaCode || 'N/A'}\nMeta error type:\n${metaType || 'N/A'}\nMeta error subcode:\n${metaSubcode || 'N/A'}\nTrace ID:\n${fbtraceId || 'N/A'}\nMeta error message:\n${metaMessage}`,
      );
      this.logger.warn(
        `[LeadNotification] 8. Provider response received\n[LeadNotification]\nWhatsApp provider response:\nHTTP: ${httpStatus || 'FAILED'}\nMeta error code: ${metaCode || 'N/A'}\nMeta error message: ${metaMessage}`,
      );

      const typedErrorCode = isNetworkError
        ? WHATSAPP_ERROR_CODES.NETWORK_ERROR
        : classifyWhatsAppError(httpStatus, metaCode, metaType);

      if (typedErrorCode === WHATSAPP_ERROR_CODES.AUTH_ERROR) {
        this.logger.error(`[WHATSAPP_AUTH_FAILURE] Meta error code ${metaCode} / type ${metaType || 'N/A'}: ${metaMessage}`);
      } else {
        this.logger.error(`[WHATSAPP_SEND_FAILURE] ${typedErrorCode}: HTTP ${httpStatus || 'N/A'} Meta code ${metaCode || 'N/A'} — ${metaMessage}`);
      }

      return {
        success: false,
        error: String(httpStatus || metaCode || 'UNKNOWN'),
        errorCode: typedErrorCode,
        reason: typedErrorCode,
        details: friendlyWhatsAppErrorMessage(typedErrorCode, metaMessage),
      };
    }
  }

  /**
   * Resolves the primary customer phone number from the database.
   * Checks customer.phone -> customer.alternatePhone -> linked user.phone.
   */
  async resolveCustomerPhone(customerId: number): Promise<{ phone: string | null; customerName: string }> {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          name: true,
          companyName: true,
          phone: true,
          alternatePhone: true,
          users: {
            where: { deletedAt: null },
            select: { phone: true },
            take: 1,
          },
        },
      });

      if (!customer) {
        return { phone: null, customerName: 'Customer' };
      }

      const customerName = customer.name || customer.companyName || 'Customer';
      const rawPhone = customer.phone || customer.alternatePhone || customer.users[0]?.phone || null;
      const normalized = this.normalizePhoneNumber(rawPhone);

      return { phone: normalized, customerName };
    } catch (err: any) {
      this.logger.error(`[WHATSAPP] Error resolving customer phone from database: ${err?.message}`);
      return { phone: null, customerName: 'Customer' };
    }
  }

  /**
   * 1. CUSTOMER REGISTRATION -> WELCOME WHATSAPP
   * Dispatches welcome template to customer's registered phone.
   * Includes idempotency check: max 1 welcome WhatsApp per customer.
   */
  async sendCustomerWelcomeMessage(params: {
    customerId: number;
    customerName?: string;
    phone?: string;
    notificationId?: number;
  }): Promise<WhatsAppSendResult> {
    const { customerId } = params;
    this.logger.log(`[WHATSAPP] Customer welcome notification started`);

    try {
      // 1. Idempotency check: verify whether welcome WhatsApp was already dispatched
      const existingNotif = await this.prisma.notification.findFirst({
        where: {
          customerId,
          type: { in: ['WELCOME', 'CUSTOMER_WELCOME'] },
        },
      });

      const existingData = (existingNotif?.data as any) || {};
      if (existingData.whatsappSent === true) {
        this.logger.log(`[WHATSAPP] Welcome message already sent for customerId=${customerId}. Skipping duplicate.`);
        return { success: true, skippedDuplicate: true };
      }

      // 2. Resolve customer phone number strictly from DB
      let targetPhone = this.normalizePhoneNumber(params.phone);
      let customerName = params.customerName;

      if (!targetPhone) {
        const resolved = await this.resolveCustomerPhone(customerId);
        targetPhone = resolved.phone;
        if (!customerName) customerName = resolved.customerName;
      }

      if (!targetPhone) {
        this.logger.warn(`[WHATSAPP] No customer phone number found for customerId=${customerId}`);
        return { success: false, skipped: true, reason: 'NO_PHONE' };
      }

      const maskedPhone = this.maskPhone(targetPhone);
      this.logger.log(`[WHATSAPP] Customer phone resolved: ${maskedPhone}`);

      const resolvedName = customerName || 'Customer';

      // 3. Prepare template message & fallback text
      const templateName = 'customer_welcome';
      const templateParameters: Array<{ type: 'text'; text: string }> = [
        { type: 'text', text: resolvedName },
      ];

      const fallbackText = `Welcome to QuikBoom, ${resolvedName}! 🎉\n\nYour account has been created successfully.\n\nWe're happy to have you with us.`;

      // 4. Send template via Meta Cloud API
      const result = await this.sendTemplate(
        targetPhone,
        templateName,
        templateParameters,
        'en_US',
        fallbackText,
      );

      if (result.success) {
        this.logger.log(`[WHATSAPP] Welcome template sent successfully: messageId=${result.messageId || 'N/A'}`);

        // Update notification DB record with WhatsApp delivery metadata for idempotency
        const notifToUpdate = params.notificationId || existingNotif?.id;
        if (notifToUpdate) {
          try {
            await this.prisma.notification.update({
              where: { id: notifToUpdate },
              data: {
                data: {
                  ...existingData,
                  whatsappSent: true,
                  whatsappMessageId: result.messageId || 'SUCCESS',
                  whatsappRecipient: maskedPhone,
                  whatsappSentAt: new Date().toISOString(),
                } as any,
              },
            });
          } catch (updateErr: any) {
            this.logger.warn(`Non-fatal: Failed updating notification data with WhatsApp status: ${updateErr?.message}`);
          }
        }
      }

      return result;
    } catch (err: any) {
      this.logger.error(`[WHATSAPP] Customer welcome message failed: ${err?.message}`);
      return { success: false, error: err?.message };
    }
  }

  /**
   * 2. PLAN PURCHASE -> WHATSAPP PLAN ACTIVATION
   * Dispatches plan activation template to customer's registered phone.
   * Only called after payment verification succeeds AND subscription is ACTIVE.
   * Includes idempotency check: max 1 plan activation WhatsApp per subscription/payment.
   */
  async sendPlanActivationMessage(params: {
    customerId: number;
    customerName?: string;
    planName: string;
    billingCycle?: string;
    startDate?: string | Date;
    expiryDate?: string | Date;
    subscriptionId?: number;
    paymentId?: string | number;
    phone?: string;
    notificationId?: number;
  }): Promise<WhatsAppSendResult> {
    const { customerId, planName, subscriptionId, paymentId } = params;
    this.logger.log(`[WHATSAPP] Plan activation notification started`);

    try {
      // 1. Idempotency check: verify whether plan activation WhatsApp was already sent for this subscription
      if (subscriptionId || paymentId) {
        const recentNotifs = await this.prisma.notification.findMany({
          where: {
            customerId,
            type: 'PLAN_PURCHASE_SUCCESS',
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        });

        const duplicate = recentNotifs.find((n) => {
          const data = (n.data as any) || {};
          if (data.whatsappSent !== true) return false;
          if (paymentId && String(data.paymentId) === String(paymentId)) return true;
          if (subscriptionId && String(data.subscriptionId) === String(subscriptionId)) return true;
          return false;
        });

        if (duplicate) {
          this.logger.log(`[WHATSAPP] Plan activation message already sent for subscriptionId=${subscriptionId}. Skipping duplicate.`);
          return { success: true, skippedDuplicate: true };
        }
      }

      // 2. Resolve customer phone number strictly from DB
      let targetPhone = this.normalizePhoneNumber(params.phone);
      let customerName = params.customerName;

      if (!targetPhone) {
        const resolved = await this.resolveCustomerPhone(customerId);
        targetPhone = resolved.phone;
        if (!customerName) customerName = resolved.customerName;
      }

      if (!targetPhone) {
        this.logger.warn(`[WHATSAPP] No customer phone number found for customerId=${customerId}`);
        return { success: false, skipped: true, reason: 'NO_PHONE' };
      }

      const maskedPhone = this.maskPhone(targetPhone);
      this.logger.log(`[WHATSAPP] Customer phone resolved: ${maskedPhone}`);

      // 3. Format dynamic variables
      const resolvedName = customerName || 'Customer';
      const billingCycle = params.billingCycle || 'Monthly';
      const startDateStr = params.startDate
        ? new Date(params.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const expiryDateStr = params.expiryDate
        ? new Date(params.expiryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'Ongoing';

      const templateName = 'plan_activation_success';
      const templateParameters: Array<{ type: 'text'; text: string }> = [
        { type: 'text', text: resolvedName },
        { type: 'text', text: planName },
        { type: 'text', text: billingCycle },
        { type: 'text', text: startDateStr },
        { type: 'text', text: expiryDateStr },
      ];

      const fallbackText = `Hi ${resolvedName} 👋\n\nYour ${planName} plan has been activated successfully.\n\nPlan: ${planName}\nBilling: ${billingCycle}\nValid From: ${startDateStr}\nValid Until: ${expiryDateStr}\n\nThank you for choosing QuikBoom! 🎉`;

      // 4. Send template via Meta Cloud API
      const result = await this.sendTemplate(
        targetPhone,
        templateName,
        templateParameters,
        'en_US',
        fallbackText,
      );

      if (result.success) {
        this.logger.log(`[WHATSAPP] Plan activation template sent successfully: messageId=${result.messageId || 'N/A'}`);

        // Update notification DB record with WhatsApp delivery metadata for idempotency
        if (params.notificationId) {
          try {
            const notif = await this.prisma.notification.findUnique({ where: { id: params.notificationId } });
            const existingData = (notif?.data as any) || {};
            await this.prisma.notification.update({
              where: { id: params.notificationId },
              data: {
                data: {
                  ...existingData,
                  whatsappSent: true,
                  whatsappMessageId: result.messageId || 'SUCCESS',
                  whatsappRecipient: maskedPhone,
                  whatsappSentAt: new Date().toISOString(),
                } as any,
              },
            });
          } catch (updateErr: any) {
            this.logger.warn(`Non-fatal: Failed updating notification data with WhatsApp status: ${updateErr?.message}`);
          }
        }
      }

      return result;
    } catch (err: any) {
      this.logger.error(`[WHATSAPP] Plan activation message failed: ${err?.message}`);
      return { success: false, error: err?.message };
    }
  }

  /**
   * Dispatches a document (e.g. Invoice PDF or Calendar Appointment PDF) via Meta WhatsApp Cloud API.
   * If direct URL or media buffer is provided, sends document payload.
   * Falls back gracefully to text message with details if document media is unconfigured.
   */
  async sendDocumentMessage(params: {
    to: string;
    pdfBuffer?: Buffer;
    pdfUrl?: string;
    filename: string;
    caption?: string;
    stageName?: string;
  }): Promise<WhatsAppSendResult> {
    const { to, pdfBuffer, pdfUrl, filename, caption, stageName } = params;
    const normalizedTo = this.normalizePhoneNumber(to);
    if (!normalizedTo) {
      return { success: false, error: 'INVALID_PHONE', reason: 'NO_PHONE' };
    }

    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP');
    if (!config?.isEnabled) {
      return { success: false, skipped: true, reason: 'INTEGRATION_DISABLED' };
    }

    const creds = config.credentials || {};
    const apiKey = (creds.apiKey || creds.accessToken || creds.access_token || '').trim();
    const phoneNumberId = (creds.phoneNumberId || creds.phone_number_id || '').trim();
    const apiVersion = (creds.apiVersion || 'v25.0').trim();

    if (!apiKey || !phoneNumberId) {
      return { success: false, skipped: true, reason: 'CREDENTIALS_MISSING' };
    }

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // 1. If public/signed URL provided, send directly via link
    if (pdfUrl) {
      try {
        const payload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedTo,
          type: 'document',
          document: {
            link: pdfUrl,
            caption: caption || filename,
            filename,
          },
        };
        const response = await axios.post(url, payload, { headers, timeout: 15000 });
        const messageId = response.data?.messages?.[0]?.id;
        this.logger.log(`[WHATSAPP_DOCUMENT_SUCCESS] Sent ${filename} to ${this.maskPhone(normalizedTo)}: id=${messageId}`);
        return { success: true, messageId };
      } catch (err: any) {
        this.logger.warn(`[WHATSAPP_DOCUMENT_LINK_FAIL] ${err?.message}`);
      }
    }

    // 2. If Buffer provided, upload media to Meta Graph API
    if (pdfBuffer && pdfBuffer.length > 0) {
      try {
        const mediaUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`;
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
        formData.append('file', blob, filename);
        formData.append('messaging_product', 'whatsapp');
        formData.append('type', 'application/pdf');

        const uploadRes = await axios.post(mediaUrl, formData, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 20000,
        });

        const mediaId = uploadRes.data?.id;
        if (mediaId) {
          const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: normalizedTo,
            type: 'document',
            document: {
              id: mediaId,
              caption: caption || filename,
              filename,
            },
          };
          const sendRes = await axios.post(url, payload, { headers, timeout: 15000 });
          const messageId = sendRes.data?.messages?.[0]?.id;
          this.logger.log(`[WHATSAPP_DOCUMENT_MEDIA_SUCCESS] Uploaded & sent ${filename} to ${this.maskPhone(normalizedTo)}: id=${messageId}`);
          return { success: true, messageId };
        }
      } catch (uploadErr: any) {
        this.logger.warn(`[WHATSAPP_MEDIA_UPLOAD_FAIL] ${uploadErr?.message}`);
      }
    }

    // 3. Fallback: deliver caption as text message so customer receives timely notification
    if (caption) {
      return this.sendMessage(normalizedTo, caption, stageName);
    }

    return { success: false, error: 'DOCUMENT_SEND_FAILED', reason: 'MEDIA_UNAVAILABLE' };
  }

  /**
   * 3. PAYMENT SUCCESS -> WHATSAPP PAYMENT RECEIPT
   */
  async sendPaymentSuccessMessage(params: {
    to?: string;
    customerId: number;
    customerName?: string;
    amount: number | string;
    planName?: string;
    transactionId?: string;
    paymentMethod?: string;
  }): Promise<WhatsAppSendResult> {
    const { customerId, amount, planName, transactionId, paymentMethod } = params;
    let targetPhone = this.normalizePhoneNumber(params.to);
    let customerName = params.customerName;

    if (!targetPhone) {
      const resolved = await this.resolveCustomerPhone(customerId);
      targetPhone = resolved.phone;
      if (!customerName) customerName = resolved.customerName;
    }

    if (!targetPhone) {
      return { success: false, skipped: true, reason: 'NO_PHONE' };
    }

    const resolvedName = customerName || 'Valued Customer';
    const plan = planName || 'Subscription Plan';
    const txId = transactionId || 'Verified';
    const method = paymentMethod || 'Online / UPI';

    const templateName = 'payment_success';
    const templateParameters: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: resolvedName },
      { type: 'text', text: String(amount) },
      { type: 'text', text: plan },
      { type: 'text', text: txId },
    ];

    const fallbackText = `Hi ${resolvedName} 👋\n\nYour payment of ₹${amount} for ${plan} was received successfully! ✅\n\nPayment Method: ${method}\nTransaction ID: ${txId}\nDate: ${new Date().toLocaleDateString('en-IN')}\n\nThank you for choosing QuikBoom! 🎉`;

    return this.sendTemplate(targetPhone, templateName, templateParameters, 'en_US', fallbackText);
  }

  /**
   * 4. CALENDAR / APPOINTMENT SCHEDULED -> WHATSAPP CONFIRMATION + PDF
   */
  async sendCalendarScheduledMessage(params: {
    to?: string;
    customerId?: number;
    customerName?: string;
    eventTitle: string;
    date: string | Date;
    time?: string;
    location?: string;
    assignedEmployee?: string;
    pdfBuffer?: Buffer;
    pdfUrl?: string;
  }): Promise<WhatsAppSendResult> {
    const { customerId, eventTitle, date, time, location, assignedEmployee, pdfBuffer, pdfUrl } = params;
    let targetPhone = this.normalizePhoneNumber(params.to);
    let customerName = params.customerName;

    if (!targetPhone && customerId) {
      const resolved = await this.resolveCustomerPhone(customerId);
      targetPhone = resolved.phone;
      if (!customerName) customerName = resolved.customerName;
    }

    if (!targetPhone) {
      return { success: false, skipped: true, reason: 'NO_PHONE' };
    }

    const resolvedName = customerName || 'Valued Client';
    const dateStr = date instanceof Date ? date.toLocaleDateString('en-IN') : String(date);
    const timeStr = time || '10:00 AM';
    const locStr = location || 'Online Video Conference';
    const repStr = assignedEmployee || 'QuickBoom Representative';

    const templateName = 'calendar_scheduled';
    const templateParameters: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: resolvedName },
      { type: 'text', text: eventTitle },
      { type: 'text', text: dateStr },
      { type: 'text', text: timeStr },
      { type: 'text', text: locStr },
    ];

    const fallbackText = `Hi ${resolvedName} 📅\n\nYour meeting "${eventTitle}" has been scheduled successfully!\n\nDate: ${dateStr}\nTime: ${timeStr} (IST)\nLocation: ${locStr}\nRepresentative: ${repStr}\n\nLooking forward to speaking with you!`;

    const textResult = await this.sendTemplate(targetPhone, templateName, templateParameters, 'en_US', fallbackText);

    // If PDF document provided, also dispatch document
    if (pdfBuffer || pdfUrl) {
      await this.sendDocumentMessage({
        to: targetPhone,
        pdfBuffer,
        pdfUrl,
        filename: `Meeting-${dateStr.replace(/[\/\s]/g, '-')}.pdf`,
        caption: `Appointment Confirmation: ${eventTitle}`,
      }).catch((err) => this.logger.warn(`Non-fatal: Failed to send appointment PDF on WhatsApp: ${err?.message}`));
    }

    return textResult;
  }

  /**
   * 5. PLAN EXPIRY REMINDER (3 DAYS) -> WHATSAPP ALERT
   */
  async sendPlanExpiryReminderMessage(params: {
    to?: string;
    customerId: number;
    customerName?: string;
    planName: string;
    expiryDate: string | Date;
    daysRemaining?: number;
  }): Promise<WhatsAppSendResult> {
    const { customerId, planName, expiryDate, daysRemaining } = params;
    let targetPhone = this.normalizePhoneNumber(params.to);
    let customerName = params.customerName;

    if (!targetPhone) {
      const resolved = await this.resolveCustomerPhone(customerId);
      targetPhone = resolved.phone;
      if (!customerName) customerName = resolved.customerName;
    }

    if (!targetPhone) {
      return { success: false, skipped: true, reason: 'NO_PHONE' };
    }

    const resolvedName = customerName || 'Valued Customer';
    const expiryDateStr = expiryDate instanceof Date ? expiryDate.toLocaleDateString('en-IN') : String(expiryDate);
    const days = daysRemaining !== undefined ? daysRemaining : 3;

    const templateName = 'plan_expiry_reminder';
    const templateParameters: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: resolvedName },
      { type: 'text', text: planName },
      { type: 'text', text: String(days) },
      { type: 'text', text: expiryDateStr },
    ];

    const fallbackText = `Hi ${resolvedName} ⚠️\n\nYour ${planName} plan will expire in ${days} days on ${expiryDateStr}.\n\nPlease renew your subscription to maintain uninterrupted CRM services.\n\nThank you for choosing QuikBoom!`;

    return this.sendTemplate(targetPhone, templateName, templateParameters, 'en_US', fallbackText);
  }

  /**
   * Extracts placeholders from template body (e.g. {{1}}, {{2}} or {{leadName}}, {{companyName}})
   * and maps them to actual lead data in the exact order and count required by Meta WhatsApp Cloud API.
   */
  resolveTemplateParameters(
    templateBody: string,
    variables: Record<string, string>,
  ): Array<{ type: 'text'; text: string }> {
    const matches = templateBody.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
    if (!matches || matches.length === 0) {
      return [];
    }

    const positionalFallback: Record<string, string> = {
      '1': variables.leadName || variables.leadTitle || 'Valued Prospect',
      '2': variables.companyName || 'QUIKBOOM',
      '3': variables.leadTitle || variables.userName || 'Marketing Solution',
      '4': variables.userName || variables.assignedEmployeeName || 'QuickBoom Team',
    };

    return matches.map((rawTag) => {
      const tag = rawTag.replace(/[\{\}\s]/g, '');
      let val = variables[tag];
      if (val === undefined && positionalFallback[tag] !== undefined) {
        val = positionalFallback[tag];
      }
      return {
        type: 'text' as const,
        text: String(val !== undefined ? val : ''),
      };
    });
  }

  /**
   * Resolves a standard WhatsApp template for a given lead stage key or alias.
   */
  getStageTemplate(stageKey?: string | null): LeadStageWhatsAppTemplate | null {
    if (!stageKey) return null;
    const normalized = stageKey.trim().toUpperCase().replace(/[\s-]+/g, '_');
    const resolvedKey = STAGE_KEY_TO_WHATSAPP_KEY[normalized] || normalized;
    return LEAD_STAGE_WHATSAPP_TEMPLATES[resolvedKey] || LEAD_STAGE_WHATSAPP_TEMPLATES[normalized] || null;
  }

  /**
   * Returns all available lead stage WhatsApp templates.
   */
  getAllStageTemplates(): LeadStageWhatsAppTemplate[] {
    return Object.values(LEAD_STAGE_WHATSAPP_TEMPLATES);
  }

  /**
   * Dispatches a lead stage change notification via WhatsApp.
   */
  async sendLeadStageMessage(params: {
    to: string;
    stageKey: string;
    variables: Record<string, string>;
    customMessage?: string;
    fallbackText?: string;
    stageName?: string;
  }): Promise<WhatsAppSendResult> {
    const { to, stageKey, variables, customMessage, stageName } = params;
    const template = this.getStageTemplate(stageKey);

    let messageText = customMessage;
    if (!messageText) {
      if (template) {
        let rendered = template.body;
        for (const [k, v] of Object.entries(variables)) {
          rendered = rendered.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v || '');
        }
        messageText = rendered;
      } else if (params.fallbackText) {
        messageText = params.fallbackText;
      }
    }

    if (!messageText) {
      return {
        success: false,
        skipped: true,
        errorCode: WHATSAPP_ERROR_CODES.NO_TEMPLATE_OR_MESSAGE,
        reason: WHATSAPP_ERROR_CODES.NO_TEMPLATE_OR_MESSAGE,
        details: 'No template or message content configured for this stage',
      };
    }

    const templateName = template?.templateName || 'lead_stage_update';
    const templateParameters = template
      ? this.resolveTemplateParameters(template.body, variables)
      : Object.values(variables).slice(0, 3).map((v) => ({ type: 'text' as const, text: String(v) }));

    return this.sendTemplate(
      to,
      templateName,
      templateParameters,
      'en_US',
      messageText,
      stageName || template?.name || stageKey,
    );
  }

  /**
   * Generates safe diagnostic output for Section 17 without revealing secrets.
   */
  async getDiagnostics(stageKey?: string, phone?: string) {
    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP');
    const creds = config?.credentials || {};
    const hasToken = Boolean(creds.apiKey || creds.accessToken || creds.access_token);
    const hasPhoneId = Boolean(creds.phoneNumberId || creds.phone_number_id);
    const hasWabaId = Boolean(creds.businessAccountId || creds.wabaId);
    const normalizedPhone = this.normalizePhoneNumber(phone);
    const template = this.getStageTemplate(stageKey);

    return {
      provider: 'Meta WhatsApp Cloud API',
      configuration: {
        accessToken: hasToken ? 'PRESENT' : 'MISSING',
        phoneNumberId: hasPhoneId ? 'PRESENT' : 'MISSING',
        businessAccountId: hasWabaId ? 'PRESENT' : 'MISSING',
        apiConfiguration: (hasToken && hasPhoneId) ? 'PRESENT' : 'MISSING',
        source: config?.source || 'NONE',
        isEnabled: Boolean(config?.isEnabled),
      },
      template: {
        stage: stageKey || 'N/A',
        templateFound: Boolean(template),
        templateName: template?.templateName || 'N/A',
        templateActive: true,
        templateApprovedOrConfigured: Boolean(template),
        language: 'en_US',
        parametersCount: template ? (template.body.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || []).length : 0,
      },
      lead: {
        phonePresent: Boolean(phone),
        phoneFormatValid: Boolean(normalizedPhone),
        maskedPhone: this.maskPhone(phone),
      },
      api: {
        requestGenerated: Boolean(hasToken && hasPhoneId && normalizedPhone && template),
      },
      webhook: {
        route: '/api/v1/webhooks/whatsapp',
        verifyTokenConfigured: Boolean(creds.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN),
        appSecretConfigured: Boolean(creds.appSecret || process.env.WHATSAPP_APP_SECRET),
      },
    };
  }

  // In-memory cache for event deduplication/idempotency (24h TTL)
  private readonly processedEvents = new Map<string, number>();

  /**
   * Safe event idempotency check to avoid duplicate processing of Meta retried webhooks.
   */
  private isEventDuplicate(key: string): boolean {
    const processedAt = this.processedEvents.get(key);
    if (processedAt && Date.now() - processedAt < 24 * 60 * 60 * 1000) {
      return true;
    }
    return false;
  }

  private markEventProcessed(key: string): void {
    if (this.processedEvents.size > 5000) {
      const now = Date.now();
      for (const [k, v] of this.processedEvents.entries()) {
        if (now - v > 24 * 60 * 60 * 1000) {
          this.processedEvents.delete(k);
        }
      }
    }
    this.processedEvents.set(key, Date.now());
  }

  /**
   * Retrieves full resolved WhatsApp credentials from Integration Settings / environment.
   */
  /**
   * Retrieves full resolved WhatsApp credentials from Integration Settings / environment.
   */
  async getWhatsAppCredentials(options?: { forceFresh?: boolean }): Promise<{
    isEnabled: boolean;
    apiKey: string;
    accessToken: string;
    phoneNumberId: string;
    businessAccountId: string;
    verifyToken: string;
    appSecret: string;
    config: Record<string, any>;
  }> {
    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP', options);
    const creds = config?.credentials || {};
    const cfg = config?.config || {};
    const apiKey = (
      creds.apiKey ||
      creds.accessToken ||
      creds.access_token ||
      process.env.WHATSAPP_API_KEY ||
      process.env.WHATSAPP_ACCESS_TOKEN ||
      ''
    ).trim();
    const phoneNumberId = (
      creds.phoneNumberId ||
      creds.phone_number_id ||
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      ''
    ).trim();
    const businessAccountId = (
      creds.businessAccountId ||
      creds.business_account_id ||
      creds.wabaId ||
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
      process.env.WHATSAPP_WABA_ID ||
      ''
    ).trim();
    const verifyToken = (
      creds.verifyToken ||
      creds.webhookVerifyToken ||
      creds.verify_token ||
      creds.webhook_verify_token ||
      cfg.verifyToken ||
      cfg.webhookVerifyToken ||
      cfg.verify_token ||
      process.env.WHATSAPP_VERIFY_TOKEN ||
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
      process.env.META_VERIFY_TOKEN ||
      process.env.META_WEBHOOK_VERIFY_TOKEN ||
      '3f4e429cbf154b82ca819b5af5bc046110d18f336db6627a'
    ).trim();
    const appSecret = (
      creds.appSecret ||
      creds.app_secret ||
      creds.clientSecret ||
      process.env.WHATSAPP_APP_SECRET ||
      process.env.META_APP_SECRET ||
      ''
    ).trim();

    return {
      isEnabled: Boolean(config?.isEnabled),
      apiKey,
      accessToken: apiKey,
      phoneNumberId,
      businessAccountId,
      verifyToken,
      appSecret,
      config: cfg,
    };
  }

  /**
   * Verifies incoming Meta Cloud API webhook GET verification request.
   */
  async verifyWebhookToken(
    mode?: string,
    token?: string,
    challenge?: string,
  ): Promise<{ valid: boolean; challenge?: string; reason?: string }> {
    // 1. Always load fresh credentials directly to prevent stale cache issues
    const creds = await this.getWhatsAppCredentials({ forceFresh: true });
    const configuredToken = (creds.verifyToken || '').trim();

    // 2. Normalize and sanitize values (strip quotes, trim whitespace)
    const sanitize = (val?: string): string => {
      if (!val || typeof val !== 'string') return '';
      return val.trim().replace(/^["']|["']$/g, '').trim();
    };

    const rawToken = sanitize(token);
    const rawConfiguredToken = sanitize(configuredToken);

    const modeValue = (mode || '').trim();
    const isModeSubscribe = modeValue === 'subscribe';

    const tokenReceived = Boolean(rawToken);
    const configuredTokenPresent = Boolean(rawConfiguredToken);

    // 3. Constant-time comparison
    let tokensMatch = false;
    if (tokenReceived && configuredTokenPresent) {
      if (rawToken === rawConfiguredToken) {
        tokensMatch = true;
      } else if (rawToken.length === rawConfiguredToken.length) {
        const bufA = Buffer.from(rawToken, 'utf8');
        const bufB = Buffer.from(rawConfiguredToken, 'utf8');
        tokensMatch = crypto.timingSafeEqual(bufA, bufB);
      } else if (rawToken.toLowerCase() === rawConfiguredToken.toLowerCase()) {
        // Tolerates hex casing differences
        tokensMatch = true;
      }
    }

    // 4. Safe logging without exposing actual secret values
    this.logger.log(
      `Webhook verification received\n` +
      `mode: ${modeValue || 'MISSING'}\n` +
      `token received: ${tokenReceived ? 'PRESENT' : 'MISSING'}\n` +
      `configured token: ${configuredTokenPresent ? 'PRESENT' : 'MISSING'}\n` +
      `tokens match: ${tokensMatch ? 'YES' : 'NO'}`
    );

    if (isModeSubscribe && tokensMatch) {
      this.logger.log('[WHATSAPP_WEBHOOK] Verification successful for Meta WhatsApp Cloud API');
      return { valid: true, challenge: challenge || '' };
    }

    if (!isModeSubscribe) {
      this.logger.warn(`[WHATSAPP_WEBHOOK] Verification failed: mode is not subscribe (${modeValue})`);
      return { valid: false, reason: 'INVALID_MODE' };
    }

    this.logger.warn(`[WHATSAPP_WEBHOOK] Verification failed: token mismatch`);
    return { valid: false, reason: 'TOKEN_MISMATCH' };
  }

  /**
   * Verifies X-Hub-Signature-256 HMAC-SHA256 signature using Meta App Secret.
   */
  async verifyMetaSignature(rawBody: string, signatureHeader?: string): Promise<boolean> {
    const creds = await this.getWhatsAppCredentials();
    if (!creds.appSecret) {
      // App secret not configured, bypass signature check safely
      return true;
    }

    if (!signatureHeader || typeof signatureHeader !== 'string') {
      this.logger.warn('[WHATSAPP_WEBHOOK] Missing X-Hub-Signature-256 header while App Secret is configured');
      return false;
    }

    try {
      const parts = signatureHeader.split('=');
      if (parts.length !== 2 || parts[0] !== 'sha256') {
        return false;
      }
      const expectedHash = parts[1];
      const actualHash = crypto
        .createHmac('sha256', creds.appSecret)
        .update(rawBody, 'utf8')
        .digest('hex');

      const expectedBuf = Buffer.from(expectedHash, 'hex');
      const actualBuf = Buffer.from(actualHash, 'hex');

      if (expectedBuf.length !== actualBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch (err: any) {
      this.logger.error(`[WHATSAPP_WEBHOOK] Signature verification error: ${err?.message}`);
      return false;
    }
  }

  /**
   * Helper to extract readable summary text from various WhatsApp Cloud API message types.
   */
  extractMessageText(message: any): string {
    if (!message) return '';
    const type = message.type;
    switch (type) {
      case 'text':
        return message.text?.body || '';
      case 'image':
        return message.image?.caption ? `[Image] ${message.image.caption}` : '[Image]';
      case 'document': {
        const filename = message.document?.filename;
        const caption = message.document?.caption;
        return filename ? `[Document: ${filename}]${caption ? ` ${caption}` : ''}` : '[Document]';
      }
      case 'audio':
        return message.audio?.voice ? '[Voice Note]' : '[Audio Message]';
      case 'video':
        return message.video?.caption ? `[Video] ${message.video.caption}` : '[Video]';
      case 'location': {
        const loc = message.location;
        if (!loc) return '[Location]';
        const name = loc.name ? ` (${loc.name})` : '';
        return `[Location: ${loc.latitude}, ${loc.longitude}${name}]`;
      }
      case 'contacts': {
        const c = message.contacts?.[0];
        const name = c?.name?.formatted_name || 'Contact';
        const phone = c?.phones?.[0]?.phone || '';
        return `[Contact: ${name} ${phone}]`.trim();
      }
      case 'interactive': {
        const reply = message.interactive?.button_reply || message.interactive?.list_reply;
        return reply?.title ? `[Reply: ${reply.title}]` : '[Interactive Response]';
      }
      case 'button':
        return message.button?.text ? `[Button: ${message.button.text}]` : '[Button Click]';
      case 'reaction':
        return message.reaction?.emoji ? `[Reaction: ${message.reaction.emoji}]` : '[Reaction]';
      default:
        return `[Unsupported message type: ${type || 'unknown'}]`;
    }
  }

  /**
   * Primary processing entry point for incoming Meta WhatsApp Cloud API webhooks.
   */
  async processWebhookPayload(payload: any): Promise<{
    processed: boolean;
    statusesCount: number;
    messagesCount: number;
  }> {
    if (!payload || typeof payload !== 'object') {
      return { processed: false, statusesCount: 0, messagesCount: 0 };
    }

    if (payload.object && payload.object !== 'whatsapp_business_account') {
      this.logger.log(`[WHATSAPP_WEBHOOK] Ignored non-whatsapp object: ${payload.object}`);
      return { processed: false, statusesCount: 0, messagesCount: 0 };
    }

    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    let statusesCount = 0;
    let messagesCount = 0;

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const val = change.value;
        if (!val || typeof val !== 'object') continue;

        const metadata = val.metadata || {};
        const displayPhoneNumber = metadata.display_phone_number;
        const phoneNumberId = metadata.phone_number_id;
        const contacts = Array.isArray(val.contacts) ? val.contacts : [];

        // 1. Process Status Updates
        if (Array.isArray(val.statuses)) {
          for (const statusObj of val.statuses) {
            const messageId = statusObj.id;
            const statusStr = (statusObj.status || '').toLowerCase();
            const recipientPhone = statusObj.recipient_id;

            this.logger.log(
              `WhatsApp Webhook Received\nEvent: message_status\nMessage ID: ${messageId || 'N/A'}\nStatus: ${statusStr}\nPhone: ${this.maskPhone(recipientPhone)}`
            );

            if (!messageId || !statusStr) continue;

            // Idempotency check
            const eventKey = `status:${messageId}:${statusStr}`;
            if (this.isEventDuplicate(eventKey)) {
              this.logger.log(`[WHATSAPP_WEBHOOK_IDEMPOTENT] Duplicate status ${statusStr} for message ${messageId}. Skipping.`);
              continue;
            }
            this.markEventProcessed(eventKey);
            statusesCount++;

            await this.updateMessageStatus(messageId, statusStr, statusObj);
          }
        }

        // 2. Process Incoming Messages
        if (Array.isArray(val.messages)) {
          for (const msg of val.messages) {
            const messageId = msg.id;
            const from = msg.from;
            const type = msg.type || 'text';
            const msgTimestamp = msg.timestamp;

            this.logger.log(
              `WhatsApp Webhook Received\nEvent: incoming_message\nMessage ID: ${messageId || 'N/A'}\nPhone: ${this.maskPhone(from)}\nType: ${type}`
            );

            if (!messageId || !from) continue;

            // Idempotency check
            const eventKey = `msg:${messageId}`;
            if (this.isEventDuplicate(eventKey)) {
              this.logger.log(`[WHATSAPP_WEBHOOK_IDEMPOTENT] Duplicate incoming message ${messageId}. Skipping.`);
              continue;
            }
            this.markEventProcessed(eventKey);
            messagesCount++;

            const contactProfile = contacts.find((c: any) => c.wa_id === from) || contacts[0];
            const contactName = contactProfile?.profile?.name || '';
            const textContent = this.extractMessageText(msg);

            await this.handleIncomingMessage({
              messageId,
              from,
              type,
              textContent,
              timestamp: msgTimestamp,
              contactName,
              phoneNumberId,
              displayPhoneNumber,
              rawMessage: msg,
            });
          }
        }

        // 3. Process errors if present
        if (Array.isArray(val.errors)) {
          for (const err of val.errors) {
            this.logger.warn(`[WHATSAPP_WEBHOOK_ERROR] Code ${err.code}: ${err.title || err.message}`);
          }
        }
      }
    }

    return { processed: true, statusesCount, messagesCount };
  }

  /**
   * Updates existing CRM communication/activity records for an outbound message status event.
   */
  private async updateMessageStatus(messageId: string, status: string, rawStatus: any) {
    const isFailed = status === 'failed';
    const errObj = isFailed && Array.isArray(rawStatus.errors) && rawStatus.errors[0] ? rawStatus.errors[0] : null;
    const errorCode = errObj?.code ? String(errObj.code) : undefined;
    const errorMessage = errObj?.message || errObj?.title || undefined;

    // 1. Update LeadActivityTimeline records that track this WhatsApp message
    try {
      const timelines = await this.prisma.leadActivityTimeline.findMany({
        where: {
          metadata: {
            path: ['messageId'],
            equals: messageId,
          },
        },
      });

      for (const tl of timelines) {
        const currentMeta = (tl.metadata as Record<string, any>) || {};
        let newDescription = tl.description;

        if (status === 'delivered') {
          if (!newDescription.includes('(Delivered)')) {
            newDescription = `${newDescription.replace(/\s*\(Sent\)/g, '').replace(/\s*\(Pending\)/g, '')} (Delivered)`;
          }
        } else if (status === 'read') {
          if (!newDescription.includes('(Read)')) {
            newDescription = `${newDescription.replace(/\s*\(Sent\)/g, '').replace(/\s*\(Delivered\)/g, '')} (Read)`;
          }
        } else if (isFailed) {
          if (!newDescription.includes('(Failed')) {
            newDescription = `${newDescription} (Failed: ${errorMessage || errorCode || 'Not delivered'})`;
          }
        }

        await this.prisma.leadActivityTimeline.update({
          where: { id: tl.id },
          data: {
            description: newDescription,
            metadata: {
              ...currentMeta,
              status: status.toUpperCase(),
              statusUpdatedAt: new Date(Number(rawStatus.timestamp) * 1000 || Date.now()),
              ...(errorCode ? { errorCode } : {}),
              ...(errorMessage ? { errorMessage } : {}),
            },
          },
        });

        // 1b. Send FCM Push Notification to assigned BPO / lead creator
        try {
          const lead = await this.prisma.lead?.findUnique?.({
            where: { id: tl.leadId },
            select: {
              id: true,
              title: true,
              firstName: true,
              phone: true,
              customerId: true,
              assignedToId: true,
              createdById: true,
            },
          });

          const recipientUserId = lead?.assignedToId || lead?.createdById;
          const notificationService = this.getNotificationService();

          if (notificationService && recipientUserId && lead?.customerId) {
            const leadName = lead.firstName || lead.title || 'Lead';
            let pushTitle = `WhatsApp: ${status.toUpperCase()}`;
            let pushBody = `WhatsApp status for ${leadName}: ${status.toUpperCase()}`;

            if (status === 'delivered') {
              pushTitle = `WhatsApp Delivered: ${leadName}`;
              pushBody = `Your message to ${lead.phone || leadName} was delivered successfully.`;
            } else if (status === 'read') {
              pushTitle = `WhatsApp Read: ${leadName}`;
              pushBody = `${leadName} has read your WhatsApp message.`;
            } else if (isFailed) {
              pushTitle = `WhatsApp Failed: ${leadName}`;
              pushBody = `Message to ${lead.phone || leadName} could not be delivered: ${errorMessage || errorCode || 'Failed'}`;
            }

            notificationService
              .sendPushNotification({
                userId: recipientUserId,
                customerId: lead.customerId,
                title: pushTitle,
                body: pushBody,
                type: 'WHATSAPP_STATUS',
                data: {
                  type: 'WHATSAPP_STATUS',
                  communicationId: String(tl.id),
                  leadId: String(lead.id),
                  customerId: String(lead.customerId),
                  status: status.toUpperCase(),
                  channel: 'WHATSAPP',
                },
              })
              .catch((pushErr: any) => {
                this.logger.debug(`[WHATSAPP_STATUS_PUSH_DEBUG] ${pushErr?.message}`);
              });
          }
        } catch (leadPushErr: any) {
          this.logger.debug(`[WHATSAPP_STATUS_LEAD_ERR] ${leadPushErr?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`[WHATSAPP_STATUS_UPDATE_WARN] Failed updating timeline for ${messageId}: ${err?.message}`);
    }

    // 2. Update Notification records that track this WhatsApp message
    try {
      const notifs = await this.prisma.notification.findMany({
        where: {
          data: {
            path: ['whatsappMessageId'],
            equals: messageId,
          },
        },
      });

      for (const notif of notifs) {
        const notifData = (notif.data as Record<string, any>) || {};
        await this.prisma.notification.update({
          where: { id: notif.id },
          data: {
            data: {
              ...notifData,
              whatsappStatus: status.toUpperCase(),
              whatsappStatusUpdatedAt: new Date(Number(rawStatus.timestamp) * 1000 || Date.now()),
              ...(errorCode ? { whatsappErrorCode: errorCode } : {}),
              ...(errorMessage ? { whatsappErrorMessage: errorMessage } : {}),
            },
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`[WHATSAPP_STATUS_UPDATE_WARN] Failed updating notification for ${messageId}: ${err?.message}`);
    }

    // 3. Update CommunicationHistory records that track this WhatsApp message
    try {
      if (this.prisma.communicationHistory?.findMany) {
        const commHistories = await this.prisma.communicationHistory.findMany({
          where: {
            details: { contains: messageId },
          },
        });
        for (const ch of commHistories) {
          let updatedDetails = ch.details || '';
          const statusTag = `Status: ${status.toUpperCase()}`;
          if (!updatedDetails.includes(statusTag)) {
            updatedDetails += `\n${statusTag}`;
          }
          await this.prisma.communicationHistory.update({
            where: { id: ch.id },
            data: { details: updatedDetails },
          });
        }
      }
    } catch (commErr: any) {
      this.logger.debug(`[WHATSAPP_STATUS_COMM_HISTORY_ERR] ${commErr?.message}`);
    }
  }

  /**
   * Matches sender to an existing Lead or Contact, creates activity timeline/notification,
   * or safely registers a new inbound lead if sender is new.
   */
  private async handleIncomingMessage(params: {
    messageId: string;
    from: string;
    type: string;
    textContent: string;
    timestamp?: string;
    contactName?: string;
    phoneNumberId?: string;
    displayPhoneNumber?: string;
    rawMessage?: any;
  }) {
    const { messageId, from, type, textContent, timestamp, contactName, phoneNumberId, displayPhoneNumber } = params;

    const normalized = this.normalizePhoneNumber(from) || from;
    const digitsOnly = from.replace(/\D/g, '');
    const last10 = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;
    const msgDate = new Date(Number(timestamp) * 1000 || Date.now());

    // 1. Check existing Lead
    let matchingLead: any = null;
    try {
      if (this.prisma.lead?.findFirst) {
        matchingLead = await this.prisma.lead.findFirst({
          where: {
            OR: [
              { phone: normalized },
              { phone: `+${normalized}` },
              { phone: digitsOnly },
              { phone: last10 },
              { phone: { endsWith: last10 } },
            ],
            deletedAt: null,
          },
          include: {
            customer: true,
            assignedTo: true,
          },
          orderBy: { updatedAt: 'desc' },
        });
      }
    } catch (err: any) {
      this.logger.warn(`[WHATSAPP_LEAD_LOOKUP_WARN] ${err?.message}`);
    }

    // 2. Check existing Contact
    let matchingContact: any = null;
    try {
      if (this.prisma.contact?.findFirst) {
        matchingContact = await this.prisma.contact.findFirst({
          where: {
            OR: [
              { phone: normalized },
              { phone: digitsOnly },
              { phone: last10 },
              { phone: { endsWith: last10 } },
              { mobile: normalized },
              { mobile: digitsOnly },
              { mobile: last10 },
              { mobile: { endsWith: last10 } },
              { alternateMobile: { endsWith: last10 } },
            ],
            deletedAt: null,
          },
          include: {
            customer: true,
          },
          orderBy: { updatedAt: 'desc' },
        });
      }
    } catch (err: any) {
      this.logger.warn(`[WHATSAPP_CONTACT_LOOKUP_WARN] ${err?.message}`);
    }

    // 3. If neither Lead nor Contact exists, create a new Lead
    if (!matchingLead && !matchingContact) {
      try {
        const defaultCustomer = await this.prisma.customer?.findFirst?.({
          where: { deletedAt: null },
          include: {
            users: {
              where: { deletedAt: null },
              take: 1,
            },
          },
          orderBy: { id: 'asc' },
        });

        if (defaultCustomer) {
          const newStage = await this.prisma.leadStage?.findFirst?.({
            where: {
              customerId: defaultCustomer.id,
              key: 'NEW',
              deletedAt: null,
            },
          });

          const nameParts = (contactName || '').trim().split(/\s+/);
          const fName = nameParts[0] || 'WhatsApp';
          const lName = nameParts.slice(1).join(' ') || `Lead (${last10})`;

          matchingLead = await this.prisma.lead?.create?.({
            data: {
              customerId: defaultCustomer.id,
              createdById: defaultCustomer.users?.[0]?.id || 1,
              title: `WhatsApp Inquiry: ${contactName || this.maskPhone(from)}`,
              firstName: fName,
              lastName: lName,
              phone: from,
              source: 'WHATSAPP',
              status: 'NEW',
              stageId: newStage?.id || null,
            },
            include: {
              customer: true,
              assignedTo: true,
            },
          });

          this.logger.log(`[WHATSAPP_WEBHOOK] Created new Lead #${matchingLead?.id} for inbound sender ${this.maskPhone(from)}`);
        }
      } catch (err: any) {
        this.logger.warn(`[WHATSAPP_WEBHOOK] Could not auto-create lead: ${err?.message}`);
      }
    }

    // 4. Record Lead Activity if lead exists
    if (matchingLead) {
      try {
        // Check if timeline entry already exists for this messageId
        const existingEntry = await this.prisma.leadActivityTimeline?.findFirst?.({
          where: {
            metadata: {
              path: ['messageId'],
              equals: messageId,
            },
          },
        });

        if (!existingEntry && this.prisma.leadActivityTimeline?.create) {
          const senderLabel = contactName || matchingLead.firstName || this.maskPhone(from);
          await this.prisma.leadActivityTimeline.create({
            data: {
              leadId: matchingLead.id,
              action: 'WHATSAPP_INBOUND',
              description: `Incoming WhatsApp message from ${senderLabel}: "${textContent.slice(0, 150)}"`,
              metadata: {
                messageId,
                from: this.maskPhone(from),
                normalizedPhone: this.maskPhone(normalized),
                contactName: contactName || null,
                type,
                text: textContent,
                timestamp: msgDate,
                status: 'RECEIVED',
                phoneNumberId: phoneNumberId || null,
                displayPhoneNumber: displayPhoneNumber || null,
              },
            },
          });

          // Send CRM notification and FCM push notification to assigned user or lead creator
          const recipientUserId = matchingLead.assignedToId || matchingLead.createdById;
          if (recipientUserId && matchingLead.customerId) {
            const notificationService = this.getNotificationService();
            if (notificationService) {
              await notificationService
                .sendPushNotification({
                  customerId: matchingLead.customerId,
                  userId: recipientUserId,
                  title: `New WhatsApp from ${senderLabel}`,
                  body: textContent.slice(0, 200),
                  type: 'WHATSAPP_INCOMING',
                  data: {
                    type: 'WHATSAPP_INCOMING',
                    leadId: String(matchingLead.id),
                    customerId: String(matchingLead.customerId),
                    whatsappMessageId: messageId,
                    from: this.maskPhone(from),
                    channel: 'WHATSAPP',
                  },
                })
                .catch((err: any) => {
                  this.logger.warn(`[WHATSAPP_INCOMING_PUSH_ERR] ${err?.message}`);
                });
            } else if (this.prisma.notification?.create) {
              await this.prisma.notification.create({
                data: {
                  customerId: matchingLead.customerId,
                  userId: recipientUserId,
                  title: `New WhatsApp Message from ${senderLabel}`,
                  message: textContent.slice(0, 200),
                  type: 'WHATSAPP_INBOUND',
                  data: {
                    leadId: matchingLead.id,
                    whatsappMessageId: messageId,
                    from: this.maskPhone(from),
                    type,
                  },
                },
              });
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`[WHATSAPP_TIMELINE_RECORD_ERR] ${err?.message}`);
      }
    }

    // 5. Record CommunicationHistory if Contact exists
    if (matchingContact) {
      try {
        if (this.prisma.communicationHistory?.create) {
          await this.prisma.communicationHistory.create({
            data: {
              contactId: matchingContact.id,
              type: 'WHATSAPP',
              summary: `Inbound WhatsApp (${type}): ${textContent.slice(0, 100)}`,
              details: `From: ${contactName || this.maskPhone(from)}\nMessage ID: ${messageId}\nContent:\n${textContent}`,
              timestamp: msgDate,
            },
          });
        }
      } catch (err: any) {
        this.logger.warn(`[WHATSAPP_COMM_HISTORY_ERR] ${err?.message}`);
      }
    }
  }
}

export const STAGE_KEY_TO_WHATSAPP_KEY: Record<string, string> = {
  NEW: 'NEW',
  NEW_LEAD: 'NEW',
  CONTACTED: 'CONTACTED',
  CALL_BACK: 'CONTACTED',
  QUALIFIED: 'QUALIFIED',
  DETAILS_SENT: 'DETAILS_SENT',
  DETAILS_SEND: 'DETAILS_SENT',
  COMPANY_DETAILS_SENT: 'DETAILS_SENT',
  FOLLOW_UP: 'FOLLOW_UP',
  FOLLOWUP: 'FOLLOW_UP',
  CUSTOMER_FOLLOW_UP: 'FOLLOW_UP',
  VISIT_SCHEDULED: 'VISIT_SCHEDULED',
  VISIT: 'VISIT_SCHEDULED',
  VISIT_DONE: 'VISIT_DONE',
  VISIT_COMPLETED: 'VISIT_DONE',
  PROPOSAL_SENT: 'PROPOSAL_SENT',
  PROPOSAL: 'PROPOSAL_SENT',
  NEGOTIATION: 'NEGOTIATION',
  FINAL_CALL: 'FINAL_CALL',
  FINAL_DISCUSSION: 'FINAL_CALL',
  WON: 'WON',
  CLOSED_WON: 'WON',
  CONVERTED: 'WON',
  DEAL_WON: 'WON',
  WORK_STARTED: 'WON',
  PAYMENT: 'PROPOSAL_SENT',
  LOST: 'LOST',
  CLOSED_LOST: 'LOST',
  CANCELLED: 'LOST',
  DEAL_LOST: 'LOST',
};

export interface LeadStageWhatsAppTemplate {
  key: string;
  templateName: string;
  name: string;
  body: string;
}

export const LEAD_STAGE_WHATSAPP_TEMPLATES: Record<string, LeadStageWhatsAppTemplate> = {
  NEW: {
    key: 'NEW',
    templateName: 'lead_stage_new',
    name: 'New Lead Welcome',
    body: 'Hi {{leadName}}, thank you for contacting {{companyName}}! We have received your inquiry regarding {{leadTitle}} and our team has been assigned to assist you.',
  },
  CONTACTED: {
    key: 'CONTACTED',
    templateName: 'lead_stage_contacted',
    name: 'Contacted Stage',
    body: 'Hi {{leadName}}, this is {{userName}} from {{companyName}}. It was great speaking with you regarding {{leadTitle}}. Please feel free to reply if you have any questions.',
  },
  QUALIFIED: {
    key: 'QUALIFIED',
    templateName: 'lead_stage_qualified',
    name: 'Qualified Stage',
    body: 'Hi {{leadName}}, we are pleased to inform you that your requirements for {{leadTitle}} have been qualified! Our team at {{companyName}} is now preparing the ideal solution for you.',
  },
  PROPOSAL: {
    key: 'PROPOSAL',
    templateName: 'lead_stage_proposal',
    name: 'Proposal Stage',
    body: 'Hi {{leadName}}, the customized proposal for {{leadTitle}} from {{companyName}} is ready. Please review it and let us know when we can discuss next steps.',
  },
  PROPOSAL_SENT: {
    key: 'PROPOSAL_SENT',
    templateName: 'lead_stage_proposal',
    name: 'Proposal Sent Stage',
    body: 'Hi {{leadName}}, the customized proposal for {{leadTitle}} from {{companyName}} is ready. Please review it and let us know when we can discuss next steps.',
  },
  NEGOTIATION: {
    key: 'NEGOTIATION',
    templateName: 'lead_stage_negotiation',
    name: 'Negotiation Stage',
    body: 'Hi {{leadName}}, following our discussion regarding {{leadTitle}}, we are finalizing the tailored scope and terms. Let us know if you need any adjustments.',
  },
  FINAL_CALL: {
    key: 'FINAL_CALL',
    templateName: 'lead_stage_final_call',
    name: 'Final Call Stage',
    body: 'Hi {{leadName}}, we are preparing the final confirmation for {{leadTitle}} from {{companyName}}. Looking forward to finalizing our collaboration!',
  },
  WON: {
    key: 'WON',
    templateName: 'lead_stage_won',
    name: 'Won / Deal Closed',
    body: 'Congratulations {{leadName}}! 🎉 We are delighted to confirm our partnership for {{leadTitle}}. Welcome to {{companyName}}!',
  },
  CONVERTED: {
    key: 'CONVERTED',
    templateName: 'lead_stage_won',
    name: 'Converted Stage',
    body: 'Congratulations {{leadName}}! 🎉 We are delighted to confirm our partnership for {{leadTitle}}. Welcome to {{companyName}}!',
  },
  LOST: {
    key: 'LOST',
    templateName: 'lead_stage_lost',
    name: 'Lost Stage',
    body: 'Hi {{leadName}}, thank you for considering {{companyName}} for {{leadTitle}}. While we could not move forward right now, we hope to collaborate in the future!',
  },
  CANCELLED: {
    key: 'CANCELLED',
    templateName: 'lead_stage_lost',
    name: 'Cancelled Stage',
    body: 'Hi {{leadName}}, thank you for considering {{companyName}} for {{leadTitle}}. While we could not move forward right now, we hope to collaborate in the future!',
  },
  DETAILS_SENT: {
    key: 'DETAILS_SENT',
    templateName: 'lead_stage_details_sent',
    name: 'Details Sent Stage',
    body: 'Hi {{leadName}}, we have sent the complete details and brochure for {{leadTitle}} to your email. Please review them at your convenience.',
  },
  FOLLOW_UP: {
    key: 'FOLLOW_UP',
    templateName: 'lead_stage_follow_up',
    name: 'Follow Up Stage',
    body: 'Hi {{leadName}}, following up on our recent discussion regarding {{leadTitle}}. Please let us know when you would be available for a quick catch-up.',
  },
  VISIT_SCHEDULED: {
    key: 'VISIT_SCHEDULED',
    templateName: 'lead_stage_visit_scheduled',
    name: 'Visit Scheduled Stage',
    body: 'Hi {{leadName}}, your appointment with {{companyName}} regarding {{leadTitle}} has been scheduled. We look forward to meeting with you!',
  },
  VISIT: {
    key: 'VISIT',
    templateName: 'lead_stage_visit_scheduled',
    name: 'Visit Stage',
    body: 'Hi {{leadName}}, your appointment with {{companyName}} regarding {{leadTitle}} has been scheduled. We look forward to meeting with you!',
  },
  VISIT_DONE: {
    key: 'VISIT_DONE',
    templateName: 'lead_stage_visit_done',
    name: 'Visit Done Stage',
    body: 'Hi {{leadName}}, thank you for meeting with {{companyName}} regarding {{leadTitle}}. We are compiling the action items discussed and will follow up shortly.',
  },
};
