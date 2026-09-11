import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import {
  CreateTrendingContentDto,
  UpdateTrendingContentDto,
  QueryTrendingDto,
} from './dto/trending.dto';
import { TrendingCategory } from '@prisma/client';

@Injectable()
export class TrendingService {
  private readonly logger = new Logger(TrendingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Helper to normalize customerId into numeric representation.
   */
  private parseCustomerId(customerId: any): number | undefined {
    if (customerId === undefined || customerId === null || customerId === '') {
      return undefined;
    }
    const num = typeof customerId === 'number' ? customerId : parseInt(String(customerId), 10);
    return isNaN(num) || num <= 0 ? undefined : num;
  }

  /**
   * Helper to resolve S3 key into presigned URL for private S3 storage.
   */
  private async resolveTrendingMedia(item: any): Promise<any> {
    if (!item) return item;
    let resolvedMediaUrl = item.mediaUrl;
    let resolvedThumbnailUrl = item.thumbnailUrl;

    if (resolvedMediaUrl && !resolvedMediaUrl.includes('youtube.com') && !resolvedMediaUrl.includes('youtu.be')) {
      resolvedMediaUrl = (await this.s3Service.getPresignedUrl(resolvedMediaUrl)) || resolvedMediaUrl;
    }

    if (resolvedThumbnailUrl && !resolvedThumbnailUrl.includes('img.youtube.com')) {
      resolvedThumbnailUrl = (await this.s3Service.getPresignedUrl(resolvedThumbnailUrl)) || resolvedThumbnailUrl;
    }

    return {
      ...item,
      mediaUrl: resolvedMediaUrl,
      thumbnailUrl: resolvedThumbnailUrl,
    };
  }

  // ── Company Admin Operations ────────────────────────────────────────────────

  /**
   * Create a new trending content record (Company Admin only).
   */
  async create(
    authCustomerId: any,
    userId: number,
    dto: CreateTrendingContentDto,
    isSuperAdmin = false,
    fileOrFiles?: Express.Multer.File | Express.Multer.File[],
  ) {
    const targetCustomerId = isSuperAdmin
      ? (dto.customerId ? this.parseCustomerId(dto.customerId) : null)
      : this.parseCustomerId(authCustomerId);

    const startAt = dto.startAt ? new Date(dto.startAt) : null;
    const endAt = dto.endAt ? new Date(dto.endAt) : null;

    if (startAt && endAt && startAt > endAt) {
      throw new BadRequestException('startAt cannot be later than endAt');
    }

    const filesList: Express.Multer.File[] = Array.isArray(fileOrFiles)
      ? fileOrFiles
      : fileOrFiles
      ? [fileOrFiles]
      : [];

    let parsedMetadata = dto.metadata;
    if (typeof parsedMetadata === 'string') {
      try {
        parsedMetadata = JSON.parse(parsedMetadata);
      } catch (_) {
        parsedMetadata = {};
      }
    }

    // ── Multi-file upload batch handling (Multiple Images, Videos, or Mixed) ──
    if (filesList.length > 0) {
      const createdItems: any[] = [];
      const failedItems: { name: string; error: string }[] = [];

      for (let i = 0; i < filesList.length; i++) {
        const file = filesList[i];
        try {
          const cleanMime = (file.mimetype || '').toLowerCase();
          const ext = file.originalname?.split('.').pop()?.toLowerCase() || '';
          const isVideoFile = cleanMime.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi', '3gp'].includes(ext);
          const fileMediaType: 'IMAGE' | 'VIDEO' = isVideoFile ? 'VIDEO' : 'IMAGE';
          const fileCategory: TrendingCategory = isVideoFile
            ? (dto.category === TrendingCategory.REEL ? dto.category : TrendingCategory.REEL)
            : (dto.category && dto.category !== TrendingCategory.REEL ? dto.category : TrendingCategory.STORY);

          const uploadResult = await this.s3Service.uploadMedia(file, 'marketing/trending', fileMediaType);
          const resolvedMediaUrl = uploadResult.imageUrl;
          const resolvedThumbnailUrl = fileMediaType === 'IMAGE' ? uploadResult.imageUrl : (dto.thumbnailUrl?.trim() || null);

          const metadata = {
            ...(typeof parsedMetadata === 'object' && parsedMetadata !== null ? parsedMetadata : {}),
            mediaType: fileMediaType,
            mediaSource: 'UPLOAD',
          };

          const itemTitle = dto.title?.trim()
            ? (filesList.length > 1 ? `${dto.title.trim()} (${i + 1})` : dto.title.trim())
            : (fileMediaType === 'VIDEO' ? 'Trending Reel' : 'Trending Creative');

          const content = await this.prisma.trendingContent.create({
            data: {
              customerId: targetCustomerId,
              title: itemTitle,
              description: dto.description?.trim() || null,
              category: fileCategory,
              thumbnailUrl: resolvedThumbnailUrl || null,
              mediaUrl: resolvedMediaUrl || null,
              ctaText: dto.ctaText?.trim() || null,
              ctaUrl: dto.ctaUrl?.trim() || null,
              platform: dto.platform?.trim() || 'INSTAGRAM',
              objective: dto.objective?.trim() || 'ENGAGEMENT',
              priority: dto.priority !== undefined ? Number(dto.priority) : 0,
              isPublished: dto.isPublished !== undefined ? Boolean(dto.isPublished) : true,
              isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
              startAt,
              endAt,
              createdBy: userId || null,
              metadata,
            },
          });

          this.logger.log(`[TRENDING_ADMIN_CREATE_BATCH] item ${i + 1}/${filesList.length}, id: ${content.id}, type: ${fileMediaType}`);
          createdItems.push(await this.resolveTrendingMedia(content));
        } catch (fileErr: any) {
          this.logger.error(`[TRENDING_CREATE_BATCH_FILE_ERROR] ${file.originalname}: ${fileErr.message || fileErr}`);
          failedItems.push({
            name: file.originalname,
            error: fileErr.message || 'Upload failed',
          });
        }
      }

      if (createdItems.length === 0 && failedItems.length > 0) {
        throw new BadRequestException(
          `Failed to upload media files: ${failedItems.map((f) => `"${f.name}" (${f.error})`).join('; ')}`,
        );
      }

      return {
        success: true,
        message: `${createdItems.length} trending ${createdItems.length === 1 ? 'item' : 'items'} created successfully${
          failedItems.length > 0 ? ` (${failedItems.length} failed: ${failedItems.map((f) => f.name).join(', ')})` : ''
        }`,
        data: createdItems.length === 1 ? createdItems[0] : createdItems,
        createdCount: createdItems.length,
        failedCount: failedItems.length,
        failedItems: failedItems.length > 0 ? failedItems : undefined,
      };
    }

    // ── URL / Payload without file ──
    let mediaType: 'IMAGE' | 'VIDEO' = dto.mediaType || (
      dto.category === 'REEL' || dto.videoUrl ? 'VIDEO' : 'IMAGE'
    );
    let mediaSource: 'UPLOAD' | 'URL' = dto.mediaSource || 'URL';
    let resolvedMediaUrl = (dto.mediaUrl || (mediaType === 'IMAGE' ? dto.imageUrl : dto.videoUrl) || '').trim();
    let resolvedThumbnailUrl = (dto.thumbnailUrl || (mediaType === 'IMAGE' ? dto.imageUrl : '') || '').trim();

    if (mediaSource === 'URL' || resolvedMediaUrl) {
      if (!resolvedMediaUrl) {
        throw new BadRequestException(`Please enter a valid ${mediaType.toLowerCase()} URL.`);
      }
      if (!resolvedMediaUrl.startsWith('http://') && !resolvedMediaUrl.startsWith('https://')) {
        throw new BadRequestException('Media URL must start with http:// or https://');
      }
      if (mediaType === 'IMAGE' && !resolvedThumbnailUrl) {
        resolvedThumbnailUrl = resolvedMediaUrl;
      }
    } else {
      throw new BadRequestException('Please upload an image or video file or provide a media URL.');
    }

    const metadata = {
      ...(typeof parsedMetadata === 'object' && parsedMetadata !== null ? parsedMetadata : {}),
      mediaType,
      mediaSource,
    };

    const resolvedCategory = dto.category || (mediaType === 'VIDEO' ? TrendingCategory.REEL : TrendingCategory.STORY);

    const content = await this.prisma.trendingContent.create({
      data: {
        customerId: targetCustomerId,
        title: dto.title?.trim() || (resolvedCategory === TrendingCategory.REEL ? 'Trending Reel' : 'Trending Creative'),
        description: dto.description?.trim() || null,
        category: resolvedCategory,
        thumbnailUrl: resolvedThumbnailUrl || null,
        mediaUrl: resolvedMediaUrl || null,
        ctaText: dto.ctaText?.trim() || null,
        ctaUrl: dto.ctaUrl?.trim() || null,
        platform: dto.platform?.trim() || 'INSTAGRAM',
        objective: dto.objective?.trim() || 'ENGAGEMENT',
        priority: dto.priority !== undefined ? Number(dto.priority) : 0,
        isPublished: dto.isPublished !== undefined ? Boolean(dto.isPublished) : true,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
        startAt,
        endAt,
        createdBy: userId || null,
        metadata,
      },
    });

    const resolved = await this.resolveTrendingMedia(content);
    return {
      success: true,
      message: 'Trending content created successfully',
      data: resolved,
    };
  }

  /**
   * Get all trending content for Company Admin with filtering, search and pagination.
   */
  async findAllAdmin(
    authCustomerId: any,
    query: QueryTrendingDto,
    isSuperAdmin = false,
  ) {
    const targetCustomerId = isSuperAdmin
      ? (query.customerId ? this.parseCustomerId(query.customerId) : undefined)
      : this.parseCustomerId(authCustomerId);

    const page = Math.max(1, parseInt(String(query.page || 1), 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(String(query.limit || 20), 10) || 20));
    const skip = (page - 1) * limit;

    const andConditions: any[] = [{ deletedAt: null }];

    if (targetCustomerId !== undefined) {
      andConditions.push({
        OR: [
          { customerId: targetCustomerId },
          { customerId: null }, // Platform-wide templates
        ],
      });
    }

    if (query.category) {
      andConditions.push({ category: query.category });
    }

    if (query.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      andConditions.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { platform: { contains: search, mode: 'insensitive' } },
          { objective: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (query.isPublished !== undefined && query.isPublished !== '') {
      andConditions.push({
        isPublished: query.isPublished === true || query.isPublished === 'true',
      });
    }

    if (query.isActive !== undefined && query.isActive !== '') {
      andConditions.push({
        isActive: query.isActive === true || query.isActive === 'true',
      });
    }

    const where: any = { AND: andConditions };

    const baseStatsWhere: any = {
      AND: [
        { deletedAt: null },
        ...(targetCustomerId !== undefined
          ? [
              {
                OR: [
                  { customerId: targetCustomerId },
                  { customerId: null },
                ],
              },
            ]
          : []),
      ],
    };

    const [items, total, statsGroup, totalAll] = await Promise.all([
      this.prisma.trendingContent.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        include: {
          customer: { select: { id: true, name: true, domain: true } },
          createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.trendingContent.count({ where }),
      this.prisma.trendingContent.groupBy({
        by: ['category'],
        where: baseStatsWhere,
        _count: { _all: true },
      }),
      this.prisma.trendingContent.count({ where: baseStatsWhere }),
    ]);

    const stats = {
      total: totalAll,
      reels: 0,
      stories: 0,
      offers: 0,
      highRoi: 0,
    };

    for (const group of statsGroup) {
      const count = (group as any)._count?._all ?? 0;
      if (group.category === TrendingCategory.REEL) stats.reels = count;
      else if (group.category === TrendingCategory.STORY) stats.stories = count;
      else if (group.category === TrendingCategory.OFFER) stats.offers = count;
      else if (group.category === TrendingCategory.HIGH_ROI_AD) stats.highRoi = count;
    }

    const resolvedItems = await Promise.all(items.map((item) => this.resolveTrendingMedia(item)));

    return {
      success: true,
      data: resolvedItems,
      stats,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get a single trending content by ID.
   */
  async findOne(authCustomerId: any, id: number | string, isSuperAdmin = false) {
    const numId = parseInt(String(id), 10);
    if (isNaN(numId)) {
      throw new NotFoundException('Invalid trending content ID');
    }

    const targetCustomerId = this.parseCustomerId(authCustomerId);

    const item = await this.prisma.trendingContent.findFirst({
      where: {
        id: numId,
        deletedAt: null,
        ...(isSuperAdmin ? {} : targetCustomerId !== undefined ? {
          OR: [
            { customerId: targetCustomerId },
            { customerId: null },
          ],
        } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, domain: true } },
        createdByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!item) {
      throw new NotFoundException(`Trending content #${id} not found`);
    }

    const resolved = await this.resolveTrendingMedia(item);

    return {
      success: true,
      data: resolved,
    };
  }

  /**
   * Update trending content (Company Admin only).
   */
  async update(
    authCustomerId: any,
    id: number | string,
    dto: UpdateTrendingContentDto,
    isSuperAdmin = false,
    file?: Express.Multer.File,
  ) {
    const existing = await this.findOne(authCustomerId, id, isSuperAdmin);
    const numId = parseInt(String(id), 10);

    const startAt = dto.startAt !== undefined ? (dto.startAt ? new Date(dto.startAt) : null) : undefined;
    const endAt = dto.endAt !== undefined ? (dto.endAt ? new Date(dto.endAt) : null) : undefined;

    if (startAt && endAt && startAt > endAt) {
      throw new BadRequestException('startAt cannot be later than endAt');
    }

    const existingMetadata = (existing.data?.metadata && typeof existing.data.metadata === 'object') ? (existing.data.metadata as any) : {};
    let mediaType: 'IMAGE' | 'VIDEO' = dto.mediaType || existingMetadata.mediaType || (
      file
        ? (file.mimetype?.startsWith('video/') ? 'VIDEO' : 'IMAGE')
        : (dto.category === 'REEL' || dto.videoUrl ? 'VIDEO' : 'IMAGE')
    );

    let mediaSource: 'UPLOAD' | 'URL' = dto.mediaSource || (file ? 'UPLOAD' : existingMetadata.mediaSource || 'URL');

    let resolvedMediaUrl: string | undefined = dto.mediaUrl !== undefined
      ? dto.mediaUrl?.trim()
      : (mediaType === 'IMAGE' && dto.imageUrl ? dto.imageUrl.trim() : (mediaType === 'VIDEO' && dto.videoUrl ? dto.videoUrl.trim() : undefined));

    let resolvedThumbnailUrl: string | undefined = dto.thumbnailUrl !== undefined
      ? dto.thumbnailUrl?.trim()
      : (mediaType === 'IMAGE' && dto.imageUrl ? dto.imageUrl.trim() : undefined);

    if (file) {
      mediaSource = 'UPLOAD';
      const uploadResult = await this.s3Service.uploadMedia(file, 'marketing/trending', mediaType);
      resolvedMediaUrl = uploadResult.imageUrl;
      if (mediaType === 'IMAGE' && !resolvedThumbnailUrl) {
        resolvedThumbnailUrl = uploadResult.imageUrl;
      }
    } else if (mediaSource === 'URL' && resolvedMediaUrl) {
      if (!resolvedMediaUrl.startsWith('http://') && !resolvedMediaUrl.startsWith('https://')) {
        throw new BadRequestException('Media URL must start with http:// or https://');
      }
      if (mediaType === 'IMAGE' && !resolvedThumbnailUrl) {
        resolvedThumbnailUrl = resolvedMediaUrl;
      }
    }

    let parsedUpdateMetadata = dto.metadata;
    if (typeof parsedUpdateMetadata === 'string') {
      try {
        parsedUpdateMetadata = JSON.parse(parsedUpdateMetadata);
      } catch (_) {
        parsedUpdateMetadata = {};
      }
    }

    const metadata = {
      ...existingMetadata,
      ...(typeof parsedUpdateMetadata === 'object' && parsedUpdateMetadata !== null ? parsedUpdateMetadata : {}),
      mediaType,
      mediaSource,
    };

    const updated = await this.prisma.trendingContent.update({
      where: { id: numId },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() || 'Trending Creative' }),
        ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(resolvedThumbnailUrl !== undefined && { thumbnailUrl: resolvedThumbnailUrl || null }),
        ...(resolvedMediaUrl !== undefined && { mediaUrl: resolvedMediaUrl || null }),
        ...(dto.ctaText !== undefined && { ctaText: dto.ctaText?.trim() || null }),
        ...(dto.ctaUrl !== undefined && { ctaUrl: dto.ctaUrl?.trim() || null }),
        ...(dto.platform !== undefined && { platform: dto.platform?.trim() || 'INSTAGRAM' }),
        ...(dto.objective !== undefined && { objective: dto.objective?.trim() || 'ENGAGEMENT' }),
        ...(dto.priority !== undefined && { priority: Number(dto.priority) }),
        ...(dto.isPublished !== undefined && { isPublished: Boolean(dto.isPublished) }),
        ...(dto.isActive !== undefined && { isActive: Boolean(dto.isActive) }),
        ...(startAt !== undefined && { startAt }),
        ...(endAt !== undefined && { endAt }),
        metadata,
      },
    });

    this.logger.log(`[TRENDING_ADMIN_UPDATE] id: ${numId}, type: ${mediaType}, source: ${mediaSource}, url: ${resolvedMediaUrl || updated.mediaUrl}`);

    const resolved = await this.resolveTrendingMedia(updated);

    return {
      success: true,
      message: 'Trending content updated successfully',
      data: resolved,
    };
  }

  /**
   * Soft delete trending content (Company Admin only).
   */
  async remove(authCustomerId: any, id: number | string, isSuperAdmin = false) {
    await this.findOne(authCustomerId, id, isSuperAdmin);
    const numId = parseInt(String(id), 10);

    await this.prisma.trendingContent.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });

    return {
      success: true,
      message: 'Trending content deleted successfully',
    };
  }

  /**
   * Toggle or update published status.
   */
  async setPublished(
    authCustomerId: any,
    id: number | string,
    isPublished: boolean,
    isSuperAdmin = false,
  ) {
    await this.findOne(authCustomerId, id, isSuperAdmin);
    const numId = parseInt(String(id), 10);

    const updated = await this.prisma.trendingContent.update({
      where: { id: numId },
      data: { isPublished },
    });

    return {
      success: true,
      message: `Trending content ${isPublished ? 'published' : 'unpublished'} successfully`,
      data: await this.resolveTrendingMedia(updated),
    };
  }

  /**
   * Toggle or update active status.
   */
  async setStatus(
    authCustomerId: any,
    id: number | string,
    isActive: boolean,
    isSuperAdmin = false,
  ) {
    await this.findOne(authCustomerId, id, isSuperAdmin);
    const numId = parseInt(String(id), 10);

    const updated = await this.prisma.trendingContent.update({
      where: { id: numId },
      data: { isActive },
    });

    return {
      success: true,
      message: `Trending content status set to ${isActive ? 'active' : 'inactive'}`,
      data: await this.resolveTrendingMedia(updated),
    };
  }

  // ── Customer Endpoint ───────────────────────────────────────────────────────

  /**
   * Automatically seeds initial high-converting Instagram and YouTube trending campaigns
   * if the database table is empty.
   */
  private async seedInitialTrendingContent() {
    this.logger.log('[TRENDING_SEED] Seeding initial high-converting Instagram and YouTube campaigns...');
    const seedCampaigns = [
      {
        title: '3 Hook Formulas That Convert 10x',
        description: 'Stop the scroll in 3 seconds: Problem -> Contrast -> Offer formula used by top D2C and lifestyle brands.',
        category: TrendingCategory.REEL,
        platform: 'INSTAGRAM',
        objective: 'VIRAL_REEL',
        thumbnailUrl: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&auto=format&fit=crop',
        mediaUrl: 'https://assets.mixkit.co/videos/preview/mixkit-vertical-video-of-a-woman-opening-a-present-43403-large.mp4',
        ctaText: 'View Reel Idea',
        priority: 10,
        metadata: {
          mediaType: 'VIDEO',
          mediaSource: 'URL',
          views: 340000,
          likes: 24500,
          shares: 4800,
          comments: 1200,
          duration: '0:30',
          engagementRate: 7.2,
        },
      },
      {
        title: 'High-ROI SaaS Product Demo Hook',
        description: 'How to break down complex features into an engaging 45-second high-intent YouTube video ad.',
        category: TrendingCategory.HIGH_ROI_AD,
        platform: 'YOUTUBE',
        objective: 'CONVERSIONS',
        thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        mediaUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        ctaText: 'Watch on YouTube',
        priority: 9,
        metadata: {
          mediaType: 'VIDEO',
          mediaSource: 'URL',
          views: 2100000,
          likes: 124000,
          shares: 8900,
          comments: 3400,
          duration: '0:45',
          engagementRate: 6.3,
        },
      },
      {
        title: 'Flash Sale Urgency Countdown',
        description: 'High-converting interactive story template with limited-time discount sticker placement and swipe-up hook.',
        category: TrendingCategory.STORY,
        platform: 'INSTAGRAM',
        objective: 'SALES',
        thumbnailUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&auto=format&fit=crop',
        mediaUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&auto=format&fit=crop',
        ctaText: 'View Story Hook',
        priority: 8,
        metadata: {
          mediaType: 'IMAGE',
          mediaSource: 'URL',
          views: 89000,
          likes: 6700,
          shares: 1100,
          duration: '0:15',
          engagementRate: 8.7,
        },
      },
      {
        title: 'Behind-the-Scenes Manufacturing Short',
        description: 'Authentic storytelling that builds brand trust and drives organic YouTube Shorts discovery.',
        category: TrendingCategory.REEL,
        platform: 'YOUTUBE',
        objective: 'BRAND_AWARENESS',
        thumbnailUrl: 'https://img.youtube.com/vi/L_LUpnjgPso/hqdefault.jpg',
        mediaUrl: 'https://www.youtube.com/watch?v=L_LUpnjgPso',
        ctaText: 'Watch Short',
        priority: 7,
        metadata: {
          mediaType: 'VIDEO',
          mediaSource: 'URL',
          views: 780000,
          likes: 56000,
          shares: 3400,
          comments: 920,
          duration: '0:58',
          engagementRate: 7.8,
        },
      },
      {
        title: 'Exclusive VIP Festive Bundle Offer',
        description: 'Seasonal promotion creative featuring bundle value proposition and gift-with-purchase hook.',
        category: TrendingCategory.OFFER,
        platform: 'INSTAGRAM',
        objective: 'PROMO_OFFER',
        thumbnailUrl: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&auto=format&fit=crop',
        mediaUrl: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&auto=format&fit=crop',
        ctaText: 'Claim Offer Idea',
        priority: 6,
        metadata: {
          mediaType: 'IMAGE',
          mediaSource: 'URL',
          views: 142000,
          likes: 11200,
          shares: 2100,
          duration: '0:20',
          engagementRate: 9.4,
        },
      },
      {
        title: 'Customer Case Study Testimonial Ad',
        description: 'Real customer testimonial highlighting 3x revenue growth within 30 days of onboarding.',
        category: TrendingCategory.HIGH_ROI_AD,
        platform: 'YOUTUBE',
        objective: 'LEAD_GENERATION',
        thumbnailUrl: 'https://img.youtube.com/vi/kJQP7kiw5Fk/hqdefault.jpg',
        mediaUrl: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk',
        ctaText: 'Watch Case Study',
        priority: 5,
        metadata: {
          mediaType: 'VIDEO',
          mediaSource: 'URL',
          views: 1450000,
          likes: 89000,
          shares: 6100,
          comments: 2100,
          duration: '1:12',
          engagementRate: 6.8,
        },
      },
    ];

    for (const item of seedCampaigns) {
      await this.prisma.trendingContent.create({
        data: {
          title: item.title,
          description: item.description,
          category: item.category,
          platform: item.platform,
          objective: item.objective,
          thumbnailUrl: item.thumbnailUrl,
          mediaUrl: item.mediaUrl,
          ctaText: item.ctaText,
          priority: item.priority,
          isPublished: true,
          isActive: true,
          metadata: item.metadata,
        },
      });
    }
    this.logger.log('[TRENDING_SEED] Successfully seeded initial trending campaigns');
  }

  /**
   * Customer / Mobile App query: Returns ONLY active, published, and currently valid
   * content isolated to the authenticated customer's company workspace.
   */
  async findAllCustomer(
    authCustomerId: any,
    category?: TrendingCategory,
    user?: any,
    platform?: string,
    sort?: string,
  ) {
    const targetCustomerId = this.parseCustomerId(authCustomerId);
    const now = new Date();

    const existingCount = await this.prisma.trendingContent.count({
      where: { deletedAt: null },
    });
    if (existingCount === 0) {
      await this.seedInitialTrendingContent();
    }

    console.log('[CUSTOMER_TRENDING_REQUEST]', {
      userId: user?.id || null,
      customerId: targetCustomerId || null,
      email: user?.email || null,
      platform,
      sort,
    });

    const where: any = {
      deletedAt: null,
      isActive: true,
      isPublished: true,
      // Date scheduling filter: startAt <= now (or null) AND endAt >= now (or null)
      AND: [
        {
          OR: [
            { startAt: null },
            { startAt: { lte: now } },
          ],
        },
        {
          OR: [
            { endAt: null },
            { endAt: { gte: now } },
          ],
        },
      ],
    };

    // Multi-tenant isolation: Content belonging to customer's workspace OR global platform templates
    if (targetCustomerId !== undefined) {
      where.OR = [
        { customerId: targetCustomerId },
        { customerId: null },
      ];
    }

    if (category) {
      where.category = category;
    }

    if (platform && platform.toUpperCase() !== 'ALL') {
      where.platform = { equals: platform, mode: 'insensitive' };
    }

    console.log('[CUSTOMER_TRENDING_PRISMA]', {
      customerId: targetCustomerId,
      customerIdType: typeof targetCustomerId,
      platform,
    });

    let orderBy: any[] = [
      { priority: 'desc' },
      { createdAt: 'desc' },
    ];
    if (sort === 'latest') {
      orderBy = [{ createdAt: 'desc' }];
    } else if (sort === 'popular') {
      orderBy = [{ priority: 'desc' }, { createdAt: 'desc' }];
    } else if (sort === 'engagement') {
      orderBy = [{ priority: 'desc' }, { createdAt: 'desc' }];
    }

    const rawItems = await this.prisma.trendingContent.findMany({
      where,
      orderBy,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        thumbnailUrl: true,
        mediaUrl: true,
        ctaText: true,
        ctaUrl: true,
        platform: true,
        objective: true,
        priority: true,
        startAt: true,
        endAt: true,
        createdAt: true,
        metadata: true,
      },
    });

    const items = await Promise.all(rawItems.map((item) => this.resolveTrendingMedia(item)));

    console.log('[TRENDING_RESPONSE]', {
      count: items.length,
    });

    return {
      success: true,
      data: items,
      count: items.length,
    };
  }
}
