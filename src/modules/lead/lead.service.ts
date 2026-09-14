import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadRepository } from './lead.repository';
import {
  CheckDuplicateDto,
  ConvertLeadDto,
  CreateLeadDto,
  CreateLeadNoteDto,
  CreateLeadStageDto,
  CreateProposalDto,
  FinalCallDto,
  LogFollowUpDto,
  ManageVisitDto,
  RecordPaymentDto,
  StartWorkDto,
  UpdateLeadDto,
  UpdateLeadStageDto,
  UpdateLeadStatusDto,
} from './dto/lead.dto';
import { PlanAccessService } from '../subscription/plan-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';

@Injectable()
export class LeadService {
  constructor(
    private readonly leadRepository: LeadRepository,
    private readonly prisma: PrismaService,
    private readonly planAccessService?: PlanAccessService,
    private readonly leadLimitService?: LeadLimitService,
  ) {}

  async getSummaryMetrics(customerId: number | string | undefined, user?: any) {
    return this.leadRepository.getSummaryMetrics(customerId, user);
  }

  async convertLead(customerId: number | string, leadId: number | string, userId: number | string, dto: ConvertLeadDto) {
    return this.leadRepository.convertLead(customerId, leadId, userId, dto);
  }

  async createLead(customerId: number | string, userOrId: any, dto: CreateLeadDto) {
    if (this.planAccessService) {
      await this.planAccessService.checkLeadLimit(customerId);
    }

    const user = typeof userOrId === 'object' ? userOrId : { id: userOrId };
    const userId = Number(user.id);

    // Concurrency-safe atomic check and lead creation within a transaction
    const lead = await this.prisma.$transaction(async (tx) => {
      let employeeId: number | null = null;
      if (this.leadLimitService) {
        const limitRes = await this.leadLimitService.validateAndConsumeLeadLimit(tx, customerId, user);
        employeeId = limitRes.employeeId;
      }
      return this.leadRepository.create(customerId, userId, dto, employeeId, tx);
    });

    await this.leadRepository.logTimeline(
      lead.id,
      'LEAD_CREATED',
      `Lead "${lead.title}" was created via ${dto.source || 'WEBSITE'}`,
      { source: dto.source, value: dto.value },
    );
    return lead;
  }

  async checkDuplicate(customerId: number | string, dto: CheckDuplicateDto) {
    return this.leadRepository.checkDuplicate(customerId, dto);
  }

