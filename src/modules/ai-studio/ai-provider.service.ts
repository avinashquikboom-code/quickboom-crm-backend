import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import {
  IAiProvider,
  TextGenerationResult,
  ImageGenerationResult,
  VideoGenerationResult,
} from './ai-provider.interface';
import { S3Service } from '../s3/s3.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import * as crypto from 'crypto';

@Injectable()
export class AiProviderService implements IAiProvider {
  private readonly logger = new Logger(AiProviderService.name);
  private readonly videoJobs = new Map<string, VideoGenerationResult>();

  constructor(
    private readonly s3Service: S3Service,
    private readonly integrationSettingsService?: IntegrationSettingsService,
  ) {}

  private async getGeminiKey(): Promise<string | null> {
    if (this.integrationSettingsService) {
      try {
        const conf = await this.integrationSettingsService.getGeminiConfig();
        if (conf?.apiKey && conf?.isEnabled !== false) {
          return conf.apiKey.trim();
        }
      } catch {}
    }
    return null;
  }

  private async getOpenAiKey(): Promise<string | null> {
    if (this.integrationSettingsService) {
      try {
        const conf = await this.integrationSettingsService.getOpenAiConfig();
        if (conf?.apiKey && conf?.isEnabled !== false) {
          return conf.apiKey.trim();
        }
      } catch {}
    }
    return null;
  }

