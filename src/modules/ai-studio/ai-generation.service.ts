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
      `[AI_GENERATION_STATUS] Starting generation for Customer #${customerId}: type="${dto.type}", product="${dto.product}"`,
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
    let errorMessage: string | null = null;
    let videoJobId: string | null = null;

    try {
      this.logger.log(
        `[AI_PROVIDER_START]\ncustomerId: ${customerId}\nwalletId: ${walletId}\ntype: ${dto.type}\nrequiredCredits: ${requiredCredits}`,
      );

      // 3. Generate Content via Provider
      if (dto.type === 'CAPTION' || dto.type === 'HASHTAGS' || dto.type === 'POST') {
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

        caption = textResult.caption;
        hashtags = textResult.hashtags;
      }

      if (dto.type === 'POST' || dto.type === 'POSTER') {
        mediaType = 'IMAGE';
        this.logger.log(
          `[AI_POSTER_GENERATION_START]\ncustomerId: ${customerId}\ngenerationId: ${generationId}\ntype: ${dto.type}\nproduct: "${dto.product}"`,
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

        if (!imgResult || (!imgResult.buffer && !imgResult.url)) {
          throw new Error('AI provider failed to generate poster image.');
        }

        let s3ResUrl: string | null = null;
        let s3ResKey: string | null = null;

        if (imgResult.buffer && imgResult.buffer.length > 0) {
          const rawMime = (imgResult.mimeType || 'image/png').toLowerCase();
          let mimeType = 'image/png';
          let ext = 'png';
          if (rawMime.includes('jpeg') || rawMime.includes('jpg')) {
            mimeType = 'image/jpeg';
            ext = 'jpg';
          } else if (rawMime.includes('svg')) {
            mimeType = 'image/svg+xml';
            ext = 'svg';
          } else if (rawMime.includes('webp')) {
            mimeType = 'image/webp';
            ext = 'webp';
          }

          this.logger.log(
            `[AI_POSTER_PROVIDER_SUCCESS]\ncustomerId: ${customerId}\ngenerationId: ${generationId}\nbytes: ${imgResult.buffer.length}\nmimeType: ${mimeType}`,
          );

          const s3Key = `ai-posters/${customerId}/${generationId}.${ext}`;
          this.logger.log(
            `[AI_POSTER_S3_UPLOAD_START]\ncustomerId: ${customerId}\ngenerationId: ${generationId}\nkey: ${s3Key}\nmimeType: ${mimeType}`,
          );

          try {
            const uploadRes = await this.s3Service.uploadBuffer(
              imgResult.buffer,
              mimeType,
              `${generationId}.${ext}`,
              `ai-posters/${customerId}`,
              s3Key,
            );
            s3ResUrl = uploadRes.imageUrl;
            s3ResKey = uploadRes.imageKey;
            this.logger.log(
              `[AI_POSTER_S3_UPLOAD_SUCCESS]\ncustomerId: ${customerId}\ngenerationId: ${generationId}\nkey: ${s3ResKey}\nurl: ${s3ResUrl}`,
            );
          } catch (s3Err: any) {
            this.logger.error(
              `[AI_POSTER_S3_UPLOAD_FAILED]\ncustomerId: ${customerId}\ngenerationId: ${generationId}\nerror: ${s3Err?.message || s3Err}`,
            );
            throw new Error(`S3 upload failed: ${s3Err?.message || s3Err}`);
          }
        }

        const candidateUrl = s3ResUrl || imgResult.url;
        if (!candidateUrl) {
          throw new Error('AI poster generation did not produce a valid output URL.');
        }

        const accessibleUrl =
          (await this.s3Service.getPresignedUrl(candidateUrl, 604800)) || candidateUrl;

        if (!accessibleUrl || accessibleUrl.startsWith('/uploads/') || accessibleUrl.includes('localhost')) {
          throw new Error(`Invalid accessible S3 URL obtained: ${accessibleUrl}`);
        }

        mediaUrl = accessibleUrl;
        mediaFileKey = s3ResKey || imgResult.fileKey || null;
        mediaWidth = imgResult.width || 1024;
        mediaHeight = imgResult.height || 1024;
      }

      if (dto.type === 'VIDEO') {
        mediaType = 'VIDEO';
        this.logger.log(
          `[AI_GENERATION_STATUS] Dispatching video job for Customer #${customerId}...`,
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

        // Poll video job until completed or failed
        let isDone = false;
        let attempts = 0;
        const maxAttempts = 20; // 20 * 500ms = 10s maximum wait
        while (!isDone && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          attempts++;
          const currentJob = await this.aiProvider.checkVideoJobStatus(videoJobId);
          if (currentJob.status === 'COMPLETED') {
            isDone = true;
            status = 'COMPLETED';
            mediaUrl = currentJob.url || null;
            this.logger.log(
              `[AI_GENERATION_STATUS] Video job ${videoJobId} finished successfully with URL: ${mediaUrl}`,
            );
          } else if (currentJob.status === 'FAILED') {
            throw new Error(`Video generation job ${videoJobId} failed`);
          }
        }

        if (!isDone) {
          throw new Error(`Video generation job ${videoJobId} timed out after ${maxAttempts * 500}ms`);
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
      if (dto.type === 'VIDEO' && !mediaUrl) {
        throw new Error('AI provider failed to generate playable video URL.');
      }

      this.logger.log(
        `[AI_PROVIDER_SUCCESS]\ncustomerId: ${customerId}\nwalletId: ${walletId}\ntype: ${dto.type}\nrequiredCredits: ${requiredCredits}`,
      );
    } catch (err: any) {
      this.logger.error(`[AI_GEN_FAILED] Failed generation for Customer #${customerId}: ${err?.message}`, err?.stack);
      this.logger.warn(
        `[AI_CREDIT_RELEASE]\ncustomerId: ${customerId}\nwalletId: ${walletId}\nreleasedCredits: ${requiredCredits}\nreason: ${err?.message}`,
      );
      // Zero deductions and zero ledger entries on failure - Return safe customer-facing message
      throw new BadRequestException('Content generation is temporarily unavailable. Please try again.');
    }

    this.logger.log(
      `[AI_OUTPUT] Generated output for Customer #${customerId}: type="${dto.type}", mediaType="${mediaType}", mediaUrl="${mediaUrl}", captionLength=${caption?.length || 0}, hashtagsCount=${hashtags.length}`,
    );

    // 4. Save Successful Record in Database FIRST
    const generation = await this.prisma.aiGeneration.create({
      data: {
        generationId,
        customerId,
        type: dto.type,
        status: 'COMPLETED',
        product: dto.product,
        objective: dto.objective,
        targetAudience: dto.targetAudience,
        platform: dto.platform || 'INSTAGRAM',
        language: dto.language || 'English',
        tone: dto.tone || 'Premium',
        cta: dto.cta || 'Order Now',
        instructions: dto.instructions,
        creditsSpent: 0, // Updated on actual deduction below
        caption,
        hashtags,
        mediaUrl,
        mediaType,
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

    // 5. Atomically & Idempotently Deduct Credits ONLY AFTER successful generation and save
    const deduction = await this.aiCredit.deductCreditsOnSuccess({
      customerId,
      serviceCode,
      generationDbId: generation.id,
      generationCode: generationId,
      requiredCredits,
    });

    if (dto.type === 'POST' || dto.type === 'POSTER') {
      this.logger.log(
        `[AI_POSTER_GENERATION_COMPLETED]\ncustomerId: ${customerId}\ngenerationId: ${generationId}\nurl: ${mediaUrl}`,
      );
    }

    this.logger.log(
      `[AI_RESPONSE] Generation #${generation.id} (${generationId}) COMPLETED and saved in DB for Customer #${customerId}. Deducted ${deduction.creditsSpent} credits. Remaining: ${deduction.newBalance}`,
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
          await this.prisma.aiGeneration.update({
            where: { id: generation.id },
            data: {
              status: 'COMPLETED',
              ...(job.url && { mediaUrl: job.url }),
            },
          });
          generation.status = 'COMPLETED';
          if (job.url) generation.mediaUrl = job.url;
        }
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
              assets: item.assets.map((a) => ({ ...a, url: resolved })),
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

    return { items, total };
  }
}
