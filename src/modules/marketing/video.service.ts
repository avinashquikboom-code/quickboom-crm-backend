import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import {
  CreateMarketingVideoDto,
  QueryMarketingVideoDto,
  UpdateMarketingVideoDto,
} from './dto/video.dto';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Helper to resolve S3 keys into presigned URLs for secure viewing
   */
  private async resolveVideoMedia(video: any): Promise<any> {
    if (!video) return video;

    const rawVideoKey = video.videoKey || this.s3Service.extractKey(video.videoUrl);
    let resolvedVideoUrl = video.videoUrl;
    if (rawVideoKey && (!video.videoUrl || !video.videoUrl.includes('youtube.com') && !video.videoUrl.includes('youtu.be') && !video.videoUrl.includes('vimeo.com'))) {
      try {
        const presigned = await this.s3Service.getPresignedUrl(video.videoUrl || rawVideoKey);
        if (presigned) resolvedVideoUrl = presigned;
      } catch {
        // fallback to original videoUrl
      }
    }

    const rawThumbKey = video.thumbnailKey || this.s3Service.extractKey(video.thumbnailUrl);
    let resolvedThumbUrl = video.thumbnailUrl;
    if (rawThumbKey && video.thumbnailUrl) {
      try {
        const presigned = await this.s3Service.getPresignedUrl(video.thumbnailUrl || rawThumbKey);
        if (presigned) resolvedThumbUrl = presigned;
      } catch {
        // fallback to original thumbnailUrl
      }
    }

    return {
      ...video,
      videoKey: rawVideoKey,
      videoUrl: resolvedVideoUrl,
      thumbnailKey: rawThumbKey,
      thumbnailUrl: resolvedThumbUrl,
    };
  }

  /**
   * Create a new marketing video
   */
  async create(
    dto: CreateMarketingVideoDto,
    user: { id: number; customerId?: number | null; role?: string },
    files?: {
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    let videoUrl = dto.videoUrl?.trim() || null;
    let videoKey = dto.videoKey?.trim() || null;
    let thumbnailUrl = dto.thumbnailUrl?.trim() || null;
    let thumbnailKey = dto.thumbnailKey?.trim() || null;

    // Handle video upload if provided
    const videoFile = files?.video?.[0];
    if (videoFile) {
      const uploadResult = await this.s3Service.uploadMedia(
        videoFile,
        'marketing/videos',
        'VIDEO',
      );
      videoUrl = uploadResult.imageUrl;
      videoKey = uploadResult.imageKey;
    }

    // Handle thumbnail upload if provided
    const thumbFile = files?.thumbnail?.[0];
    if (thumbFile) {
      const uploadResult = await this.s3Service.uploadMedia(
        thumbFile,
        'marketing/thumbnails',
        'IMAGE',
      );
      thumbnailUrl = uploadResult.imageUrl;
      thumbnailKey = uploadResult.imageKey;
    }

    if (!videoUrl) {
      throw new BadRequestException('Valid video file upload or video URL is required');
    }

    const startAt = dto.startAt ? new Date(dto.startAt) : null;
    const endAt = dto.endAt ? new Date(dto.endAt) : null;

    if (startAt && endAt && endAt < startAt) {
      throw new BadRequestException('endAt cannot be earlier than startAt');
    }

    const customerId = dto.customerId !== undefined ? dto.customerId : (user.customerId ?? null);
    const cleanVideoKey = videoKey || this.s3Service.extractKey(videoUrl);
    const cleanThumbKey = thumbnailKey || (thumbnailUrl ? this.s3Service.extractKey(thumbnailUrl) : null);

    const created = await this.prisma.marketingVideo.create({
      data: {
        title: dto.title?.trim() || 'Marketing Video',
        subtitle: dto.subtitle?.trim() || null,
        description: dto.description?.trim() || null,
        videoUrl,
        videoKey: cleanVideoKey,
        thumbnailUrl,
        thumbnailKey: cleanThumbKey,
        ctaText: dto.ctaText?.trim() || null,
        ctaUrl: dto.ctaUrl?.trim() || null,
        status: (dto.status || 'ACTIVE').toUpperCase(),
        priority: dto.priority !== undefined ? Number(dto.priority) : 0,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
        isPublished: dto.isPublished !== undefined ? Boolean(dto.isPublished) : true,
        showOnHome: dto.showOnHome !== undefined ? Boolean(dto.showOnHome) : true,
        showInIntroduction: dto.showInIntroduction !== undefined ? Boolean(dto.showInIntroduction) : false,
        startAt,
        endAt,
        customerId,
        createdBy: user.id || null,
        metadata: dto.metadata || null,
      },
    });

    this.logger.log(`[MARKETING_VIDEO_CREATED] id: ${created.id} title: "${created.title}"`);
    return this.resolveVideoMedia(created);
  }

  /**
   * List videos for Company Admin / Super Admin
   */
  async findAllAdmin(
    query: QueryMarketingVideoDto,
    user: { id: number; customerId?: number | null; isSuperAdmin?: boolean },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (!user.isSuperAdmin && user.customerId) {
      where.OR = [{ customerId: user.customerId }, { customerId: null }];
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { subtitle: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { ctaText: { contains: term, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (query.status && query.status !== 'ALL') {
      where.status = query.status.toUpperCase();
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.isPublished !== undefined) {
      where.isPublished = query.isPublished;
    }

    const [total, records] = await Promise.all([
      this.prisma.marketingVideo.count({ where }),
      this.prisma.marketingVideo.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    const resolved = await Promise.all(records.map((v) => this.resolveVideoMedia(v)));

    return {
      data: resolved,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Find single video by ID
   */
  async findOne(
    id: number,
    user: { id: number; customerId?: number | null; isSuperAdmin?: boolean },
  ) {
    const video = await this.prisma.marketingVideo.findFirst({
      where: { id, deletedAt: null },
    });

    if (!video) {
      throw new NotFoundException(`Marketing video with ID ${id} not found`);
    }

    if (!user.isSuperAdmin && user.customerId && video.customerId && video.customerId !== user.customerId) {
      throw new NotFoundException(`Marketing video with ID ${id} not found`);
    }

    return this.resolveVideoMedia(video);
  }

  /**
   * Update video
   */
  async update(
    id: number,
    dto: UpdateMarketingVideoDto,
    user: { id: number; customerId?: number | null; isSuperAdmin?: boolean },
    files?: {
      video?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    const existing = await this.findOne(id, user);

    let videoUrl = dto.videoUrl !== undefined ? dto.videoUrl.trim() : undefined;
    let videoKey = dto.videoKey !== undefined ? dto.videoKey.trim() : undefined;
    let thumbnailUrl = dto.thumbnailUrl !== undefined ? dto.thumbnailUrl.trim() : undefined;
    let thumbnailKey = dto.thumbnailKey !== undefined ? dto.thumbnailKey.trim() : undefined;

    const videoFile = files?.video?.[0];
    if (videoFile) {
      const uploadResult = await this.s3Service.uploadMedia(
        videoFile,
        'marketing/videos',
        'VIDEO',
      );
      videoUrl = uploadResult.imageUrl;
      videoKey = uploadResult.imageKey;
    }

    const thumbFile = files?.thumbnail?.[0];
    if (thumbFile) {
      const uploadResult = await this.s3Service.uploadMedia(
        thumbFile,
        'marketing/thumbnails',
        'IMAGE',
      );
      thumbnailUrl = uploadResult.imageUrl;
      thumbnailKey = uploadResult.imageKey;
    }

    const startAt = dto.startAt !== undefined ? (dto.startAt ? new Date(dto.startAt) : null) : existing.startAt;
    const endAt = dto.endAt !== undefined ? (dto.endAt ? new Date(dto.endAt) : null) : existing.endAt;

    if (startAt && endAt && endAt < startAt) {
      throw new BadRequestException('endAt cannot be earlier than startAt');
    }

    const cleanVideoKey = videoKey !== undefined ? videoKey : (videoUrl ? this.s3Service.extractKey(videoUrl) : undefined);
    const cleanThumbKey = thumbnailKey !== undefined ? thumbnailKey : (thumbnailUrl ? this.s3Service.extractKey(thumbnailUrl) : undefined);

    const updated = await this.prisma.marketingVideo.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.subtitle !== undefined && { subtitle: dto.subtitle ? dto.subtitle.trim() : null }),
        ...(dto.description !== undefined && { description: dto.description ? dto.description.trim() : null }),
        ...(videoUrl !== undefined && { videoUrl }),
        ...(cleanVideoKey !== undefined && { videoKey: cleanVideoKey }),
        ...(thumbnailUrl !== undefined && { thumbnailUrl }),
        ...(cleanThumbKey !== undefined && { thumbnailKey: cleanThumbKey }),
        ...(dto.ctaText !== undefined && { ctaText: dto.ctaText ? dto.ctaText.trim() : null }),
        ...(dto.ctaUrl !== undefined && { ctaUrl: dto.ctaUrl ? dto.ctaUrl.trim() : null }),
        ...(dto.status !== undefined && { status: dto.status.toUpperCase() }),
        ...(dto.priority !== undefined && { priority: Number(dto.priority) }),
        ...(dto.isActive !== undefined && { isActive: Boolean(dto.isActive) }),
        ...(dto.isPublished !== undefined && { isPublished: Boolean(dto.isPublished) }),
        ...(dto.showOnHome !== undefined && { showOnHome: Boolean(dto.showOnHome) }),
        ...(dto.showInIntroduction !== undefined && { showInIntroduction: Boolean(dto.showInIntroduction) }),
        ...(dto.startAt !== undefined && { startAt }),
        ...(dto.endAt !== undefined && { endAt }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata }),
      },
    });

    this.logger.log(`[MARKETING_VIDEO_UPDATED] id: ${id}`);
    return this.resolveVideoMedia(updated);
  }

  /**
   * Soft delete video
   */
  async remove(
    id: number,
    user: { id: number; customerId?: number | null; isSuperAdmin?: boolean },
  ) {
    await this.findOne(id, user);

    await this.prisma.marketingVideo.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`[MARKETING_VIDEO_DELETED] id: ${id}`);
    return { success: true, message: `Marketing video ${id} deleted successfully` };
  }

  /**
   * Set status & active state
   */
  async setStatus(
    id: number,
    isActive?: boolean,
    status?: string,
    user?: { id: number; customerId?: number | null; isSuperAdmin?: boolean },
  ) {
    if (user) await this.findOne(id, user);

    const updateData: any = {};
    if (isActive !== undefined) {
      updateData.isActive = isActive;
      if (!isActive && !status) {
        updateData.status = 'INACTIVE';
      } else if (isActive && !status) {
        updateData.status = 'ACTIVE';
      }
    }
    if (status) {
      updateData.status = status.toUpperCase();
      if (updateData.status === 'ACTIVE') {
        updateData.isActive = true;
      } else if (updateData.status === 'INACTIVE') {
        updateData.isActive = false;
      }
    }

    const updated = await this.prisma.marketingVideo.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(`[MARKETING_VIDEO_STATUS_TOGGLE] id: ${id} status: ${updated.status} active: ${updated.isActive}`);
    return this.resolveVideoMedia(updated);
  }

  /**
   * Set published state
   */
  async setPublished(
    id: number,
    isPublished: boolean,
    user?: { id: number; customerId?: number | null; isSuperAdmin?: boolean },
  ) {
    if (user) await this.findOne(id, user);

    const updated = await this.prisma.marketingVideo.update({
      where: { id },
      data: { isPublished },
    });

    return this.resolveVideoMedia(updated);
  }

  /**
   * Fetch active, customer-visible marketing videos for Customer Home Screen
   */
  async findAllCustomer(user: {
    id?: number;
    customerId?: number | null;
    role?: string;
  }) {
    const now = new Date();
    const resolvedCustomerId = user?.customerId ? Number(user.customerId) : null;

    const allVideos = await this.prisma.marketingVideo.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        isPublished: true,
        status: 'ACTIVE',
        showOnHome: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    // Filter by customer isolation (global null or matching current customer)
    const customerFiltered = allVideos.filter((v) => {
      if (v.customerId === null) return true;
      if (resolvedCustomerId && v.customerId === resolvedCustomerId) return true;
      return false;
    });

    // Filter by startAt and endAt schedule window
    const dateFiltered = customerFiltered.filter((v) => {
      if (v.startAt) {
        const start = new Date(v.startAt);
        if (start > now) return false;
      }
      if (v.endAt) {
        const end = new Date(v.endAt);
        // If time is 00:00:00, extend through end of day
        if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
          end.setHours(23, 59, 59, 999);
        }
        if (end < now) return false;
      }
      return true;
    });

    this.logger.log(
      `[CUSTOMER_MARKETING_VIDEOS] found: ${allVideos.length} filtered: ${dateFiltered.length} for customer: ${resolvedCustomerId ?? 'GLOBAL'}`,
    );

    const result: any[] = [];
    for (const v of dateFiltered) {
      const resolved = await this.resolveVideoMedia(v);
      result.push(resolved);
    }

    return result;
  }

  /**
   * Fetch single next eligible unseen marketing video for Customer Introduction / Onboarding
   */
  async findIntroductionVideoCustomer(user: {
    id?: number;
    customerId?: number | null;
    role?: string;
  }) {
    const now = new Date();
    const resolvedCustomerId = user?.customerId ? Number(user.customerId) : null;
    if (!resolvedCustomerId) {
      return null;
    }

    // 1. Fetch IDs of videos already seen by this customer
    const seenViews = await this.prisma.customerMarketingVideoView.findMany({
      where: { customerId: resolvedCustomerId },
      select: { marketingVideoId: true },
    });
    const seenVideoIds = new Set(seenViews.map((v) => v.marketingVideoId));

    // 2. Fetch all eligible active published videos with showInIntroduction = true
    const allVideos = await this.prisma.marketingVideo.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        isPublished: true,
        status: 'ACTIVE',
        showInIntroduction: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    // 3. Filter by customer isolation (global or matching customer)
    const customerFiltered = allVideos.filter((v) => {
      if (v.customerId === null) return true;
      if (v.customerId === resolvedCustomerId) return true;
      return false;
    });

    // 4. Exclude already seen videos for this customer
    const unseenFiltered = customerFiltered.filter((v) => !seenVideoIds.has(v.id));

    // 5. Filter by schedule window
    const dateFiltered = unseenFiltered.filter((v) => {
      if (v.startAt) {
        const start = new Date(v.startAt);
        if (start > now) return false;
      }
      if (v.endAt) {
        const end = new Date(v.endAt);
        if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
          end.setHours(23, 59, 59, 999);
        }
        if (end < now) return false;
      }
      return true;
    });

    if (dateFiltered.length === 0) {
      return null;
    }

    // Return the highest priority unseen video
    const nextVideo = dateFiltered[0];
    return this.resolveVideoMedia(nextVideo);
  }

  /**
   * Mark introduction marketing video as seen for authenticated customer
   */
  async markIntroductionVideoSeen(
    videoId: number,
    user: { id?: number; customerId?: number | null },
  ) {
    const resolvedCustomerId = user?.customerId ? Number(user.customerId) : null;
    if (!resolvedCustomerId) {
      throw new BadRequestException('Authenticated customer required to mark video as seen');
    }

    const video = await this.prisma.marketingVideo.findFirst({
      where: { id: videoId, deletedAt: null },
    });
    if (!video) {
      throw new NotFoundException(`Marketing video ${videoId} not found`);
    }

    const view = await this.prisma.customerMarketingVideoView.upsert({
      where: {
        customerId_marketingVideoId: {
          customerId: resolvedCustomerId,
          marketingVideoId: videoId,
        },
      },
      create: {
        customerId: resolvedCustomerId,
        marketingVideoId: videoId,
        seenAt: new Date(),
      },
      update: {
        seenAt: new Date(),
      },
    });

    this.logger.log(`[INTRODUCTION_VIDEO_SEEN] customer: ${resolvedCustomerId} video: ${videoId}`);
    return { success: true, message: 'Introduction video marked as seen', view };
  }

  /**
   * Admin reset views for a specific marketing video so eligible customers can see it again
   */
  async resetIntroductionViews(
    videoId: number,
    user: { id: number; customerId?: number | null; isSuperAdmin?: boolean },
  ) {
    await this.findOne(videoId, user);

    const result = await this.prisma.customerMarketingVideoView.deleteMany({
      where: { marketingVideoId: videoId },
    });

    this.logger.log(`[INTRODUCTION_VIEWS_RESET] videoId: ${videoId} deletedRecords: ${result.count}`);
    return { success: true, message: `Reset ${result.count} views for marketing video ${videoId}` };
  }
}
