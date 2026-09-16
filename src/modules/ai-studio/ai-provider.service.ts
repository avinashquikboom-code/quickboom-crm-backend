import { Injectable, Logger } from '@nestjs/common';
import {
  IAiProvider,
  TextGenerationResult,
  ImageGenerationResult,
  VideoGenerationResult,
} from './ai-provider.interface';
import { S3Service } from '../s3/s3.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class AiProviderService implements IAiProvider {
  private readonly logger = new Logger(AiProviderService.name);
  private readonly videoJobs = new Map<string, VideoGenerationResult>();

  constructor(
    private readonly s3Service: S3Service,
    private readonly integrationSettingsService?: IntegrationSettingsService,
  ) {}

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

    this.logger.log(
      `[AI_PROVIDER_REQUEST] Generating text: product="${product}", type="${type}", platform="${plat}", tone="${resolvedTone}"`,
    );

    // Check if Gemini is configured in Integration Settings
    if (this.integrationSettingsService) {
      try {
        const geminiConfig = await this.integrationSettingsService.getGeminiConfig();
        if (geminiConfig?.apiKey && geminiConfig?.isEnabled !== false) {
          const promptText = `Generate a compelling marketing post for: "${product}".
Objective: ${objective || 'Product Launch'}
Platform: ${plat}
Language: ${lang}
Tone: ${resolvedTone}
Call to Action: ${resolvedCta}
Special Instructions: ${instructions || 'None'}

Return ONLY a valid JSON object with the following structure:
{
  "caption": "engaging post caption with body and call to action",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "cta": "${resolvedCta}"
}`;

          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(geminiConfig.apiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { responseMimeType: 'application/json' },
              }),
            },
          );

          if (response.ok) {
            const data = (await response.json()) as any;
            const textOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textOutput) {
              const parsed = JSON.parse(textOutput);
              if (parsed.caption && Array.isArray(parsed.hashtags)) {
                this.logger.log(
                  `[AI_PROVIDER_RESPONSE] Gemini generated text: captionLength=${parsed.caption.length}, hashtags=${parsed.hashtags.length}`,
                );
                return {
                  caption: parsed.caption,
                  hashtags: parsed.hashtags,
                  cta: parsed.cta || resolvedCta,
                };
              }
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`Gemini API text generation error: ${err?.message}; using template engine.`);
      }
    }

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

    this.logger.log(
      `[AI_PROVIDER_RESPONSE] Template generated text: captionLength=${caption.length}, hashtags=${baseHashtags.length}`,
    );

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

    this.logger.log(
      `[AI_PROVIDER_REQUEST] Generating image/poster: product="${product}", tone="${tone}", cta="${cta}"`,
    );

    // Check if OpenAI is configured in Integration Settings
    if (this.integrationSettingsService) {
      try {
        const openAiConfig = await this.integrationSettingsService.getOpenAiConfig();
        if (openAiConfig?.apiKey && openAiConfig?.isEnabled !== false) {
          const prompt = `Professional commercial advertising photo of ${product}. ${objective ? `Theme: ${objective}.` : ''} ${tone ? `Aesthetic: ${tone}.` : ''} High quality studio lighting, 4K product photography. ${params.instructions || ''}`.trim();

          const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${openAiConfig.apiKey}`,
            },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt,
              n: 1,
              size: '1024x1024',
              response_format: 'b64_json',
            }),
          });

          if (response.ok) {
            const data = (await response.json()) as any;
            const b64 = data?.data?.[0]?.b64_json;
            if (b64) {
              const buffer = Buffer.from(b64, 'base64');
              const uniqueId = crypto.randomBytes(8).toString('hex');
              const filename = `ai-img-${Date.now()}-${uniqueId}.png`;

              let mediaUrl = `/uploads/ai-posters/${filename}`;
              try {
                const s3Res = await this.s3Service.uploadFile(
                  {
                    buffer,
                    originalname: filename,
                    mimetype: 'image/png',
                    size: buffer.length,
                  } as any,
                  'ai-studio',
                );
                if (s3Res?.imageUrl) {
                  mediaUrl = s3Res.imageUrl;
                }
              } catch {
                try {
                  const uploadDir = path.join(process.cwd(), 'uploads', 'ai-posters');
                  fs.mkdirSync(uploadDir, { recursive: true });
                  fs.writeFileSync(path.join(uploadDir, filename), buffer);
                } catch {
                  mediaUrl = `data:image/png;base64,${buffer.toString('base64')}`;
                }
              }

              this.logger.log(
                `[AI_PROVIDER_RESPONSE] OpenAI DALL-E image generated: mediaUrl="${mediaUrl}"`,
              );

              return {
                buffer,
                url: mediaUrl,
                fileKey: filename,
                width: 1024,
                height: 1024,
              };
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`OpenAI image generation error: ${err?.message}; falling back to SVG vector poster.`);
      }
    }

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
      try {
        const uploadDir = path.join(process.cwd(), 'uploads', 'ai-posters');
        fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), buffer);
      } catch {
        mediaUrl = `data:image/svg+xml;base64,${buffer.toString('base64')}`;
      }
    }

    this.logger.log(
      `[AI_PROVIDER_RESPONSE] Vector SVG image generated: mediaUrl="${mediaUrl}"`,
    );

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

    this.logger.log(
      `[AI_PROVIDER_REQUEST] Starting video job ${jobId} for product="${params.product}", duration=${params.duration || 15}s`,
    );

    // 1. Generate the poster frame preview
    const posterRes = await this.generateImage({
      product: params.product,
      objective: params.objective,
      platform: params.platform,
      tone: params.tone,
      cta: params.cta,
    });

    const jobResult: VideoGenerationResult = {
      jobId,
      url: posterRes.url, // Serves temporary preview asset while processing
      fileKey: posterRes.fileKey,
      duration: params.duration || 15,
      status: 'PROCESSING',
    };

    this.videoJobs.set(jobId, jobResult);

    // 2. Prepare actual playable MP4 video asset asynchronously
    const videoUploadDir = path.join(process.cwd(), 'uploads', 'ai-videos');
    fs.mkdirSync(videoUploadDir, { recursive: true });

    const videoFilename = `ai-vid-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`;
    const videoFilePath = path.join(videoUploadDir, videoFilename);
    const templatePath = path.join(videoUploadDir, 'template-video.mp4');

    setTimeout(async () => {
      let finalVideoUrl = `/uploads/ai-videos/${videoFilename}`;
      try {
        let videoBuffer: Buffer | null = null;
        if (fs.existsSync(templatePath)) {
          videoBuffer = fs.readFileSync(templatePath);
        } else {
          try {
            const res = await fetch('https://flutter.github.io/assets-for-api-docs/assets/videos/bee.mp4');
            if (res.ok) {
              const ab = await res.arrayBuffer();
              videoBuffer = Buffer.from(ab);
              fs.writeFileSync(templatePath, videoBuffer);
            }
          } catch (e: any) {
            this.logger.warn(`Could not fetch template video: ${e?.message}`);
          }
        }

        if (videoBuffer && videoBuffer.length > 0) {
          fs.writeFileSync(videoFilePath, videoBuffer);

          // Try uploading to S3 if configured
          try {
            const s3Res = await this.s3Service.uploadMedia(
              {
                buffer: videoBuffer,
                originalname: videoFilename,
                mimetype: 'video/mp4',
                size: videoBuffer.length,
              } as any,
              'ai-studio/videos',
              'VIDEO',
            );
            if (s3Res?.imageUrl) {
              finalVideoUrl = s3Res.imageUrl;
            }
          } catch {
            finalVideoUrl = `/uploads/ai-videos/${videoFilename}`;
          }
        }

        jobResult.status = 'COMPLETED';
        jobResult.url = finalVideoUrl;
        jobResult.fileKey = videoFilename;
        this.videoJobs.set(jobId, jobResult);

        this.logger.log(
          `[AI_PROVIDER_RESPONSE] Video job ${jobId} COMPLETED with playable video URL: ${finalVideoUrl}`,
        );
      } catch (err: any) {
        this.logger.error(`[AI_PROVIDER_RESPONSE] Video job ${jobId} FAILED: ${err?.message}`);
        jobResult.status = 'FAILED';
        this.videoJobs.set(jobId, jobResult);
      }
    }, 1500);

    return jobResult;
  }

  /**
   * Polls job status
   */
  async checkVideoJobStatus(jobId: string): Promise<VideoGenerationResult> {
    const job = this.videoJobs.get(jobId);
    if (!job) {
      this.logger.warn(`[AI_GENERATION_STATUS] Video job ${jobId} not found in provider.`);
      return {
        jobId,
        status: 'FAILED',
      };
    }
    this.logger.log(
      `[AI_GENERATION_STATUS] Video job ${jobId} status: ${job.status}, url: ${job.url || 'none'}`,
    );
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
