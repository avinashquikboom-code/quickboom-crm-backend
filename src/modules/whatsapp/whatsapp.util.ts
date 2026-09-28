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
  AUTH_ERROR: 'WHATSAPP_AUTH_ERROR',             // 401 / code 190 (Token expired or invalid)
  PERMISSION_ERROR: 'WHATSAPP_PERMISSION_ERROR',  // 403 / code 200-299 / code 10
  REQUEST_ERROR: 'WHATSAPP_REQUEST_ERROR',        // 400 (bad payload, missing fields)
  RESOURCE_ERROR: 'WHATSAPP_RESOURCE_ERROR',      // 404 (wrong Phone Number ID or WABA ID)
  TEMPLATE_ERROR: 'WHATSAPP_TEMPLATE_ERROR',      // 400 / code 132001 (template not found/inactive)
  WINDOW_EXPIRED: 'WHATSAPP_WINDOW_EXPIRED',      // 400 / code 131047 (24h customer window closed)
  RECIPIENT_NOT_ALLOWED: 'WHATSAPP_RECIPIENT_NOT_ALLOWED', // 400 / code 131030 (test number not allowlisted)
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
export function classifyWhatsAppError(httpStatus?: number, metaCode?: string | number, metaType?: string, metaMessage?: string): string {
  const codeStr = metaCode ? String(metaCode) : '';
  const numCode = Number(metaCode);
  const msgLower = (metaMessage || '').toLowerCase();

  // 1. Genuine Authentication Failure: Meta error code 190 or HTTP 401
  // (NOTE: Meta returns type: "OAuthException" for almost ALL errors, so do NOT treat OAuthException alone as auth error!)
  if (codeStr === '190' || httpStatus === 401 || msgLower.includes('error validating access token') || msgLower.includes('session has expired')) {
    return WHATSAPP_ERROR_CODES.AUTH_ERROR;
  }

  // 2. 24-hour customer service window closed: Free-form text cannot be sent outside 24h window
  if (codeStr === '131047' || msgLower.includes('re-engagement message') || msgLower.includes('24 hours')) {
    return WHATSAPP_ERROR_CODES.WINDOW_EXPIRED;
  }

  // 3. Test recipient not allowlisted: In dev mode, recipient must be added in Meta Developer Portal
  if (codeStr === '131030' || codeStr === '131026' || msgLower.includes('recipient phone number not in allowed list')) {
    return WHATSAPP_ERROR_CODES.RECIPIENT_NOT_ALLOWED;
  }

  // 4. Template errors (132000-132016 or template text in message)
  if (
    codeStr === '132001' ||
    (!isNaN(numCode) && numCode >= 132000 && numCode <= 132016) ||
    msgLower.includes('template')
  ) {
    return WHATSAPP_ERROR_CODES.TEMPLATE_ERROR;
  }

  // 5. Permission errors (HTTP 403 or Meta codes 200-299, code 10, code 3)
  if (httpStatus === 403 || (!isNaN(numCode) && numCode >= 200 && numCode <= 299) || codeStr === '10' || codeStr === '3') {
    return WHATSAPP_ERROR_CODES.PERMISSION_ERROR;
  }

  // 6. Resource errors (HTTP 404 or Phone Number ID not found / unsupported object)
  if (httpStatus === 404 || msgLower.includes('does not exist') || msgLower.includes('unsupported get request') || msgLower.includes('unsupported post request')) {
    return WHATSAPP_ERROR_CODES.RESOURCE_ERROR;
  }

  // 7. Rate limiting (HTTP 429 or Meta code 130429, 4, 17)
  if (httpStatus === 429 || codeStr === '130429' || codeStr === '4' || codeStr === '17') {
    return WHATSAPP_ERROR_CODES.RATE_LIMIT;
  }

  // 8. Meta upstream provider/server errors (5xx)
  if (httpStatus && httpStatus >= 500) {
    return WHATSAPP_ERROR_CODES.PROVIDER_ERROR;
  }

  // 9. Bad request / invalid parameter errors (HTTP 400 or code 100)
  if (httpStatus === 400 || codeStr === '100') {
    return WHATSAPP_ERROR_CODES.REQUEST_ERROR;
  }

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
      return 'WhatsApp authentication failed: Meta Access Token is invalid or expired (Meta Error 190). Please generate a permanent System User token in Meta Business Suite and update it in Settings → Integrations → WhatsApp.';
    }
    case WHATSAPP_ERROR_CODES.WINDOW_EXPIRED:
      return 'WhatsApp 24-hour service window closed: Free-form text messages can only be sent within 24 hours of a customer replying. To contact customers outside this 24-hour window, use an approved WhatsApp Message Template.';
    case WHATSAPP_ERROR_CODES.RECIPIENT_NOT_ALLOWED:
      return metaMessage ? `WhatsApp recipient rejected: ${metaMessage}. If using a Meta development number, the recipient number must be added to the allowed phone numbers list in Meta Developer Portal.` : 'WhatsApp recipient phone number is not allowed. In development mode, add this number to the allowed list in Meta Developer Portal.';
    case WHATSAPP_ERROR_CODES.PERMISSION_ERROR:
      return metaMessage ? `WhatsApp permission denied (HTTP 403): ${metaMessage}. Check your Meta App permissions (whatsapp_business_messaging, whatsapp_business_management).` : 'WhatsApp access is not permitted for this account. Check your Meta App permissions.';
    case WHATSAPP_ERROR_CODES.REQUEST_ERROR:
      return metaMessage ? `WhatsApp rejected the message request: ${metaMessage}` : 'WhatsApp rejected the message request. Please check message configuration.';
    case WHATSAPP_ERROR_CODES.TEMPLATE_ERROR:
      return metaMessage ? `WhatsApp template error: ${metaMessage}` : 'WhatsApp template not found or not approved on Meta. Check your template status in Meta Business Manager.';
    case WHATSAPP_ERROR_CODES.RESOURCE_ERROR:
    case 'WHATSAPP_PHONE_NUMBER_ERROR':
      return metaMessage ? `WhatsApp resource error: ${metaMessage}. Verify the Phone Number ID in Settings → Integrations → WhatsApp.` : 'WhatsApp phone number configuration is invalid. Verify the Phone Number ID in Settings → Integrations → WhatsApp.';
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
