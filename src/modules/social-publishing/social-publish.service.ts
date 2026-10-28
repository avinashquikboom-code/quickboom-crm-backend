import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SocialAccountService } from './social-account.service';
import {
  InstagramProvider,
  FacebookProvider,
  YouTubeProvider,
  LinkedInProvider,
  TikTokProvider,
} from './providers/platform-providers';
import { PublishContentDto } from './dto/social-publishing.dto';

@Injectable()
export class SocialPublishService {
  private readonly logger = new Logger(SocialPublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly socialAccountService: SocialAccountService,
    private readonly instagramProvider: InstagramProvider,
    private readonly facebookProvider: FacebookProvider,
    private readonly youtubeProvider: YouTubeProvider,
    private readonly linkedinProvider: LinkedInProvider,
    private readonly tiktokProvider: TikTokProvider,
  ) {
    // Run interval every 60 seconds to process scheduled posts
    setInterval(() => {
      this.processScheduledPosts().catch((err) =>
        this.logger.error(`[SCHEDULED_POSTS_WORKER_ERROR] ${err?.message}`),
      );
    }, 60000);
  }

  private getProvider(platform: string) {
    switch (platform.toUpperCase()) {
      case 'INSTAGRAM':
        return this.instagramProvider;
      case 'FACEBOOK':
        return this.facebookProvider;
      case 'YOUTUBE':
        return this.youtubeProvider;
      case 'LINKEDIN':
        return this.linkedinProvider;
      case 'TIKTOK':
        return this.tiktokProvider;
      default:
        throw new BadRequestException(`Unsupported social platform: ${platform}`);
    }
  }

