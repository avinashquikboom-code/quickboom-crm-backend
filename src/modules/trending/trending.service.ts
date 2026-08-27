import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTrendingContentDto,
  UpdateTrendingContentDto,
  QueryTrendingDto,
} from './dto/trending.dto';
import { TrendingCategory } from '@prisma/client';

@Injectable()
export class TrendingService {
  private readonly logger = new Logger(TrendingService.name);

  constructor(private readonly prisma: PrismaService) {}

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
  ) {
    const targetCustomerId = isSuperAdmin && dto.customerId
      ? this.parseCustomerId(dto.customerId)
      : this.parseCustomerId(authCustomerId);

    const startAt = dto.startAt ? new Date(dto.startAt) : null;
    const endAt = dto.endAt ? new Date(dto.endAt) : null;

    if (startAt && endAt && startAt > endAt) {
      throw new BadRequestException('startAt cannot be later than endAt');
    }

    const content = await this.prisma.trendingContent.create({
      data: {
        customerId: targetCustomerId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        category: dto.category,
        thumbnailUrl: dto.thumbnailUrl?.trim() || null,
        mediaUrl: dto.mediaUrl?.trim() || null,
        ctaText: dto.ctaText?.trim() || null,
        ctaUrl: dto.ctaUrl?.trim() || null,
        platform: dto.platform?.trim() || 'INSTAGRAM',
        objective: dto.objective?.trim() || 'ENGAGEMENT',
        priority: dto.priority !== undefined ? dto.priority : 0,
        isPublished: dto.isPublished !== undefined ? dto.isPublished : true,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        startAt,
        endAt,
        createdBy: userId || null,
        metadata: dto.metadata || null,
      },
    });

    console.log('[TRENDING_ADMIN_CREATE]', {
      adminId: userId,
      customerId: targetCustomerId,
      contentId: content.id,
      category: content.category,
    });

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
  ) {
    await this.findOne(authCustomerId, id, isSuperAdmin);
    const numId = parseInt(String(id), 10);

    const startAt = dto.startAt ? new Date(dto.startAt) : undefined;
    const endAt = dto.endAt ? new Date(dto.endAt) : undefined;

    if (startAt && endAt && startAt > endAt) {
      throw new BadRequestException('startAt cannot be later than endAt');
    }

    const updated = await this.prisma.trendingContent.update({
      where: { id: numId },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.thumbnailUrl !== undefined && { thumbnailUrl: dto.thumbnailUrl?.trim() || null }),
        ...(dto.mediaUrl !== undefined && { mediaUrl: dto.mediaUrl?.trim() || null }),
        ...(dto.ctaText !== undefined && { ctaText: dto.ctaText?.trim() || null }),
        ...(dto.ctaUrl !== undefined && { ctaUrl: dto.ctaUrl?.trim() || null }),
        ...(dto.platform !== undefined && { platform: dto.platform?.trim() || 'INSTAGRAM' }),
        ...(dto.objective !== undefined && { objective: dto.objective?.trim() || 'ENGAGEMENT' }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.startAt !== undefined && { startAt }),
        ...(dto.endAt !== undefined && { endAt }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata }),
      },
    });

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

    console.log('[TRENDING_CUSTOMER_REQUEST]', {
      userId: user?.id || null,
      customerId: targetCustomerId || null,
      category: category || 'ALL',
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
