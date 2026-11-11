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

import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDealDto, UpdateDealDto, UpdateDealStageDto } from './dto/deal.dto';
import { isUserSuperAdmin } from '../../common/utils/role.util';

@Injectable()
export class DealService {
  private readonly ensuredCustomers = new Set<string>();

  constructor(private prisma: PrismaService) {}

  private async ensureDealStages(customerId?: number) {
    if (!customerId) return;
    await this.ensureDefaultPipeline(customerId);
  }

  private async ensureDefaultPipeline(customerId: number) {
    const key = String(customerId);
    let pipeline = await this.prisma.pipeline.findFirst({
      where: { customerId, deletedAt: null },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!pipeline) {
      pipeline = await this.prisma.pipeline.create({
        data: {
          customerId,
          name: 'Sales Pipeline',
          isDefault: true,
          stages: { create: DEAL_STAGE_SPECS },
        },
        include: { stages: { orderBy: { order: 'asc' } } },
      });
    }
    this.ensuredCustomers.add(key);
    return pipeline;
  }

  private async attachLeadContext(deals: any[]) {
    const customerIds = [...new Set(deals.map((deal) => deal.customerId).filter((id) => Number(id) > 0))];
    const tenant = customerIds.length ? { customerId: { in: customerIds } } : {};
    const leadIds = [...new Set(deals.map((deal) => deal.leadId).filter((id) => Number(id) > 0))];
    const dealIds = deals.map((deal) => deal.id);
    const contactIds = [...new Set(deals.map((deal) => deal.contactId).filter((id) => Number(id) > 0))];
    const leadSelect = { id: true, title: true, firstName: true, lastName: true, phone: true, email: true, companyName: true, source: true, status: true, nextFollowUpDate: true, nextFollowUpTime: true, convertedToDealId: true, convertedToContactId: true, stage: { select: { id: true, name: true, key: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true } } };
    const [leadsById, leadsByDeal, leadsByContact] = await Promise.all([
      this.prisma.lead.findMany({ where: { ...tenant, id: { in: leadIds.length ? leadIds : [-1] }, deletedAt: null }, select: leadSelect }),
      this.prisma.lead.findMany({ where: { ...tenant, convertedToDealId: { in: dealIds.length ? dealIds : [-1] }, deletedAt: null }, select: leadSelect }),
      this.prisma.lead.findMany({ where: { ...tenant, convertedToContactId: { in: contactIds.length ? contactIds : [-1] }, deletedAt: null }, select: leadSelect }),
    ]);
    const leadMap = new Map(leadsById.map((lead) => [lead.id, lead]));
    const convertedMap = new Map(leadsByDeal.map((lead) => [lead.convertedToDealId, lead]));
    const contactGroups = new Map<number, any[]>();
    for (const lead of leadsByContact) {
      const group = contactGroups.get(lead.convertedToContactId) || [];
      group.push(lead);
      contactGroups.set(lead.convertedToContactId, group);
    }
    const resolved = deals.map((deal) => {
      const byContact = contactGroups.get(deal.contactId) || [];
      const lead = leadMap.get(deal.leadId) || convertedMap.get(deal.id) || (byContact.length === 1 ? byContact[0] : null) || null;
      return { deal, lead };
    });
    const resolvedLeadIds = [...new Set(resolved.map((item) => item.lead?.id).filter((id) => Number(id) > 0))];
    const followUps = await this.prisma.leadActivityTimeline.findMany({
      where: { leadId: { in: resolvedLeadIds.length ? resolvedLeadIds : [-1] }, action: 'FOLLOW_UP_CALL' },
      orderBy: { createdAt: 'desc' },
    });
    const followUpMap = new Map<number, any>();
    for (const event of followUps) if (!followUpMap.has(event.leadId)) followUpMap.set(event.leadId, event);
    return resolved.map(({ deal, lead }) => {
      const latest = lead ? followUpMap.get(lead.id) : null;
      const metadata = latest?.metadata && typeof latest.metadata === 'object' && !Array.isArray(latest.metadata) ? latest.metadata as { outcome?: string; notes?: string } : {};
      const person = `${lead?.firstName || ''} ${lead?.lastName || ''}`.trim();
      return {
        ...deal,
        lead: lead ? {
          id: lead.id,
          name: person || lead.title || lead.companyName || `Lead #${lead.id}`,
          firstName: lead.firstName,
          lastName: lead.lastName,
          title: lead.title,
          mobileNumber: lead.phone || null,
          phone: lead.phone || null,
          email: lead.email || null,
          companyName: lead.companyName || null,
          source: lead.source,
          status: lead.stage?.name || lead.status,
          stage: lead.stage,
          assignedTo: lead.assignedTo,
          nextFollowUpDate: lead.nextFollowUpDate,
        } : null,
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
      const activeStage = pipeline.stages.find((stage) => stage.isActive !== false);
      stageId = stageId || activeStage?.id;
    }
    if (!stageId) throw new BadRequestException('Add an active stage before creating a deal.');
    await this.assertAssignableStage(numCustomerId, stageId);

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
      meta: { total, page, limit, totalPages, stages: effectiveCustomerId ? (await this.ensureDefaultPipeline(Number(effectiveCustomerId))).stages : [] },
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
    const existing = await this.findOne(numCustomerId, numId);
    if (dto.stageId) await this.assertAssignableStage(numCustomerId, Number(dto.stageId), existing.stageId);

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
    const deal = await this.findOne(numCustomerId, numId);
    await this.assertAssignableStage(numCustomerId, Number(dto.stageId), deal.stageId);

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

  private async assertAssignableStage(customerId: number, stageId: number, currentStageId?: number) {
    if (!stageId || stageId === currentStageId) return;
    const stage = await this.prisma.pipelineStage.findFirst({ where: { id: stageId, pipeline: { customerId, deletedAt: null } } });
    if (!stage) throw new NotFoundException('Deal stage not found');
    if (stage.isActive === false) throw new BadRequestException('Inactive stages cannot be assigned to a deal. Activate the stage first.');
  }

  private requireCustomer(customerId: number | string) {
    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) throw new UnauthorizedException('User is not associated with any customer account');
    return id;
  }

  private async pipelineFor(customerId: number) {
    return this.ensureDefaultPipeline(customerId);
  }

  private async stageInTenant(customerId: number, stageId: number) {
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipeline: { customerId, deletedAt: null } },
      include: { _count: { select: { deals: { where: { deletedAt: null } } } } },
    });
    if (!stage) throw new NotFoundException('Deal stage not found');
    return stage;
  }

