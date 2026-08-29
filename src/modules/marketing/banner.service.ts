import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BannerUploadService } from './banner-upload.service';
import {
  CreateMarketingBannerDto,
  QueryMarketingBannerDto,
  UpdateMarketingBannerDto,
} from './dto/banner.dto';

@Injectable()
export class BannerService {
  private readonly logger = new Logger(BannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: BannerUploadService,
  ) {}

  /**
   * Create a new marketing banner (Company Admin / Super Admin)
   */
  async create(
    dto: CreateMarketingBannerDto,
    user: { id: number; customerId?: number | null; role?: string },
    file?: Express.Multer.File,
  ) {
    let imageUrl = dto.imageUrl?.trim();
    let imagePublicId = dto.imagePublicId?.trim() || null;

    if (file) {
      const uploadResult = await this.uploadService.uploadBannerImage(file);
      imageUrl = uploadResult.imageUrl;
      imagePublicId = uploadResult.imagePublicId || null;
    } else if (imageUrl && imageUrl.startsWith('data:')) {
      const uploadResult = await this.uploadService.uploadBase64(imageUrl);
      imageUrl = uploadResult.imageUrl;
      imagePublicId = uploadResult.imagePublicId || null;
    }

    if (!imageUrl || imageUrl.startsWith('data:')) {
      throw new BadRequestException('Valid banner image file or S3 image URL is required');
    }

    const startAt = dto.startAt ? new Date(dto.startAt) : null;
    const endAt = dto.endAt ? new Date(dto.endAt) : null;

    if (startAt && endAt && endAt < startAt) {
      throw new BadRequestException('endAt cannot be earlier than startAt');
    }

    const customerId = user.customerId ?? null;

    let banner: any;
    try {
      banner = await this.prisma.marketingBanner.create({
        data: {
          customerId,
          title: dto.title.trim(),
          subtitle: dto.subtitle?.trim() || null,
          description: dto.description?.trim() || null,
          imageUrl,
          imagePublicId,
          imageKey: imagePublicId,
          ctaText: dto.ctaText?.trim() || null,
          ctaUrl: dto.ctaUrl?.trim() || null,
          priority: dto.priority !== undefined ? Number(dto.priority) : 0,
          isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
          isPublished: dto.isPublished !== undefined ? Boolean(dto.isPublished) : true,
          startAt,
          endAt,
          createdBy: user.id,
        },
      });
    } catch (dbErr: any) {
      if (imagePublicId) {
        this.logger.warn(
          `[BANNER_CREATE_ROLLBACK] DB create failed after S3 upload. Deleting orphan S3 object: ${imagePublicId}`,
        );
        await this.uploadService.deleteBannerImage(imagePublicId).catch((delErr) =>
          this.logger.error(`[BANNER_ROLLBACK_DELETE_FAILED] ${delErr?.message}`),
        );
      }
      throw dbErr;
    }

    this.logger.log(
      `[BANNER_DB_DEBUG]\nsavedImageUrl: ${banner.imageUrl}`,
    );

    this.logger.log(
      `[MARKETING_BANNER_CREATE]\nadminId: ${user.id}\ncompanyId: ${customerId ?? 'GLOBAL'}\nbannerId: ${banner.id}\nimageUrl: ${imageUrl}`,
    );

    return banner;
  }

  /**
   * List banners for Company Admin with search, filters, pagination
   */
  async findAllAdmin(
    query: QueryMarketingBannerDto,
    user: { id: number; customerId?: number | null; role?: string },
  ) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    // Workspace scoping: If user belongs to a customer/tenant, limit to that customer or global
    if (user.customerId) {
      where.OR = [{ customerId: user.customerId }, { customerId: null }];
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.isPublished !== undefined) {
      where.isPublished = query.isPublished;
    }

