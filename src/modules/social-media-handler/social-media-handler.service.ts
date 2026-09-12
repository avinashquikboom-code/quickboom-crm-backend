import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateSocialMediaHandlerDto,
  QuerySocialMediaHandlerDto,
  UpdateSocialMediaHandlerDto,
} from './dto/social-media-handler.dto';

export interface UserContext {
  id: number;
  customerId?: number | null;
  role?: string;
  isSuperAdmin?: boolean;
  isAdminOrStaff?: boolean;
}

@Injectable()
export class SocialMediaHandlerService {
  private readonly logger = new Logger(SocialMediaHandlerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to safely encode metadata (socialMediaId, password) into notes field
   */
  private encodeMetadataIntoNotes(
    userNotes?: string | null,
    socialMediaId?: string | null,
    password?: string | null,
  ): string | null {
    const hasSocialMediaId = socialMediaId !== undefined && socialMediaId !== null && socialMediaId.trim().length > 0;
    const hasPassword = password !== undefined && password !== null && password.trim().length > 0;

    if (!hasSocialMediaId && !hasPassword) {
      return userNotes?.trim() || null;
    }

    const meta: Record<string, string> = {};
    if (hasSocialMediaId) meta.socialMediaId = socialMediaId!.trim();
    if (hasPassword) meta.password = password!.trim();
    if (userNotes && userNotes.trim().length > 0) meta.userNotes = userNotes.trim();

    return `__QB_META__:${JSON.stringify(meta)}`;
  }

  /**
   * Helper to decode metadata from notes field and attach top-level fields
   */
  private formatHandlerRecord(record: any): any {
    if (!record) return record;
    let socialMediaId = record.socialMediaId || record.accountName || '';
    let password = record.password || '';
    let cleanNotes = record.notes || null;

    if (record.notes && typeof record.notes === 'string') {
      if (record.notes.startsWith('__QB_META__:')) {
        try {
          const jsonStr = record.notes.substring('__QB_META__:'.length);
          const meta = JSON.parse(jsonStr);
          if (meta.socialMediaId) socialMediaId = meta.socialMediaId;
          if (meta.password) password = meta.password;
          cleanNotes = meta.userNotes || null;
        } catch (_) {}
      } else if (record.notes.startsWith('{') && record.notes.endsWith('}')) {
        try {
          const meta = JSON.parse(record.notes);
          if (meta.socialMediaId || meta.password) {
            if (meta.socialMediaId) socialMediaId = meta.socialMediaId;
            if (meta.password) password = meta.password;
            cleanNotes = meta.userNotes || null;
          }
        } catch (_) {}
      }
    }

    return {
      ...record,
      socialMediaId,
      password,
      notes: cleanNotes,
    };
  }

  /**
   * Resolve target customer ID based on user authorization
   */
  private resolveTargetCustomerId(
    explicitCustomerId: number | string | undefined,
    context: UserContext,
  ): number {
    const isSuperAdmin = context.isSuperAdmin || context.role === 'SUPER_ADMIN' || context.role === 'SUPERADMIN';
    const isAdmin = isSuperAdmin || context.isAdminOrStaff || context.role === 'COMPANY_ADMIN' || context.role === 'ADMIN';

    if (isAdmin && explicitCustomerId) {
      const parsed = Number(String(explicitCustomerId).replace(/[^0-9]/g, ''));
      if (parsed && !isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    if (context.customerId && Number(context.customerId) > 0) {
      return Number(context.customerId);
    }

    if (isAdmin && explicitCustomerId) {
      const parsed = Number(explicitCustomerId);
      if (parsed && !isNaN(parsed)) return parsed;
    }

    throw new ForbiddenException('Valid customer context is required for this operation');
  }

  /**
   * Create a new Social Media Handler record
   */
  async create(dto: CreateSocialMediaHandlerDto, context: UserContext) {
    const targetCustomerId = this.resolveTargetCustomerId(dto.customerId, context);

    const customer = await this.prisma.customer.findFirst({
      where: { id: targetCustomerId, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID #${targetCustomerId} not found`);
    }

    const start = dto.startDate ? new Date(dto.startDate) : new Date();
    const duration = dto.durationDays && dto.durationDays > 0 ? dto.durationDays : 30;
    const end = dto.endDate
      ? new Date(dto.endDate)
      : new Date(start.getTime() + duration * 24 * 60 * 60 * 1000);

    const notesWithMeta = this.encodeMetadataIntoNotes(
      dto.notes,
      dto.socialMediaId,
      dto.password,
    );

    const handler = await this.prisma.socialMediaHandler.create({
      data: {
        customerId: targetCustomerId,
        platform: dto.platform.trim().toUpperCase(),
        accountName: dto.accountName.trim(),
        accountUrl: dto.accountUrl?.trim() || null,
        handlerName: dto.handlerName?.trim() || null,
        handlerPhone: dto.handlerPhone?.trim() || null,
        handlerEmail: dto.handlerEmail?.trim() || null,
        workType: dto.workType?.trim() || 'Content Posting',
        status: dto.status?.toUpperCase() || 'ACTIVE',
        notes: notesWithMeta,
        startDate: start,
        endDate: end,
        durationDays: duration,
      },
      include: {
        customer: {
          select: { id: true, name: true, companyName: true, email: true },
        },
      },
    });

    this.logger.log(
      `[SOCIAL_MEDIA_HANDLER_CREATE]\nid: ${handler.id}\ncustomerId: ${handler.customerId}\nplatform: ${handler.platform}\naccount: ${handler.accountName}`,
    );

    return {
      success: true,
      message: 'Social Media Handler created successfully',
      data: this.formatHandlerRecord(handler),
    };
  }

  /**
   * List Social Media Handlers with filtering, pagination, and customer scoping
   */
  async findAll(query: QuerySocialMediaHandlerDto, context: UserContext) {
    const isSuperAdmin = context.isSuperAdmin || context.role === 'SUPER_ADMIN' || context.role === 'SUPERADMIN';
    const isAdmin = isSuperAdmin || context.isAdminOrStaff || context.role === 'COMPANY_ADMIN' || context.role === 'ADMIN';

    this.logger.log(
      `[SOCIAL_MEDIA_HANDLER_REQUEST]\nuserId: ${context.id}\ncustomerId: ${context.customerId ?? 'NONE'}\nrole: ${context.role ?? 'CUSTOMER'}`,
    );

    const where: any = { deletedAt: null };

    // Scoping
    if (!isAdmin) {
      if (!context.customerId) {
        throw new ForbiddenException('Customer ID context is required');
      }
      where.customerId = Number(context.customerId);
    } else if (query.customerId && query.customerId !== 'ALL') {
      const parsed = Number(String(query.customerId).replace(/[^0-9]/g, ''));
      if (parsed && !isNaN(parsed) && parsed > 0) {
        where.customerId = parsed;
      }
    }

    // Platform filter
    if (query.platform && query.platform !== 'ALL') {
      where.platform = query.platform.toUpperCase();
    }

    // Status filter
    if (query.status && query.status !== 'ALL') {
      where.status = query.status.toUpperCase();
    }

    // Search filter
    if (query.search && query.search.trim().length > 0) {
      const s = query.search.trim();
      where.OR = [
        { accountName: { contains: s, mode: 'insensitive' } },
        { handlerName: { contains: s, mode: 'insensitive' } },
        { platform: { contains: s, mode: 'insensitive' } },
        { workType: { contains: s, mode: 'insensitive' } },
        { customer: { name: { contains: s, mode: 'insensitive' } } },
        { customer: { companyName: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.socialMediaHandler.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: {
          customer: {
            select: { id: true, name: true, companyName: true, email: true, phone: true },
          },
        },
      }),
      this.prisma.socialMediaHandler.count({ where }),
    ]);

    this.logger.log(`[SOCIAL_MEDIA_HANDLER_RESULT]\ncount: ${items.length}\ntotal: ${total}`);

    return {
      success: true,
      data: items.map((i) => this.formatHandlerRecord(i)),
      items: items.map((i) => this.formatHandlerRecord(i)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get single Social Media Handler by ID with customer ownership validation
   */
  async findOne(id: number, context: UserContext) {
    const handler = await this.prisma.socialMediaHandler.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: {
          select: { id: true, name: true, companyName: true, email: true, phone: true },
        },
      },
    });

    if (!handler) {
      throw new NotFoundException(`Social Media Handler #${id} not found`);
    }

    const isSuperAdmin = context.isSuperAdmin || context.role === 'SUPER_ADMIN' || context.role === 'SUPERADMIN';
    const isAdmin = isSuperAdmin || context.isAdminOrStaff || context.role === 'COMPANY_ADMIN' || context.role === 'ADMIN';

    if (!isAdmin && handler.customerId !== Number(context.customerId)) {
      throw new ForbiddenException('You do not have permission to access this handler');
    }

    return {
      success: true,
      data: this.formatHandlerRecord(handler),
    };
  }

  /**
   * Update Social Media Handler with customer ownership validation
   */
  async update(id: number, dto: UpdateSocialMediaHandlerDto, context: UserContext) {
    const existing = await this.findOne(id, context);
    const existingData = existing.data;

    const data: any = {};
    if (dto.platform !== undefined) data.platform = dto.platform.trim().toUpperCase();
    if (dto.accountName !== undefined) data.accountName = dto.accountName.trim();
    if (dto.accountUrl !== undefined) data.accountUrl = dto.accountUrl?.trim() || null;
    if (dto.handlerName !== undefined) data.handlerName = dto.handlerName?.trim() || null;
    if (dto.handlerPhone !== undefined) data.handlerPhone = dto.handlerPhone?.trim() || null;
    if (dto.handlerEmail !== undefined) data.handlerEmail = dto.handlerEmail?.trim() || null;
    if (dto.workType !== undefined) data.workType = dto.workType?.trim() || null;
    if (dto.status !== undefined) data.status = dto.status?.toUpperCase() || 'ACTIVE';

    if (dto.notes !== undefined || dto.socialMediaId !== undefined || dto.password !== undefined) {
      const targetNotes = dto.notes !== undefined ? dto.notes : existingData.notes;
      const targetSocialMediaId = dto.socialMediaId !== undefined ? dto.socialMediaId : existingData.socialMediaId;
      const targetPassword = dto.password !== undefined ? dto.password : existingData.password;
      data.notes = this.encodeMetadataIntoNotes(targetNotes, targetSocialMediaId, targetPassword);
    }

    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.durationDays !== undefined) data.durationDays = Number(dto.durationDays);

    const updated = await this.prisma.socialMediaHandler.update({
      where: { id },
      data,
      include: {
        customer: {
          select: { id: true, name: true, companyName: true, email: true },
        },
      },
    });

    const safeLogData = { ...data };
    if (safeLogData.notes && safeLogData.notes.startsWith('__QB_META__:')) {
      safeLogData.notes = '[METADATA_STORED]';
    }
    this.logger.log(`[SOCIAL_MEDIA_HANDLER_UPDATE]\nid: ${id}\nupdated: ${JSON.stringify(safeLogData)}`);

    return {
      success: true,
      message: 'Social Media Handler updated successfully',
      data: this.formatHandlerRecord(updated),
    };
  }

  /**
   * Soft delete Social Media Handler with customer ownership validation
   */
  async remove(id: number, context: UserContext) {
    await this.findOne(id, context);

    await this.prisma.socialMediaHandler.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`[SOCIAL_MEDIA_HANDLER_DELETE]\nid: ${id}`);

    return {
      success: true,
      message: 'Social Media Handler deleted successfully',
    };
  }
}
