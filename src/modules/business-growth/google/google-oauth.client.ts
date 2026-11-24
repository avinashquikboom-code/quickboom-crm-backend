import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';

export const GOOGLE_GROWTH_SCOPES = ['https://www.googleapis.com/auth/adwords', 'https://www.googleapis.com/auth/business.manage'];

/** OAuth protocol operations only. The caller must validate a single-use state before exchanging a code. */
@Injectable()
export class GoogleOAuthClient {
  private config() {
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: redirectUri } = process.env;
    const missing = [!clientId && 'GOOGLE_CLIENT_ID', !clientSecret && 'GOOGLE_CLIENT_SECRET', !redirectUri && 'GOOGLE_REDIRECT_URI'].filter(Boolean);
    if (missing.length) throw new ServiceUnavailableException(`Missing Google OAuth configuration: ${missing.join(', ')}`);
    return { clientId, clientSecret, redirectUri };
  }
  authorizationUrl(state: string, codeChallenge: string): string {
    const { clientId, redirectUri } = this.config();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    const params = { client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_GROWTH_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: codeChallenge, code_challenge_method: 'S256' };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }
  private async tokenRequest(params: Record<string, string>) {
    const { clientId, clientSecret } = this.config();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new BadGatewayException({ message: 'Google OAuth token request failed', providerStatus: response.status });
    return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string; token_type: string }>;
  }
  async exchangeCode(code: string, verifier: string) {
    const { redirectUri } = this.config();
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
  }
  async refresh(refreshToken: string) {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }
}
