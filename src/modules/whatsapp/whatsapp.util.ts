import { decryptSecret } from '../../common/utils/crypto.util';

export interface WhatsAppSendResult {
  success: boolean;
  provider?: string;
  messageId?: string;
  /** Machine-readable error code (e.g. WHATSAPP_AUTH_ERROR, WHATSAPP_PERMISSION_ERROR, etc.) */
  errorCode?: string;
  /** HTTP status code from Meta or local check */
  providerStatus?: number;
  /** Safe high-level user message */
  message?: string;
  /** Raw safe upstream error message from Meta (no tokens/secrets) */
  providerMessage?: string;
  /** Human-readable safe error details */
  details?: string;
  skipped?: boolean;
  skippedDuplicate?: boolean;
  /** Machine-readable reason code (same as errorCode, kept for backward compat) */
  reason?: string;
  /** Raw upstream HTTP status (for logging only) */
  error?: string;
  /** Meta Graph API error code (e.g. 132001) */
  metaErrorCode?: number;
  /** Meta Graph API error type (e.g. OAuthException) */
  metaErrorType?: string;
  /** Meta Graph API error message */
  metaErrorMessage?: string;
  /** Meta Graph API fbtrace_id */
  fbtraceId?: string;
}

/**
 * Typed error codes for WhatsApp send failures.
 * Use these for programmatic differentiation — never put human messages here.
 */
export const WHATSAPP_ERROR_CODES = {
  AUTH_ERROR: 'WHATSAPP_AUTH_ERROR',             // 401 / OAuthException / code 190
  PERMISSION_ERROR: 'WHATSAPP_PERMISSION_ERROR',  // 403
  REQUEST_ERROR: 'WHATSAPP_REQUEST_ERROR',        // 400 (bad payload, template params)
  RESOURCE_ERROR: 'WHATSAPP_RESOURCE_ERROR',      // 404 (wrong Phone Number ID)
  TEMPLATE_ERROR: 'WHATSAPP_TEMPLATE_ERROR',      // 400 / code 132001 (template not found/inactive)
  RATE_LIMIT: 'WHATSAPP_RATE_LIMIT',              // 429
  PROVIDER_ERROR: 'WHATSAPP_PROVIDER_ERROR',      // 5xx
  NETWORK_ERROR: 'WHATSAPP_NETWORK_ERROR',        // timeout / ECONNREFUSED
  CONFIGURATION_ERROR: 'WHATSAPP_CONFIGURATION_ERROR', // Decrypt failed or missing creds
  UNKNOWN_ERROR: 'WHATSAPP_UNKNOWN_ERROR',
  // Backward compatibility aliases
  INVALID_REQUEST: 'WHATSAPP_REQUEST_ERROR',
  PHONE_NUMBER_ERROR: 'WHATSAPP_RESOURCE_ERROR',
  CREDENTIALS_MISSING: 'WHATSAPP_CONFIGURATION_ERROR',
  CREDENTIALS_DECRYPT_FAILURE: 'WHATSAPP_CONFIGURATION_ERROR',
  INTEGRATION_DISABLED: 'INTEGRATION_DISABLED',
  NO_PHONE: 'NO_PHONE',
  INVALID_PHONE: 'INVALID_PHONE',
  NO_TEMPLATE_OR_MESSAGE: 'NO_TEMPLATE_OR_MESSAGE',
} as const;

/** Masks sensitive access tokens for safe logging: EAAG****ABCD */
export function maskAccessToken(token?: string | null): string {
  if (!token) return 'MISSING';
  const clean = token.trim();
  if (clean.length <= 8) return '****';
  return `${clean.substring(0, 4)}****${clean.substring(clean.length - 4)}`;
}

