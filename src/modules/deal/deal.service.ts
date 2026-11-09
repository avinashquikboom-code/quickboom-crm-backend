const DEAL_STAGE_SPECS = [
  { name: 'New', order: 1, probability: 10 },
  { name: 'Contacted', order: 2, probability: 20 },
  { name: 'Qualified', order: 3, probability: 30 },
  { name: 'Proposal', order: 4, probability: 50 },
  { name: 'Negotiation', order: 5, probability: 70 },
  { name: 'Final Call', order: 6, probability: 85 },
  { name: 'Won', order: 7, probability: 100 },
  { name: 'Lost', order: 8, probability: 0 },
];

function stageMatches(existingName: string, canonical: string) {
  const name = String(existingName || '').trim().toLowerCase();
  const target = canonical.toLowerCase();
  if (name === target) return true;
  if (target === 'qualified' && name.includes('qualified')) return true;
  if (target === 'proposal' && name.includes('proposal')) return true;
  if (target === 'negotiation' && name.includes('negotiation')) return true;
  if (target === 'final call' && (name === 'final call' || name === 'final')) return true;
  if (target === 'won' && (name === 'won' || name === 'closed won')) return true;
  if (target === 'lost' && (name === 'lost' || name === 'closed lost')) return true;
  if (target === 'new' && (name === 'new' || name === 'new deal')) return true;
  if (target === 'contacted' && name === 'contacted') return true;
  return false;
}
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDealDto, UpdateDealDto, UpdateDealStageDto } from './dto/deal.dto';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@Injectable()
export class DealService {
  private readonly ensuredCustomers = new Set<string>();

  constructor(private prisma: PrismaService) {}

  private async ensureDealStages(customerId?: number) {
    const key = customerId ? String(customerId) : 'all';
    if (this.ensuredCustomers.has(key)) return;
    const where: any = { deletedAt: null };
    if (customerId) where.customerId = customerId;
    let pipelines = await this.prisma.pipeline.findMany({ where, include: { stages: true } });
    if (!pipelines.length && customerId) {
      const created = await this.prisma.pipeline.create({
        data: {
          customerId,
          name: 'Sales Pipeline',
          isDefault: true,
          stages: { create: DEAL_STAGE_SPECS },
        },
        include: { stages: true },
      });
      pipelines = [created];
    }
    for (const pipeline of pipelines) {
      const used = new Set<number>();
      for (const spec of DEAL_STAGE_SPECS) {
        const match = pipeline.stages.find((stage) => !used.has(stage.id) && stageMatches(stage.name, spec.name));
        if (match) {
          used.add(match.id);
          if (match.order !== spec.order || match.name !== spec.name || match.probability !== spec.probability) {
            await this.prisma.pipelineStage.update({
              where: { id: match.id },
              data: { order: spec.order, name: spec.name, probability: spec.probability },
            });
          }
        } else {
          await this.prisma.pipelineStage.create({
            data: { pipelineId: pipeline.id, name: spec.name, order: spec.order, probability: spec.probability },
          });
        }
      }
    }
    this.ensuredCustomers.add(key);
  }

