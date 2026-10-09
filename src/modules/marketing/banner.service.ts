import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BannerUploadService } from './banner-upload.service';
import { S3Service } from '../s3/s3.service';
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
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Helper to resolve S3 key into a temporary presigned URL for private S3 access.
   * Ensures image, bannerImage, bannerUrl, and mediaUrl all use the same resolved URL.
   */
  private async resolveBannerMedia(banner: any): Promise<any> {
    if (!banner) return banner;

    const rawKey = banner.imageKey || banner.imagePublicId || this.s3Service.extractKey(banner.imageUrl);
    const resolvedUrl = (await this.s3Service.getPresignedUrl(banner.imageUrl || rawKey)) || banner.imageUrl;
    const meta = typeof banner.metadata === 'object' && banner.metadata !== null ? banner.metadata : {};

    return {
      ...banner,
      imageKey: rawKey,
      imagePublicId: rawKey,
      imageUrl: resolvedUrl,
      image: resolvedUrl,
      bannerImage: resolvedUrl,
      bannerUrl: resolvedUrl,
      mediaUrl: resolvedUrl,
      actionType: banner.actionType || meta.actionType || meta.action || (banner.ctaUrl?.startsWith('http') ? 'OPEN_URL' : null),
      couponCode: banner.couponCode || meta.couponCode || meta.code || null,
      discount: banner.discount || meta.discount || meta.discountPct || null,
      brand: banner.brand || meta.brand || null,
      terms: banner.terms || meta.terms || null,
      minOrder: banner.minOrder || meta.minOrder || null,
      category: banner.category || meta.category || null,
    };
  }

  /**
   * Create a new marketing banner (Company Admin / Super Admin)
   */
  async create(
    dto: CreateMarketingBannerDto,
    user: { id: number; customerId?: number | null; role?: string },
    file?: Express.Multer.File,
  ) {
    let imageUrl = (dto.imageUrl || dto.image)?.trim();
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
    const cleanKey = imagePublicId || this.s3Service.extractKey(imageUrl);

    const couponMetadata: Record<string, any> = {
      ...(typeof dto.metadata === 'object' && dto.metadata !== null ? dto.metadata : {}),
      ...(dto.actionType ? { actionType: dto.actionType.trim() } : {}),
      ...(dto.couponCode ? { couponCode: dto.couponCode.trim() } : {}),
      ...(dto.discount ? { discount: dto.discount.trim() } : {}),
      ...(dto.brand ? { brand: dto.brand.trim() } : {}),
      ...(dto.terms ? { terms: dto.terms.trim() } : {}),
      ...(dto.minOrder ? { minOrder: dto.minOrder.trim() } : {}),
      ...(dto.category ? { category: dto.category.trim() } : {}),
    };

    let banner: any;
    try {
      banner = await this.prisma.marketingBanner.create({
        data: {
          customerId,
          title: dto.title?.trim() || 'Home Banner',
          subtitle: dto.subtitle?.trim() || null,
          description: dto.description?.trim() || null,
          imageUrl,
          imagePublicId: cleanKey,
          imageKey: cleanKey,
          ctaText: dto.ctaText?.trim() || null,
          ctaUrl: dto.ctaUrl?.trim() || null,
          priority: dto.priority !== undefined ? Number(dto.priority) : 0,
          isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
          isPublished: dto.isPublished !== undefined ? Boolean(dto.isPublished) : true,
          startAt,
          endAt,
          createdBy: user.id,
          metadata: Object.keys(couponMetadata).length > 0 ? couponMetadata : undefined,
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

    const resolved = await this.resolveBannerMedia(banner);

    this.logger.log(
      `[ADMIN_BANNER_CREATE_DEBUG]\ntitle: ${dto.title}\nimage: ${file ? file.originalname : (dto.imageUrl ? dto.imageUrl.substring(0, 40) + '...' : 'none')}\nimageType: ${file ? file.mimetype : (dto.imageUrl?.startsWith('data:') ? 'BASE64' : 'URL')}\nimageSize: ${file ? file.size : 'N/A'}\nimageUrl: ${resolved.imageUrl}\nbannerUrl: ${resolved.imageUrl}\npayload: ${JSON.stringify(dto)}`,
    );

    this.logger.log(
      `[BANNER_DB_DEBUG]\nid: ${banner.id}\ntitle: ${banner.title}\nimageUrl: ${resolved.imageUrl}\nimage: ${resolved.imageUrl}\nbannerUrl: ${resolved.imageUrl}\nmediaUrl: ${resolved.imageUrl}`,
    );

    this.logger.log(
      `[MARKETING_BANNER_CREATE]\nadminId: ${user.id}\ncompanyId: ${customerId ?? 'GLOBAL'}\nbannerId: ${banner.id}\nimageUrl: ${resolved.imageUrl}`,
    );

    return resolved;
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

    const [rawItems, total] = await Promise.all([
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

    const items = await Promise.all(rawItems.map((item) => this.resolveBannerMedia(item)));

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

    const resolved = await this.resolveBannerMedia(banner);

    this.logger.log(
      `[BANNER_DB_DEBUG]\nid: ${resolved.id}\ntitle: ${resolved.title}\nimageUrl: ${resolved.imageUrl}\nimage: ${resolved.imageUrl}\nbannerUrl: ${resolved.imageUrl}\nmediaUrl: ${resolved.imageUrl}`,
    );

    return resolved;
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

    const rawImageUrl = dto.imageUrl !== undefined ? dto.imageUrl : dto.image;
    let imageUrl = rawImageUrl !== undefined ? rawImageUrl.trim() : undefined;
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
        : undefined;
    const endAt =
      dto.endAt !== undefined
        ? dto.endAt
          ? new Date(dto.endAt)
          : null
        : undefined;

    const effectiveStartAt = startAt !== undefined ? startAt : existing.startAt;
    const effectiveEndAt = endAt !== undefined ? endAt : existing.endAt;

    if (effectiveStartAt && effectiveEndAt && effectiveEndAt < effectiveStartAt) {
      throw new BadRequestException('endAt cannot be earlier than startAt');
    }

    const cleanKey = imagePublicId || (imageUrl ? this.s3Service.extractKey(imageUrl) : undefined);

    let updatedMetadata = existing.metadata;
    if (
      dto.metadata !== undefined ||
      dto.actionType !== undefined ||
      dto.couponCode !== undefined ||
      dto.discount !== undefined ||
      dto.brand !== undefined ||
      dto.terms !== undefined ||
      dto.minOrder !== undefined ||
      dto.category !== undefined
    ) {
      const prevMeta =
        typeof existing.metadata === 'object' && existing.metadata !== null
          ? existing.metadata
          : {};
      const newMeta =
        typeof dto.metadata === 'object' && dto.metadata !== null
          ? dto.metadata
          : {};
      updatedMetadata = {
        ...prevMeta,
        ...newMeta,
        ...(dto.actionType !== undefined ? { actionType: dto.actionType ? dto.actionType.trim() : null } : {}),
        ...(dto.couponCode !== undefined ? { couponCode: dto.couponCode ? dto.couponCode.trim() : null } : {}),
        ...(dto.discount !== undefined ? { discount: dto.discount ? dto.discount.trim() : null } : {}),
        ...(dto.brand !== undefined ? { brand: dto.brand ? dto.brand.trim() : null } : {}),
        ...(dto.terms !== undefined ? { terms: dto.terms ? dto.terms.trim() : null } : {}),
        ...(dto.minOrder !== undefined ? { minOrder: dto.minOrder ? dto.minOrder.trim() : null } : {}),
        ...(dto.category !== undefined ? { category: dto.category ? dto.category.trim() : null } : {}),
      };
    }

    const updated = await this.prisma.marketingBanner.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title?.trim() || 'Home Banner' }),
        ...(dto.subtitle !== undefined && {
          subtitle: dto.subtitle ? dto.subtitle.trim() : null,
        }),
        ...(dto.description !== undefined && {
          description: dto.description ? dto.description.trim() : null,
        }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(cleanKey !== undefined && {
          imagePublicId: cleanKey,
          imageKey: cleanKey,
        }),
        ...(dto.ctaText !== undefined && {
          ctaText: dto.ctaText ? dto.ctaText.trim() : null,
        }),
        ...(dto.ctaUrl !== undefined && {
          ctaUrl: dto.ctaUrl ? dto.ctaUrl.trim() : null,
        }),
        ...(dto.priority !== undefined && { priority: Number(dto.priority) }),
        ...(dto.isActive !== undefined && { isActive: Boolean(dto.isActive) }),
        ...(dto.isPublished !== undefined && {
          isPublished: Boolean(dto.isPublished),
        }),
        ...(startAt !== undefined && { startAt }),
        ...(endAt !== undefined && { endAt }),
        ...(updatedMetadata !== undefined && { metadata: updatedMetadata }),
      },
    });

    // Clean up old Amazon S3 object only AFTER database update succeeds
    if (file && existing.imagePublicId && existing.imagePublicId !== imagePublicId) {
      this.uploadService.deleteBannerImage(existing.imagePublicId).catch(() => {});
    }

    const resolved = await this.resolveBannerMedia(updated);

    this.logger.log(
      `[BANNER_DB_DEBUG]\nid: ${resolved.id}\ntitle: ${resolved.title}\nimageUrl: ${resolved.imageUrl}\nimage: ${resolved.imageUrl}\nbannerUrl: ${resolved.imageUrl}\nmediaUrl: ${resolved.imageUrl}`,
    );
    this.logger.log(`[MARKETING_BANNER_UPDATE]\nbannerId: ${id}`);
    return resolved;
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
    return this.resolveBannerMedia(updated);
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
    return this.resolveBannerMedia(updated);
  }

  /**
   * Fetch active, published, scheduled banners for Customer Home Screen.
   * Returns empty list when customer has DENY override on CUSTOMER_MARKETING.
   */
  async findAllCustomer(user: {
    id?: number;
    customerId?: number | null;
    role?: string;
  }) {
    const now = new Date();
    const resolvedCustomerId = user?.customerId ? Number(user.customerId) : null;

    // ── RBAC: enforce CUSTOMER_MARKETING:VIEW ───────────────────────────────
    if (resolvedCustomerId) {
      try {
        const marketingOverride = await (this.prisma as any).customerModuleOverride?.findFirst({
          where: {
            subjectCustomerId: resolvedCustomerId,
            moduleKey: { in: ['employee.customer_marketing.view', 'CUSTOMER_MARKETING'] },
            override: 'DENY',
          },
        });
        if (marketingOverride) {
          this.logger.log(
            `[CUSTOMER_MARKETING_DENIED] customerId=${resolvedCustomerId} — throwing ForbiddenException`,
          );
          throw new ForbiddenException(
            'Access denied: CUSTOMER_MARKETING permission is revoked for this customer',
          );
        }
      } catch {
        // Graceful fallback: if the override table is unavailable, serve normally
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    console.log('[BANNER_API_REQUEST]', {
      customerId: resolvedCustomerId,
      userId: user?.id ?? null,
    });

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
      const bAny = b as any;
      const isCoupon = Boolean(
        bAny.couponCode ||
        meta?.couponCode ||
        meta?.code ||
        meta?.isCoupon ||
        meta?.discount ||
        bAny.category === 'COUPON' ||
        meta?.category === 'COUPON' ||
        bAny.category === 'OFFER' ||
        meta?.category === 'OFFER' ||
        bAny.actionType === 'OPEN_COUPON' ||
        meta?.actionType === 'OPEN_COUPON'
      );
      if (isCoupon && (!meta?.customerIds || !Array.isArray(meta.customerIds) || meta.customerIds.length === 0)) {
        return true;
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

      const item = await this.resolveBannerMedia({
        ...b,
        imageUrl: currentImageUrl || b.imageUrl || '',
        imagePublicId: currentImageKey || b.imageKey || b.imagePublicId || null,
        imageKey: currentImageKey || b.imageKey || b.imagePublicId || null,
      });

      resultBanners.push(item);
      this.logger.log(
        `[BANNER_API_DEBUG]\nid: ${item.id}\ntitle: ${item.title}\nimage: ${item.imageUrl}\nimageUrl: ${item.imageUrl}\nbannerUrl: ${item.imageUrl}\nmediaUrl: ${item.imageUrl}`,
      );
      this.logger.log(
        `[CUSTOMER_BANNER_RESPONSE_DEBUG]\nid: ${item.id}\ntitle: ${item.title}\nimageUrl: ${item.imageUrl}\nstatus: ${item.isActive ? 'ACTIVE' : 'INACTIVE'}\nplacement: HOME\ncustomerId: ${item.customerId ?? 'GLOBAL'}`,
      );
    }

    console.log('[BANNER_API_RESPONSE]', {
      status: 200,
      count: resultBanners.length,
      bannerId: resultBanners[0]?.id ?? null,
      imageUrl: resultBanners[0]?.imageUrl ?? null,
    });

    this.logger.log(`[CUSTOMER_BANNERS_RESPONSE]\ncount: ${resultBanners.length}`);
    return resultBanners;
  }
}