/** Resolves, decrypts, and thoroughly normalizes a Meta WhatsApp access token */
export function resolveCleanAccessToken(rawToken: any): { token: string | null; error?: string } {
  if (!rawToken) {
    return { token: null, error: 'TOKEN_EMPTY' };
  }

  let token = rawToken;

  // 1. If an object was passed, extract the token string property
  if (typeof token === 'object' && token !== null) {
    token = token.accessToken || token.apiKey || token.access_token || token.token || '';
  }

  if (typeof token !== 'string') {
    return { token: null, error: 'TOKEN_EMPTY' };
  }

  token = token.trim();
  if (!token || token.length === 0) {
    return { token: null, error: 'TOKEN_EMPTY' };
  }

  // 2. Handle stringified JSON (e.g. '{"accessToken":"..."}' or '{"apiKey":"..."}')
  if (token.startsWith('{') && token.endsWith('}')) {
    try {
      const parsed = JSON.parse(token);
      token = (
        parsed.accessToken ||
        parsed.apiKey ||
        parsed.access_token ||
        parsed.token ||
        token
      ).trim();
    } catch {
      // not valid JSON, proceed with raw string
    }
  }

  // 3. Decrypt if encrypted with enc:v1:, handling potential double-encryption
  let decryptAttempts = 0;
  while (typeof token === 'string' && token.startsWith('enc:v1:') && decryptAttempts < 3) {
    decryptAttempts++;
    const decrypted = decryptSecret(token);
    if (!decrypted || decrypted === token) {
      break;
    }
    token = decrypted.trim();
  }

  if (!token || token.length === 0) {
    return { token: null, error: 'TOKEN_EMPTY' };
  }

  if (token === 'undefined' || token === 'null' || token === '[object Object]' || token.startsWith('enc:v1:')) {
    return { token: null, error: 'TOKEN_DECRYPT_FAILED' };
  }

  // 4. Repeatedly strip quotes, escaped quotes, 'Bearer ' prefixes, and trailing punctuation
  let prev = '';
  let cleanPasses = 0;
  while (token !== prev && cleanPasses < 5) {
    prev = token;
    cleanPasses++;
    token = token.trim()
      // Remove leading & trailing single/double/backtick/smart quotes
      .replace(/^["'`\u201C\u201D\u2018\u2019]+|["'`\u201C\u201D\u2018\u2019]+$/g, '')
      // Remove escaped quotes e.g. \"...\"
      .replace(/^[\\"'`]+|[\\"'`]+$/g, '')
      // Remove leading Bearer or bearer prefix (e.g. "Bearer ", "Bearer:", "bearer ")
      .replace(/^bearer[:\s]+/i, '')
      // Remove trailing semicolons or commas
      .replace(/[;,]+$/, '')
      .trim();
  }

  // 5. Strip all internal whitespace, line-breaks (\r, \n), tabs, and zero-width chars
  // Meta OAuth tokens are continuous Base64URL/alphanumeric strings without any whitespace
  token = token.replace(/[\r\n\t\s\u200B-\u200D\uFEFF]/g, '');

  if (!token || token.length === 0) {
    return { token: null, error: 'TOKEN_EMPTY' };
  }

  return { token };
}

/** Maps Meta API HTTP status + error code to a typed WhatsApp error code. */
export function classifyWhatsAppError(httpStatus?: number, metaCode?: string | number, metaType?: string): string {
  if (metaType === 'OAuthException' || String(metaCode) === '190' || httpStatus === 401) {
    return WHATSAPP_ERROR_CODES.AUTH_ERROR;
  }
  if (httpStatus === 403) return WHATSAPP_ERROR_CODES.PERMISSION_ERROR;
  if (httpStatus === 404) return WHATSAPP_ERROR_CODES.RESOURCE_ERROR;
  if (httpStatus === 429) return WHATSAPP_ERROR_CODES.RATE_LIMIT;
  if (httpStatus && httpStatus >= 500) return WHATSAPP_ERROR_CODES.PROVIDER_ERROR;
  if (metaCode === 132001 || String(metaCode) === '132001') {
    return WHATSAPP_ERROR_CODES.TEMPLATE_ERROR;
  }
  if (httpStatus === 400) return WHATSAPP_ERROR_CODES.REQUEST_ERROR;
  return WHATSAPP_ERROR_CODES.UNKNOWN_ERROR;
}

/** Returns a safe user-facing message for a given error code. */
export function friendlyWhatsAppErrorMessage(errorCode: string, metaMessage?: string): string {
  switch (errorCode) {
    case WHATSAPP_ERROR_CODES.AUTH_ERROR: {
      const isCannotParse = metaMessage && (metaMessage.toLowerCase().includes('cannot parse') || metaMessage.toLowerCase().includes('malformed'));
      if (isCannotParse) {
        return `WhatsApp authentication failed: Meta could not parse the access token format (${metaMessage}). Please verify the token has no extra quotes or prefixes in Settings → Integrations → WhatsApp.`;
      }
      return 'WhatsApp authentication failed. Please verify the WhatsApp Access Token in Settings → Integrations → WhatsApp.';
    }
    case WHATSAPP_ERROR_CODES.PERMISSION_ERROR:
      return 'WhatsApp access is not permitted for this account. Check your Meta App permissions.';
    case WHATSAPP_ERROR_CODES.REQUEST_ERROR:
      return metaMessage ? `WhatsApp rejected the message request: ${metaMessage}` : 'WhatsApp rejected the message request. Please check message configuration.';
    case WHATSAPP_ERROR_CODES.TEMPLATE_ERROR:
      return metaMessage ? `WhatsApp template error: ${metaMessage}` : 'WhatsApp template not found or not approved on Meta. Check your template status in Meta Business Manager.';
    case WHATSAPP_ERROR_CODES.RESOURCE_ERROR:
    case 'WHATSAPP_PHONE_NUMBER_ERROR':
      return 'WhatsApp phone number configuration is invalid. Verify the Phone Number ID in Settings → Integrations → WhatsApp.';
    case WHATSAPP_ERROR_CODES.RATE_LIMIT:
      return 'WhatsApp rate limit reached. Please try again later.';
    case WHATSAPP_ERROR_CODES.PROVIDER_ERROR:
      return 'WhatsApp service returned an error. Please try again.';
    case WHATSAPP_ERROR_CODES.NETWORK_ERROR:
      return 'Could not reach Meta WhatsApp API. Check server network connectivity.';
    case WHATSAPP_ERROR_CODES.CONFIGURATION_ERROR:
      return 'WhatsApp configuration error: Access token or Phone Number ID is invalid or failed decryption. Please re-save in Settings → Integrations → WhatsApp.';
    case WHATSAPP_ERROR_CODES.INTEGRATION_DISABLED:
      return 'WhatsApp integration is disabled in Admin Settings.';
    case WHATSAPP_ERROR_CODES.NO_PHONE:
      return 'No customer phone number found.';
    case WHATSAPP_ERROR_CODES.INVALID_PHONE:
      return 'Customer phone number is invalid.';
    case WHATSAPP_ERROR_CODES.NO_TEMPLATE_OR_MESSAGE:
      return 'No WhatsApp template or message content is configured for this stage.';
    default:
      return metaMessage ? `WhatsApp error: ${metaMessage}` : 'WhatsApp message could not be delivered. Please try again.';
  }
}
