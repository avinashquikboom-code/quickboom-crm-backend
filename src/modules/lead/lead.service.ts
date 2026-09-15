import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
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
  ReorderLeadStagesDto,
  StartWorkDto,
  UpdateLeadDto,
  UpdateLeadStageDto,
  UpdateLeadStatusDto,
  normalizeLeadStatus,
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

  private async validateBpoEmployeeAssignment(
    customerId: number | string,
    assignedToId?: number | string | null,
  ): Promise<{ assignedToId: number | null; employeeId: number | null } | undefined> {
    if (assignedToId === undefined) {
      return undefined;
    }

    if (assignedToId === null || assignedToId === '' || assignedToId === 0 || assignedToId === '0') {
      return { assignedToId: null, employeeId: null };
    }

    const targetId = Number(assignedToId);
    if (isNaN(targetId)) {
      throw new BadRequestException('Invalid employee ID provided for lead assignment');
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { userId: targetId },
          { id: targetId },
        ],
        customerId: Number(customerId),
      },
      include: {
        department: true,
        designation: true,
        teamMembers: {
          include: { team: true },
        },
      },
    });

    if (!employee) {
      throw new BadRequestException('Assigned employee does not exist in this workspace');
    }

    if (employee.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot assign lead to an inactive employee');
    }

    const deptStr = `${employee.department?.name || ''} ${employee.department?.code || ''}`.toLowerCase();
    const desigStr = `${employee.designation?.name || ''} ${employee.designation?.code || ''}`.toLowerCase();
    const teamStr = (employee.teamMembers || [])
      .map((tm) => tm.team?.name || '')
      .join(' ')
      .toLowerCase();

    const isBpo =
      deptStr.includes('bpo') ||
      desigStr.includes('bpo') ||
      teamStr.includes('bpo');

    if (!isBpo) {
      throw new BadRequestException('Only BPO employees/representatives can be assigned to leads');
    }

    return {
      assignedToId: employee.userId || targetId,
      employeeId: employee.id,
    };
  }

  async createLead(customerId: number | string, userOrId: any, dto: CreateLeadDto) {
    if (this.planAccessService) {
      await this.planAccessService.checkLeadLimit(customerId);
    }

    const user = typeof userOrId === 'object' ? userOrId : { id: userOrId };
    const userId = Number(user.id);

    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);
    const numCustomerId = Number(customerId);
    let resolvedStageId: number | undefined = dto.stageId ? Number(dto.stageId) : undefined;
    let resolvedStatus: LeadStatus = LeadStatus.NEW;

    if (resolvedStageId) {
      const stage = await this.leadRepository.findStageById(resolvedStageId);
      if (stage) {
        const normKey = normalizeLeadStatus(stage.key);
        if (ALL_LEAD_STATUSES.includes(normKey)) {
          resolvedStatus = normKey as LeadStatus;
        }
      }
    } else if (dto.status) {
      const normStatus = normalizeLeadStatus(dto.status);
      if (ALL_LEAD_STATUSES.includes(normStatus)) {
        resolvedStatus = normStatus as LeadStatus;
      }
    }

    const assignment = await this.validateBpoEmployeeAssignment(customerId, dto.assignedToId);

    const sanitizedDto = {
      ...dto,
      status: resolvedStatus,
      ...(resolvedStageId ? { stageId: resolvedStageId } : {}),
      ...(assignment !== undefined ? { assignedToId: assignment.assignedToId, employeeId: assignment.employeeId } : {}),
    };

    // Concurrency-safe atomic check and lead creation within a transaction
    const lead = await this.prisma.$transaction(async (tx) => {
      let employeeId: number | null = null;
      if (this.leadLimitService) {
        const limitRes = await this.leadLimitService.validateAndConsumeLeadLimit(tx, customerId, user);
        employeeId = limitRes.employeeId;
      }
      return this.leadRepository.create(customerId, userId, sanitizedDto as any, employeeId, tx);
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
    // Auto-seed default stages for a new workspace on first call.
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;
    try {
      await this.leadRepository.ensureDefaultStagesForCustomer(numCustomerId);
    } catch (err) {
      console.warn('[LeadService] ensureDefaultStagesForCustomer failed (non-fatal):', err);
    }

    let dbStages: any[] = [];
    try {
      dbStages = await this.leadRepository.findStages(customerId, includeInactive) ?? [];
    } catch (err) {
      console.error('[LeadService] getStages DB query failed:', err);
      return [];
    }

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

  async reorderStages(customerId: number | string | undefined, user: any, dto: ReorderLeadStagesDto) {
    if (!dto.stages || dto.stages.length === 0) {
      throw new BadRequestException('stages array cannot be empty.');
    }
    return this.leadRepository.reorderStages(customerId, dto.stages);
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

  async getLeadStatus(customerId: number | string, id: number | string) {
    const lead = await this.getLeadById(customerId, id);
    let stage = lead.stage;
    if (!stage && lead.stageId) {
      stage = await this.leadRepository.findStageById(lead.stageId);
    }
    if (!stage && lead.status) {
      const stages = await this.leadRepository.findStages(customerId);
      const match = stages.find((s: any) => s.key === lead.status);
      if (match) {
        stage = match;
      }
    }
    return {
      ...lead,
      leadId: lead.id,
      status: lead.status,
      stageId: lead.stageId ?? stage?.id ?? null,
      stage: stage ?? null,
      statusHistory: lead.statusHistory ?? [],
    };
  }

  async updateLead(customerId: number | string, id: number | string, dto: UpdateLeadDto) {
    const lead = await this.getLeadById(customerId, id);
    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);

    let resolvedStageId: number | undefined = dto.stageId !== undefined ? (dto.stageId ? Number(dto.stageId) : undefined) : undefined;
    let resolvedStatus: LeadStatus | undefined = undefined;

    if (resolvedStageId) {
      const stage = await this.leadRepository.findStageById(resolvedStageId);
      if (stage) {
        const normKey = normalizeLeadStatus(stage.key);
        if (ALL_LEAD_STATUSES.includes(normKey)) {
          resolvedStatus = normKey as LeadStatus;
        } else {
          // Custom stage: keep existing lead status
          resolvedStatus = lead.status as LeadStatus;
        }
      }
    } else if (dto.status) {
      const normStatus = normalizeLeadStatus(dto.status);
      if (ALL_LEAD_STATUSES.includes(normStatus)) {
        resolvedStatus = normStatus as LeadStatus;
      } else {
        resolvedStatus = lead.status as LeadStatus;
      }
    }

    const assignment = await this.validateBpoEmployeeAssignment(customerId, dto.assignedToId);

    const sanitizedDto = {
      ...dto,
      ...(resolvedStageId !== undefined ? { stageId: resolvedStageId } : {}),
      ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
      ...(assignment !== undefined ? { assignedToId: assignment.assignedToId, employeeId: assignment.employeeId } : {}),
    };

    await this.leadRepository.update(customerId, id, sanitizedDto as any);
    await this.leadRepository.logTimeline(
      id,
      'LEAD_UPDATED',
      `Lead details updated`,
    );
    return this.getLeadById(customerId, id);
  }

  async updateStatus(customerId: number | string, id: number | string, userId: number | string, dto: UpdateLeadStatusDto) {
    const lead = await this.getLeadById(customerId, id);
    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);

    let resolvedStageId: number | undefined = dto.stageId ? Number(dto.stageId) : undefined;
    let resolvedStatus: LeadStatus = lead.status as LeadStatus;
    let stageName: string | undefined;

    if (resolvedStageId) {
      // 1. Resolve LeadStage from DB
      const stage = await this.leadRepository.findStageById(resolvedStageId);
      if (!stage) {
        throw new NotFoundException(`Lead stage with ID ${resolvedStageId} not found`);
      }

      stageName = stage.name;

      // 2. Tenant verification (workspace/company/tenant isolation)
      const numCustomerId = Number(customerId);
      if (
        stage.customerId !== null &&
        !isNaN(numCustomerId) &&
        numCustomerId > 0 &&
        Number(stage.customerId) !== numCustomerId
      ) {
        throw new ForbiddenException('Lead stage does not belong to your company/workspace');
      }

      // 3. Prevent assigning inactive stages (unless lead was already on this stage)
      if (!stage.isActive && lead.stageId !== stage.id) {
        throw new BadRequestException(`Cannot transition lead to inactive stage "${stage.name}"`);
      }

      // 4. Map to legacy status ONLY if there is a valid enum match, otherwise keep existing lead.status
      const normKey = normalizeLeadStatus(stage.key);
      if (ALL_LEAD_STATUSES.includes(normKey)) {
        resolvedStatus = normKey as LeadStatus;
      } else if (dto.status) {
        const normDtoStatus = normalizeLeadStatus(dto.status);
        if (ALL_LEAD_STATUSES.includes(normDtoStatus)) {
          resolvedStatus = normDtoStatus as LeadStatus;
        }
      }
    } else if (dto.status) {
      // Legacy status update without stageId
      const normStatus = normalizeLeadStatus(dto.status);
      if (!ALL_LEAD_STATUSES.includes(normStatus)) {
        throw new BadRequestException(`Invalid status "${dto.status}". Must be a recognized status or supply a valid stageId.`);
      }
      resolvedStatus = normStatus as LeadStatus;
      // Try to resolve matching stage for this tenant
      const stages = await this.leadRepository.findStages(customerId);
      const matchStage = stages.find((s: any) => s.key === resolvedStatus);
      if (matchStage) {
        resolvedStageId = matchStage.id;
        stageName = matchStage.name;
      }
    } else {
      throw new BadRequestException('Either stageId or status must be provided.');
    }

    await this.leadRepository.updateStatus(
      customerId,
      id,
      lead.status,
      resolvedStatus,
      userId,
      dto.notes,
      resolvedStageId,
      lead.stageId,
      stageName,
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
