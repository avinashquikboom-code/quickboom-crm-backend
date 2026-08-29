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
      `[ADMIN_BANNER_CREATE_DEBUG]\ntitle: ${dto.title}\nimage: ${file ? file.originalname : (dto.imageUrl ? dto.imageUrl.substring(0, 40) + '...' : 'none')}\nimageType: ${file ? file.mimetype : (dto.imageUrl?.startsWith('data:') ? 'BASE64' : 'URL')}\nimageSize: ${file ? file.size : 'N/A'}\nimageUrl: ${imageUrl}\nbannerUrl: ${imageUrl}\npayload: ${JSON.stringify(dto)}`,
    );

    this.logger.log(
      `[BANNER_DB_DEBUG]\nid: ${banner.id}\ntitle: ${banner.title}\nimageUrl: ${banner.imageUrl}\nimage: ${banner.imageUrl}\nbannerUrl: ${banner.imageUrl}\nmediaUrl: ${banner.imageUrl}`,
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

    this.logger.log(
      `[BANNER_DB_DEBUG]\nid: ${banner.id}\ntitle: ${banner.title}\nimageUrl: ${banner.imageUrl}\nimage: ${banner.imageUrl}\nbannerUrl: ${banner.imageUrl}\nmediaUrl: ${banner.imageUrl}`,
    );

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

    this.logger.log(
      `[BANNER_DB_DEBUG]\nid: ${updated.id}\ntitle: ${updated.title}\nimageUrl: ${updated.imageUrl}\nimage: ${updated.imageUrl}\nbannerUrl: ${updated.imageUrl}\nmediaUrl: ${updated.imageUrl}`,
    );
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
    id?: number;
    customerId?: number | null;
    role?: string;
  }) {
    const now = new Date();
    const resolvedCustomerId = user?.customerId ? Number(user.customerId) : null;

    let currentPlanName = 'NONE';
    let currentPlanId: number | null = null;
    if (resolvedCustomerId && (this.prisma as any).customerSubscription) {
      try {
        const activeSub = await (this.prisma as any).customerSubscription.findFirst({
          where: {
            customerId: resolvedCustomerId,
            status: 'ACTIVE',
            deletedAt: null,
          },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
        });
        if (activeSub) {
          currentPlanId = activeSub.planId;
          currentPlanName = activeSub.plan?.name || `Plan #${activeSub.planId}`;
        }
      } catch (subErr) {
        // Safe fallback if mock prisma or table lookup fails
      }
    }

    this.logger.log(
      `[CUSTOMER_BANNER_QUERY_DEBUG]\nauthenticatedUser: ${user?.id || 'ANONYMOUS'}\ncustomerId: ${resolvedCustomerId ?? 'NONE'}\nplacement: HOME\nactive: true\ncurrentDate: ${now.toISOString()}\ncurrentPlan: ${currentPlanName}\nquery: customerId IN [${resolvedCustomerId ?? 'NONE'}, null] AND isActive=true AND isPublished=true AND deletedAt=null`,
    );

    const allBanners = await this.prisma.marketingBanner.findMany({
      where: { deletedAt: null },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    const statusFiltered = allBanners.filter((b) => b.isActive && b.isPublished);

    const customerFiltered = statusFiltered.filter((b) => {
      if (b.customerId === null) return true;
      if (resolvedCustomerId && b.customerId === resolvedCustomerId) return true;
      const meta = b.metadata as any;
      if (meta && Array.isArray(meta.customerIds) && resolvedCustomerId) {
        return meta.customerIds.map(Number).includes(resolvedCustomerId);
      }
      return false;
    });

    const isDateValid = (banner: any) => {
      if (banner.startAt) {
        const start = new Date(banner.startAt);
        if (start > now) return false;
      }
      if (banner.endAt) {
        const end = new Date(banner.endAt);
        if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
          end.setHours(23, 59, 59, 999);
        }
        if (end < now) return false;
      }
      return true;
    };

    const isPlanValid = (banner: any) => {
      const meta = banner.metadata as any;
      if (!meta) return true;
      const targetPlanIds: number[] = [];
      if (meta.planId) targetPlanIds.push(Number(meta.planId));
      if (Array.isArray(meta.planIds)) {
        meta.planIds.forEach((p: any) => targetPlanIds.push(Number(p)));
      }
      if (targetPlanIds.length === 0) return true;
      if (!currentPlanId) return false;
      return targetPlanIds.includes(currentPlanId);
    };

    const dateFiltered = customerFiltered.filter((b) => isDateValid(b) && isPlanValid(b));

    this.logger.log(
      `[CUSTOMER_BANNER_QUERY_DEBUG]\ncustomerId: ${resolvedCustomerId ?? 'NONE'}\nplacement: HOME\nactive: true\ncurrentDate: ${now.toISOString()}\nquery: customerId IN [${resolvedCustomerId ?? 'NONE'}, null] AND isActive=true AND isPublished=true AND deletedAt=null\nmatchedCount: ${dateFiltered.length}`,
    );

    this.logger.log(
      `database records before filtering: ${allBanners.length}\nrecords after customer filtering: ${customerFiltered.length}\nrecords after status filtering: ${statusFiltered.length}\nrecords after date filtering: ${dateFiltered.length}\nrecords returned: ${dateFiltered.length}`,
    );

    const resultBanners: any[] = [];
    for (const b of dateFiltered) {
      let currentImageUrl = b.imageUrl;
      let currentImageKey = b.imageKey || b.imagePublicId;

      if (currentImageUrl && currentImageUrl.startsWith('data:')) {
        try {
          this.logger.log(`[BANNER_MIGRATION_S3] Migrating base64 banner ${b.id} to S3`);
          const uploadResult = await this.uploadService.uploadBase64(currentImageUrl);
          currentImageUrl = uploadResult.imageUrl;
          currentImageKey = uploadResult.imagePublicId || null;

          await this.prisma.marketingBanner.update({
            where: { id: b.id },
            data: {
              imageUrl: currentImageUrl,
              imagePublicId: currentImageKey,
              imageKey: currentImageKey,
            },
          });
          this.logger.log(
            `[BANNER_MIGRATION_S3_SUCCESS] Banner ${b.id} migrated to S3: ${currentImageUrl}`,
          );
        } catch (migErr: any) {
          this.logger.error(`[BANNER_MIGRATION_S3_FAILED] Banner ${b.id}: ${migErr?.message}`);
        }
      }

      if (currentImageUrl) {
        const item = {
          ...b,
          imageUrl: currentImageUrl,
          image: currentImageUrl,
          bannerImage: currentImageUrl,
          bannerUrl: currentImageUrl,
          mediaUrl: currentImageUrl,
          imagePublicId: currentImageKey,
          imageKey: currentImageKey,
        };
        resultBanners.push(item);
        this.logger.log(
          `[BANNER_API_DEBUG]\nid: ${item.id}\ntitle: ${item.title}\nimage: ${item.imageUrl}\nimageUrl: ${item.imageUrl}\nbannerUrl: ${item.imageUrl}\nmediaUrl: ${item.imageUrl}`,
        );
        this.logger.log(
          `[CUSTOMER_BANNER_RESPONSE_DEBUG]\nid: ${item.id}\ntitle: ${item.title}\nimageUrl: ${item.imageUrl}\nstatus: ${item.isActive ? 'ACTIVE' : 'INACTIVE'}\nplacement: HOME\ncustomerId: ${item.customerId ?? 'GLOBAL'}`,
        );
      }
    }

    this.logger.log(`[CUSTOMER_BANNERS_RESPONSE]\ncount: ${resultBanners.length}`);
    return resultBanners;
  }
}
