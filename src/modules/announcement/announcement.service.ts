import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { NotificationService } from '../notification/notification.service';
import { AnnouncementBodyDto, AnnouncementQueryDto, ScheduleAnnouncementDto } from './dto/announcement.dto';

const include = { department: { select: { id: true, name: true, code: true } } };

@Injectable()
export class AnnouncementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnnouncementService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly s3Service: S3Service, private readonly notifications: NotificationService) {}

  onModuleInit() {
    this.processScheduled().catch((err) => this.logger.error('Scheduled announcements failed', err));
    this.timer = setInterval(() => this.processScheduled().catch((err) => this.logger.error('Scheduled announcements failed', err)), 60000);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async notifyEmployees(row: any) {
    const employees = await this.prisma.employee.findMany({
      where: { customerId: row.customerId, status: 'ACTIVE', userId: { not: null }, ...(row.audience === 'DEPARTMENT' ? { departmentId: row.departmentId } : {}), user: { isActive: true, deletedAt: null } },
      select: { userId: true },
    });
    for (const employee of employees) {
      try {
        await this.notifications.sendPushNotification({ userId: employee.userId!, customerId: row.customerId, title: row.title, body: row.description, type: 'ANNOUNCEMENT', data: { announcementId: String(row.id), ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}) } });
      } catch (err) {
        this.logger.error(`Announcement ${row.id} delivery failed for user ${employee.userId}`, err);
      }
    }
  }

  async processScheduled() {
    const due = await this.prisma.announcement.findMany({ where: { status: 'SCHEDULED', publishAt: { lte: new Date() } } });
    for (const row of due) {
      const claimed = await this.prisma.announcement.updateMany({ where: { id: row.id, status: 'SCHEDULED', publishAt: { lte: new Date() } }, data: { status: 'PUBLISHED' } });
      if (claimed.count && (!row.expiresAt || row.expiresAt > new Date())) await this.notifyEmployees(row);
    }
  }

  private async customerId(value?: number | string) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    const customer = await this.prisma.customer.findFirst({ select: { id: true }, orderBy: { id: 'asc' } });
    if (!customer) throw new NotFoundException('No company is available for announcements.');
    return customer.id;
  }

  async findAll(customerId: number | string | undefined, query: AnnouncementQueryDto = {}) {
    const id = await this.customerId(customerId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = this.where(id, query);
    const [total, rows] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({ where, include, orderBy: [{ publishAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    ]);
    return { data: await Promise.all(rows.map((row) => this.present(row))), meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async summary(customerId?: number | string, query: AnnouncementQueryDto = {}) {
    const id = await this.customerId(customerId);
    const rows = await this.prisma.announcement.findMany({ where: this.where(id, { ...query, status: undefined }), select: { status: true } });
    const count = (status: string) => rows.filter((row) => row.status === status).length;
    return { total: rows.length, published: count('PUBLISHED'), scheduled: count('SCHEDULED'), drafts: count('DRAFT'), archived: count('ARCHIVED') };
  }

  async findOne(customerId: number | string | undefined, announcementId: number) {
    return this.present(await this.load(customerId, announcementId));
  }

  async create(user: any, customerId: number | string | undefined, dto: AnnouncementBodyDto) {
    const id = await this.customerId(customerId);
    await this.assertDepartment(id, dto);
    const row = await this.prisma.announcement.create({
      data: { customerId: id, createdById: user?.id ? Number(user.id) : null, status: 'DRAFT', ...this.fields(dto) },
      include,
    });
    return this.present(row);
  }

  async update(customerId: number | string | undefined, announcementId: number, dto: AnnouncementBodyDto) {
    const current = await this.load(customerId, announcementId);
    await this.assertDepartment(current.customerId, dto, current.departmentId);
    const row = await this.prisma.announcement.update({ where: { id: current.id }, data: this.fields(dto), include });
    return this.present(row);
  }

  async publish(customerId: number | string | undefined, announcementId: number) {
    const current = await this.load(customerId, announcementId);
    if (current.status === 'ARCHIVED') throw new ConflictException('Archived announcements must be edited back to a draft before publishing.');
    const claimed = await this.prisma.announcement.updateMany({
      where: { id: current.id, status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: { status: 'PUBLISHED', publishAt: current.publishAt && current.publishAt <= new Date() ? current.publishAt : new Date() },
    });
    const row = await this.prisma.announcement.findUniqueOrThrow({
      where: { id: current.id },
      include,
    });
    if (claimed.count && (!row.expiresAt || row.expiresAt > new Date())) await this.notifyEmployees(row);
    return this.present(row);
  }

  async schedule(customerId: number | string | undefined, announcementId: number, dto: ScheduleAnnouncementDto) {
    const current = await this.load(customerId, announcementId);
    const publishAt = new Date(dto.publishAt);
    if (Number.isNaN(publishAt.getTime()) || publishAt <= new Date()) throw new BadRequestException('Schedule time must be a future date.');
    const row = await this.prisma.announcement.update({ where: { id: current.id }, data: { status: 'SCHEDULED', publishAt }, include });
    return this.present(row);
  }

  async archive(customerId: number | string | undefined, announcementId: number) {
    const current = await this.load(customerId, announcementId);
    const row = await this.prisma.announcement.update({ where: { id: current.id }, data: { status: 'ARCHIVED' }, include });
    return this.present(row);
  }

  async remove(customerId: number | string | undefined, announcementId: number) {
    const current = await this.load(customerId, announcementId);
    if (current.status === 'PUBLISHED') throw new ConflictException('Archive a published announcement before deleting it.');
    await this.prisma.announcement.delete({ where: { id: current.id } });
    return { success: true };
  }

  private async present(row: any) {
    const previewUrl = row.imageUrl
      ? await this.s3Service.getPresignedUrl(row.imageUrl, 3600).catch(() => null)
      : null;
    return { ...row, departmentName: row.department?.name || '', previewUrl: previewUrl || row.imageUrl || null };
  }

  private where(customerId: number, query: AnnouncementQueryDto): Prisma.AnnouncementWhereInput {
    const where: Prisma.AnnouncementWhereInput = { customerId };
    if (query.status) where.status = query.status as any;
    if (query.audience) where.audience = query.audience as any;
    if (query.departmentId) where.departmentId = Number(query.departmentId);
    if (query.dateFrom || query.dateTo) {
      where.publishAt = {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(`${query.dateTo}T23:59:59.999Z`) : undefined,
      };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private fields(dto: AnnouncementBodyDto) {
    const publishAt = dto.publishAt ? new Date(dto.publishAt) : null;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (publishAt && Number.isNaN(publishAt.getTime())) throw new BadRequestException('Publish date is invalid.');
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new BadRequestException('Expiry date is invalid.');
    if (publishAt && expiresAt && expiresAt <= publishAt) throw new BadRequestException('Expiry must be after the publish date.');
    return {
      title: dto.title.trim(),
      description: dto.description.trim(),
      imageUrl: dto.imageUrl?.trim() || null,
      category: dto.category?.trim() || 'GENERAL',
      audience: (dto.audience || 'ALL') as any,
      departmentId: dto.audience === 'DEPARTMENT' ? Number(dto.departmentId) : dto.departmentId ? Number(dto.departmentId) : null,
      publishAt,
      expiresAt,
    };
  }

  private async assertDepartment(customerId: number, dto: AnnouncementBodyDto, currentDepartmentId?: number | null) {
    const departmentId = dto.departmentId ?? (dto.audience === 'DEPARTMENT' ? currentDepartmentId : null);
    if (dto.audience === 'DEPARTMENT' && !departmentId) throw new BadRequestException('Choose a department for a department announcement.');
    if (!departmentId) return;
    const department = await this.prisma.department.findFirst({ where: { id: Number(departmentId), customerId } });
    if (!department) throw new BadRequestException('Department does not belong to this company.');
  }

  private async load(customerId: number | string | undefined, announcementId: number) {
    const id = await this.customerId(customerId);
    const row = await this.prisma.announcement.findFirst({ where: { id: Number(announcementId), customerId: id }, include });
    if (!row) throw new NotFoundException('Announcement was not found.');
    return row;
  }
}

