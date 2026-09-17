import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderService } from './ai-provider.service';
import { AiCreditService } from './ai-credit.service';
import { GenerateContentDto, UpdateGenerationDto } from './dto/ai-studio.dto';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class AiGenerationService {
  private readonly logger = new Logger(AiGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
    private readonly aiCredit: AiCreditService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Generates AI Content based on customer selection (Post, Poster, Video, Caption, Hashtags)
   * Credit deduction happens STRICTLY AFTER successful generation and database storage.
   */
  async generate(customerId: number, dto: GenerateContentDto, file?: Express.Multer.File) {
    const rawInput = (dto.product || dto.prompt || '').trim();
    if (!rawInput) {
      throw new BadRequestException('Product or prompt description is required');
    }
    dto.product = rawInput;

    const serviceCode = `AI_${dto.type.toUpperCase()}`;

    this.logger.log(
      `[AI_REQUEST_RECEIVED] Customer #${customerId} initiated generation: type="${dto.type}", product="${dto.product}"`,
    );

    // 1. Validate Available Credits BEFORE starting AI generation (No deduction occurs here)
    const { requiredCredits, walletId } = await this.aiCredit.validateCreditAvailability(customerId, serviceCode);

    // 2. Generate unique generation ID
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    const generationId = `AIGEN-${y}${m}${d}-${rand}`;

    let caption: string | null = null;
    let hashtags: string[] = [];
    let mediaUrl: string | null = null;
    let mediaFileKey: string | null = null;
    let mediaWidth: number | null = null;
    let mediaHeight: number | null = null;
    let mediaType = 'TEXT';
    let status = 'COMPLETED';
    let videoJobId: string | null = null;

    try {
      // 3. Generate Content via Real AI Provider
      if (dto.type === 'CAPTION' || dto.type === 'HASHTAGS' || dto.type === 'POST') {
        this.logger.log(
          `[AI_REQUEST_SENT] Text generation requested for type="${dto.type}", product="${dto.product}"`,
        );
        const textResult = await this.aiProvider.generateText({
          product: dto.product,
          type: dto.type,
          objective: dto.objective,
          platform: dto.platform,
          language: dto.language,
          tone: dto.tone,
          cta: dto.cta,
          instructions: dto.instructions,
        });

        this.logger.log(`[AI_RESPONSE_RECEIVED] Real text response received from AI provider`);
        caption = textResult.caption;
        hashtags = textResult.hashtags;

        this.logger.log(
          `[AI_RESPONSE_PARSED] Text output parsed: captionLength=${caption?.length || 0}, hashtagsCount=${hashtags.length}`,
        );
      }

      if (dto.type === 'POST' || dto.type === 'POSTER') {
        mediaType = 'IMAGE';

        this.logger.log(
          `[AI_REQUEST_SENT] Image generation requested for product="${dto.product}"`,
        );
        const imgResult = await this.aiProvider.generateImage({
          product: dto.product,
          objective: dto.objective,
          platform: dto.platform,
          tone: dto.tone,
          cta: dto.cta,
          instructions: dto.instructions,
          referenceImageUrl: dto.referenceImageUrl,
        });

        if (!imgResult || (!imgResult.url && !imgResult.buffer)) {
          throw new Error('AI provider failed to generate poster image.');
        }

        this.logger.log(
          `[AI_RESPONSE_RECEIVED] Real image result received from AI provider (bufferSize=${imgResult.buffer?.length || 0}, url=${imgResult.url || 'none'})`,
        );

        let imageBuffer = imgResult.buffer;
        const mimeType = imgResult.mimeType || 'image/jpeg';
        const filename = imgResult.fileKey || `ai-poster-${Date.now()}-${generationId}.jpg`;

        if (!imageBuffer && imgResult.url && imgResult.url.startsWith('http')) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 35000);
            const fetchRes = await fetch(imgResult.url, { signal: controller.signal });
            clearTimeout(timeout);
            if (fetchRes.ok) {
              const ab = await fetchRes.arrayBuffer();
              imageBuffer = Buffer.from(ab);
            }
          } catch (fetchErr: any) {
            this.logger.warn(`Could not fetch image buffer from provider URL: ${fetchErr?.message}`);
          }
        }

        if (imageBuffer && imageBuffer.length > 0) {
          try {
            this.logger.log(
              `[AI_STORAGE_UPLOAD] Uploading generated image to existing storage: filename=${filename}, mimeType=${mimeType}, size=${imageBuffer.length}`,
            );
            const uploadResult = await this.s3Service.uploadBuffer(
              imageBuffer,
              mimeType,
              filename,
              'marketing/banners',
            );
            mediaFileKey = uploadResult.imageKey;

            const presigned = await this.s3Service.getPresignedUrl(uploadResult.imageKey);
            mediaUrl = presigned || uploadResult.imageUrl;

            this.logger.log(
              `[AI_STORAGE_UPLOAD] Stored in existing storage: key=${mediaFileKey}, url=${mediaUrl}`,
            );
          } catch (storageErr: any) {
            this.logger.error(
              `[AI_STORAGE_UPLOAD] Existing storage upload failed: ${storageErr?.message}. Falling back to direct URL.`,
            );
            if (imgResult.url && !imgResult.url.startsWith('data:')) {
              mediaUrl = imgResult.url;
              mediaFileKey = filename;
            } else {
              throw new Error(`Image storage failed: ${storageErr?.message || storageErr}`);
            }
          }
        } else if (imgResult.url) {
          mediaUrl = imgResult.url;
          mediaFileKey = filename;
        }

        if (!mediaUrl) {
          throw new Error('AI poster generation did not produce a valid output URL.');
        }

        mediaWidth = imgResult.width || 1024;
        mediaHeight = imgResult.height || 1024;

        this.logger.log(
          `[AI_RESPONSE_PARSED] Poster output parsed: mediaUrl=${mediaUrl}, width=${mediaWidth}, height=${mediaHeight}`,
        );
      }

      if (dto.type === 'VIDEO') {
        mediaType = 'VIDEO';
        this.logger.log(
          `[AI_REQUEST_SENT] Video generation job requested for Customer #${customerId}, product="${dto.product}"`,
        );
        const videoResult = await this.aiProvider.startVideoJob({
          product: dto.product,
          objective: dto.objective,
          platform: dto.platform,
          language: dto.language,
          tone: dto.tone,
          cta: dto.cta,
          duration: 15,
        });

        videoJobId = videoResult.jobId;
        this.logger.log(
          `[AI_RESPONSE_RECEIVED] Video generation job started: jobId=${videoJobId}`,
        );

        // Poll video job until completed, failed, or async handover
        let isDone = false;
        let attempts = 0;
        const maxAttempts = 24; // 24 * 500ms = 12s synchronous wait window
        while (!isDone && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          attempts++;
          const currentJob = await this.aiProvider.checkVideoJobStatus(videoJobId);
          if (currentJob.status === 'COMPLETED') {
            isDone = true;
            status = 'COMPLETED';
            mediaUrl = currentJob.url || null;
            mediaFileKey = currentJob.fileKey || null;
            this.logger.log(
              `[AI_RESPONSE_PARSED] Video job ${videoJobId} finished with playable URL: ${mediaUrl}`,
            );
          } else if (currentJob.status === 'FAILED') {
            throw new Error(`Video generation job ${videoJobId} failed`);
          }
        }

        if (!isDone) {
          // Asynchronous rendering: mark as PROCESSING for client polling
          status = 'PROCESSING';
          this.logger.log(
            `[AI_RESPONSE_PARSED] Video job ${videoJobId} still PROCESSING after ${maxAttempts * 500}ms. Handing over for asynchronous polling.`,
          );
        }

        const textResult = await this.aiProvider.generateText({
          product: dto.product,
          type: 'POST',
          objective: dto.objective,
          platform: dto.platform,
          language: dto.language,
          tone: dto.tone,
          cta: dto.cta,
        });
        caption = textResult.caption;
        hashtags = textResult.hashtags;
      }

      // Output Validation: Verify that generation produced actual content
      if (dto.type === 'POST' && !caption && !mediaUrl) {
        throw new Error('AI provider returned empty post content.');
      }
      if (dto.type === 'POSTER' && !mediaUrl) {
        throw new Error('AI provider failed to generate poster image.');
      }
      if ((dto.type === 'CAPTION' || dto.type === 'HASHTAGS') && !caption && hashtags.length === 0) {
        throw new Error('AI provider returned empty text content.');
      }
      if (dto.type === 'VIDEO' && status === 'COMPLETED' && !mediaUrl) {
        throw new Error('AI provider failed to generate playable video URL.');
      }
    } catch (err: any) {
      this.logger.error(
        `[AI_PROVIDER_ERROR] Customer #${customerId} generation failed: ${err?.message}`,
        err?.stack,
      );
      this.logger.warn(
        `[AI_CREDIT_RELEASE]\ncustomerId: ${customerId}\nwalletId: ${walletId}\nreleasedCredits: ${requiredCredits}\nreason: ${err?.message}`,
      );
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException(`AI Generation failed: ${err?.message || 'Provider error'}`);
    }

    // 4. Save Record in Database
    this.logger.log(
      `[AI_DATABASE_SAVE] Saving generation in database for Customer #${customerId}: generationId=${generationId}, status=${status}`,
    );
    const generation = await this.prisma.aiGeneration.create({
      data: {
        generationId,
        customerId,
        type: dto.type,
        status,
        product: dto.product,
        objective: dto.objective,
        targetAudience: dto.targetAudience,
        platform: dto.platform || 'INSTAGRAM',
        language: dto.language || 'English',
        tone: dto.tone || 'Premium',
        cta: dto.cta || 'Order Now',
        instructions: dto.instructions,
        creditsSpent: 0,
        caption,
        hashtags,
        mediaUrl,
        mediaType,
        metadata: videoJobId ? { videoJobId } : undefined,
      },
    });

    if (mediaUrl) {
      await this.prisma.aiGenerationAsset.create({
        data: {
          generationId: generation.id,
          assetType: mediaType,
          url: mediaUrl,
          fileKey: mediaFileKey,
          width: mediaWidth,
          height: mediaHeight,
        },
      });
    }
    this.logger.log(`[AI_DATABASE_SAVE] Generation #${generation.id} saved in database.`);

    // 5. Atomically & Idempotently Deduct Credits ONLY IF status is COMPLETED
    let deduction = { creditsSpent: 0, newBalance: 0 };
    if (status === 'COMPLETED') {
      deduction = await this.aiCredit.deductCreditsOnSuccess({
        customerId,
        serviceCode,
        generationDbId: generation.id,
        generationCode: generationId,
        requiredCredits,
      });
    }

    this.logger.log(
      `[AI_API_RESPONSE] Returning generation #${generation.id} (${generationId}) to Customer #${customerId}: status="${status}", mediaUrl="${mediaUrl || 'none'}", creditsSpent=${deduction.creditsSpent}`,
    );

    return {
      success: true,
      generation: {
        ...generation,
        creditsSpent: deduction.creditsSpent,
      },
      creditsSpent: deduction.creditsSpent,
      balance: deduction.newBalance,
    };
  }

  /**
   * Checks asynchronous generation status (e.g. video renders)
   */
  async getJobStatus(customerId: number, generationId: string) {
    const generation = await this.prisma.aiGeneration.findFirst({
      where: {
        OR: [{ generationId }, { id: parseInt(generationId, 10) || -1 }],
        customerId,
        deletedAt: null,
      },
      include: { assets: true },
    });

    if (!generation) {
      throw new NotFoundException(`Generation #${generationId} not found`);
    }

    if (generation.status === 'PROCESSING' && generation.metadata) {
      const meta = generation.metadata as any;
      if (meta.videoJobId) {
        const job = await this.aiProvider.checkVideoJobStatus(meta.videoJobId);
        if (job.status === 'COMPLETED') {
          let spent = generation.creditsSpent;
          if (spent === 0) {
            const serviceCode = `AI_${generation.type.toUpperCase()}`;
            const { requiredCredits } = await this.aiCredit.validateCreditAvailability(
              customerId,
              serviceCode,
            );
            const deduction = await this.aiCredit.deductCreditsOnSuccess({
              customerId,
              serviceCode,
              generationDbId: generation.id,
              generationCode: generation.generationId,
              requiredCredits,
            });
            spent = deduction.creditsSpent;
          }

          await this.prisma.aiGeneration.update({
            where: { id: generation.id },
            data: {
              status: 'COMPLETED',
              creditsSpent: spent,
              ...(job.url && { mediaUrl: job.url }),
            },
          });
          generation.status = 'COMPLETED';
          generation.creditsSpent = spent;
          if (job.url) generation.mediaUrl = job.url;
        } else if (job.status === 'FAILED') {
          await this.prisma.aiGeneration.update({
            where: { id: generation.id },
            data: { status: 'FAILED' },
          });
          generation.status = 'FAILED';
        }
      }
    }

    if (generation.mediaUrl && !generation.mediaUrl.startsWith('data:')) {
      const fileKey = (generation as any).assets?.[0]?.fileKey || generation.mediaUrl;
      const resolved = await this.s3Service.getPresignedUrl(fileKey, 604800);
      if (resolved) {
        generation.mediaUrl = resolved;
      }
    }

    return generation;
  }

  /**
   * Allows customer to update captions or hashtags before publishing
   */
  async updateGeneration(customerId: number, generationId: string, dto: UpdateGenerationDto) {
    const generation = await this.prisma.aiGeneration.findFirst({
      where: {
        OR: [{ generationId }, { id: parseInt(generationId, 10) || -1 }],
        customerId,
        deletedAt: null,
      },
    });

    if (!generation) {
      throw new NotFoundException(`Generation #${generationId} not found`);
    }

    return this.prisma.aiGeneration.update({
      where: { id: generation.id },
      data: {
        ...(dto.caption !== undefined && { caption: dto.caption }),
        ...(dto.hashtags !== undefined && { hashtags: dto.hashtags }),
      },
    });
  }

  /**
   * Retrieves customer's generation history with strict isolation
   */
  async getMyGenerations(customerId: number, type?: string) {
    const where: any = {
      customerId,
      deletedAt: null,
    };

    if (type && type.toUpperCase() !== 'ALL') {
      where.type = type.toUpperCase();
    }

    const items = await this.prisma.aiGeneration.findMany({
      where,
      include: { assets: true },
      orderBy: { id: 'desc' },
      take: 50,
    });

    return Promise.all(
      items.map(async (item) => {
        if (item.mediaUrl && !item.mediaUrl.startsWith('data:')) {
          const keyOrUrl = item.assets?.[0]?.fileKey || item.mediaUrl;
          const resolved = await this.s3Service.getPresignedUrl(keyOrUrl, 604800);
          if (resolved) {
            return {
              ...item,
              mediaUrl: resolved,
              assets: (item.assets || []).map((a) => ({ ...a, url: resolved })),
            };
          }
        }
        return item;
      }),
    );
  }

  /**
   * Retrieves all generations across customers for Admin Panel
   */
  async getAllGenerationsAdmin(query?: any) {
    const where: any = { deletedAt: null };

    if (query?.type && query.type !== 'ALL') {
      where.type = query.type;
    }

    if (query?.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.aiGeneration.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true, companyName: true },
          },
          assets: true,
        },
        orderBy: { id: 'desc' },
        take: query?.limit ? parseInt(query.limit, 10) : 50,
        skip: query?.offset ? parseInt(query.offset, 10) : 0,
      }),
      this.prisma.aiGeneration.count({ where }),
    ]);

    const resolvedItems = await Promise.all(
      items.map(async (item) => {
        if (item.mediaUrl && !item.mediaUrl.startsWith('data:')) {
          const keyOrUrl = item.assets?.[0]?.fileKey || item.mediaUrl;
          const resolved = await this.s3Service.getPresignedUrl(keyOrUrl, 604800);
          if (resolved) {
            return {
              ...item,
              mediaUrl: resolved,
              assets: (item.assets || []).map((a) => ({ ...a, url: resolved })),
            };
          }
        }
        return item;
      }),
    );

    return { items: resolvedItems, total };
  }
}
