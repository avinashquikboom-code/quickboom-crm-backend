import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Derives a consistent 32-byte key from the application encryption key / JWT secret.
 */
function getMasterKey(): Buffer {
  const masterSecret =
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'quikboom_crm_enterprise_secret_encryption_key_2026_safe';

  return crypto.createHash('sha256').update(masterSecret).digest();
}

/**
 * Encrypts plain text using AES-256-GCM.
 * Output format: `enc:v1:<hex_iv>:<hex_auth_tag>:<hex_ciphertext>`
 */
export function encryptSecret(plainText: string): string {
  if (!plainText || plainText.trim().length === 0) {
    return '';
  }

  // If already encrypted with our format, return as is
  if (plainText.startsWith('enc:v1:')) {
    return plainText;
  }

  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts AES-256-GCM encrypted string.
 * If input is not encrypted or format is unrecognized, returns input as fallback.
 *
 * IMPORTANT: If decryption fails (e.g. ENCRYPTION_KEY rotated since token was saved),
 * returns "" and logs a safe warning — never exposes the ciphertext.
 */
export function decryptSecret(cipherText: string): string {
  if (!cipherText || !cipherText.startsWith('enc:v1:')) {
    return cipherText || '';
  }

  try {
    const parts = cipherText.split(':');
    if (parts.length !== 5) {
      return cipherText;
    }

    const ivHex = parts[2];
    const authTagHex = parts[3];
    const encryptedHex = parts[4];

    const key = getMasterKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encryptedText = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encryptedText),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (_err) {
    // SAFE WARNING: Do NOT log the cipherText or any secret value.
    // This fires when ENCRYPTION_KEY / JWT_SECRET changed after the credential was saved.
    // Action: Verify ENCRYPTION_KEY in .env is unchanged, then re-save the affected integration.
    const ivFingerprint = cipherText.length > 20 ? cipherText.substring(7, 13) : 'unknown';
    console.warn(
      `[CRYPTO_DECRYPT_FAILURE] AES-256-GCM decryption failed. ` +
      `This usually means ENCRYPTION_KEY or JWT_SECRET changed after the credential was encrypted. ` +
      `IV-prefix: ${ivFingerprint}... ` +
      `Action: Re-save the affected integration in Admin → Settings → Integrations.`,
    );
    return '';
  }
}

/**
 * Safely masks sensitive keys for display in Admin Panel UI.
 * e.g., 'rzp_sec_live_9876543210' -> 'rzp_sec_***3210'
 */
export function maskSecret(secret: string): string {
  if (!secret || secret.trim().length === 0) {
    return '';
  }

  const clean = secret.startsWith('enc:v1:') ? decryptSecret(secret) : secret;
  if (!clean || clean.length <= 6) {
    return '******';
  }

  const prefix = clean.substring(0, Math.min(8, Math.floor(clean.length / 3)));
  const suffix = clean.substring(clean.length - 4);
  return `${prefix}***${suffix}`;
}

/**
 * Strips whitespace, carriage returns, tabs, zero-width characters, and control characters.
 */
export function sanitizeSecret(secret: string): string {
  if (!secret) return '';
  return String(secret)
    .replace(/[\r\n\t\s\u200B-\u200D\uFEFF]/g, '')
    .trim();
}
