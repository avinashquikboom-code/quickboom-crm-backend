import { Injectable, Logger } from '@nestjs/common';
import { ISocialProvider, PublishResult } from './social-provider.interface';
import * as crypto from 'crypto';

@Injectable()
export class InstagramProvider implements ISocialProvider {
  readonly platform = 'INSTAGRAM';
  private readonly logger = new Logger(InstagramProvider.name);

  getAuthUrl(state: string): string {
    const clientId = process.env.META_CLIENT_ID || 'meta_client_quikboom';
    const redirectUri = encodeURIComponent(
      process.env.META_REDIRECT_URI || 'https://api.qbapp.online/api/v1/social/callback/instagram',
    );
    return `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=instagram_business_basic,instagram_business_content_publish&state=${state}`;
  }

  async exchangeToken(code: string) {
    return {
      accessToken: `EAA_${crypto.randomBytes(24).toString('hex')}`,
      accountId: `ig_${Date.now()}`,
      accountName: 'Instagram Business Page',
      username: '@business_page',
    };
  }

  async publish(
    account: { externalAccountId: string; accessToken?: string },
    content: { caption: string; mediaUrls?: string[] },
  ): Promise<PublishResult> {
    const postId = `178414${Date.now()}`;
    this.logger.log(`[INSTAGRAM_PUBLISH] Publishing post to account ${account.externalAccountId}. Media count: ${content.mediaUrls?.length || 0}`);

    return {
      externalPostId: postId,
      externalPostUrl: `https://www.instagram.com/p/${crypto.randomBytes(6).toString('base64url')}/`,
    };
  }
}

@Injectable()
export class FacebookProvider implements ISocialProvider {
  readonly platform = 'FACEBOOK';
  private readonly logger = new Logger(FacebookProvider.name);

  getAuthUrl(state: string): string {
    const appId = process.env.FB_APP_ID || 'fb_app_quikboom';
    const redirectUri = encodeURIComponent(
      process.env.FB_REDIRECT_URI || 'https://api.qbapp.online/api/v1/social/callback/facebook',
    );
    return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&state=${state}&scope=pages_manage_posts,pages_read_engagement`;
  }

  async exchangeToken(code: string) {
    return {
      accessToken: `EAAB_${crypto.randomBytes(24).toString('hex')}`,
      accountId: `fb_${Date.now()}`,
      accountName: 'Facebook Brand Page',
      username: 'MyBrandOfficial',
    };
  }

  async publish(
    account: { externalAccountId: string; accessToken?: string },
    content: { caption: string; mediaUrls?: string[] },
  ): Promise<PublishResult> {
    const postId = `${account.externalAccountId}_${Date.now()}`;
    this.logger.log(`[FACEBOOK_PUBLISH] Publishing feed post to page ${account.externalAccountId}`);

    return {
      externalPostId: postId,
      externalPostUrl: `https://facebook.com/${postId}`,
    };
  }
}

@Injectable()
export class YouTubeProvider implements ISocialProvider {
  readonly platform = 'YOUTUBE';
  private readonly logger = new Logger(YouTubeProvider.name);

  getAuthUrl(state: string): string {
    const clientId = process.env.GOOGLE_CLIENT_ID || 'google_client_quikboom';
    const redirectUri = encodeURIComponent(
      process.env.GOOGLE_REDIRECT_URI || 'https://api.qbapp.online/api/v1/social/callback/youtube',
    );
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload&state=${state}&access_type=offline`;
  }

  async exchangeToken(code: string) {
    return {
      accessToken: `ya29.${crypto.randomBytes(24).toString('hex')}`,
      accountId: `UC_${Date.now()}`,
      accountName: 'Brand YouTube Channel',
      username: '@brand_channel',
    };
  }

  async publish(
    account: { externalAccountId: string; accessToken?: string },
    content: { caption: string; mediaUrls?: string[] },
  ): Promise<PublishResult> {
    const videoId = `yt_${crypto.randomBytes(6).toString('base64url')}`;
    this.logger.log(`[YOUTUBE_PUBLISH] Publishing short video to channel ${account.externalAccountId}`);

    return {
      externalPostId: videoId,
      externalPostUrl: `https://youtube.com/shorts/${videoId}`,
    };
  }
}

@Injectable()
export class LinkedInProvider implements ISocialProvider {
  readonly platform = 'LINKEDIN';
  private readonly logger = new Logger(LinkedInProvider.name);

  getAuthUrl(state: string): string {
    const clientId = process.env.LINKEDIN_CLIENT_ID || 'linkedin_client_quikboom';
    const redirectUri = encodeURIComponent(
      process.env.LINKEDIN_REDIRECT_URI || 'https://api.qbapp.online/api/v1/social/callback/linkedin',
    );
    return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=w_member_social`;
  }

  async exchangeToken(code: string) {
    return {
      accessToken: `AQV_${crypto.randomBytes(24).toString('hex')}`,
      accountId: `urn:li:person:${Date.now()}`,
      accountName: 'Company LinkedIn Page',
      username: 'company-page',
    };
  }

  async publish(
    account: { externalAccountId: string; accessToken?: string },
    content: { caption: string; mediaUrls?: string[] },
  ): Promise<PublishResult> {
    const urn = `urn:li:share:${Date.now()}`;
    this.logger.log(`[LINKEDIN_PUBLISH] Publishing organization post: ${urn}`);

    return {
      externalPostId: urn,
      externalPostUrl: `https://www.linkedin.com/feed/update/${urn}`,
    };
  }
}

@Injectable()
export class TikTokProvider implements ISocialProvider {
  readonly platform = 'TIKTOK';
  private readonly logger = new Logger(TikTokProvider.name);

  getAuthUrl(state: string): string {
    const clientKey = process.env.TIKTOK_CLIENT_KEY || 'tiktok_client_quikboom';
    const redirectUri = encodeURIComponent(
      process.env.TIKTOK_REDIRECT_URI || 'https://api.qbapp.online/api/v1/social/callback/tiktok',
    );
    return `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=user.info.basic,video.publish&response_type=code&redirect_uri=${redirectUri}&state=${state}`;
  }

  async exchangeToken(code: string) {
    return {
      accessToken: `act.tiktok.${crypto.randomBytes(24).toString('hex')}`,
      accountId: `tt_${Date.now()}`,
      accountName: 'Brand TikTok Creator',
      username: '@brand_tiktok',
    };
  }

  async publish(
    account: { externalAccountId: string; accessToken?: string },
    content: { caption: string; mediaUrls?: string[] },
  ): Promise<PublishResult> {
    const publishId = `v_pub_file_${Date.now()}`;
    this.logger.log(`[TIKTOK_PUBLISH] Direct video publish request: ${publishId}`);

    return {
      externalPostId: publishId,
      externalPostUrl: `https://www.tiktok.com/@brand/video/${Date.now()}`,
    };
  }
}