  private async attachLeadContext(deals: any[]) {
    const leadIds = [...new Set(deals.map((deal) => deal.leadId).filter((id) => Number(id) > 0))];
    const dealIds = deals.map((deal) => deal.id);
    const leadsById = await this.prisma.lead.findMany({
      where: { id: { in: leadIds.length ? leadIds : [-1] }, deletedAt: null },
      select: { id: true, title: true, firstName: true, lastName: true, phone: true, email: true, companyName: true, source: true, status: true, nextFollowUpDate: true, nextFollowUpTime: true, stage: { select: { id: true, name: true, key: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    });
    const leadsByDeal = await this.prisma.lead.findMany({
      where: { convertedToDealId: { in: dealIds.length ? dealIds : [-1] }, deletedAt: null },
      select: { id: true, title: true, firstName: true, lastName: true, phone: true, email: true, companyName: true, source: true, status: true, nextFollowUpDate: true, nextFollowUpTime: true, convertedToDealId: true, stage: { select: { id: true, name: true, key: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    });
    const followUps = await this.prisma.leadActivityTimeline.findMany({
      where: { leadId: { in: leadIds.length ? leadIds : [-1] }, action: 'FOLLOW_UP_CALL' },
      orderBy: { createdAt: 'desc' },
    });
    const leadMap = new Map(leadsById.map((lead) => [lead.id, lead]));
    const convertedMap = new Map(leadsByDeal.map((lead) => [lead.convertedToDealId, lead]));
    const followUpMap = new Map<number, any>();
    for (const event of followUps) if (!followUpMap.has(event.leadId)) followUpMap.set(event.leadId, event);
    return deals.map((deal) => {
      const lead = leadMap.get(deal.leadId) || convertedMap.get(deal.id) || null;
      const latest = lead ? followUpMap.get(lead.id) : null;
      const metadata = latest?.metadata && typeof latest.metadata === 'object' && !Array.isArray(latest.metadata) ? latest.metadata as { outcome?: string; notes?: string } : {};
      return {
        ...deal,
        lead,
        nextFollowUpDate: lead?.nextFollowUpDate || null,
        nextFollowUpTime: lead?.nextFollowUpTime || null,
        latestFollowUp: latest ? { outcome: metadata.outcome || null, notes: metadata.notes || latest.description, createdAt: latest.createdAt } : null,
      };
    });
  }

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
            isDefault: true,
            stages: { create: DEAL_STAGE_SPECS },
          },
          include: { stages: { orderBy: { order: 'asc' } } },
        });
      } else {
        await this.ensureDealStages(numCustomerId);
        pipeline = await this.prisma.pipeline.findFirst({
          where: { id: pipeline.id },
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
    const isSuperAdmin = isUserSuperAdmin(user);
    const numCustomerId = Number(customerId);
    const hasExplicitCustomer = !isNaN(numCustomerId) && numCustomerId > 0;

    const baseWhere: any = { deletedAt: null };
    if (isSuperAdmin) {
      if (hasExplicitCustomer) {
        baseWhere.customerId = numCustomerId;
      }
      // else: SUPER_ADMIN — no customerId filter, full platform view
    } else {
      const effectiveCustomerId = hasExplicitCustomer ? numCustomerId : Number(user?.customerId);
      if (isNaN(effectiveCustomerId) || effectiveCustomerId <= 0) {
        throw new UnauthorizedException('User is not associated with any customer account');
      }
      baseWhere.customerId = effectiveCustomerId;
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
    query: { pipelineId?: number | string; stageId?: number | string; stage?: string; search?: string; assignedToId?: string; status?: string; closeFrom?: string; closeTo?: string; page?: number; limit?: number },
    user?: any,
  ) {
    const isSuperAdmin = isUserSuperAdmin(user);
    const numCustomerId = Number(customerId);
    const hasExplicitCustomer = !isNaN(numCustomerId) && numCustomerId > 0;

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (isSuperAdmin) {
      if (hasExplicitCustomer) {
        where.customerId = numCustomerId;
      }
      // else: SUPER_ADMIN — no customerId filter, full platform view
    } else {
      const effectiveCustomerId = hasExplicitCustomer ? numCustomerId : Number(user?.customerId);
      if (isNaN(effectiveCustomerId) || effectiveCustomerId <= 0) {
        throw new UnauthorizedException('User is not associated with any customer account');
      }
      where.customerId = effectiveCustomerId;
    }

    const effectiveCustomerId = where.customerId;
    if (effectiveCustomerId) await this.ensureDealStages(Number(effectiveCustomerId));

    if (query.pipelineId && query.pipelineId !== 'ALL') where.pipelineId = Number(query.pipelineId);
    if (query.stageId && query.stageId !== 'ALL') where.stageId = Number(query.stageId);
    if (query.stage && query.stage !== 'ALL') where.stage = { name: { equals: query.stage, mode: 'insensitive' } };
    if (query.assignedToId && query.assignedToId !== 'ALL') where.assignedToId = Number(query.assignedToId);

    if (query.status === 'WON') where.isWon = true;
    else if (query.status === 'LOST') where.isLost = true;
    else if (query.status === 'OPEN') {
      where.isWon = false;
      where.isLost = false;
    } else if (query.status === 'FINAL_CALL') {
      where.stage = { name: { equals: 'Final Call', mode: 'insensitive' } };
      where.isWon = false;
      where.isLost = false;
    }

    if (query.closeFrom || query.closeTo) {
      where.expectedClosing = {};
      if (query.closeFrom) where.expectedClosing.gte = new Date(query.closeFrom);
      if (query.closeTo) {
        const end = new Date(query.closeTo);
        end.setHours(23, 59, 59, 999);
        where.expectedClosing.lte = end;
      }
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      const matchedLeads = await this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          ...(where.customerId ? { customerId: where.customerId } : {}),
          OR: [
            { firstName: { contains: s, mode: 'insensitive' } },
            { lastName: { contains: s, mode: 'insensitive' } },
            { companyName: { contains: s, mode: 'insensitive' } },
            { phone: { contains: s } },
            { title: { contains: s, mode: 'insensitive' } },
          ],
        },
        select: { id: true, convertedToDealId: true },
      });
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { company: { name: { contains: s, mode: 'insensitive' } } },
        { contact: { firstName: { contains: s, mode: 'insensitive' } } },
        { contact: { lastName: { contains: s, mode: 'insensitive' } } },
        { contact: { phone: { contains: s, mode: 'insensitive' } } },
        { leadId: { in: matchedLeads.map((lead) => lead.id).concat([-1]) } },
        { id: { in: matchedLeads.map((lead) => lead.convertedToDealId).filter((id): id is number => Boolean(id)).concat([-1]) } },
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

    const rows = await this.attachLeadContext(data);
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data: rows,
      pagination: { page, pageSize: limit, total, totalPages },
      meta: { total, page, limit, totalPages, stages: DEAL_STAGE_SPECS },
    };
  }

  async findOne(customerId: number | string | undefined, id: number | string) {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    if (isNaN(numId) || numId <= 0) {
      throw new NotFoundException(`Deal record #${id} not found`);
    }

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
    const [enriched] = await this.attachLeadContext([deal]);
    return enriched;
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