  async getStages(customerId?: number | string, includeInactive = true) {
    // Stage Management is the SINGLE SOURCE OF TRUTH.
    // Do NOT merge hardcoded system defaults here — only return what is configured in DB.
    let dbStages: any[] = [];
    try {
      dbStages = await this.leadRepository.findStages(customerId, includeInactive) ?? [];
    } catch (err) {
      // If DB query fails, return empty array — do NOT silently fall back to hardcoded list.
      // The caller (frontend) will show a proper error/retry state.
      console.error('[LeadService] getStages DB query failed:', err);
      return [];
    }

    // Map DB stages to response format and sort by sortOrder
    return dbStages
      .map((stage: any) => ({
        id: stage.id,
        key: stage.key,
        name: stage.name,
        label: stage.name,
        color: stage.color,
        bgColor: stage.bgColor,
        borderColor: stage.borderColor,
        sortOrder: stage.sortOrder,
        isActive: stage.isActive,
        isSystem: stage.isSystem ?? false,
        leadsCount: stage._count?.leads ?? 0,
      }))
      .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  async createStage(customerId: number | string | undefined, user: any, dto: CreateLeadStageDto) {
    return this.leadRepository.createStage(customerId, dto);
  }

  async updateStage(customerId: number | string | undefined, user: any, id: number | string, dto: UpdateLeadStageDto) {
    const stage = await this.leadRepository.findStageById(id);
    if (!stage) {
      throw new NotFoundException(`Stage with ID ${id} not found`);
    }
    return this.leadRepository.updateStage(id, dto);
  }

  async deleteStage(customerId: number | string | undefined, user: any, id: number | string) {
    const stage = await this.leadRepository.findStageById(id);
    if (!stage) {
      throw new NotFoundException(`Stage with ID ${id} not found`);
    }
    const leadCount = await this.leadRepository.countLeadsForStage(id, stage.key);
    if (leadCount > 0) {
      throw new BadRequestException(
        `Cannot delete stage "${stage.name}" because it is currently assigned to ${leadCount} lead(s). Please reassign existing leads or deactivate the stage instead.`,
      );
    }
    return this.leadRepository.deleteStage(id);
  }

  async getLeads(customerId: number | string | undefined, query: { page?: number; limit?: number; search?: string; status?: string }, user?: any) {
    return this.leadRepository.findAll(customerId, query, user);
  }

  async getLeadById(customerId: number | string, id: number | string) {
    const lead = await this.leadRepository.findOne(customerId, id);
    if (!lead) {
      throw new NotFoundException(`Lead with ID ${id} not found`);
    }
    return lead;
  }

  async updateLead(customerId: number | string, id: number | string, dto: UpdateLeadDto) {
    await this.getLeadById(customerId, id);
    await this.leadRepository.update(customerId, id, dto);
    await this.leadRepository.logTimeline(
      id,
      'LEAD_UPDATED',
      `Lead details updated`,
    );
    return this.getLeadById(customerId, id);
  }

  async updateStatus(customerId: number | string, id: number | string, userId: number | string, dto: UpdateLeadStatusDto) {
    const lead = await this.getLeadById(customerId, id);

    let resolvedStatus = dto.status;

    // If status is not provided (custom stage selected), resolve it from the stageId
    if (!resolvedStatus && dto.stageId) {
      const stage = await this.leadRepository.findStageById(dto.stageId);
      const VALID_STATUSES = [
        'NEW', 'FOLLOW_UP', 'CONTACTED', 'VISIT', 'QUALIFIED', 'PROPOSAL',
        'PROPOSAL_SENT', 'FINAL_CALL', 'NEGOTIATION', 'PAYMENT',
        'WORK_STARTED', 'WON', 'LOST', 'CANCELLED', 'CONVERTED',
      ];
      if (stage && VALID_STATUSES.includes(stage.key)) {
        resolvedStatus = stage.key as any;
      }
    }

    // Fall back to the existing lead status if nothing was resolved
    if (!resolvedStatus) {
      resolvedStatus = lead.status as any;
    }

    await this.leadRepository.updateStatus(
      customerId,
      id,
      lead.status,
      resolvedStatus,
      userId,
      dto.notes,
      dto.stageId,
    );
    return this.getLeadById(customerId, id);
  }

  async deleteLead(customerId: number | string, id: number | string) {
    await this.getLeadById(customerId, id);
    return this.leadRepository.softDelete(customerId, id);
  }

  async addNote(customerId: number | string, leadId: number | string, userId: number | string, dto: CreateLeadNoteDto) {
    await this.getLeadById(customerId, leadId);
    const note = await this.leadRepository.addNote(leadId, userId, dto.content);
    await this.leadRepository.logTimeline(
      leadId,
      'NOTE_ADDED',
      `New note added: ${dto.content.substring(0, 40)}...`,
    );
    return note;
  }

  async logFollowUp(customerId: number | string, leadId: number | string, userId: number | string, dto: LogFollowUpDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.logFollowUp(customerId, leadId, userId, dto);
  }

  async manageVisit(customerId: number | string, leadId: number | string, userId: number | string, dto: ManageVisitDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.manageVisit(customerId, leadId, userId, dto);
  }

  async createProposal(customerId: number | string, leadId: number | string, userId: number | string, dto: CreateProposalDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.createProposal(customerId, leadId, userId, dto);
  }

  async recordFinalCall(customerId: number | string, leadId: number | string, userId: number | string, dto: FinalCallDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.recordFinalCall(customerId, leadId, userId, dto);
  }

  async recordPayment(customerId: number | string, leadId: number | string, userId: number | string, dto: RecordPaymentDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.recordPayment(customerId, leadId, userId, dto);
  }

  async startWork(customerId: number | string, leadId: number | string, userId: number | string, dto: StartWorkDto) {
    await this.getLeadById(customerId, leadId);
    return this.leadRepository.startWork(customerId, leadId, userId, dto);
  }
}