  /**
   * Generates REAL AI marketing text, captions, and hashtags
   * Priority: Google Gemini -> OpenAI -> Pollinations Live LLM
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
    const resolvedTone = tone || 'Professional & Engaging';
    const resolvedCta = cta || 'Learn More';
    const lang = language || 'English';

    let promptSystem = 'You are an elite, highly creative marketing and social media copywriter. Output strictly a single JSON object with three keys: "caption" (string with engaging copy, line breaks, and emojis), "hashtags" (array of 6 to 12 strings, each starting with #), and "cta" (string with clear call to action).';

    let promptUser = `Create high-converting social media content for: "${product}".
Campaign Objective: ${objective || 'Engagement and Conversions'}
Platform: ${plat}
Language: ${lang}
Tone of Voice: ${resolvedTone}
Call to Action: ${resolvedCta}
Special Instructions: ${instructions || 'None'}`;

    if (type === 'CAPTION') {
      promptSystem = 'You are a social media specialist. Output strictly a JSON object with keys: "caption" (concise, catchy post caption with emojis), "hashtags" (array of 8 to 15 relevant hashtags starting with #), and "cta" (short action phrase).';
      promptUser = `Write an engaging caption and trending hashtags for: "${product}". Platform: ${plat}. Tone: ${resolvedTone}. Language: ${lang}. CTA: ${resolvedCta}.`;
    } else if (type === 'HASHTAGS') {
      promptSystem = 'You are an SEO and hashtag researcher. Output strictly a JSON object with keys: "caption" (short 1-line intro), "hashtags" (array of 15 to 20 trending high-traffic hashtags starting with #), and "cta" (short CTA).';
      promptUser = `Generate trending and targeted hashtags for: "${product}" on ${plat}. Language: ${lang}.`;
    } else if (type === 'VIDEO') {
      promptSystem = 'You are a video scriptwriter for short-form video reels. Output strictly a JSON object with keys: "caption" (detailed script breakdown with Hook, Scene-by-Scene Visuals, Voiceover/Dialogue, and Outro/CTA), "hashtags" (array of 8 to 12 hashtags), and "cta" (call to action).';
      promptUser = `Write a viral, high-energy 15-30 second video script for: "${product}". Platform: ${plat}. Tone: ${resolvedTone}. Language: ${lang}. CTA: ${resolvedCta}.`;
    }

    // 1. Try Google Gemini if configured in Admin Integration
    const geminiKey = await this.getGeminiKey();
    if (geminiKey) {
      this.logger.log(
        `[AI_REQUEST_SENT] Calling Google Gemini 1.5 Flash: product="${product}", type="${type}", platform="${plat}"`,
      );
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `${promptSystem}\n\n${promptUser}\n\nOutput strictly valid JSON with keys: caption, hashtags, cta.`,
                    },
                  ],
                },
              ],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          },
        );

        if (response.ok) {
          const data = (await response.json()) as any;
          this.logger.log(`[AI_RESPONSE_RECEIVED] Gemini responded successfully.`);
          const textOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (textOutput) {
            const parsed = this.parseJsonSafely(textOutput);
            if (parsed?.caption) {
              const rawTags = this.normalizeHashtags(parsed.hashtags);
              this.logger.log(
                `[AI_RESPONSE_PARSED] Gemini generated text: captionLength=${parsed.caption.length}, hashtags=${rawTags.length}`,
              );
              return {
                caption: parsed.caption,
                hashtags: rawTags,
                cta: parsed.cta || resolvedCta,
              };
            }
          }
        } else {
          const errBody = await response.text();
          this.logger.warn(`[AI_PROVIDER_ERROR] Gemini API error HTTP ${response.status}: ${errBody}`);
        }
      } catch (err: any) {
        this.logger.warn(`[AI_PROVIDER_ERROR] Gemini API network/execution error: ${err?.message}`);
      }
    }

    // 2. Try OpenAI if configured in Admin Integration
    const openAiKey = await this.getOpenAiKey();
    if (openAiKey) {
      this.logger.log(
        `[AI_REQUEST_SENT] Calling OpenAI gpt-4o-mini: product="${product}", type="${type}"`,
      );
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: promptSystem },
              { role: 'user', content: promptUser },
            ],
            response_format: { type: 'json_object' },
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          this.logger.log(`[AI_RESPONSE_RECEIVED] OpenAI responded successfully.`);
          const content = data?.choices?.[0]?.message?.content;
          if (content) {
            const parsed = this.parseJsonSafely(content);
            if (parsed?.caption) {
              const rawTags = this.normalizeHashtags(parsed.hashtags);
              this.logger.log(
                `[AI_RESPONSE_PARSED] OpenAI generated text: captionLength=${parsed.caption.length}, hashtags=${rawTags.length}`,
              );
              return {
                caption: parsed.caption,
                hashtags: rawTags,
                cta: parsed.cta || resolvedCta,
              };
            }
          }
        } else {
          const errBody = await response.text();
          this.logger.warn(`[AI_PROVIDER_ERROR] OpenAI API error HTTP ${response.status}: ${errBody}`);
        }
      } catch (err: any) {
        this.logger.warn(`[AI_PROVIDER_ERROR] OpenAI API execution error: ${err?.message}`);
      }
    }

    // 3. Fallback to Pollinations Live AI LLM if neither Gemini nor OpenAI are set
    this.logger.log(
      `[AI_REQUEST_SENT] Calling Pollinations live AI LLM: product="${product}", type="${type}"`,
    );
    try {
      const response = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: promptSystem },
            { role: 'user', content: promptUser },
          ],
          jsonMode: true,
        }),
      });

      if (response.ok) {
        const text = await response.text();
        this.logger.log(`[AI_RESPONSE_RECEIVED] Pollinations AI responded (${text.length} chars).`);
        const parsed = this.parseJsonSafely(text);
        if (parsed?.caption) {
          const rawTags = this.normalizeHashtags(parsed.hashtags);
          this.logger.log(
            `[AI_RESPONSE_PARSED] Pollinations AI generated real text: captionLength=${parsed.caption.length}, hashtags=${rawTags.length}`,
          );
          return {
            caption: parsed.caption,
            hashtags: rawTags,
            cta: parsed.cta || resolvedCta,
          };
        }
      } else {
        const errText = await response.text();
        this.logger.warn(`[AI_PROVIDER_ERROR] Pollinations AI error HTTP ${response.status}: ${errText}`);
      }
    } catch (err: any) {
      this.logger.error(`[AI_PROVIDER_ERROR] Pollinations AI error: ${err?.message}`);
    }

    throw new Error('AI text generation failed: Could not receive content from AI providers.');
  }

  /**
   * Generates a marketing poster/image using OpenAI ONLY.
   * Single source of truth: Admin Panel -> Integration -> OpenAI.
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
    const { product, objective, tone, instructions } = params;

    if (!this.integrationSettingsService) {
      throw new BadRequestException('Integration settings service is not available');
    }

    // Retrieve OpenAI configuration from Admin Integration
    const openAiConfig = await this.integrationSettingsService.getOpenAiConfig();

    if (!openAiConfig?.isConfigured || !openAiConfig.apiKey) {
      throw new BadRequestException(
        'OpenAI is not configured. Please configure your OpenAI API Key in Admin Panel -> Integrations.',
      );
    }

    if (!openAiConfig.isEnabled) {
      throw new BadRequestException(
        'OpenAI integration is currently disabled in Admin Panel -> Integrations.',
      );
    }

    const openAiKey = openAiConfig.apiKey.trim();
    const fullPrompt = `Professional commercial advertising photo of ${product}. ${
      objective ? `Campaign: ${objective}. ` : ''
    }${tone ? `Aesthetic: ${tone}. ` : ''}High quality studio lighting, 4K product photography, sharp focus, vibrant colors. ${
      instructions || ''
    }`.trim();

    this.logger.log(
      `[AI_REQUEST_SENT] Calling OpenAI Images API (DALL-E 3): prompt="${product}"`,
    );

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: fullPrompt,
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json',
        }),
      });
    } catch (netErr: any) {
      this.logger.error(`[AI_PROVIDER_ERROR] OpenAI connection failed: ${netErr?.message}`);
      throw new BadRequestException(`OpenAI connection failed: ${netErr?.message}`);
    }

    if (!response.ok) {
      let errDetail = '';
      try {
        const errJson = await response.json();
        errDetail = errJson?.error?.message || JSON.stringify(errJson);
      } catch {
        errDetail = await response.text();
      }
      this.logger.error(`[AI_PROVIDER_ERROR] OpenAI API error HTTP ${response.status}: ${errDetail}`);
      throw new BadRequestException(`OpenAI image generation failed: ${errDetail}`);
    }

    const data = (await response.json()) as any;
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      throw new BadRequestException('OpenAI returned invalid or empty image data.');
    }

    const buffer = Buffer.from(b64, 'base64');
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const filename = `ai-poster-${Date.now()}-${uniqueId}.png`;

    this.logger.log(
      `[AI_RESPONSE_RECEIVED] OpenAI DALL-E 3 returned image data: size=${buffer.length} bytes`,
    );

    // Upload using existing S3 service
    let mediaUrl: string;
    let fileKey: string = filename;
    try {
      this.logger.log(
        `[AI_STORAGE_UPLOAD] Uploading generated OpenAI image to existing storage: ${filename}`,
      );
      const uploadResult = await this.s3Service.uploadBuffer(
        buffer,
        'image/png',
        filename,
        'marketing/banners',
      );
      fileKey = uploadResult.imageKey;
      const presigned = await this.s3Service.getPresignedUrl(uploadResult.imageKey);
      mediaUrl = presigned || uploadResult.imageUrl;
      this.logger.log(`[AI_STORAGE_UPLOAD] Stored OpenAI image in S3: ${mediaUrl}`);
    } catch (storageErr: any) {
      this.logger.error(`[AI_STORAGE_UPLOAD] S3 upload error: ${storageErr?.message}`);
      throw new BadRequestException(`Image storage failed: ${storageErr?.message}`);
    }

    return {
      url: mediaUrl,
      buffer,
      mimeType: 'image/png',
      fileKey,
      width: 1024,
      height: 1024,
    };
  }

  /**
   * Starts an asynchronous video generation job using Google Gemini ONLY.
   * Single source of truth: Admin Panel -> Integration -> Gemini.
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

    if (!this.integrationSettingsService) {
      throw new BadRequestException('Integration settings service is not available');
    }

    // Retrieve Gemini configuration from Admin Integration
    const geminiConfig = await this.integrationSettingsService.getGeminiConfig();

    if (!geminiConfig?.isConfigured || !geminiConfig.apiKey) {
      throw new BadRequestException(
        'Google Gemini is not configured. Please configure your Gemini API Key in Admin Panel -> Integrations.',
      );
    }

    if (!geminiConfig.isEnabled) {
      throw new BadRequestException(
        'Google Gemini integration is currently disabled in Admin Panel -> Integrations.',
      );
    }

    const geminiKey = geminiConfig.apiKey.trim();
    const fullPrompt = `${params.product}. ${
      params.objective ? `Goal: ${params.objective}. ` : ''
    }${params.tone ? `Style: ${params.tone}. ` : ''}High production quality, commercial video advertising clip.`.trim();

    this.logger.log(
      `[AI_REQUEST_SENT] Calling Google Gemini video generation: prompt="${params.product}"`,
    );

    // Call Google Gemini long-running video generation endpoint (Veo models on Generative Language API)
    const candidateModels = [
      'veo-2.0-generate-001',
      'veo-3.1-generate-preview',
      'veo-2.0',
    ];

    let operationName: string | null = null;
    let usedModel = candidateModels[0];
    let lastError: string = '';

    for (const model of candidateModels) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiKey,
          },
          body: JSON.stringify({
            instances: [
              {
                prompt: fullPrompt,
              },
            ],
            parameters: {
              sampleCount: 1,
              aspectRatio: '9:16',
              durationSeconds: params.duration || 8,
            },
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          if (data.name) {
            operationName = data.name;
            usedModel = model;
            this.logger.log(`[AI_RESPONSE_RECEIVED] Gemini video generation started: operation=${operationName}`);
            break;
          }
        } else {
          const errText = await res.text();
          lastError = errText;
          this.logger.warn(`[AI_PROVIDER_WARN] Gemini model ${model} returned HTTP ${res.status}: ${errText}`);
          if (res.status === 404) continue;
          throw new Error(errText);
        }
      } catch (err: any) {
        lastError = err?.message || lastError;
        if (!err?.message?.includes('404')) {
          break;
        }
      }
    }

    if (!operationName) {
      let parsedMsg = lastError;
      try {
        const p = JSON.parse(lastError);
        parsedMsg = p?.error?.message || lastError;
      } catch {}
      this.logger.error(`[AI_PROVIDER_ERROR] Gemini video generation failed: ${parsedMsg}`);
      throw new BadRequestException(`Gemini video generation failed: ${parsedMsg || 'Could not initiate video operation'}`);
    }

    const jobResult: VideoGenerationResult = {
      jobId,
      url: undefined,
      fileKey: undefined,
      duration: params.duration || 8,
      status: 'PROCESSING',
    };

    (jobResult as any).operationName = operationName;
    (jobResult as any).geminiApiKey = geminiKey;
    (jobResult as any).model = usedModel;
    this.videoJobs.set(jobId, jobResult);

    return jobResult;
  }

  /**
   * Polls job status for Gemini video generation and uploads to S3 upon completion.
   */
  async checkVideoJobStatus(jobId: string): Promise<VideoGenerationResult> {
    const job = this.videoJobs.get(jobId);
    if (!job) {
      return {
        jobId,
        status: 'FAILED',
      };
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      return job;
    }

    const operationName = (job as any).operationName;
    const geminiKey = (job as any).geminiApiKey;

    if (!operationName || !geminiKey) {
      job.status = 'FAILED';
      return job;
    }

    try {
      const opUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${encodeURIComponent(geminiKey)}`;
      const opRes = await fetch(opUrl, {
        headers: {
          'x-goog-api-key': geminiKey,
        },
      });

      if (!opRes.ok) {
        const errBody = await opRes.text();
        this.logger.warn(`[AI_GENERATION_STATUS] Gemini operation check returned HTTP ${opRes.status}: ${errBody}`);
        return job;
      }

      const opData = (await opRes.json()) as any;
      if (!opData.done) {
        this.logger.log(`[AI_GENERATION_STATUS] Gemini video operation ${operationName} still processing...`);
        return job;
      }

      if (opData.error) {
        this.logger.error(`[AI_PROVIDER_ERROR] Gemini video operation failed: ${opData.error?.message}`);
        job.status = 'FAILED';
        return job;
      }

      const videoUri =
        opData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
        opData.response?.generatedSamples?.[0]?.video?.uri;

      if (!videoUri) {
        this.logger.error('[AI_PROVIDER_ERROR] Gemini video operation completed without video URI');
        job.status = 'FAILED';
        return job;
      }

      this.logger.log(`[AI_RESPONSE_RECEIVED] Gemini video completed. Downloading video from: ${videoUri}`);

      const vRes = await fetch(videoUri, {
        headers: {
          'x-goog-api-key': geminiKey,
        },
      });

      if (!vRes.ok) {
        throw new Error(`Failed to download Gemini video: HTTP ${vRes.status}`);
      }

      const ab = await vRes.arrayBuffer();
      const videoBuffer = Buffer.from(ab);
      const filename = `ai-video-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`;

      this.logger.log(
        `[AI_STORAGE_UPLOAD] Uploading Gemini video (${videoBuffer.length} bytes) to existing S3 storage`,
      );
      const s3Res = await this.s3Service.uploadMedia(
        {
          buffer: videoBuffer,
          originalname: filename,
          mimetype: 'video/mp4',
          size: videoBuffer.length,
        } as any,
        'marketing/videos',
        'VIDEO',
      );

      const finalUrl = s3Res.imageUrl;
      job.status = 'COMPLETED';
      job.url = finalUrl;
      job.fileKey = filename;
      this.videoJobs.set(jobId, job);

      this.logger.log(`[AI_STORAGE_UPLOAD] Stored Gemini video in S3: ${finalUrl}`);
      return job;
    } catch (err: any) {
      this.logger.error(`[AI_PROVIDER_ERROR] Gemini video polling error: ${err?.message}`);
      return job;
    }
  }

  private parseJsonSafely(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      try {
        const cleaned = text
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        return JSON.parse(cleaned);
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            return JSON.parse(match[0]);
          } catch {}
        }
        return null;
      }
    }
  }

  private normalizeHashtags(raw: any): string[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((h) => String(h).trim())
      .filter((h) => h.length > 0)
      .map((h) => (h.startsWith('#') ? h : `#${h}`));
  }
}