  async getStage(customerId: number | string, id: number | string) {
    const tenantId = this.requireCustomer(customerId);
    const stageId = Number(id);
    if (!Number.isInteger(stageId) || stageId <= 0) throw new BadRequestException('Stage ID must be a positive number.');
    const stage = await this.stageInTenant(tenantId, stageId);
    return { ...stage, dealsCount: stage._count?.deals ?? 0 };
  }

  async listStages(customerId: number | string, activeOnly = false) {
    const tenantId = this.requireCustomer(customerId);
    const pipeline = await this.pipelineFor(tenantId);
    const stages = await this.prisma.pipelineStage.findMany({
      where: { pipelineId: pipeline.id, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { deals: { where: { deletedAt: null } } } } },
    });
    return {
      pipelineId: pipeline.id,
      stages: stages.map((stage) => ({ ...stage, dealsCount: stage._count?.deals ?? 0 })),
    };
  }

  async createStage(customerId: number | string, dto: { name: string; order?: number; probability?: number; description?: string; color?: string; isActive?: boolean }) {
    const tenantId = this.requireCustomer(customerId);
    const pipeline = await this.pipelineFor(tenantId);
    const name = String(dto.name || '').trim();
    if (!name) throw new BadRequestException('Stage name is required');
    await this.assertUniqueStageName(pipeline.id, name);
    const maxOrder = pipeline.stages.reduce((max, stage) => Math.max(max, stage.order), 0);
    const order = Number.isInteger(Number(dto.order)) ? Number(dto.order) : maxOrder + 1;
    await this.shiftOrders(pipeline.id, order);
    return this.prisma.pipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        name,
        order,
        probability: this.probability(dto.probability, 50),
        description: dto.description?.trim() || null,
        color: dto.color || '#163A2E',
        isActive: dto.isActive !== false,
      },
    });
  }

  async updateStageDefinition(customerId: number | string, id: number | string, dto: { name?: string; order?: number; probability?: number; description?: string; color?: string; isActive?: boolean }) {
    const tenantId = this.requireCustomer(customerId);
    const stage = await this.stageInTenant(tenantId, Number(id));
    const name = dto.name !== undefined ? String(dto.name).trim() : stage.name;
    if (!name) throw new BadRequestException('Stage name is required');
    if (name.toLowerCase() !== stage.name.toLowerCase()) await this.assertUniqueStageName(stage.pipelineId, name, stage.id);
    if (dto.order !== undefined && Number(dto.order) !== stage.order) await this.shiftOrders(stage.pipelineId, Number(dto.order), stage.id);
    return this.prisma.pipelineStage.update({
      where: { id: stage.id },
      data: {
        name,
        ...(dto.order !== undefined ? { order: Number(dto.order) } : {}),
        ...(dto.probability !== undefined ? { probability: this.probability(dto.probability, stage.probability) } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.color !== undefined ? { color: dto.color || '#163A2E' } : {}),
        ...(dto.isActive !== undefined ? { isActive: Boolean(dto.isActive) } : {}),
      },
    });
  }

  async reassignAndDeleteStage(customerId: number | string, id: number | string, targetStageId: number | string) {
    const tenantId = this.requireCustomer(customerId);
    const source = await this.stageInTenant(tenantId, Number(id));
    const target = await this.stageInTenant(tenantId, Number(targetStageId));
    if (source.id === target.id) throw new BadRequestException('Choose a different deal stage.');
    if (source.pipelineId !== target.pipelineId) throw new BadRequestException('A deal stage cannot be reassigned to a lead stage.');
    const moved = source._count.deals;
    const work = [
      this.prisma.deal.updateMany({ where: { customerId: tenantId, stageId: source.id }, data: { stageId: target.id } }),
      this.prisma.pipelineStage.delete({ where: { id: source.id } }),
    ];
    if (typeof this.prisma.$transaction === 'function') await this.prisma.$transaction(work);
    else { await work[0]; await work[1]; }
    return { deleted: true, id: source.id, reassigned: moved };
  }

  async deleteStage(customerId: number | string, id: number | string) {
    const tenantId = this.requireCustomer(customerId);
    const stage = await this.stageInTenant(tenantId, Number(id));
    if (stage._count.deals > 0) {
      throw new BadRequestException(`"${stage.name}" is used by ${stage._count.deals} deal${stage._count.deals === 1 ? '' : 's'}. Reassign those deals to another deal stage, or deactivate this stage. Deals are not deleted.`);
    }
    if (typeof this.prisma.deal?.count === 'function') {
      const archived = await this.prisma.deal.count({
        where: { customerId: tenantId, stageId: stage.id, deletedAt: { not: null } },
      });
      if (archived > 0) {
        const other = await this.prisma.pipelineStage.findFirst({
          where: { pipelineId: stage.pipelineId, id: { not: stage.id } },
          orderBy: { order: 'asc' },
        });
        if (!other) {
          throw new BadRequestException(`"${stage.name}" is still linked to ${archived} removed deal${archived === 1 ? '' : 's'}. Add another deal stage before deleting this one. Deals are not deleted.`);
        }
        await this.prisma.deal.updateMany({
          where: { customerId: tenantId, stageId: stage.id, deletedAt: { not: null } },
          data: { stageId: other.id },
        });
      }
    }
    try {
      await this.prisma.pipelineStage.delete({ where: { id: stage.id } });
    } catch (error: any) {
      throw new BadRequestException(error?.code === 'P2003'
        ? `"${stage.name}" is still linked to existing deals. Move those deals to another deal stage first. Deals are not deleted.`
        : (error?.message || `"${stage.name}" could not be deleted.`));
    }
    return { deleted: true, id: stage.id };
  }

  async bulkStages(customerId: number | string, body: { ids?: number[]; action?: string }) {
    const ids = [...new Set((body.ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const action = String(body.action || '').toLowerCase();
    const failures: Array<{ id: number; message: string }> = [];
    let success = 0;
    for (const id of ids) {
      try {
        if (action === 'delete') await this.deleteStage(customerId, id);
        else if (action === 'activate' || action === 'deactivate') await this.updateStageDefinition(customerId, id, { isActive: action === 'activate' });
        else throw new BadRequestException('Unsupported bulk action');
        success += 1;
      } catch (error: any) {
        failures.push({ id, message: error?.message || 'Stage update failed' });
      }
    }
    return { total: ids.length, success, failed: failures.length, failures };
  }

  private probability(value: unknown, fallback: number) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(100, Math.max(0, number));
  }

  private async assertUniqueStageName(pipelineId: number, name: string, ignoreId?: number) {
    const existing = await this.prisma.pipelineStage.findMany({ where: { pipelineId, ...(ignoreId ? { id: { not: ignoreId } } : {}) } });
    if (existing.some((stage) => stage.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new BadRequestException('A stage with this name already exists');
    }
  }

  private async shiftOrders(pipelineId: number, order: number, ignoreId?: number) {
    const clash = await this.prisma.pipelineStage.findFirst({ where: { pipelineId, order, ...(ignoreId ? { id: { not: ignoreId } } : {}) } });
    if (!clash) return;
    await this.prisma.pipelineStage.updateMany({ where: { pipelineId, order: { gte: order }, ...(ignoreId ? { id: { not: ignoreId } } : {}) }, data: { order: { increment: 1 } } });
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