  /**
   * Publishes or schedules content across selected connected accounts
   */
  async publishOrSchedule(customerId: number, dto: PublishContentDto) {
    const rawIds = dto.accountIds && dto.accountIds.length > 0
      ? dto.accountIds
      : (dto.socialAccountId ? [dto.socialAccountId] : []);

    if (rawIds.length === 0) {
      throw new BadRequestException('At least one connected social account must be selected');
    }

    // Validate that all accounts belong to this customer
    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        id: { in: rawIds },
        customerId,
        deletedAt: null,
        isConnected: true,
      },
    });

    if (accounts.length !== rawIds.length) {
      throw new BadRequestException('One or more selected accounts are invalid or disconnected');
    }

    const isScheduled = !!dto.scheduledFor && new Date(dto.scheduledFor) > new Date();
    const scheduledDate = isScheduled ? new Date(dto.scheduledFor!) : null;

    const results = [];

    for (const account of accounts) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const rand = Math.floor(1000 + Math.random() * 9000);
      const publishId = `PUB-${y}${m}${d}-${rand}`;

      if (isScheduled) {
        // Record as SCHEDULED
        const record = await this.prisma.socialPublish.create({
          data: {
            publishId,
            customerId,
            socialAccountId: account.id,
            generationId: dto.generationId,
            platform: account.platform,
            content: dto.content,
            mediaUrls: dto.mediaUrls || [],
            status: 'SCHEDULED',
            scheduledFor: scheduledDate,
          },
        });
        results.push(record);
      } else {
        // Publish immediately
        let externalPostId: string | null = null;
        let externalPostUrl: string | null = null;
        let status = 'PUBLISHED';
        let errorMessage: string | null = null;

        try {
          const provider = this.getProvider(account.platform);
          const decryptedToken = this.socialAccountService.decrypt(account.accessTokenEncrypted);

          const pubResult = await provider.publish(
            {
              externalAccountId: account.externalAccountId,
              accessToken: decryptedToken || undefined,
            },
            {
              caption: dto.content,
              mediaUrls: dto.mediaUrls,
            },
          );

          externalPostId = pubResult.externalPostId;
          externalPostUrl = pubResult.externalPostUrl || null;
        } catch (err: any) {
          status = 'FAILED';
          errorMessage = err?.message || 'Publish failed';
          this.logger.error(`[PUBLISH_ERROR] Platform: ${account.platform}, Error: ${errorMessage}`);
        }

        const record = await this.prisma.socialPublish.create({
          data: {
            publishId,
            customerId,
            socialAccountId: account.id,
            generationId: dto.generationId,
            platform: account.platform,
            content: dto.content,
            mediaUrls: dto.mediaUrls || [],
            status,
            publishedAt: status === 'PUBLISHED' ? new Date() : null,
            externalPostId,
            externalPostUrl,
            errorMessage,
          },
        });

        results.push(record);
      }
    }

    return {
      success: true,
      mode: isScheduled ? 'SCHEDULED' : 'PUBLISHED',
      scheduledFor: scheduledDate,
      count: results.length,
      records: results,
    };
  }

  /**
   * Worker processor: queries and publishes all scheduled posts due for delivery
   */
  async processScheduledPosts() {
    const duePosts = await this.prisma.socialPublish.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: { lte: new Date() },
      },
      include: { socialAccount: true },
      take: 20,
    });

    if (duePosts.length === 0) return;

    this.logger.log(`[SCHEDULED_WORKER] Processing ${duePosts.length} due scheduled posts...`);

    for (const post of duePosts) {
      try {
        const provider = this.getProvider(post.platform);
        const decryptedToken = this.socialAccountService.decrypt(
          post.socialAccount.accessTokenEncrypted,
        );

        const pubResult = await provider.publish(
          {
            externalAccountId: post.socialAccount.externalAccountId,
            accessToken: decryptedToken || undefined,
          },
          {
            caption: post.content || '',
            mediaUrls: post.mediaUrls,
          },
        );

        await this.prisma.socialPublish.update({
          where: { id: post.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
            externalPostId: pubResult.externalPostId,
            externalPostUrl: pubResult.externalPostUrl,
          },
        });

        this.logger.log(`[SCHEDULED_POST_PUBLISHED] Post #${post.id} (${post.publishId}) published to ${post.platform}`);
      } catch (err: any) {
        await this.prisma.socialPublish.update({
          where: { id: post.id },
          data: {
            status: 'FAILED',
            errorMessage: err?.message || 'Publishing failed',
            retryCount: post.retryCount + 1,
          },
        });
      }
    }
  }

  /**
   * Retrieves current customer's publishing history
   */
  async getMyPublishes(customerId: number, status?: string) {
    const where: any = { customerId };
    if (status && status.toUpperCase() !== 'ALL') {
      where.status = status.toUpperCase();
    }

    return this.prisma.socialPublish.findMany({
      where,
      include: {
        socialAccount: {
          select: { id: true, platform: true, accountName: true, username: true, profilePic: true },
        },
      },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  /**
   * Cancels a scheduled post
   */
  async cancelScheduledPost(customerId: number, id: number) {
    const post = await this.prisma.socialPublish.findFirst({
      where: { id, customerId, status: 'SCHEDULED' },
    });
    if (!post) {
      throw new NotFoundException(`Scheduled post #${id} not found or cannot be cancelled`);
    }

    return this.prisma.socialPublish.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  /**
   * Admin view of all published & scheduled posts
   */
  async getAllPublishesAdmin(query?: any) {
    const where: any = {};
    if (query?.status && query.status !== 'ALL') {
      where.status = query.status.toUpperCase();
    }
    if (query?.platform && query.platform !== 'ALL') {
      where.platform = query.platform.toUpperCase();
    }

    const [items, total] = await Promise.all([
      this.prisma.socialPublish.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true, companyName: true },
          },
          socialAccount: {
            select: { id: true, platform: true, accountName: true, username: true },
          },
        },
        orderBy: { id: 'desc' },
        take: query?.limit ? parseInt(query.limit, 10) : 50,
        skip: query?.offset ? parseInt(query.offset, 10) : 0,
      }),
      this.prisma.socialPublish.count({ where }),
    ]);

    return { items, total };
  }
}
