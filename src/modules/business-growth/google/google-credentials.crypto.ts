import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** AES-256-GCM: separate nonce and authentication tag for every credential. */
@Injectable()
export class GoogleCredentialsCrypto {
  private key(): Buffer {
    const encoded = process.env.GOOGLE_INTEGRATION_ENCRYPTION_KEY;
    if (!encoded || !/^[a-fA-F0-9]{64}$/.test(encoded)) {
      throw new ServiceUnavailableException('GOOGLE_INTEGRATION_ENCRYPTION_KEY must be a 32-byte hex key');
    }
    return Buffer.from(encoded, 'hex');
  }
  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }
  decrypt(value: string): string {
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid encrypted credential');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  }
}
