import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnnouncementBodyDto, AnnouncementQueryDto, ScheduleAnnouncementDto } from './dto/announcement.dto';

const include = { department: { select: { id: true, name: true, code: true } } };

@Injectable()
export class AnnouncementService {
  constructor(private readonly prisma: PrismaService) {}

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
    return { data: rows.map(present), meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async summary(customerId?: number | string, query: AnnouncementQueryDto = {}) {
    const id = await this.customerId(customerId);
    const rows = await this.prisma.announcement.findMany({ where: this.where(id, { ...query, status: undefined }), select: { status: true } });
    const count = (status: string) => rows.filter((row) => row.status === status).length;
    return { total: rows.length, published: count('PUBLISHED'), scheduled: count('SCHEDULED'), drafts: count('DRAFT'), archived: count('ARCHIVED') };
  }

  async findOne(customerId: number | string | undefined, announcementId: number) {
    return present(await this.load(customerId, announcementId));
  }

  async create(user: any, customerId: number | string | undefined, dto: AnnouncementBodyDto) {
    const id = await this.customerId(customerId);
    await this.assertDepartment(id, dto);
    const row = await this.prisma.announcement.create({
      data: { customerId: id, createdById: user?.id ? Number(user.id) : null, status: 'DRAFT', ...this.fields(dto) },
      include,
    });
    return present(row);
  }

  async update(customerId: number | string | undefined, announcementId: number, dto: AnnouncementBodyDto) {
    const current = await this.load(customerId, announcementId);
    await this.assertDepartment(current.customerId, dto, current.departmentId);
    const row = await this.prisma.announcement.update({ where: { id: current.id }, data: this.fields(dto), include });
    return present(row);
  }

  async publish(customerId: number | string | undefined, announcementId: number) {
    const current = await this.load(customerId, announcementId);
    if (current.status === 'ARCHIVED') throw new ConflictException('Archived announcements must be edited back to a draft before publishing.');
    const row = await this.prisma.announcement.update({
      where: { id: current.id },
      data: { status: 'PUBLISHED', publishAt: current.publishAt && current.publishAt <= new Date() ? current.publishAt : new Date() },
      include,
    });
    return present(row);
  }

  async schedule(customerId: number | string | undefined, announcementId: number, dto: ScheduleAnnouncementDto) {
    const current = await this.load(customerId, announcementId);
    const publishAt = new Date(dto.publishAt);
    if (Number.isNaN(publishAt.getTime()) || publishAt <= new Date()) throw new BadRequestException('Schedule time must be a future date.');
    const row = await this.prisma.announcement.update({ where: { id: current.id }, data: { status: 'SCHEDULED', publishAt }, include });
    return present(row);
  }

  async archive(customerId: number | string | undefined, announcementId: number) {
    const current = await this.load(customerId, announcementId);
    const row = await this.prisma.announcement.update({ where: { id: current.id }, data: { status: 'ARCHIVED' }, include });
    return present(row);
  }

  async remove(customerId: number | string | undefined, announcementId: number) {
    const current = await this.load(customerId, announcementId);
    if (current.status === 'PUBLISHED') throw new ConflictException('Archive a published announcement before deleting it.');
    await this.prisma.announcement.delete({ where: { id: current.id } });
    return { success: true };
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

function present(row: any) {
  return {
    ...row,
    departmentName: row.department?.name || '',
  };
}
