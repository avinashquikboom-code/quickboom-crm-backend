import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  ParseIntPipe,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SocialAccountService } from './social-account.service';
import { SocialPublishService } from './social-publish.service';
import { ConnectSocialAccountDto, PublishContentDto } from './dto/social-publishing.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AccountGuard } from '../../common/guards/account.guard';
import {
  InstagramProvider,
  FacebookProvider,
  YouTubeProvider,
  LinkedInProvider,
  TikTokProvider,
} from './providers/platform-providers';
import * as crypto from 'crypto';

@ApiTags('Social Publishing')
@Controller()
export class SocialPublishingController {
  constructor(
    private readonly socialAccountService: SocialAccountService,
    private readonly socialPublishService: SocialPublishService,
    private readonly instagramProvider: InstagramProvider,
    private readonly facebookProvider: FacebookProvider,
    private readonly youtubeProvider: YouTubeProvider,
    private readonly linkedinProvider: LinkedInProvider,
    private readonly tiktokProvider: TikTokProvider,
  ) {}

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  private resolveCustomerId(req: any): number {
return undefined;
  }

  private getProvider(platform: string) {
    switch (platform.toUpperCase()) {
      case 'INSTAGRAM': return this.instagramProvider;
      case 'FACEBOOK':  return this.facebookProvider;
      case 'YOUTUBE':   return this.youtubeProvider;
      case 'LINKEDIN':  return this.linkedinProvider;
      case 'TIKTOK':    return this.tiktokProvider;
      default:
        throw new BadRequestException(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Create a HMAC-signed state token encoding customerId + platform.
   * Format: base64url(payload).hmac-hex
   */
  private signState(customerId: number, platform: string): string {
    const secret = process.env.JWT_SECRET || 'quikboom_production_secure_token_secret_key_3847291847';
    const payload = Buffer.from(
      JSON.stringify({  platform: platform.toUpperCase(), ts: Date.now() }),
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  /** Verify and decode a state token. Returns null if invalid or expired (>10 min). */
  private decodeState(state: string): { customerId?: number; platform: string } | null {
    try {
      const secret = process.env.JWT_SECRET || 'quikboom_production_secure_token_secret_key_3847291847';
      const dotIdx = state.lastIndexOf('.');
      if (dotIdx < 0) return null;
      const payload = state.slice(0, dotIdx);
      const sig = state.slice(dotIdx + 1);
      const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      if (sig !== expectedSig) return null;
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (Date.now() - data.ts > 10 * 60 * 1000) return null;
      return {  platform: String(data.platform) };
    } catch {
      return null;
    }
  }

  // =========================================================================
  // OAUTH CALLBACK — PUBLIC (Instagram/Meta redirects here — no JWT)
  // =========================================================================

  /**
   * Instagram redirects to GET /social/callback/instagram?code=...&state=...
   * Exchanges the code, saves the SocialAccount, returns a "success" HTML page.
   */
  @Get(['social/callback/:platform', 'api/v1/social/callback/:platform'])
  @ApiOperation({ summary: 'OAuth callback — receives authorization code from social platform' })
  async oauthCallback(
    @Param('platform') platform: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const htmlSuccess = (name: string, plat: string) =>
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected!</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0fdf4}.card{background:#fff;border-radius:16px;padding:32px 24px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:340px;width:90%}.icon{font-size:48px;margin-bottom:12px}h2{margin:0 0 8px;color:#166534}p{color:#4b5563;margin:0;font-size:14px}.chip{background:#dcfce7;color:#166534;padding:4px 14px;border-radius:99px;font-size:13px;font-weight:600;display:inline-block;margin-bottom:16px}</style></head><body><div class="card"><div class="icon">&#x2705;</div><h2>${plat} Connected!</h2><div class="chip">${name}</div><p>Your ${plat} account has been connected to QuikBoom.<br>You can close this tab and return to the app.</p></div></body></html>`;

    const htmlError = (msg: string) =>
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connection Failed</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fef2f2}.card{background:#fff;border-radius:16px;padding:32px 24px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:340px;width:90%}.icon{font-size:48px;margin-bottom:12px}h2{margin:0 0 8px;color:#991b1b}p{color:#6b7280;margin:0;font-size:14px}</style></head><body><div class="card"><div class="icon">&#x274C;</div><h2>Connection Failed</h2><p>${msg}<br>Please close this tab and try again in the app.</p></div></body></html>`;

    if (error) {
      return res.status(200).send(htmlError(`Authorization was cancelled or denied: ${error}`));
    }
    if (!code || !state) {
      return res.status(400).send(htmlError('Missing authorization code or state parameter.'));
    }

    const stateData = this.decodeState(state);
    if (!stateData) {
      return res.status(400).send(htmlError('Invalid or expired connection request. Please try again.'));
    }

    const { customerId } = stateData;
    const normalizedPlatform = platform.toUpperCase();

    try {
      const provider = this.getProvider(normalizedPlatform);
      const tokenData = await provider.exchangeToken(code);

      await this.socialAccountService.connectAccount(customerId, {
        platform: normalizedPlatform,
        accountName: tokenData.accountName || `${normalizedPlatform} Account`,
        username: tokenData.username,
        externalAccountId: tokenData.accountId || `oauth_${normalizedPlatform.toLowerCase()}_${Date.now()}`,
        accessToken: tokenData.accessToken,
      });

      return res.status(200).send(htmlSuccess(
        tokenData.accountName || `${normalizedPlatform} Account`,
        normalizedPlatform,
      ));
    } catch (err: any) {
      return res.status(500).send(htmlError(err?.message || 'An unexpected error occurred.'));
    }
  }

  // =========================================================================
  // ADMIN PANEL APIS
  // =========================================================================

  @Get('admin/social/accounts')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'View all customer connected social accounts (Admin)' })
  async getAllAccountsAdmin(@Query() query: any) {
    const data = await this.socialAccountService.getAllAccountsAdmin(query);
    return { statusCode: 200, success: true, data };
  }

  @Get('admin/social/publishes')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountGuard)
  @ApiOperation({ summary: 'View all published and scheduled posts across customers (Admin)' })
  async getAllPublishesAdmin(@Query() query: any) {
    const data = await this.socialPublishService.getAllPublishesAdmin(query);
    return { statusCode: 200, success: true, data };
  }
}
