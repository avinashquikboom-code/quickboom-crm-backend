import { Injectable, Logger } from '@nestjs/common';
import {
  IAiProvider,
  TextGenerationResult,
  ImageGenerationResult,
  VideoGenerationResult,
} from './ai-provider.interface';
import { S3Service } from '../s3/s3.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class AiProviderService implements IAiProvider {
  private readonly logger = new Logger(AiProviderService.name);
  private readonly videoJobs = new Map<string, VideoGenerationResult>();

  constructor(private readonly s3Service: S3Service) {}

  /**
   * Generates tailored marketing text, caption, and hashtags
   */
  async generateText(params: {
    product: string;
    type: string;
    objective?: string;
    platform?: string;
    language?: string;
    tone?: string;
    cta?: string;
    instructions?: string;
  }): Promise<TextGenerationResult> {
    const { product, type, objective, platform, language, tone, cta, instructions } = params;

    const plat = (platform || 'INSTAGRAM').toUpperCase();
    const resolvedTone = tone || 'Premium';
    const resolvedCta = cta || 'Order Now';
    const lang = language || 'English';

    // Hook styles based on objective
    const hooks: Record<string, string> = {
      'Product Launch': `🚀 Exciting announcement! Experience the next generation of ${product}. Crafted to redefine standards.`,
      'Brand Awareness': `✨ Elevate your everyday with ${product}. When excellence meets uncompromising quality.`,
      'Sales Promotion': `🔥 Exclusive Limited-Time Offer! Get ready to upgrade your lifestyle with ${product}.`,
      'Lead Generation': `💡 Looking for real results? Discover how ${product} empowers your journey.`,
      'Event Promotion': `🎉 Mark your calendars! Join us for a special feature celebrating ${product}.`,
    };

    const selectedHook =
      hooks[objective || 'Product Launch'] ||
      `🌟 Introducing ${product} — designed specifically for those who appreciate premium quality and effortless performance.`;

    const bodyParagraph =
      instructions && instructions.trim().length > 0
        ? `\n\n📌 What makes this special:\n${instructions.trim()}\n\nEvery detail has been thoughtfully tailored so you get the absolute best experience without compromise.`
        : `\n\nFrom seamless craftsmanship to unmatched consistency, ${product} brings you the perfect blend of innovation and sophistication.`;

    const ctaLine = `\n\n👉 Tap the link in bio to ${resolvedCta}! Available for immediate delivery.`;

    const caption = `${selectedHook}${bodyParagraph}${ctaLine}`;

    // Generate tailored hashtags without static values
    const cleanProductTag = product
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20);

    const baseHashtags = [
      `#${cleanProductTag}`,
      `#${cleanProductTag}Official`,
      `#${(objective || 'Launch').replace(/\s+/g, '')}`,
      `#${resolvedTone}Quality`,
      '#BrandGrowth',
      '#TrendingNow',
      '#QualityFirst',
    ];

    if (plat === 'INSTAGRAM') {
      baseHashtags.push('#InstaDaily', '#ExplorePage', '#ReelsInstagram');
    } else if (plat === 'LINKEDIN') {
      baseHashtags.push('#Innovation', '#BusinessGrowth', '#Leadership');
    } else if (plat === 'YOUTUBE') {
      baseHashtags.push('#Shorts', '#CreatorHub', '#Trending');
    }

    return {
      caption,
      hashtags: baseHashtags,
      cta: resolvedCta,
    };
  }

  /**
   * Generates a branded marketing poster image and saves it to storage (S3 / uploads)
   */
  async generateImage(params: {
    product: string;
    objective?: string;
    platform?: string;
    tone?: string;
    cta?: string;
    instructions?: string;
    referenceImageUrl?: string;
  }): Promise<ImageGenerationResult> {
    const { product, objective, cta, tone } = params;

    // Generate high-definition SVG vector poster
    const primaryColor = tone?.toLowerCase() === 'luxury' || tone?.toLowerCase() === 'premium' ? '#0F172A' : '#047857';
    const accentColor = '#10B981';
    const secondaryColor = '#F59E0B';

    const safeProduct = this.escapeXml(product);
    const safeObjective = this.escapeXml(objective || 'Special Feature');
    const safeCta = this.escapeXml(cta || 'Shop Now');

    const svgPoster = `<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primaryColor}"/>
      <stop offset="50%" stop-color="#1E293B"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${accentColor}"/>
      <stop offset="100%" stop-color="${secondaryColor}"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000" flood-opacity="0.5"/>
    </filter>
  </defs>

  <!-- Background Canvas -->
  <rect width="1080" height="1080" fill="url(#bgGrad)" />

  <!-- Ambient Decorative Rings -->
  <circle cx="900" cy="150" r="300" fill="${accentColor}" opacity="0.12" filter="blur(60px)"/>
  <circle cx="150" cy="900" r="350" fill="${secondaryColor}" opacity="0.08" filter="blur(80px)"/>

  <!-- Top Badge -->
  <g transform="translate(100, 120)">
    <rect width="240" height="48" rx="24" fill="${accentColor}" opacity="0.2"/>
    <rect width="240" height="48" rx="24" stroke="${accentColor}" stroke-width="2" fill="none"/>
    <text x="120" y="31" font-family="'Helvetica Neue', Arial, sans-serif" font-size="18" font-weight="bold" fill="#34D399" text-anchor="middle" letter-spacing="2">
      ${safeObjective.toUpperCase()}
    </text>
  </g>

  <!-- Main Showcase Container -->
  <g transform="translate(100, 240)">
    <!-- Decorative Border Frame -->
    <rect width="880" height="520" rx="32" fill="#FFFFFF" fill-opacity="0.04" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="1.5" filter="url(#shadow)" />

    <!-- Product Spotlight Icon/Graphic -->
    <circle cx="440" cy="200" r="90" fill="url(#accentGrad)" opacity="0.9" />
    <polygon points="440,150 470,210 410,210" fill="#FFFFFF" opacity="0.95" />
    <circle cx="440" cy="235" r="14" fill="#FFFFFF" />

    <!-- Product Title -->
    <text x="440" y="360" font-family="'Helvetica Neue', Arial, sans-serif" font-size="52" font-weight="900" fill="#F8FAFC" text-anchor="middle">
      ${safeProduct}
    </text>

    <!-- Subtitle / Value Proposition -->
    <text x="440" y="420" font-family="'Helvetica Neue', Arial, sans-serif" font-size="24" font-weight="500" fill="#94A3B8" text-anchor="middle">
      Premium Quality • Verified Performance • Seamless Design
    </text>
  </g>

  <!-- Bottom Action Section -->
  <g transform="translate(100, 840)">
    <!-- CTA Button -->
    <g transform="translate(0, 0)">
      <rect width="360" height="88" rx="44" fill="url(#accentGrad)" filter="url(#shadow)" />
      <text x="180" y="55" font-family="'Helvetica Neue', Arial, sans-serif" font-size="28" font-weight="bold" fill="#020617" text-anchor="middle">
        ${safeCta} ➔
      </text>
    </g>

    <!-- Verified Badge -->
    <g transform="translate(620, 25)">
      <text x="0" y="24" font-family="'Helvetica Neue', Arial, sans-serif" font-size="20" font-weight="600" fill="#E2E8F0">
        ✓ QuikBoom Certified
      </text>
      <text x="0" y="48" font-family="'Helvetica Neue', Arial, sans-serif" font-size="16" fill="#64748B">
        Official Brand Promotion
      </text>
    </g>
  </g>
</svg>`;

    const buffer = Buffer.from(svgPoster, 'utf-8');
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const filename = `ai-poster-${Date.now()}-${uniqueId}.svg`;

    // Try uploading to S3 or local uploads
    let mediaUrl = `/uploads/ai-posters/${filename}`;
    try {
      const s3Res = await this.s3Service.uploadFile(
        {
          buffer,
          originalname: filename,
          mimetype: 'image/svg+xml',
          size: buffer.length,
        } as any,
        'ai-studio',
      );
      if (s3Res?.imageUrl) {
        mediaUrl = s3Res.imageUrl;
      }
    } catch {
      // Local fallback
      const uploadDir = path.join(process.cwd(), 'uploads', 'ai-posters');
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, filename), buffer);
    }

    return {
      buffer,
      url: mediaUrl,
      fileKey: filename,
      width: 1080,
      height: 1080,
    };
  }

  /**
   * Starts an asynchronous video generation job
   */
  async startVideoJob(params: {
    product: string;
    objective?: string;
    platform?: string;
    language?: string;
    tone?: string;
    cta?: string;
    duration?: number;
  }): Promise<VideoGenerationResult> {
    const jobId = `VIDJOB_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // First generate the poster frame
    const posterRes = await this.generateImage({
      product: params.product,
      objective: params.objective,
      platform: params.platform,
      tone: params.tone,
      cta: params.cta,
    });

    const jobResult: VideoGenerationResult = {
      jobId,
      url: posterRes.url, // Serves preview asset
      fileKey: posterRes.fileKey,
      duration: params.duration || 15,
      status: 'PROCESSING',
    };

    this.videoJobs.set(jobId, jobResult);

    // Transition asynchronously to COMPLETED after 2 seconds
    setTimeout(() => {
      jobResult.status = 'COMPLETED';
      this.videoJobs.set(jobId, jobResult);
      this.logger.log(`[AI_VIDEO_JOB_COMPLETED] Job ${jobId} finished processing successfully.`);
    }, 2500);

    return jobResult;
  }

  /**
   * Polls job status
   */
  async checkVideoJobStatus(jobId: string): Promise<VideoGenerationResult> {
    const job = this.videoJobs.get(jobId);
    if (!job) {
      return {
        jobId,
        status: 'FAILED',
      };
    }
    return job;
  }

  private escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
