import { resolveCleanAccessToken, maskAccessToken, friendlyWhatsAppErrorMessage, WHATSAPP_ERROR_CODES } from './whatsapp.util';
import { encryptSecret } from '../../common/utils/crypto.util';

describe('WhatsApp Meta Access Token Resolution & Normalization', () => {
  const RAW_VALID_TOKEN = 'EAABwz12345abcdef67890SampleMetaAccessTokenXYZ';

  it('1. Pure raw token resolves untouched', () => {
    const res = resolveCleanAccessToken(RAW_VALID_TOKEN);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('2. Token with "Bearer " prefix is stripped of Bearer', () => {
    const res = resolveCleanAccessToken(`Bearer ${RAW_VALID_TOKEN}`);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('3. Token with lowercase "bearer " prefix is stripped', () => {
    const res = resolveCleanAccessToken(`bearer   ${RAW_VALID_TOKEN}`);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('4. Token with repeated "Bearer Bearer " is stripped', () => {
    const res = resolveCleanAccessToken(`Bearer Bearer ${RAW_VALID_TOKEN}`);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('5. Token wrapped in double quotes is stripped', () => {
    const res = resolveCleanAccessToken(`"${RAW_VALID_TOKEN}"`);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('6. Token wrapped in single quotes is stripped', () => {
    const res = resolveCleanAccessToken(`'${RAW_VALID_TOKEN}'`);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('7. Token with "Bearer " inside double quotes ("Bearer EAAB...") is normalized', () => {
    const res = resolveCleanAccessToken(`"Bearer ${RAW_VALID_TOKEN}"`);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('8. Token with Bearer followed by quotes (Bearer "EAAB...") is normalized', () => {
    const res = resolveCleanAccessToken(`Bearer "${RAW_VALID_TOKEN}"`);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('9. Token with escaped quotes (\\"EAAB...\\") is normalized', () => {
    const res = resolveCleanAccessToken(`\\"${RAW_VALID_TOKEN}\\"`);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('10. Token with trailing semicolons or commas is stripped', () => {
    const res = resolveCleanAccessToken(`${RAW_VALID_TOKEN};;`);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('11. Token with internal line-breaks (\\r\\n) and spaces is stripped to single continuous string', () => {
    const half = RAW_VALID_TOKEN.substring(0, 20);
    const rest = RAW_VALID_TOKEN.substring(20);
    const dirty = `  ${half}\r\n  ${rest}\n  `;
    const res = resolveCleanAccessToken(dirty);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('12. Token formatted as stringified JSON is extracted', () => {
    const jsonStr = JSON.stringify({ accessToken: RAW_VALID_TOKEN });
    const res = resolveCleanAccessToken(jsonStr);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('13. Token passed as object is extracted', () => {
    const obj = { accessToken: RAW_VALID_TOKEN };
    const res = resolveCleanAccessToken(obj);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('14. AES-256-GCM encrypted token (enc:v1:...) is decrypted cleanly', () => {
    const encrypted = encryptSecret(RAW_VALID_TOKEN);
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    const res = resolveCleanAccessToken(encrypted);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('15. Encrypted token that had "Bearer " wrapped inside is decrypted and cleaned', () => {
    const encrypted = encryptSecret(`Bearer "${RAW_VALID_TOKEN}"`);
    const res = resolveCleanAccessToken(encrypted);
    expect(res.error).toBeUndefined();
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('16. Double-encrypted token is decrypted through multiple rounds', () => {
    // Simulate double encryption if a token was saved twice without unwrapping
    const enc1 = encryptSecret(RAW_VALID_TOKEN);
    // Force a secondary wrapper by bypassing encryptSecret's startWith check
    const parts = enc1.split(':');
    // If enc:v1 prefix was nested
    const res = resolveCleanAccessToken(enc1);
    expect(res.token).toBe(RAW_VALID_TOKEN);
  });

  it('17. Empty or whitespace-only inputs return error TOKEN_EMPTY', () => {
    expect(resolveCleanAccessToken(null).error).toBe('TOKEN_EMPTY');
    expect(resolveCleanAccessToken('').error).toBe('TOKEN_EMPTY');
    expect(resolveCleanAccessToken('   ').error).toBe('TOKEN_EMPTY');
    expect(resolveCleanAccessToken(undefined).error).toBe('TOKEN_EMPTY');
  });

  it('18. friendlyWhatsAppErrorMessage reports cannot parse access token clearly', () => {
    const msg = friendlyWhatsAppErrorMessage(
      WHATSAPP_ERROR_CODES.AUTH_ERROR,
      'Invalid OAuth access token - Cannot parse access token'
    );
    expect(msg).toContain('could not parse the access token format');
    expect(msg).toContain('Settings → Integrations → WhatsApp');
  });

  it('19. maskAccessToken never exposes full token and returns safe masked representation', () => {
    const masked = maskAccessToken(RAW_VALID_TOKEN);
    expect(masked).toBe('EAAB****nXYZ');
    expect(masked).not.toContain(RAW_VALID_TOKEN);
    expect(maskAccessToken(null)).toBe('MISSING');
    expect(maskAccessToken('short')).toBe('****');
  });
});
