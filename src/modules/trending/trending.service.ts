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

  // ── Company Admin Operations ────────────────────────────────────────────────

  /**
   * Create a new trending content record (Company Admin only).
   */
  async create(
    authCustomerId: any,
    userId: number,
    dto: CreateTrendingContentDto,
    isSuperAdmin = false,
    file?: Express.Multer.File,
  ) {
    const targetCustomerId = isSuperAdmin && dto.customerId
      ? this.parseCustomerId(dto.customerId)
      : this.parseCustomerId(authCustomerId);

    const startAt = dto.startAt ? new Date(dto.startAt) : null;
    const endAt = dto.endAt ? new Date(dto.endAt) : null;

    if (startAt && endAt && startAt > endAt) {
      throw new BadRequestException('startAt cannot be later than endAt');
    }

    // Determine Media Type: IMAGE | VIDEO
    let mediaType: 'IMAGE' | 'VIDEO' = dto.mediaType || (
      file
        ? (file.mimetype?.startsWith('video/') ? 'VIDEO' : 'IMAGE')
        : (dto.category === 'REEL' || dto.videoUrl ? 'VIDEO' : 'IMAGE')
    );

    // Determine Media Source: UPLOAD | URL
    let mediaSource: 'UPLOAD' | 'URL' = dto.mediaSource || (file ? 'UPLOAD' : 'URL');

    let resolvedMediaUrl = (dto.mediaUrl || (mediaType === 'IMAGE' ? dto.imageUrl : dto.videoUrl) || '').trim();
    let resolvedThumbnailUrl = (dto.thumbnailUrl || (mediaType === 'IMAGE' ? dto.imageUrl : '') || '').trim();

    // 1. Handle File Upload
    if (file) {
      mediaSource = 'UPLOAD';
      const uploadResult = await this.s3Service.uploadMedia(file, 'marketing/trending', mediaType);
      resolvedMediaUrl = uploadResult.imageUrl;
      if (mediaType === 'IMAGE' && !resolvedThumbnailUrl) {
        resolvedThumbnailUrl = uploadResult.imageUrl;
      }
    } else if (mediaSource === 'UPLOAD' && !resolvedMediaUrl) {
      throw new BadRequestException(`A ${mediaType.toLowerCase()} file is required when upload source is selected.`);
    }

    // 2. Validate URL if source is URL or URL was provided
    if (mediaSource === 'URL') {
      if (!resolvedMediaUrl) {
        throw new BadRequestException(`Please enter a valid ${mediaType.toLowerCase()} URL.`);
      }
      if (!resolvedMediaUrl.startsWith('http://') && !resolvedMediaUrl.startsWith('https://')) {
        throw new BadRequestException('Media URL must start with http:// or https://');
      }
      if (mediaType === 'IMAGE' && !resolvedThumbnailUrl) {
        resolvedThumbnailUrl = resolvedMediaUrl;
      }
    }

    const metadata = {
      ...(typeof dto.metadata === 'object' && dto.metadata !== null ? dto.metadata : {}),
      mediaType,
      mediaSource,
    };

    const content = await this.prisma.trendingContent.create({
      data: {
        customerId: targetCustomerId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        category: dto.category,
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

    this.logger.log(`[TRENDING_ADMIN_CREATE] id: ${content.id}, customer: ${targetCustomerId}, type: ${mediaType}, source: ${mediaSource}, url: ${resolvedMediaUrl}`);

    return {
      success: true,
      message: 'Trending content created successfully',
      data: content,
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
    const targetCustomerId = isSuperAdmin && query.customerId
      ? this.parseCustomerId(query.customerId)
      : this.parseCustomerId(authCustomerId);

    const page = Math.max(1, parseInt(String(query.page || 1), 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(String(query.limit || 20), 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (targetCustomerId !== undefined) {
      where.OR = [
        { customerId: targetCustomerId },
        { customerId: null }, // Platform-wide templates
      ];
    }

    if (query.category) {
      where.category = query.category;
    }

    if (query.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { platform: { contains: search, mode: 'insensitive' } },
            { objective: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (query.isPublished !== undefined && query.isPublished !== '') {
      where.isPublished = query.isPublished === true || query.isPublished === 'true';
    }

    if (query.isActive !== undefined && query.isActive !== '') {
      where.isActive = query.isActive === true || query.isActive === 'true';
    }

    const [items, total] = await Promise.all([
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
    ]);

    return {
      success: true,
      data: items,
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

    return {
      success: true,
      data: item,
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

    const metadata = {
      ...existingMetadata,
      ...(typeof dto.metadata === 'object' && dto.metadata !== null ? dto.metadata : {}),
      mediaType,
      mediaSource,
    };

    const updated = await this.prisma.trendingContent.update({
      where: { id: numId },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
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

    return {
      success: true,
      message: 'Trending content updated successfully',
      data: updated,
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
      data: updated,
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
      data: updated,
    };
  }

  // ── Customer Endpoint ───────────────────────────────────────────────────────

  /**
   * Customer / Mobile App query: Returns ONLY active, published, and currently valid
   * content isolated to the authenticated customer's company workspace.
   */
  async findAllCustomer(
    authCustomerId: any,
    category?: TrendingCategory,
    user?: any,
  ) {
    const targetCustomerId = this.parseCustomerId(authCustomerId);
    const now = new Date();

    console.log('[CUSTOMER_TRENDING_REQUEST]', {
      userId: user?.id || null,
      customerId: targetCustomerId || null,
      email: user?.email || null,
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

    console.log('[CUSTOMER_TRENDING_PRISMA]', {
      customerId: targetCustomerId,
      customerIdType: typeof targetCustomerId,
    });

    const items = await this.prisma.trendingContent.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
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
