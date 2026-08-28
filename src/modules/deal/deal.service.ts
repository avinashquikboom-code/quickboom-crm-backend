import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDealDto, UpdateDealDto, UpdateDealStageDto } from './dto/deal.dto';

@Injectable()
export class DealService {
  constructor(private prisma: PrismaService) {}

  async create(customerId: number | string, dto: CreateDealDto) {
    const numCustomerId = Number(customerId);

    // Resolve default pipeline and stage if not provided
    let pipelineId = dto.pipelineId ? Number(dto.pipelineId) : undefined;
    let stageId = dto.stageId ? Number(dto.stageId) : undefined;

    if (!pipelineId || !stageId) {
      let pipeline = await this.prisma.pipeline.findFirst({
        where: { customerId: numCustomerId, deletedAt: null },
        include: { stages: { orderBy: { order: 'asc' } } },
      });

      if (!pipeline) {
        pipeline = await this.prisma.pipeline.create({
          data: {
            customerId: numCustomerId,
            name: 'Sales Pipeline',
            stages: {
              create: [
                { name: 'Qualified', order: 1, probability: 25 },
                { name: 'Proposal', order: 2, probability: 50 },
                { name: 'Negotiation', order: 3, probability: 75 },
                { name: 'Won', order: 4, probability: 100 },
              ],
            },
          },
          include: { stages: { orderBy: { order: 'asc' } } },
        });
      }

      pipelineId = pipeline.id;
      stageId = stageId || pipeline.stages[0]?.id;
    }

    return this.prisma.deal.create({
      data: {
        customerId: numCustomerId,
        pipelineId: pipelineId!,
        stageId: stageId!,
        title: dto.title,
        amount: Number(dto.amount),
        expectedClosing: dto.expectedClosing ? new Date(dto.expectedClosing) : null,
        probability: dto.probability !== undefined ? Number(dto.probability) : 50,
        contactId: dto.contactId ? Number(dto.contactId) : undefined,
        companyId: dto.companyId ? Number(dto.companyId) : undefined,
        leadId: dto.leadId ? Number(dto.leadId) : undefined,
        assignedToId: dto.assignedToId ? Number(dto.assignedToId) : undefined,
        source: dto.source || 'CRM',
        currency: dto.currency || 'INR',
        description: dto.description,
        notes: dto.notes,
      },
      include: {
        pipeline: true,
        stage: true,
        contact: true,
        company: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async getMetrics(customerId: number | string | undefined, user?: any) {
    const numCustomerId = Number(customerId || user?.customerId);
    const isSuperAdmin =
      user?.role === 'SUPER_ADMIN' ||
      user?.roleType === 'SUPER_ADMIN' ||
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('Super Administrator') ||
      customerId === undefined;

    const baseWhere: any = { deletedAt: null };
    if (!isSuperAdmin) {
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        baseWhere.customerId = numCustomerId;
      } else {
        baseWhere.customerId = 0;
      }
    } else if (!isNaN(numCustomerId) && numCustomerId > 0) {
      baseWhere.customerId = numCustomerId;
    }

    const [total, open, won, lost, allDeals] = await Promise.all([
      this.prisma.deal.count({ where: { ...baseWhere } }),
      this.prisma.deal.count({ where: { ...baseWhere, isWon: false, isLost: false } }),
      this.prisma.deal.count({ where: { ...baseWhere, isWon: true } }),
      this.prisma.deal.count({ where: { ...baseWhere, isLost: true } }),
      this.prisma.deal.findMany({
        where: { ...baseWhere },
        select: { amount: true, isWon: true, isLost: true },
      }),
    ]);

    const pipelineValue = allDeals
      .filter((d) => !d.isWon && !d.isLost)
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    const wonValue = allDeals
      .filter((d) => d.isWon)
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    return {
      total,
      open,
      won,
      lost,
      pipelineValue,
      wonValue,
    };
  }

  async findAll(
    customerId: number | string | undefined,
    query: { pipelineId?: number | string; stageId?: number | string; search?: string; assignedToId?: string; status?: string; page?: number; limit?: number },
    user?: any,
  ) {
    const numCustomerId = Number(customerId || user?.customerId);
    const isSuperAdmin =
      user?.role === 'SUPER_ADMIN' ||
      user?.roleType === 'SUPER_ADMIN' ||
      user?.roles?.includes('SUPER_ADMIN') ||
      user?.roles?.includes('Super Administrator') ||
      customerId === undefined;

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (!isSuperAdmin) {
      if (!isNaN(numCustomerId) && numCustomerId > 0) {
        where.customerId = numCustomerId;
      } else {
        where.customerId = 0;
      }
    } else if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    if (query.pipelineId && query.pipelineId !== 'ALL') where.pipelineId = Number(query.pipelineId);
    if (query.stageId && query.stageId !== 'ALL') where.stageId = Number(query.stageId);
    if (query.assignedToId && query.assignedToId !== 'ALL') where.assignedToId = Number(query.assignedToId);

    if (query.status === 'WON') where.isWon = true;
    else if (query.status === 'LOST') where.isLost = true;
    else if (query.status === 'OPEN') {
      where.isWon = false;
      where.isLost = false;
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { company: { name: { contains: s, mode: 'insensitive' } } },
        { contact: { firstName: { contains: s, mode: 'insensitive' } } },
        { contact: { lastName: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          pipeline: { include: { stages: { orderBy: { order: 'asc' } } } },
          stage: true,
          contact: true,
          company: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.deal.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages,
      },
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async findOne(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    const where: any = { id: numId, deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const deal = await this.prisma.deal.findFirst({
      where,
      include: {
        pipeline: { include: { stages: { orderBy: { order: 'asc' } } } },
        stage: true,
        contact: true,
        company: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        quotations: true,
        visits: {
          include: { employee: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`);
    }
    return deal;
  }

  async update(customerId: number | string, id: number | string, dto: UpdateDealDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.deal.update({
      where: { id: numId },
      data: {
        title: dto.title,
        amount: dto.amount !== undefined ? Number(dto.amount) : undefined,
        pipelineId: dto.pipelineId ? Number(dto.pipelineId) : undefined,
        stageId: dto.stageId ? Number(dto.stageId) : undefined,
        contactId: dto.contactId ? Number(dto.contactId) : undefined,
        companyId: dto.companyId ? Number(dto.companyId) : undefined,
        leadId: dto.leadId ? Number(dto.leadId) : undefined,
        assignedToId: dto.assignedToId ? Number(dto.assignedToId) : undefined,
        expectedClosing: dto.expectedClosing ? new Date(dto.expectedClosing) : undefined,
        probability: dto.probability !== undefined ? Number(dto.probability) : undefined,
        isWon: dto.isWon,
        isLost: dto.isLost,
        lostReason: dto.lostReason,
        source: dto.source,
        currency: dto.currency,
        description: dto.description,
        notes: dto.notes,
      },
      include: {
        pipeline: true,
        stage: true,
        contact: true,
        company: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async updateStage(customerId: number | string, id: number | string, dto: UpdateDealStageDto) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.deal.update({
      where: { id: numId },
      data: {
        stageId: Number(dto.stageId),
        probability: dto.probability !== undefined ? Number(dto.probability) : undefined,
        isWon: dto.isWon !== undefined ? dto.isWon : undefined,
        isLost: dto.isLost !== undefined ? dto.isLost : undefined,
        notes: dto.notes ? dto.notes : undefined,
      },
      include: {
        stage: true,
        pipeline: true,
      },
    });
  }

  async delete(customerId: number | string, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);
    await this.findOne(numCustomerId, numId);

    return this.prisma.deal.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });
  }
}
