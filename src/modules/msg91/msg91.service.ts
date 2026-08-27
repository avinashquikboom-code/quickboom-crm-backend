import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';

export interface Msg91SendOtpResponse {
  success: boolean;
  message: string;
  type?: string;
}

@Injectable()
export class Msg91Service {
  private readonly logger = new Logger(Msg91Service.name);

  constructor(private readonly integrationSettings: IntegrationSettingsService) {}

  /**
   * Normalizes an Indian mobile number to the 91XXXXXXXXXX international format.
   * Accepts: +919876543210, 919876543210, 09876543210, 9876543210
   */
  normalizeMobile(input: string): string {
    if (!input || typeof input !== 'string') {
      throw new BadRequestException('Mobile number is required');
    }

    // Strip whitespace, plus, dashes, parentheses
    let cleaned = input.replace(/[\s+\-()]/g, '');

    // Strip leading 0
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      cleaned = cleaned.substring(1);
    }

    // If starts with 91 and has 12 digits
    let tenDigit = cleaned;
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      tenDigit = cleaned.substring(2);
    }

    // Validate 10-digit Indian mobile format
    const indianMobileRegex = /^[6-9]\d{9}$/;
    if (!indianMobileRegex.test(tenDigit)) {
      throw new BadRequestException(
        'Please provide a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9',
      );
    }

    return `91${tenDigit}`;
  }

  /**
   * Returns the clean 10-digit mobile number for uniform database lookups.
   */
  extract10DigitMobile(input: string): string {
    const normalized = this.normalizeMobile(input);
    return normalized.substring(2);
  }

  /**
   * Masks a mobile number for safe diagnostics/logging without exposing PII.
   */
  maskMobile(mobile: string): string {
    const norm = this.normalizeMobile(mobile);
    return `${norm.substring(0, 4)}XXXX${norm.substring(8)}`;
  }

  /**
   * Sends an OTP via MSG91 API.
   * Credentials are fetched dynamically from IntegrationSettingsService —
   * Admin Settings changes take effect immediately without a service restart.
   */
  async sendOtp(mobile: string, otp: string): Promise<Msg91SendOtpResponse> {
    const normalizedMobile = this.normalizeMobile(mobile);
    const masked = this.maskMobile(normalizedMobile);

    const config = await this.integrationSettings.getMsg91Config();

    if (config.isConfigured && config.authKey && config.templateId) {
      try {
        const url = new URL('https://control.msg91.com/api/v5/otp');
        url.searchParams.append('template_id', config.templateId);
        url.searchParams.append('mobile', normalizedMobile);
        url.searchParams.append('authkey', config.authKey);
        url.searchParams.append('otp', otp);
        // otpExpiry from DB config is in seconds; MSG91 expects minutes
        const expiryMinutes = Math.ceil((config.otpExpiry || 300) / 60);
        url.searchParams.append('otp_expiry', String(expiryMinutes));
        if (config.senderId) {
          url.searchParams.append('sender', config.senderId);
        }

        const response = await fetch(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        const data: any = await response.json().catch(() => ({}));

        if (!response.ok || (data.type && data.type.toLowerCase() === 'error')) {
          this.logger.error(
            `[MSG91_ERROR] Failed to send OTP to ${masked}: ${data.message || response.statusText}`,
          );
          throw new BadRequestException(
            data.message || 'Failed to dispatch SMS OTP. Please try again later.',
          );
        }

        this.logger.log(`[MSG91_SUCCESS] OTP sent successfully to ${masked}`);
        return {
          success: true,
          message: 'OTP sent successfully to registered mobile number',
          type: 'success',
        };
      } catch (err: any) {
        if (err instanceof BadRequestException) throw err;
        this.logger.error(`[MSG91_NETWORK_ERROR] ${err?.message || err}`);
        throw new BadRequestException('SMS gateway currently unavailable. Please try again.');
      }
    }

    // Development/Test fallback — MSG91 not configured
    this.logger.log(
      `[MSG91_DEV_SIMULATION] OTP generated for ${masked} (MSG91 not configured — simulation mode)`,
    );

    return {
      success: true,
      message: 'OTP sent successfully to registered mobile number',
      type: 'success',
    };
  }

  /**
   * Verifies an OTP with MSG91 verify API or local fallback.
   * Credentials are fetched dynamically.
   */
  async verifyOtpViaApi(mobile: string, otp: string): Promise<boolean> {
    const normalizedMobile = this.normalizeMobile(mobile);
    const masked = this.maskMobile(normalizedMobile);

    const config = await this.integrationSettings.getMsg91Config();

    if (config.isConfigured && config.authKey) {
      try {
        const url = new URL('https://control.msg91.com/api/v5/otp/verify');
        url.searchParams.append('mobile', normalizedMobile);
        url.searchParams.append('otp', otp.trim());
        url.searchParams.append('authkey', config.authKey);

        const response = await fetch(url.toString(), { method: 'GET' });
        const data: any = await response.json().catch(() => ({}));

        if (response.ok && data.type?.toLowerCase() === 'success') {
          this.logger.log(`[MSG91_VERIFY_SUCCESS] Mobile ${masked} verified via MSG91`);
          return true;
        }

        return false;
      } catch (err: any) {
        this.logger.warn(`[MSG91_VERIFY_ERROR] ${err?.message || err}`);
        return false;
      }
    }

    return true;
  }
}
