import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LeadStatus } from '@prisma/client';
import { LeadRepository } from './lead.repository';
import { NotificationService } from '../notification/notification.service';
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
  SendLeadWhatsAppDto,
  SendLeadEmailDto,
  normalizeLeadStatus,
} from './dto/lead.dto';
import { PlanAccessService } from '../subscription/plan-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';
import { EmailService } from '../email/email.service';
import {
  EmailTemplateService,
  TELECALLER_STATUS_TO_TEMPLATE_KEY,
  PREDEFINED_SYSTEM_TEMPLATES,
  renderEmailTemplate,
  wrapInQuikboomEmailHtml,
} from '../email/email-template.service';
import { WhatsappService, STAGE_KEY_TO_WHATSAPP_KEY } from '../whatsapp/whatsapp.service';
import { isUserSuperAdmin } from '../../common/utils/role.util';

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

function maskPhone(phone?: string | null): string {
  if (!phone) return 'none';
  const clean = phone.replace(/\D/g, '');
  if (clean.length <= 4) return '****';
  return `****${clean.slice(-4)}`;
}

@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);

  constructor(
    private readonly leadRepository: LeadRepository,
    private readonly prisma: PrismaService,
    @Optional() private readonly planAccessService?: PlanAccessService,
    @Optional() private readonly leadLimitService?: LeadLimitService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly emailTemplateService?: EmailTemplateService,
    @Optional() private readonly whatsappService?: WhatsappService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private getNotificationService(): NotificationService | null {
    if (!this.moduleRef) return null;
    try {
      return this.moduleRef.get(NotificationService, { strict: false });
    } catch {
      return null;
    }
  }

  async getSummaryMetrics(customerId: number | string | undefined, user?: any) {
    return this.leadRepository.getSummaryMetrics(customerId, user);
  }

  async convertLead(customerId: number | string, leadId: number | string, userId: number | string, dto: ConvertLeadDto) {
    return this.leadRepository.convertLead(customerId, leadId, userId, dto);
  }

  private sanitizeLeadFields<T extends Record<string, any>>(dto: T): T {
    const isInvalid = (v: any) => {
      if (v === null || v === undefined) return true;
      if (typeof v === 'string') {
        const t = v.trim();
        if (!t) return true;
        const u = t.toUpperCase();
        return u === 'N/A' || u === 'NA' || u === 'NONE' || u === 'NULL' || u === '-';
      }
      return false;
    };

    const cleaned = { ...dto } as any;
    const optionalKeys = [
      'phone',
      'email',
      'companyName',
      'website',
      'address',
      'city',
      'location',
      'state',
      'category',
      'googlePlaceId',
      'firstName',
      'lastName',
    ];

    for (const key of optionalKeys) {
      if (key in cleaned) {
        if (isInvalid(cleaned[key])) {
          cleaned[key] = null;
        } else if (typeof cleaned[key] === 'string') {
          cleaned[key] = cleaned[key].trim();
        }
      }
    }

    // Bi-directional fallback between city and location
    if (!cleaned.city && cleaned.location) {
      cleaned.city = cleaned.location;
    }
    if (!cleaned.location && cleaned.city) {
      cleaned.location = cleaned.city;
    }

    return cleaned;
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
    const user = typeof userOrId === 'object' ? userOrId : { id: userOrId };
    const isSuperAdmin = isUserSuperAdmin(user);

    if (this.planAccessService && !isSuperAdmin) {
      await this.planAccessService.checkLeadLimit(customerId);
    }

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

    const cleaned = this.sanitizeLeadFields(dto);
    const assignment = await this.validateBpoEmployeeAssignment(customerId, cleaned.assignedToId);

    const sanitizedDto = {
      ...cleaned,
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

    // Retrieve fresh lead with stage and customer relations populated
    const createdLead = await this.getLeadById(customerId, lead.id).catch(() => lead);
    const initialStageName = createdLead.stage?.name || createdLead.status || 'New';

    // Automated communication for NEW LEAD CREATED
    // 1. Email automation using initial stage template:
    await this.handleLeadStageChangeNotification(
      customerId,
      createdLead,
      '',
      initialStageName,
      userId,
      undefined,
      undefined,
      undefined,
      'LEAD_CREATED',
    ).catch((err) => {
      this.logger.error(`[NEW_LEAD_EMAIL_NOTIFICATION_ERROR] ${err?.message}`);
    });

    // 2. WhatsApp automation using initial stage template:
    await this.handleLeadStageChangeWhatsappNotification(
      customerId,
      createdLead,
      '',
      initialStageName,
      userId,
      undefined,
      undefined,
      'LEAD_CREATED',
    ).catch((err) => {
      this.logger.error(`[NEW_LEAD_WHATSAPP_NOTIFICATION_ERROR] ${err?.message}`);
    });

    if (assignment?.assignedToId) {
      const notifService = this.getNotificationService();
      if (notifService) {
        notifService.sendPushNotification({
          userId: Number(assignment.assignedToId),
          customerId: Number(customerId),
          title: 'New Lead Assigned',
          body: `You have been assigned to lead "${lead.companyName || lead.title || lead.firstName || 'Lead #' + lead.id}".`,
          type: 'LEAD_ASSIGNED',
          data: {
            leadId: String(lead.id),
            customerId: String(customerId),
            channel: 'LEAD',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        }).catch((err) => this.logger.warn(`Failed to dispatch LEAD_ASSIGNED push: ${err?.message}`));
      }
    }

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

  async getLeads(customerId: number | string | undefined, query: { page?: number; limit?: number; search?: string; status?: string; stageId?: string | number }, user?: any) {
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

  async updateLead(customerId: number | string, id: number | string, dto: UpdateLeadDto, userId?: number | string) {
    const lead = await this.getLeadById(customerId, id);
    const ALL_LEAD_STATUSES: string[] = Object.values(LeadStatus);

    let resolvedStageId: number | undefined = dto.stageId !== undefined ? (dto.stageId ? Number(dto.stageId) : undefined) : undefined;
    let resolvedStatus: LeadStatus | undefined = undefined;
    let stageName: string | undefined = undefined;

    if (resolvedStageId) {
      const stage = await this.leadRepository.findStageById(resolvedStageId);
      if (stage) {
        stageName = stage.name;
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

    const cleaned = this.sanitizeLeadFields(dto);
    const assignment = await this.validateBpoEmployeeAssignment(customerId, cleaned.assignedToId);

    const sanitizedDto = {
      ...cleaned,
      ...(resolvedStageId !== undefined ? { stageId: resolvedStageId } : {}),
      ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
      ...(assignment !== undefined ? { assignedToId: assignment.assignedToId, employeeId: assignment.employeeId } : {}),
    };

    const previousStageName = lead.stage?.name || lead.status || 'NEW';
    const isStageChanged =
      (resolvedStageId !== undefined && resolvedStageId !== lead.stageId) ||
      (resolvedStatus !== undefined && resolvedStatus !== lead.status);

    await this.leadRepository.update(customerId, id, sanitizedDto as any);
    await this.leadRepository.logTimeline(
      id,
      'LEAD_UPDATED',
      `Lead details updated`,
    );

    if (assignment?.assignedToId && assignment.assignedToId !== lead.assignedToId) {
      const notifService = this.getNotificationService();
      if (notifService) {
        notifService.sendPushNotification({
          userId: Number(assignment.assignedToId),
          customerId: Number(customerId),
          title: 'New Lead Assigned',
          body: `You have been assigned to lead "${lead.companyName || lead.title || lead.firstName || 'Lead #' + id}".`,
          type: 'LEAD_ASSIGNED',
          data: {
            leadId: String(id),
            customerId: String(customerId),
            channel: 'LEAD',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        }).catch((err) => this.logger.warn(`Failed to dispatch LEAD_ASSIGNED push: ${err?.message}`));
      }
    }

    const updatedLead = await this.getLeadById(customerId, id);

    if (isStageChanged) {
      const newStageName = stageName || updatedLead.stage?.name || resolvedStatus || updatedLead.status || 'UPDATED';
      await this.handleLeadStageChangeNotification(
        customerId,
        updatedLead,
        previousStageName,
        newStageName,
        userId,
        undefined,
        undefined,
        undefined,
        'LEAD_STAGE_CHANGED',
      );
      await this.handleLeadStageChangeWhatsappNotification(
        customerId,
        updatedLead,
        previousStageName,
        newStageName,
        userId,
        undefined,
        undefined,
        'LEAD_STAGE_CHANGED',
      );
    }

    return updatedLead;
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

    // Detect if stage or status actually changed
    const previousStageName = lead.stage?.name || lead.status || 'NEW';
    const newStageName = stageName || resolvedStatus;
    const isStageChanged =
      (resolvedStageId !== undefined && resolvedStageId !== lead.stageId) ||
      resolvedStatus !== lead.status;

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

    const updatedLead = await this.getLeadById(customerId, id);

    // If stage actually changed, trigger automatic customer email notification unless explicitly skipped
    if (isStageChanged && dto.sendEmail !== false) {
      await this.handleLeadStageChangeNotification(
        customerId,
        updatedLead,
        previousStageName,
        newStageName,
        userId,
        dto.templateId,
        dto.customSubject,
        dto.customBody,
        'LEAD_STAGE_CHANGED',
      );
    }

    // Trigger WhatsApp notification automatically unless explicitly skipped
    if (isStageChanged && dto.sendWhatsapp !== false) {
      await this.handleLeadStageChangeWhatsappNotification(
        customerId,
        updatedLead,
        previousStageName,
        newStageName,
        userId,
        dto.whatsappMessage,
        dto.whatsappTemplateName,
        'LEAD_STAGE_CHANGED',
      );
    }

    return updatedLead;
  }

  /**
   * Dispatches automatic email notification to customer upon lead stage change.
   * Ensures email failure never causes the lead update to fail.
   */
  async handleLeadStageChangeNotification(
    customerId: number | string,
    lead: any,
    previousStageName: string,
    newStageName: string,
    userId?: number | string,
    overrideTemplateId?: number,
    customSubject?: string,
    customBody?: string,
    eventType: 'LEAD_CREATED' | 'LEAD_STAGE_CHANGED' = 'LEAD_STAGE_CHANGED',
  ) {
    try {
      this.logger.log(`[LEAD] ${eventType} detected`);
      if (previousStageName) this.logger.log(`[LEAD] Previous stage: ${previousStageName}`);
      this.logger.log(`[LEAD] New stage: ${newStageName}`);

      // 0. Do NOT send email if stage did not actually change (for stage change events)
      if (
        eventType === 'LEAD_STAGE_CHANGED' &&
        previousStageName &&
        newStageName &&
        previousStageName.trim().toUpperCase() === newStageName.trim().toUpperCase()
      ) {
        this.logger.log(
          `[EMAIL] Stage unchanged (${previousStageName} → ${newStageName}). Skipping automatic email.`,
        );
        return;
      }

      // 1. Resolve recipient email: strictly comes from the Lead record's email field
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const recipientEmail = (lead.email || '').trim();

      // Handle missing or invalid email gracefully
      if (!recipientEmail || !emailRegex.test(recipientEmail)) {
        this.logger.log(`[EMAIL] Recipient email not available on lead #${lead.id}. ${eventType === 'LEAD_CREATED' ? 'Lead created' : 'Stage updated'} successfully, skipping email.`);
        return;
      }

      this.logger.log(`[EMAIL] Lead notification recipient: ${maskEmail(recipientEmail)}`);

      // 2. Prevent duplicate notifications (debounce identical transitions/events within 60 seconds)
      const recentLog = await this.prisma.emailLog.findFirst({
        where: {
          leadId: Number(lead.id),
          eventType,
          ...(eventType === 'LEAD_STAGE_CHANGED'
            ? {
                previousStage: String(previousStageName),
                newStage: String(newStageName),
              }
            : {}),
          createdAt: {
            gte: new Date(Date.now() - 60000),
          },
        },
      });

      if (recentLog) {
        this.logger.log(
          `[LEAD] Duplicate ${eventType} email notification detected for lead #${lead.id}. Skipping redundant email.`,
        );
        return;
      }

      // 3. Resolve template mapping strictly for the NEW stage
      const normNewStage = (newStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const normLeadStageKey = (lead.stage?.key || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const targetStageKey = normNewStage || normLeadStageKey;
      const templateKey =
        TELECALLER_STATUS_TO_TEMPLATE_KEY[targetStageKey] ||
        (normLeadStageKey && TELECALLER_STATUS_TO_TEMPLATE_KEY[normLeadStageKey]) ||
        `QUIKBOOM_${targetStageKey}`;

      let template: any = null;
      if (overrideTemplateId && this.emailTemplateService) {
        template = await this.emailTemplateService.findOne(Number(overrideTemplateId), lead.customerId).catch(() => null);
      }
      if (!template && templateKey && this.emailTemplateService) {
        template = await this.emailTemplateService.findByKey(templateKey, lead.customerId).catch(() => null);
      }
      if (!template && this.emailTemplateService) {
        // Also check predefined system fallback templates
        template = PREDEFINED_SYSTEM_TEMPLATES.find(
          (t) => t.key === templateKey || t.key === `QUIKBOOM_${normNewStage}`
        ) || null;
      }

      if (template && template.isActive === false) {
        this.logger.log(
          `[EMAIL] Email template "${templateKey || template.key}" is inactive. Skipping automatic email for lead #${lead.id}.`,
        );
        return;
      }

      // If no template is configured for this stage, do NOT send generic or random template
      if (!template && !customBody) {
        this.logger.log(
          `[EMAIL] ${eventType === 'LEAD_CREATED' ? 'New lead created' : 'Lead stage updated'}, but no email template is configured for the "${newStageName}" stage. Skipping email.`,
        );
        return;
      }

      // Build context variables with Lead full name
      const leadTitle =
        `${lead.firstName || ''} ${lead.lastName || ''}`.trim() ||
        lead.title ||
        lead.companyName ||
        'Valued Client';

      // Resolve assigned employee details for signature (or fallback to user/customer)
      let userName = 'QuickBoom Team';
      let senderEmail = 'sales@quikboom.com';
      let assignedEmployeeName = 'QuickBoom Team';
      let assignedEmployeeEmail = 'sales@quikboom.com';

      if (lead.assignedTo) {
        const repName = `${lead.assignedTo.firstName || ''} ${lead.assignedTo.lastName || ''}`.trim();
        if (repName) {
          userName = repName;
          assignedEmployeeName = repName;
        }
        if (lead.assignedTo.email) {
          senderEmail = lead.assignedTo.email.trim();
          assignedEmployeeEmail = lead.assignedTo.email.trim();
        }
      } else if (lead.user?.name) {
        userName = lead.user.name;
        if (lead.user.email) senderEmail = lead.user.email;
      } else if (userId && this.prisma.user) {
        const u = await this.prisma.user
          .findUnique({
            where: { id: Number(userId) },
            select: { firstName: true, lastName: true, email: true },
          })
          .catch(() => null);
        if (u) {
          const uName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
          if (uName) {
            userName = uName;
            assignedEmployeeName = uName;
          }
          if (u.email) {
            senderEmail = u.email.trim();
            assignedEmployeeEmail = u.email.trim();
          }
        }
      } else if (lead.customer?.email) {
        senderEmail = lead.customer.email.trim();
      }

      // Resolve primaryColor from lead stage, database lead_stages, or Admin Panel fallback (#16A34A)
      let primaryColor = lead.stage?.color || null;
      if (!primaryColor && newStageName) {
        const st = await this.prisma.leadStage.findFirst({
          where: {
            OR: [
              { name: { equals: newStageName, mode: 'insensitive' } },
              { key: { equals: normNewStage, mode: 'insensitive' } },
            ],
            deletedAt: null,
          },
          select: { color: true },
        }).catch(() => null);
        if (st?.color) {
          primaryColor = st.color;
        }
      }
      if (!primaryColor) {
        primaryColor = process.env.PRIMARY_COLOR || '#16A34A';
      }

      // Resolve public HTTPS logo URL (absolute, public without auth)
      let logoUrl = 'https://admin.qbapp.online/logo.png';
      if (lead.customer?.logo) {
        const l = String(lead.customer.logo).trim();
        if (l.startsWith('http://') || l.startsWith('https://')) {
          logoUrl = l;
        } else if (l.startsWith('/')) {
          logoUrl = `https://admin.qbapp.online${l}`;
        }
      }

      let emailSubject = customSubject || 'Your Lead Status Has Been Updated';
      let htmlContent = '';
      let textContent = '';

      if (customBody) {
        textContent = customBody;
        htmlContent = customBody.includes('<') && customBody.includes('>')
          ? customBody
          : wrapInQuikboomEmailHtml(customBody, { primaryColor, logoSrc: logoUrl });
      } else if (template) {
        let startDate = '';
        let startTime = '';

        if (templateKey === 'QUIKBOOM_VISIT_SCHEDULED') {
          const scheduledVisit = await this.prisma.visit
            .findFirst({
              where: {
                leadId: Number(lead.id),
                status: 'SCHEDULED',
              },
              orderBy: { date: 'desc' },
            })
            .catch(() => null);

          if (scheduledVisit?.date) {
            startDate = new Intl.DateTimeFormat('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(new Date(scheduledVisit.date));
            startTime = scheduledVisit.time || '';
          } else if (lead.nextFollowUpDate) {
            startDate = new Intl.DateTimeFormat('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(new Date(lead.nextFollowUpDate));
            startTime = lead.nextFollowUpTime || '';
          }
        }

        const variables: Record<string, any> = {
          leadTitle,
          leadName: leadTitle,
          leadFirstName: (lead.firstName || '').trim() || leadTitle,
          name: leadTitle,
          customerName: leadTitle,
          recipientName: leadTitle,
          leadEmail: recipientEmail,
          email: senderEmail,
          senderEmail,
          userName,
          senderName: userName,
          assignedUser: userName,
          assignedEmployee: userName,
          assignedEmployeeName,
          assignedEmployeeEmail,
          companyName: lead.customer?.companyName || lead.customer?.name || 'QUIKBOOM Digital Marketing Agency',
          company: lead.companyName || 'your company',
          stage: newStageName,
          stageName: newStageName,
          newStage: newStageName,
          previousStage: previousStageName,
          startDate: startDate || 'To be communicated',
          startTime: startTime || '',
          loginUrl: 'https://quikboom.com/login',
          primaryColor,
          logoUrl,
        };

        const rendered = renderEmailTemplate(
          { subject: template.subject, body: template.body },
          variables,
        );

        emailSubject = customSubject || rendered.subject;
        textContent = rendered.body;
        htmlContent = wrapInQuikboomEmailHtml(rendered.body, { primaryColor, logoSrc: logoUrl });
      }

      // 4. Send email via existing EmailService
      let messageId: string | null = null;
      let sendError: string | null = null;
      let status = 'SENT';

      try {
        if (!this.emailService) {
          throw new Error('Email service is not available');
        }

        const sendResult = await this.emailService.sendEmail({
          to: recipientEmail,
          subject: emailSubject,
          html: htmlContent,
          text: textContent,
          recordType: 'lead',
          recordId: lead.id,
          templateId: template?.id || undefined,
          eventType,
        });

        messageId = sendResult?.messageId || null;
        this.logger.log(`[EMAIL] Lead ${eventType} email sent successfully`);
      } catch (err: any) {
        status = 'FAILED';
        sendError = err?.message || 'Failed to dispatch email';
        this.logger.error(`[EMAIL] Failed to send lead ${eventType} email: ${sendError}`);
      }

      this.logger.log(
        `[LEAD_STAGE_NOTIFICATION]\nLead Stage Changed\nLead ID: ${lead.id}\nPrevious Stage: ${previousStageName || 'None'}\nNew Stage: ${newStageName}\nEmail:\nTemplate Found: ${template ? 'YES' : 'NO'}\nTemplate ID: ${template?.id || templateKey || 'N/A'}\nRecipient: ${maskEmail(recipientEmail)}\nProvider Status: ${status === 'SENT' ? 'SUCCESS' : 'FAILED'}`
      );

      // 5. Store email delivery/log status in EmailLog table
      await this.prisma.emailLog.create({
        data: {
          leadId: Number(lead.id),
          customerId: lead.customerId ? Number(lead.customerId) : null,
          userId: userId ? Number(userId) : null,
          templateId: template?.id || null,
          identifierKey: templateKey || (eventType === 'LEAD_CREATED' ? 'QUIKBOOM_NEW_LEAD' : 'LEAD_STAGE_UPDATED'),
          recipientEmail,
          subject: emailSubject,
          renderedContent: htmlContent,
          eventType,
          previousStage: previousStageName ? String(previousStageName) : null,
          newStage: String(newStageName),
          status,
          providerMessageId: messageId,
          errorMessage: sendError,
          sentAt: new Date(),
        },
      }).catch((logErr) => {
        this.logger.warn(`[EMAIL_LOG_WARN] Failed to write EmailLog: ${logErr?.message}`);
      });

      // 6. Record timeline event
      await this.leadRepository.logTimeline(
        lead.id,
        eventType === 'LEAD_CREATED' ? 'LEAD_CREATED_EMAIL' : 'STAGE_CHANGE_EMAIL',
        status === 'SENT'
          ? (eventType === 'LEAD_CREATED'
              ? `Welcome email sent to ${maskEmail(recipientEmail)} (${newStageName} stage)`
              : `Stage transition email sent to ${maskEmail(recipientEmail)} (${previousStageName} → ${newStageName})`)
          : (eventType === 'LEAD_CREATED'
              ? `Welcome email failed for ${maskEmail(recipientEmail)}: ${sendError}`
              : `Stage transition email failed for ${maskEmail(recipientEmail)}: ${sendError}`),
        {
          eventType,
          previousStage: previousStageName,
          newStage: newStageName,
          recipientEmail: maskEmail(recipientEmail),
          status,
          providerMessageId: messageId,
        },
      ).catch(() => null);
    } catch (unexpectedError: any) {
      // Must NEVER fail the lead stage update even on unexpected notification errors
      this.logger.error(`[EMAIL_NOTIFICATION_UNEXPECTED_ERROR] ${unexpectedError?.message}`);
    }
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

  /**
   * Dispatches complete lead profile and account details to the lead's email
   * using the configured SMTP Email Integration.
   */
  async sendLeadDetails(customerId: number | string | undefined, leadId: number | string, user?: any) {
    const id = Number(leadId);
    if (isNaN(id)) {
      throw new BadRequestException('Invalid lead ID');
    }

    const parsedCustomerId = customerId !== undefined && customerId !== null ? Number(customerId) : undefined;

    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        ...(parsedCustomerId ? { customerId: parsedCustomerId } : {}),
        deletedAt: null,
      },
      include: {
        stage: true,
        assignedTo: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        customer: {
          select: { name: true, companyName: true, email: true, phone: true, logo: true },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead record #${leadId} not found`);
    }

    const recipient = (lead.email || '').trim();
    if (!recipient) {
      throw new BadRequestException(
        `Lead "${lead.companyName || lead.title || `${lead.firstName} ${lead.lastName}`}" has no email address configured. Please add an email address to the lead first.`,
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipient)) {
      throw new BadRequestException(
        `Lead "${lead.companyName || lead.title || `${lead.firstName} ${lead.lastName}`}" has an invalid email address "${recipient}". Please update the lead with a valid email address.`,
      );
    }

    if (!this.emailService) {
      throw new BadRequestException('Email service is not available');
    }

    const leadFullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Valued Contact';
    const businessName = lead.companyName || lead.title || 'Client Organization';
    const senderOrgName = lead.customer?.companyName || lead.customer?.name || 'QuickBoom CRM';

    const primaryColor = lead.stage?.color || process.env.PRIMARY_COLOR || '#16A34A';
    let logoUrl = 'https://admin.qbapp.online/logo.png';
    const customerObj = lead.customer as any;
    if (customerObj?.logo) {
      const l = String(customerObj.logo).trim();
      if (l.startsWith('http://') || l.startsWith('https://')) {
        logoUrl = l;
      } else if (l.startsWith('/')) {
        logoUrl = `https://admin.qbapp.online${l}`;
      }
    }

    // HTML Email Template
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background-color: ${primaryColor}; background: ${primaryColor}; padding: 28px 32px; color: #ffffff; text-align: center; }
    .header img { max-height: 48px; width: auto; display: inline-block; margin-bottom: 12px; border: 0; }
    .header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 800; color: #ffffff; }
    .header p { margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.9); }
    .body { padding: 32px; }
    .intro { font-size: 14px; line-height: 1.6; margin-bottom: 24px; color: #334155; }
    .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 12px; }
    .details-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    .details-table td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
    .details-table tr:last-child td { border-bottom: none; }
    .label { font-weight: 700; color: #64748b; width: 38%; }
    .value { font-weight: 600; color: #0f172a; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: #dcfce7; color: #15803d; }
    .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="card" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div class="header" style="background-color: ${primaryColor}; background: ${primaryColor}; padding: 28px 32px; color: #ffffff; text-align: center;">
      <img src="${logoUrl}" alt="${senderOrgName}" width="160" style="max-height: 48px; width: auto; display: inline-block; margin-bottom: 12px; border: 0;" />
      <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 800; color: #ffffff;">${businessName}</h1>
      <p style="margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.9);">Lead Reference #${lead.id} • Registered Profile Details</p>
    </div>
    <div class="body">
      <p class="intro">
        Hello <strong>${leadFullName}</strong>,<br><br>
        Here are the recorded account and lead details on file with <strong>${senderOrgName}</strong>:
      </p>

      <div class="section-title">Lead & Contact Information</div>
      <table class="details-table">
        <tr>
          <td class="label">Lead / Opportunity</td>
          <td class="value">${lead.title}</td>
        </tr>
        <tr>
          <td class="label">Business / Account</td>
          <td class="value">${businessName}</td>
        </tr>
        <tr>
          <td class="label">Primary Contact</td>
          <td class="value">${leadFullName}</td>
        </tr>
        <tr>
          <td class="label">Email Address</td>
          <td class="value">${lead.email || '—'}</td>
        </tr>
        <tr>
          <td class="label">Phone Number</td>
          <td class="value">${lead.phone || '—'}</td>
        </tr>
        ${lead.website ? `
        <tr>
          <td class="label">Website</td>
          <td class="value">${lead.website}</td>
        </tr>` : ''}
        ${lead.address || lead.city ? `
        <tr>
          <td class="label">Location / City</td>
          <td class="value">${[lead.address, lead.city, lead.state, lead.country].filter(Boolean).join(', ')}</td>
        </tr>` : ''}
        ${lead.category ? `
        <tr>
          <td class="label">Industry / Category</td>
          <td class="value">${lead.category}</td>
        </tr>` : ''}
      </table>

      <div class="section-title">Account Engagement Overview</div>
      <table class="details-table">
        <tr>
          <td class="label">Status / Stage</td>
          <td class="value"><span class="badge">${lead.stage?.name || lead.status}</span></td>
        </tr>
        <tr>
          <td class="label">Priority</td>
          <td class="value">${lead.priority || 'MEDIUM'}</td>
        </tr>
        ${lead.value ? `
        <tr>
          <td class="label">Estimated Deal Value</td>
          <td class="value">₹${Number(lead.value).toLocaleString('en-IN')}</td>
        </tr>` : ''}
        ${lead.assignedTo ? `
        <tr>
          <td class="label">Assigned Representative</td>
          <td class="value">${lead.assignedTo.firstName} ${lead.assignedTo.lastName} (${lead.assignedTo.email})</td>
        </tr>` : ''}
        <tr>
          <td class="label">Lead Source</td>
          <td class="value">${lead.source}</td>
        </tr>
      </table>

      <p style="font-size: 13px; color: #64748b; margin: 0;">
        If you have any questions or updates regarding these details, please reply directly to this email or get in touch with our team.
      </p>
    </div>
    <div class="footer">
      Sent by <strong>${senderOrgName}</strong> via CRM
    </div>
  </div>
</body>
</html>
    `.trim();

    // Plain text fallback
    const textContent = `
Lead & Account Details
---------------------------------------------
Opportunity: ${lead.title}
Business: ${businessName}
Contact: ${leadFullName}
Email: ${lead.email || '—'}
Phone: ${lead.phone || '—'}
Website: ${lead.website || '—'}
Location: ${[lead.address, lead.city, lead.state, lead.country].filter(Boolean).join(', ') || '—'}
Stage: ${lead.stage?.name || lead.status}
Priority: ${lead.priority || 'MEDIUM'}
Deal Value: ₹${Number(lead.value || 0).toLocaleString('en-IN')}
Assigned Rep: ${lead.assignedTo ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName} (${lead.assignedTo.email})` : 'Unassigned'}
Source: ${lead.source}

Sent by ${senderOrgName} via CRM.
    `.trim();

    try {
      const result = await this.emailService.sendEmail({
        to: recipient,
        subject: `Lead Details: ${businessName}`,
        html: htmlContent,
        text: textContent,
        recordType: 'lead',
        recordId: lead.id,
      }, user);

      // Write to activity timeline
      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: lead.id,
          action: 'EMAIL_SENT',
          description: `Lead details dispatched via SMTP to ${recipient} (Message ID: ${result.messageId || 'sent'})`,
        },
      }).catch(() => null);

      return {
        success: true,
        message: `Lead details successfully sent to ${recipient}`,
        messageId: result.messageId,
      };
    } catch (err: any) {
      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: lead.id,
          action: 'EMAIL_FAILED',
          description: `Failed to send email to ${recipient}: ${err.message || 'SMTP Error'}`,
        },
      }).catch(() => null);

      const targetUserId = lead.assignedToId || (user?.id ? Number(user.id) : undefined);
      if (targetUserId && lead.customerId) {
        const notifService = this.getNotificationService();
        if (notifService) {
          notifService.sendPushNotification({
            userId: targetUserId,
            customerId: lead.customerId,
            title: 'Email Delivery Failed',
            body: `Failed to send email to "${businessName}": ${err.message || 'SMTP Error'}`,
            type: 'EMAIL_FAILED',
            data: {
              leadId: String(lead.id),
              customerId: String(lead.customerId),
              channel: 'EMAIL',
              error: String(err.message || 'SMTP Error'),
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
          }).catch((e) => this.logger.warn(`Failed to dispatch EMAIL_FAILED push: ${e.message}`));
        }
      }
      throw err;
    }
  }

  /**
   * Sends custom email or details email to lead.
   */
  async sendLeadEmail(
    customerId: number | string | undefined,
    leadId: number | string,
    user?: any,
    dto?: SendLeadEmailDto,
  ) {
    if (!dto?.message && !dto?.subject) {
      return this.sendLeadDetails(customerId, leadId, user);
    }

    const id = Number(leadId);
    if (isNaN(id)) throw new BadRequestException('Invalid lead ID');
    const parsedCustomerId = customerId !== undefined && customerId !== null ? Number(customerId) : undefined;

    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        ...(parsedCustomerId ? { customerId: parsedCustomerId } : {}),
        deletedAt: null,
      },
      include: {
        customer: {
          select: { name: true, companyName: true, email: true, phone: true },
        },
      },
    });

    if (!lead) throw new NotFoundException(`Lead record #${leadId} not found`);

    const recipient = (lead.email || '').trim();
    if (!recipient) {
      throw new BadRequestException(`Lead has no email address configured.`);
    }

    if (!this.emailService) {
      throw new BadRequestException('Email service is not available');
    }

    const senderOrgName = lead.customer?.companyName || lead.customer?.name || 'QuickBoom CRM';
    const subject = dto.subject?.trim() || `Update from ${senderOrgName}`;
    const bodyContent = dto.message || '';

    const htmlContent = wrapInQuikboomEmailHtml(
      `<div style="font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-wrap;">${bodyContent}</div>`,
      { previewText: subject, companyName: senderOrgName },
    );

    try {
      const result = await this.emailService.sendEmail({
        to: recipient,
        subject,
        html: htmlContent,
        text: bodyContent,
        recordType: 'lead',
        recordId: lead.id,
      }, user);

      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: lead.id,
          action: 'EMAIL_SENT',
          description: `Custom email sent to ${recipient}: "${subject}"`,
        },
      }).catch(() => null);

      return {
        success: true,
        message: `Email successfully sent to ${recipient}`,
        messageId: result.messageId,
      };
    } catch (err: any) {
      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: lead.id,
          action: 'EMAIL_FAILED',
          description: `Failed to send email to ${recipient}: ${err.message || 'SMTP Error'}`,
        },
      }).catch(() => null);

      const targetUserId = lead.assignedToId || (user?.id ? Number(user.id) : undefined);
      if (targetUserId && lead.customerId) {
        const notifService = this.getNotificationService();
        if (notifService) {
          notifService.sendPushNotification({
            userId: targetUserId,
            customerId: lead.customerId,
            title: 'Email Delivery Failed',
            body: `Failed to send email to "${recipient}": ${err.message || 'SMTP Error'}`,
            type: 'EMAIL_FAILED',
            data: {
              leadId: String(lead.id),
              customerId: String(lead.customerId),
              channel: 'EMAIL',
              error: String(err.message || 'SMTP Error'),
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
          }).catch((e) => this.logger.warn(`Failed to dispatch EMAIL_FAILED push: ${e.message}`));
        }
      }
      throw err;
    }
  }

  /**
   * Unified communication history for a lead (EmailLogs + WhatsApp / Email timelines)
   */
  async getLeadCommunications(customerId: number | string | undefined, leadId: number | string) {
    const id = Number(leadId);
    if (isNaN(id)) {
      throw new BadRequestException('Invalid lead ID');
    }
    const parsedCustomerId = customerId !== undefined && customerId !== null ? Number(customerId) : undefined;

    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        ...(parsedCustomerId ? { customerId: parsedCustomerId } : {}),
        deletedAt: null,
      },
      select: {
        id: true,
        customerId: true,
        assignedToId: true,
        firstName: true,
        lastName: true,
        companyName: true,
        title: true,
        email: true,
        phone: true,
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead #${leadId} not found`);
    }

    // 1. Fetch email logs
    const emailLogs = await this.prisma.emailLog.findMany({
      where: {
        leadId: id,
        ...(parsedCustomerId ? { customerId: parsedCustomerId } : {}),
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // 2. Fetch timeline records with communication actions
    const commActions = [
      'WHATSAPP_SENT',
      'WHATSAPP_INCOMING',
      'WHATSAPP_FAILED',
      'LEAD_CREATED_WHATSAPP',
      'EMAIL_SENT',
      'EMAIL_FAILED',
    ];
    const timelineLogs = await this.prisma.leadActivityTimeline.findMany({
      where: {
        leadId: id,
        action: { in: commActions },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // 3. Build unified communication items
    const items: Array<{
      id: string;
      channel: 'EMAIL' | 'WHATSAPP';
      direction: 'OUTBOUND' | 'INBOUND';
      action: string;
      status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED';
      title: string;
      content: string;
      recipient: string;
      sender: string;
      errorMessage: string | null;
      providerMessageId: string | null;
      createdAt: string;
      metadata?: any;
    }> = [];

    for (const el of emailLogs) {
      const senderName = el.user
        ? `${el.user.firstName || ''} ${el.user.lastName || ''}`.trim() || el.user.email
        : 'System / CRM';
      const rawStatus = (el.status || 'SENT').toUpperCase();
      let status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED' = 'SENT';
      if (rawStatus === 'FAILED') status = 'FAILED';
      else if (rawStatus === 'QUEUED') status = 'QUEUED';
      else if (rawStatus === 'DELIVERED') status = 'DELIVERED';

      items.push({
        id: `email-${el.id}`,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        action: 'EMAIL_SENT',
        status,
        title: el.subject || 'Email to Lead',
        content: el.renderedContent
          ? el.renderedContent.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().substring(0, 300)
          : (el.subject || ''),
        recipient: el.recipientEmail || lead.email || '',
        sender: senderName,
        errorMessage: el.errorMessage || null,
        providerMessageId: el.providerMessageId || null,
        createdAt: el.createdAt ? el.createdAt.toISOString() : new Date().toISOString(),
        metadata: {
          eventType: el.eventType,
          emailLogId: el.id,
        },
      });
    }

    for (const tl of timelineLogs) {
      const meta = (tl.metadata as any) || {};
      const action = tl.action;

      if (action === 'EMAIL_SENT' || action === 'EMAIL_FAILED') {
        const isDuplicate = emailLogs.some((el) => {
          const diff = Math.abs(new Date(el.createdAt).getTime() - new Date(tl.createdAt).getTime());
          return diff < 60000;
        });
        if (isDuplicate) continue;

        items.push({
          id: `timeline-${tl.id}`,
          channel: 'EMAIL',
          direction: 'OUTBOUND',
          action,
          status: action === 'EMAIL_FAILED' ? 'FAILED' : 'SENT',
          title: 'Email Communication',
          content: tl.description || '',
          recipient: lead.email || '',
          sender: 'CRM',
          errorMessage: action === 'EMAIL_FAILED' ? tl.description : null,
          providerMessageId: meta.messageId || null,
          createdAt: tl.createdAt.toISOString(),
          metadata: meta,
        });
      } else if (action === 'WHATSAPP_INCOMING') {
        items.push({
          id: `timeline-${tl.id}`,
          channel: 'WHATSAPP',
          direction: 'INBOUND',
          action,
          status: 'RECEIVED',
          title: `Incoming WhatsApp from ${meta.from || lead.phone || 'Lead'}`,
          content: meta.text || tl.description || '',
          recipient: 'CRM / You',
          sender: meta.from || lead.phone || 'Lead',
          errorMessage: null,
          providerMessageId: meta.messageId || null,
          createdAt: tl.createdAt.toISOString(),
          metadata: meta,
        });
      } else {
        let status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED' = 'SENT';
        const metaStatus = (meta.status || '').toUpperCase();
        if (action === 'WHATSAPP_FAILED' || metaStatus === 'FAILED') {
          status = 'FAILED';
        } else if (metaStatus === 'READ') {
          status = 'READ';
        } else if (metaStatus === 'DELIVERED') {
          status = 'DELIVERED';
        } else if (metaStatus === 'SENT' || metaStatus === 'SUCCESS') {
          status = 'SENT';
        }

        items.push({
          id: `timeline-${tl.id}`,
          channel: 'WHATSAPP',
          direction: 'OUTBOUND',
          action,
          status,
          title: meta.stageName ? `WhatsApp: ${meta.stageName}` : 'WhatsApp Message',
          content: tl.description || '',
          recipient: meta.phone || lead.phone || '',
          sender: 'CRM Team',
          errorMessage: meta.errorReason || meta.errorCode || null,
          providerMessageId: meta.messageId || null,
          createdAt: tl.createdAt.toISOString(),
          metadata: meta,
        });
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const totalEmails = items.filter((i) => i.channel === 'EMAIL').length;
    const totalWhatsApp = items.filter((i) => i.channel === 'WHATSAPP').length;
    const lastItem = items[0];

    return {
      leadId: id,
      summary: {
        totalCommunications: items.length,
        totalEmails,
        totalWhatsApp,
        lastContactAt: lastItem ? lastItem.createdAt : null,
        lastChannel: lastItem ? lastItem.channel : null,
        lastStatus: lastItem ? lastItem.status : null,
      },
      communications: items,
    };
  }

  /**
   * Returns all available WhatsApp templates for lead stages.
   */
  getWhatsAppTemplates() {
    if (!this.whatsappService) return [];
    return this.whatsappService.getAllStageTemplates().map((tpl) => ({
      key: tpl.key,
      templateName: tpl.templateName,
      title: `${tpl.name} WhatsApp`,
      name: tpl.name,
      body: tpl.body,
    }));
  }

  /**
   * Dispatches a WhatsApp message for a lead and logs it to activity timeline.
   */
  async sendLeadWhatsApp(
    customerId: number | string,
    id: number | string,
    userId?: number | string,
    dto?: SendLeadWhatsAppDto & { eventType?: 'LEAD_CREATED' | 'LEAD_STAGE_CHANGED' },
  ) {
    const lead = await this.getLeadById(customerId, id);
    if (!lead) {
      throw new NotFoundException(`Lead #${id} not found`);
    }

    const phone = lead.phone ? String(lead.phone).trim() : '';
    if (!phone) {
      return {
        success: false,
        skipped: true,
        reason: 'NO_PHONE',
        message: 'No phone number is registered for this lead.',
      };
    }

    const normalizedPhone = this.whatsappService?.normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      return {
        success: false,
        reason: 'INVALID_PHONE',
        message: `Phone number "${phone}" is not a valid mobile number for WhatsApp.`,
      };
    }

    const targetStageName = dto?.stageName || lead.stage?.name || lead.status || 'NEW';
    const normStage = targetStageName.trim().toUpperCase().replace(/[\s-]+/g, '_');
    const rawKey = dto?.stageName
      ? normStage
      : (lead.stage?.key ? String(lead.stage.key).trim().toUpperCase().replace(/[\s-]+/g, '_') : normStage);
    const stageKey = STAGE_KEY_TO_WHATSAPP_KEY[rawKey] || rawKey || 'NEW';

    const template = typeof this.whatsappService?.getStageTemplate === 'function'
      ? (this.whatsappService.getStageTemplate(stageKey) || this.whatsappService.getStageTemplate(normStage))
      : true;
    if (!template && !dto?.message) {
      this.logger.log(
        `[WHATSAPP] Lead #${lead.id} stage is "${targetStageName}", but no WhatsApp template is configured for this stage. Skipping WhatsApp.`,
      );
      return {
        success: false,
        skipped: true,
        reason: 'NO_TEMPLATE_CONFIGURED',
        message: `No WhatsApp template is configured for stage "${targetStageName}". Skipping.`,
      };
    }

    const leadFullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title || 'Valued Prospect';
    const companyName = lead.customer?.companyName || lead.customer?.name || 'QUIKBOOM Digital Marketing Agency';

    let userName = 'QuickBoom Team';
    let assignedEmployeeName = 'QuickBoom Team';
    let assignedEmployeeEmail = '';
    let assignedEmployeePhone = '';

    const assignedUser = lead.assignedTo || (lead.assignedToId && this.prisma.user ? await this.prisma.user.findUnique({
      where: { id: lead.assignedToId },
      select: { firstName: true, lastName: true, email: true, phone: true },
    }).catch(() => null) : null);

    if (assignedUser) {
      const repName = `${assignedUser.firstName || ''} ${assignedUser.lastName || ''}`.trim();
      if (repName) {
        userName = repName;
        assignedEmployeeName = repName;
      }
      if (assignedUser.email) assignedEmployeeEmail = assignedUser.email.trim();
      if (assignedUser.phone) assignedEmployeePhone = assignedUser.phone.trim();
    } else if (userId && this.prisma.user) {
      const u = await this.prisma.user
        .findUnique({
          where: { id: Number(userId) },
          select: { firstName: true, lastName: true, email: true, phone: true },
        })
        .catch(() => null);
      if (u) {
        const uName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
        if (uName) {
          userName = uName;
          assignedEmployeeName = uName;
        }
        if (u.email) assignedEmployeeEmail = u.email.trim();
        if (u.phone) assignedEmployeePhone = u.phone.trim();
      }
    }

    const variables: Record<string, string> = {
      leadName: leadFullName,
      leadTitle: lead.title || leadFullName,
      companyName,
      userName,
      assignedUser: userName,
      assignedEmployeeName,
      assignedEmployeeEmail,
      assignedEmployeePhone,
      stage: targetStageName,
      startDate: lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).toLocaleDateString('en-IN') : '',
      startTime: lead.nextFollowUpTime || '',
    };

    let result: any = { success: true, messageId: undefined, skipped: false };
    if (this.whatsappService) {
      result = await this.whatsappService.sendLeadStageMessage({
        to: normalizedPhone,
        stageKey: String(stageKey),
        variables,
        customMessage: dto?.message,
        stageName: targetStageName,
      });
    }

    // Write to LeadActivityTimeline
    const eventType = dto?.eventType || 'LEAD_STAGE_CHANGED';
    const action = eventType === 'LEAD_CREATED' ? 'LEAD_CREATED_WHATSAPP' : 'WHATSAPP_SENT';
    await this.prisma.leadActivityTimeline
      .create({
        data: {
          leadId: Number(lead.id),
          action,
          description: result.success
            ? (eventType === 'LEAD_CREATED'
                ? `Welcome WhatsApp message sent to ${phone} for ${targetStageName} stage`
                : `WhatsApp notification sent to ${phone} for stage ${targetStageName}`)
            : `WhatsApp notification skipped or failed for ${phone}: ${result.reason || result.error || 'Not delivered'}`,
          metadata: {
            eventType,
            phone: maskPhone(phone),
            normalizedPhone: maskPhone(normalizedPhone),
            stageName: targetStageName,
            stageKey,
            status: result.success ? 'Sent' : (result.skipped ? 'Skipped' : 'Failed'),
            success: result.success,
            messageId: result.messageId || null,
            errorCode: result.error || null,
            errorReason: result.reason || null,
            errorDetails: result.details || null,
          } as any,
        },
      })
      .catch(() => null);

    this.logger.log(
      `[LEAD_STAGE_NOTIFICATION]\nLead Stage Changed\nLead ID: ${lead.id}\nPrevious Stage: ${dto?.eventType === 'LEAD_CREATED' ? 'None' : (lead.stage?.name || 'N/A')}\nNew Stage: ${targetStageName}\nWhatsApp:\nTemplate Found: ${template ? 'YES' : 'NO'}\nTemplate ID: ${template && typeof template === 'object' ? template.templateName : stageKey}\nRecipient: ${maskPhone(phone)}\nProvider Status: ${result.success ? 'SUCCESS' : 'FAILED'}`
    );

    return {
      success: result.success,
      messageId: result.messageId,
      message: result.success
        ? `WhatsApp message sent successfully to ${phone}`
        : `WhatsApp message could not be sent: ${result.reason || result.error || 'Provider error'}`,
      skipped: result.skipped,
      reason: result.reason || result.error,
    };
  }

  /**
   * Dispatches automatic WhatsApp notification upon lead creation or stage change with debouncing.
   */
  async handleLeadStageChangeWhatsappNotification(
    customerId: number | string,
    lead: any,
    previousStageName: string,
    newStageName: string,
    userId?: number | string,
    customMessage?: string,
    templateName?: string,
    eventType: 'LEAD_CREATED' | 'LEAD_STAGE_CHANGED' = 'LEAD_STAGE_CHANGED',
  ) {
    try {
      this.logger.log(`[WHATSAPP] Handling ${eventType} WhatsApp notification for lead #${lead.id} (${previousStageName} → ${newStageName})`);

      // 0. Do NOT send if stage did not actually change for stage change events
      if (
        eventType === 'LEAD_STAGE_CHANGED' &&
        previousStageName &&
        newStageName &&
        previousStageName.trim().toUpperCase() === newStageName.trim().toUpperCase()
      ) {
        this.logger.log(`[WHATSAPP] Stage unchanged (${previousStageName} → ${newStageName}). Skipping automatic WhatsApp.`);
        return;
      }

      if (!this.whatsappService) {
        this.logger.warn(`[WHATSAPP] WhatsappService not available. Skipping.`);
        return;
      }

      const phone = lead.phone ? String(lead.phone).trim() : '';
      if (!phone) {
        this.logger.warn(`[WHATSAPP] Lead #${lead.id} has no phone registered. Skipping.`);
        return;
      }

      // Check recent timeline debounce to avoid duplicate WhatsApp sends within 15s for the same stage
      let recentTimeline: any = null;
      if (this.prisma.leadActivityTimeline?.findFirst) {
        recentTimeline = await this.prisma.leadActivityTimeline.findFirst({
          where: {
            leadId: Number(lead.id),
            action: { in: ['WHATSAPP_SENT', 'LEAD_CREATED_WHATSAPP'] },
            createdAt: {
              gte: new Date(Date.now() - 15000),
            },
          },
          orderBy: { createdAt: 'desc' },
        }).catch(() => null);
      }

      if (recentTimeline) {
        const meta = (recentTimeline.metadata as any) || {};
        const recentStage = (meta.stageName || '').trim().toUpperCase();
        const currentNewStage = (newStageName || '').trim().toUpperCase();
        if (!recentStage || recentStage === currentNewStage || (eventType === 'LEAD_CREATED' && recentTimeline.action === 'LEAD_CREATED_WHATSAPP')) {
          this.logger.log(`[WHATSAPP] Duplicate ${eventType} WhatsApp notification within 15s for lead #${lead.id} on stage "${newStageName}". Skipping.`);
          return;
        }
      }

      return await this.sendLeadWhatsApp(customerId, lead.id, userId, {
        message: customMessage,
        templateName,
        stageName: newStageName,
        eventType,
      });
    } catch (err: any) {
      this.logger.error(`[WHATSAPP] Failed to send lead ${eventType} WhatsApp: ${err?.message}`);
    }
  }
}
