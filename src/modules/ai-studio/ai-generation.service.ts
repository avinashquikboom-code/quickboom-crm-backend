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

@Injectable()
export class AiGenerationService {
  private readonly logger = new Logger(AiGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
    private readonly aiCredit: AiCreditService,
  ) {}

  /**
   * Generates AI Content based on customer selection (Post, Poster, Video, Caption, Hashtags)
   */
  async generate(customerId: number, dto: GenerateContentDto, file?: Express.Multer.File) {
    const serviceCode = `AI_${dto.type.toUpperCase()}`;

    // 1. Validate & Deduct Credits atomically
    const creditsSpent = await this.aiCredit.deductCredits(customerId, serviceCode);

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
    let mediaType = 'TEXT';
    let status = 'COMPLETED';
    let errorMessage: string | null = null;
    let videoJobId: string | null = null;

    try {
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
        const imgResult = await this.aiProvider.generateImage({
          product: dto.product,
          objective: dto.objective,
          platform: dto.platform,
          tone: dto.tone,
          cta: dto.cta,
          instructions: dto.instructions,
          referenceImageUrl: dto.referenceImageUrl,
        });

        mediaUrl = imgResult.url || null;
      }

      if (dto.type === 'VIDEO') {
        mediaType = 'VIDEO';
        status = 'PROCESSING';
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
        mediaUrl = videoResult.url || null; // Poster frame preview

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

      // 4. Save Record in Database
      const generation = await this.prisma.aiGeneration.create({
        data: {
          generationId,
          customerId,
          type: dto.type.toUpperCase(),
          status,
          product: dto.product,
          objective: dto.objective,
          targetAudience: dto.targetAudience,
          platform: dto.platform?.toUpperCase() || 'INSTAGRAM',
          language: dto.language || 'English',
          tone: dto.tone || 'Premium',
          cta: dto.cta || 'Order Now',
          instructions: dto.instructions,
          creditsSpent,
          caption,
          hashtags,
          mediaUrl,
          mediaType,
          errorMessage,
          metadata: videoJobId ? { videoJobId } : undefined,
        },
      });

      if (mediaUrl) {
        await this.prisma.aiGenerationAsset.create({
          data: {
            generationId: generation.id,
            assetType: mediaType,
            url: mediaUrl,
          },
        });
      }

      this.logger.log(`[AI_GEN_CREATED] Generated #${generation.id} (${generationId}) for Customer #${customerId}`);

      return {
        success: true,
        generation,
      };
    } catch (err: any) {
      this.logger.error(`[AI_GEN_FAILED] Failed generation for Customer #${customerId}: ${err?.message}`);
      // Refund credits on unexpected failure
      await this.aiCredit.refundCredits(customerId, serviceCode, creditsSpent);
      throw new BadRequestException(`AI Generation failed: ${err?.message}`);
    }
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
            data: { status: 'COMPLETED' },
          });
          generation.status = 'COMPLETED';
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

    return this.prisma.aiGeneration.findMany({
      where,
      include: { assets: true },
      orderBy: { id: 'desc' },
      take: 50,
    });
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
