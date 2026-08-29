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
        notes: dto.notes?.trim() || null,
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
      data: handler,
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

    const where: any = {
      deletedAt: null,
    };

    if (!isAdmin) {
      // Regular customer user: Strictly locked to their own authenticated customer ID
      if (!context.customerId || Number(context.customerId) <= 0) {
        throw new ForbiddenException('User does not belong to any customer organization');
      }
      where.customerId = Number(context.customerId);
    } else if (query.customerId) {
      // Admin filtered by explicit customerId
      const parsedCustId = Number(String(query.customerId).replace(/[^0-9]/g, ''));
      if (parsedCustId && !isNaN(parsedCustId)) {
        where.customerId = parsedCustId;
      }
    } else if (context.customerId && !isSuperAdmin) {
      // Company admin locked to their company's customer ID if specified
      where.customerId = Number(context.customerId);
    }

    if (query.platform && query.platform !== 'ALL') {
      where.platform = { equals: query.platform.trim().toUpperCase(), mode: 'insensitive' };
    }

    if (query.status && query.status !== 'ALL') {
      where.status = { equals: query.status.trim().toUpperCase(), mode: 'insensitive' };
    }

    if (query.search && query.search.trim()) {
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

    this.logger.log(
      `[SOCIAL_MEDIA_HANDLER_QUERY]\ncustomerId: ${where.customerId ?? 'ALL'}\nwhere: ${JSON.stringify(where)}`,
    );

    const [items, total] = await Promise.all([
      this.prisma.socialMediaHandler.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }],
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
      data: items,
      items,
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
      data: handler,
    };
  }

  /**
   * Update Social Media Handler with customer ownership validation
   */
  async update(id: number, dto: UpdateSocialMediaHandlerDto, context: UserContext) {
    await this.findOne(id, context);

    const data: any = {};
    if (dto.platform !== undefined) data.platform = dto.platform.trim().toUpperCase();
    if (dto.accountName !== undefined) data.accountName = dto.accountName.trim();
    if (dto.accountUrl !== undefined) data.accountUrl = dto.accountUrl?.trim() || null;
    if (dto.handlerName !== undefined) data.handlerName = dto.handlerName?.trim() || null;
    if (dto.handlerPhone !== undefined) data.handlerPhone = dto.handlerPhone?.trim() || null;
    if (dto.handlerEmail !== undefined) data.handlerEmail = dto.handlerEmail?.trim() || null;
    if (dto.workType !== undefined) data.workType = dto.workType?.trim() || null;
    if (dto.status !== undefined) data.status = dto.status?.toUpperCase() || 'ACTIVE';
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
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

    this.logger.log(`[SOCIAL_MEDIA_HANDLER_UPDATE]\nid: ${id}\nupdated: ${JSON.stringify(data)}`);

    return {
      success: true,
      message: 'Social Media Handler updated successfully',
      data: updated,
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
