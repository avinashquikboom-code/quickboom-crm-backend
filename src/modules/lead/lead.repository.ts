import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLeadDto, UpdateLeadDto } from './dto/lead.dto';

@Injectable()
export class LeadRepository {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, createdById: string, dto: CreateLeadDto) {
    return this.prisma.lead.create({
      data: {
        ...dto,
        tenantId,
        createdById,
      },
      include: {
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async findAll(tenantId: string, options: { page?: number; limit?: number; search?: string; status?: string }) {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      deletedAt: null,
    };

    if (options.status) {
      where.status = options.status;
    }

    if (options.search) {
      where.OR = [
        { title: { contains: options.search, mode: 'insensitive' } },
        { firstName: { contains: options.search, mode: 'insensitive' } },
        { lastName: { contains: options.search, mode: 'insensitive' } },
        { email: { contains: options.search, mode: 'insensitive' } },
        { companyName: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.lead.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        notes: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        timeline: { orderBy: { createdAt: 'desc' } },
        reminders: { orderBy: { remindAt: 'asc' } },
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateLeadDto) {
    return this.prisma.lead.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: dto,
    });
  }

  async softDelete(tenantId: string, id: string) {
    return this.prisma.lead.updateMany({
      where: { id, tenantId },
      data: { deletedAt: new Date() },
    });
  }

  async addNote(leadId: string, userId: string, content: string) {
    return this.prisma.leadNote.create({
      data: { leadId, userId, content },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async logTimeline(leadId: string, action: string, description: string, metadata?: any) {
    return this.prisma.leadActivityTimeline.create({
      data: { leadId, action, description, metadata },
    });
  }
}