    if (query.search) {
      const s = query.search.trim();
      where.AND = [
        {
          OR: [
            { title: { contains: s, mode: 'insensitive' } },
            { subtitle: { contains: s, mode: 'insensitive' } },
            { description: { contains: s, mode: 'insensitive' } },
            { ctaText: { contains: s, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.marketingBanner.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          createdByUser: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
      this.prisma.marketingBanner.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find single banner by ID
   */
  async findOne(
    id: number,
    user: { id: number; customerId?: number | null; role?: string },
  ) {
    const banner = await this.prisma.marketingBanner.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        createdByUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!banner) {
      throw new NotFoundException(`Marketing banner with ID ${id} not found`);
    }

    if (
      user.customerId &&
      banner.customerId &&
      banner.customerId !== user.customerId
    ) {
      throw new NotFoundException(`Marketing banner with ID ${id} not found`);
    }

    return banner;
  }

  /**
   * Update marketing banner
   */
  async update(
    id: number,
    dto: UpdateMarketingBannerDto,
    user: { id: number; customerId?: number | null; role?: string },
    file?: Express.Multer.File,
  ) {
    const existing = await this.findOne(id, user);

    let imageUrl = dto.imageUrl !== undefined ? dto.imageUrl.trim() : undefined;
    let imagePublicId = dto.imagePublicId !== undefined ? dto.imagePublicId.trim() : undefined;

    if (file) {
      const uploadResult = await this.uploadService.uploadBannerImage(file);
      imageUrl = uploadResult.imageUrl;
      imagePublicId = uploadResult.imagePublicId || null;
    } else if (imageUrl && imageUrl.startsWith('data:')) {
      const uploadResult = await this.uploadService.uploadBase64(imageUrl);
      imageUrl = uploadResult.imageUrl;
      imagePublicId = uploadResult.imagePublicId || null;
    }

    const startAt =
      dto.startAt !== undefined
        ? dto.startAt
          ? new Date(dto.startAt)
          : null
        : existing.startAt;
    const endAt =
      dto.endAt !== undefined
        ? dto.endAt
          ? new Date(dto.endAt)
          : null
        : existing.endAt;

    if (startAt && endAt && endAt < startAt) {
      throw new BadRequestException('endAt cannot be earlier than startAt');
    }

    const updated = await this.prisma.marketingBanner.update({
      where: { id },
      data: {
        title: dto.title !== undefined ? dto.title.trim() : undefined,
        subtitle:
          dto.subtitle !== undefined
            ? dto.subtitle
              ? dto.subtitle.trim()
              : null
            : undefined,
        description:
          dto.description !== undefined
            ? dto.description
              ? dto.description.trim()
              : null
            : undefined,
        imageUrl: imageUrl !== undefined ? imageUrl : undefined,
        imagePublicId: imagePublicId !== undefined ? imagePublicId : undefined,
        imageKey: imagePublicId !== undefined ? imagePublicId : undefined,
        ctaText:
          dto.ctaText !== undefined
            ? dto.ctaText
              ? dto.ctaText.trim()
              : null
            : undefined,
        ctaUrl:
          dto.ctaUrl !== undefined
            ? dto.ctaUrl
              ? dto.ctaUrl.trim()
              : null
            : undefined,
        priority: dto.priority !== undefined ? Number(dto.priority) : undefined,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : undefined,
        isPublished:
          dto.isPublished !== undefined ? Boolean(dto.isPublished) : undefined,
        startAt,
        endAt,
      },
    });

    // Clean up old Amazon S3 object only AFTER database update succeeds
    if (file && existing.imagePublicId && existing.imagePublicId !== imagePublicId) {
      this.uploadService.deleteBannerImage(existing.imagePublicId).catch(() => {});
    }

    this.logger.log(`[BANNER_DB_DEBUG]\nsavedImageUrl: ${updated.imageUrl}`);
    this.logger.log(`[MARKETING_BANNER_UPDATE]\nbannerId: ${id}`);
    return updated;
  }

  /**
   * Soft delete a marketing banner
   */
  async remove(
    id: number,
    user: { id: number; customerId?: number | null; role?: string },
  ) {
    const existing = await this.findOne(id, user);

    await this.prisma.marketingBanner.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    if (existing.imagePublicId) {
      this.uploadService.deleteBannerImage(existing.imagePublicId).catch(() => {});
    }

    this.logger.log(`[MARKETING_BANNER_DELETE]\nbannerId: ${id}`);
    return { success: true, message: `Marketing banner ${id} deleted successfully` };
  }

  /**
   * Set published state
   */
  async setPublished(
    id: number,
    isPublished: boolean,
    user: { id: number; customerId?: number | null; role?: string },
  ) {
    await this.findOne(id, user);

    const updated = await this.prisma.marketingBanner.update({
      where: { id },
      data: { isPublished },
    });

    this.logger.log(
      `[MARKETING_BANNER_PUBLISH]\nbannerId: ${id}\nisPublished: ${isPublished}`,
    );
    return updated;
  }

  /**
   * Set active state
   */
  async setStatus(
    id: number,
    isActive: boolean,
    user: { id: number; customerId?: number | null; role?: string },
  ) {
    await this.findOne(id, user);

    const updated = await this.prisma.marketingBanner.update({
      where: { id },
      data: { isActive },
    });

    this.logger.log(
      `[MARKETING_BANNER_STATUS]\nbannerId: ${id}\nisActive: ${isActive}`,
    );
    return updated;
  }

  /**
   * Fetch active, published, scheduled banners for Customer Home Screen
   */
  async findAllCustomer(user: {
    id: number;
    customerId?: number | null;
    role?: string;
  }) {
    const now = new Date();

    this.logger.log(
      `[CUSTOMER_BANNERS_REQUEST]\nuserId: ${user.id}\ncustomerId: ${user.customerId ?? 'NONE'}\ncompanyId: ${user.customerId ?? 'GLOBAL'}`,
    );

    const customerScope: any = user.customerId
      ? { OR: [{ customerId: user.customerId }, { customerId: null }] }
      : { customerId: null };

    const banners = await this.prisma.marketingBanner.findMany({
      where: {
        ...customerScope,
        isActive: true,
        isPublished: true,
        deletedAt: null,
        AND: [
          {
            OR: [{ startAt: null }, { startAt: { lte: now } }],
          },
          {
            OR: [{ endAt: null }, { endAt: { gte: now } }],
          },
        ],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    const validBanners = banners.filter((b) => b.imageUrl && !b.imageUrl.startsWith('data:'));
    for (const b of validBanners) {
      this.logger.log(`[BANNER_API_DEBUG]\nreturnedImageUrl: ${b.imageUrl}`);
    }
    this.logger.log(`[CUSTOMER_BANNERS_RESPONSE]\ncount: ${validBanners.length}`);
    return validBanners;
  }
}
