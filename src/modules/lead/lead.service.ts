import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
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
  SendLeadWhatsAppDto,
  normalizeLeadStatus,
} from './dto/lead.dto';
import { PlanAccessService } from '../subscription/plan-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';
import { EmailService } from '../email/email.service';
import {
  EmailTemplateService,
  TELECALLER_STATUS_TO_TEMPLATE_KEY,
  renderEmailTemplate,
  wrapInQuikboomEmailHtml,
} from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { isUserSuperAdmin } from '../../common/utils/role.util';

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
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
  ) {}

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

  async updateLead(customerId: number | string, id: number | string, dto: UpdateLeadDto) {
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

    const updatedLead = await this.getLeadById(customerId, id);

    if (isStageChanged) {
      const newStageName = stageName || updatedLead.stage?.name || resolvedStatus || updatedLead.status || 'UPDATED';
      await this.handleLeadStageChangeNotification(
        customerId,
        updatedLead,
        previousStageName,
        newStageName,
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
      );
    }

    // Trigger WhatsApp notification if sendWhatsapp is enabled
    if (isStageChanged && dto.sendWhatsapp) {
      await this.handleLeadStageChangeWhatsappNotification(
        customerId,
        updatedLead,
        previousStageName,
        newStageName,
        userId,
        dto.whatsappMessage,
        dto.whatsappTemplateName,
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
  ) {
    try {
      this.logger.log(`[LEAD] Stage change detected`);
      this.logger.log(`[LEAD] Previous stage: ${previousStageName}`);
      this.logger.log(`[LEAD] New stage: ${newStageName}`);

      // 1. Resolve recipient email: prioritize the email address stored directly on the Lead record
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      let recipientEmail = (lead.email || '').trim();

      if (!recipientEmail || !emailRegex.test(recipientEmail)) {
        if (lead.customer?.email && emailRegex.test(lead.customer.email.trim())) {
          recipientEmail = lead.customer.email.trim();
        } else {
          recipientEmail = '';
        }
      }

      // Handle missing email gracefully
      if (!recipientEmail) {
        this.logger.warn(`[EMAIL] Recipient email not available on lead #${lead.id}`);
        return;
      }

      this.logger.log(`[EMAIL] Lead notification recipient: ${maskEmail(recipientEmail)}`);

      // 2. Prevent duplicate notifications (debounce identical transitions within 60 seconds)
      const recentLog = await this.prisma.emailLog.findFirst({
        where: {
          leadId: Number(lead.id),
          eventType: 'LEAD_STAGE_CHANGED',
          previousStage: String(previousStageName),
          newStage: String(newStageName),
          createdAt: {
            gte: new Date(Date.now() - 60000),
          },
        },
      });

      if (recentLog) {
        this.logger.log(
          `[LEAD] Duplicate stage change notification detected for lead #${lead.id} (${previousStageName} → ${newStageName}). Skipping redundant email.`,
        );
        return;
      }

      // 3. Resolve template mapping from lead status / stage automatically
      const normNewStage = (newStageName || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const normNewStatus = (lead.status || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const templateKey =
        TELECALLER_STATUS_TO_TEMPLATE_KEY[normNewStage] ||
        TELECALLER_STATUS_TO_TEMPLATE_KEY[normNewStatus] ||
        null;

      let template: any = null;
      if (overrideTemplateId && this.emailTemplateService) {
        template = await this.emailTemplateService.findOne(Number(overrideTemplateId), lead.customerId).catch(() => null);
      }
      if (!template && templateKey && this.emailTemplateService) {
        template = await this.emailTemplateService.findByKey(templateKey, lead.customerId).catch(() => null);
      }

      if (template && !template.isActive) {
        this.logger.log(
          `[EMAIL] Email template "${templateKey || template.key}" is inactive. Skipping automatic email for lead #${lead.id}.`,
        );
        return;
      }

      // Build context variables with Lead full name
      const leadTitle =
        `${lead.firstName || ''} ${lead.lastName || ''}`.trim() ||
        lead.title ||
        lead.companyName ||
        'Valued Client';

      let userName = 'QuickBoom Team';
      if (lead.user?.name) {
        userName = lead.user.name;
      } else if (userId && this.prisma.user) {
        const u = await this.prisma.user
          .findUnique({
            where: { id: Number(userId) },
            select: { firstName: true, lastName: true },
          })
          .catch(() => null);
        if (u) {
          userName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'QuickBoom Team';
        }
      }

      const senderEmail =
        lead.user?.email ||
        lead.customer?.email ||
        'sales@quikboom.com';

      let emailSubject = customSubject || 'Your Lead Status Has Been Updated';
      let htmlContent = '';
      let textContent = '';

      if (customBody) {
        textContent = customBody;
        htmlContent = customBody.includes('<') && customBody.includes('>')
          ? customBody
          : wrapInQuikboomEmailHtml(customBody);
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
          userName,
          email: senderEmail,
          startDate: startDate || 'To be communicated',
          startTime: startTime || '',
          companyName: lead.customer?.companyName || lead.customer?.name || 'QUIKBOOM Digital Marketing Agency',
        };

        const rendered = renderEmailTemplate(
          { subject: template.subject, body: template.body },
          variables,
        );

        emailSubject = customSubject || rendered.subject;
        textContent = rendered.body;
        htmlContent = wrapInQuikboomEmailHtml(rendered.body);
      } else {
        // Standard clean stage update notification for stages without custom template (e.g. Qualified)
        const senderOrgName = lead.customer?.companyName || lead.customer?.name || 'QuickBoom Team';

        htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Lead Status Has Been Updated</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; -webkit-font-smoothing: antialiased; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #0f172a, #1e293b); padding: 28px 32px; color: #ffffff; }
    .header h1 { margin: 0 0 6px; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
    .header p { margin: 0; font-size: 13px; color: #94a3b8; }
    .body { padding: 32px; }
    .intro { font-size: 15px; line-height: 1.6; margin-bottom: 20px; color: #334155; }
    .status-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; }
    .status-pill-old { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; }
    .status-pill-new { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .details-table { width: 100%; border-collapse: collapse; margin-top: 16px; border-top: 1px solid #e2e8f0; }
    .details-table td { padding: 10px 0; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
    .details-table tr:last-child td { border-bottom: none; }
    .label { font-weight: 700; color: #64748b; width: 40%; }
    .value { font-weight: 600; color: #0f172a; }
    .closing { font-size: 14px; color: #475569; margin-top: 24px; line-height: 1.6; }
    .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Your Lead Status Has Been Updated</h1>
      <p>Notification from ${senderOrgName}</p>
    </div>
    <div class="body">
      <p class="intro">
        Hello <strong>${leadTitle}</strong>,<br><br>
        Your lead stage has been updated in QuickBoom CRM.
      </p>

      <div class="status-box">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; font-size: 13px; font-weight: 700; color: #64748b; width: 40%;">Previous Stage:</td>
            <td style="padding: 6px 0;"><span class="status-pill-old">${previousStageName}</span></td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-size: 13px; font-weight: 700; color: #64748b;">Current Stage:</td>
            <td style="padding: 6px 0;"><span class="status-pill-new">${newStageName}</span></td>
          </tr>
        </table>
      </div>

      <p class="closing">
        Thank you,<br>
        <strong>QuickBoom Team</strong>
      </p>
    </div>
    <div class="footer">
      Sent via <strong>QuickBoom CRM</strong>
    </div>
  </div>
</body>
</html>`.trim();

        textContent = `
Hello ${leadTitle},

Your lead stage has been updated in QuickBoom CRM.

Previous Stage: ${previousStageName}
Current Stage: ${newStageName}

Thank you,
QuickBoom Team`.trim();
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
          eventType: 'LEAD_STAGE_CHANGED',
        });

        messageId = sendResult?.messageId || null;
        this.logger.log(`[EMAIL] Lead stage change email sent successfully`);
      } catch (err: any) {
        status = 'FAILED';
        sendError = err?.message || 'Failed to dispatch email';
        this.logger.error(`[EMAIL] Failed to send lead stage change email: ${sendError}`);
      }

      // 5. Store email delivery/log status in EmailLog table
      await this.prisma.emailLog.create({
        data: {
          leadId: Number(lead.id),
          customerId: lead.customerId ? Number(lead.customerId) : null,
          userId: userId ? Number(userId) : null,
          templateId: template?.id || null,
          identifierKey: templateKey || 'LEAD_STAGE_UPDATED',
          recipientEmail,
          subject: emailSubject,
          renderedContent: htmlContent,
          eventType: 'LEAD_STAGE_CHANGED',
          previousStage: String(previousStageName),
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
        'STAGE_CHANGE_EMAIL',
        status === 'SENT'
          ? `Stage transition email sent to ${maskEmail(recipientEmail)} (${previousStageName} → ${newStageName})`
          : `Stage transition email failed for ${maskEmail(recipientEmail)}: ${sendError}`,
        {
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
          select: { name: true, companyName: true, email: true, phone: true },
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

    // HTML Email Template
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #0f172a, #1e293b); padding: 28px 32px; color: #ffffff; }
    .header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 800; }
    .header p { margin: 0; font-size: 13px; color: #94a3b8; }
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
  <div class="card">
    <div class="header">
      <h1>${businessName}</h1>
      <p>Lead Reference #${lead.id} • Registered Profile Details</p>
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
  }

  /**
   * Dispatches a WhatsApp message for a lead and logs it to activity timeline.
   */
  async sendLeadWhatsApp(
    customerId: number | string,
    id: number | string,
    userId?: number | string,
    dto?: SendLeadWhatsAppDto,
  ) {
    const lead = await this.getLeadById(customerId, id);
    if (!lead) {
      throw new NotFoundException(`Lead #${id} not found`);
    }

    const phone = lead.phone ? String(lead.phone).trim() : '';
    if (!phone) {
      return {
        success: false,
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

    const leadFullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title || 'Valued Prospect';
    const companyName = lead.customer?.companyName || lead.customer?.name || 'QUIKBOOM Digital Marketing Agency';
    let userName = 'QuickBoom Team';
    if (userId && this.prisma.user) {
      const u = await this.prisma.user
        .findUnique({
          where: { id: Number(userId) },
          select: { firstName: true, lastName: true },
        })
        .catch(() => null);
      if (u) {
        userName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'QuickBoom Team';
      }
    }

    const stageKey = lead.stage?.key || lead.status || 'NEW';
    const stageName = dto?.stageName || lead.stage?.name || lead.status || 'Updated';

    const variables: Record<string, string> = {
      leadName: leadFullName,
      leadTitle: lead.title || leadFullName,
      companyName,
      userName,
      stage: stageName,
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
      });
    }

    // Write to LeadActivityTimeline
    await this.prisma.leadActivityTimeline
      .create({
        data: {
          leadId: Number(lead.id),
          action: 'WHATSAPP_SENT',
          description: result.success
            ? `WhatsApp notification sent to ${phone} for stage ${stageName}`
            : `WhatsApp notification skipped or failed for ${phone}: ${result.reason || 'Not delivered'}`,
          metadata: {
            phone,
            normalizedPhone,
            stageName,
            stageKey,
            success: result.success,
            messageId: result.messageId,
            reason: result.reason,
          } as any,
        },
      })
      .catch(() => null);

    return {
      success: result.success,
      messageId: result.messageId,
      message: result.success
        ? `WhatsApp message sent successfully to ${phone}`
        : `WhatsApp message could not be sent: ${result.reason || 'Provider error'}`,
      skipped: result.skipped,
      reason: result.reason,
    };
  }

  /**
   * Dispatches automatic WhatsApp notification upon lead stage change with debouncing.
   */
  async handleLeadStageChangeWhatsappNotification(
    customerId: number | string,
    lead: any,
    previousStageName: string,
    newStageName: string,
    userId?: number | string,
    customMessage?: string,
    templateName?: string,
  ) {
    try {
      this.logger.log(`[WHATSAPP] Handling stage change WhatsApp notification for lead #${lead.id} (${previousStageName} → ${newStageName})`);
      if (!this.whatsappService) {
        this.logger.warn(`[WHATSAPP] WhatsappService not available. Skipping.`);
        return;
      }

      const phone = lead.phone ? String(lead.phone).trim() : '';
      if (!phone) {
        this.logger.warn(`[WHATSAPP] Lead #${lead.id} has no phone registered. Skipping.`);
        return;
      }

      // Check recent timeline debounce to avoid duplicate WhatsApp sends within 60s
      let recentTimeline: any = null;
      if (this.prisma.leadActivityTimeline?.findFirst) {
        recentTimeline = await this.prisma.leadActivityTimeline.findFirst({
          where: {
            leadId: Number(lead.id),
            action: 'WHATSAPP_SENT',
            createdAt: {
              gte: new Date(Date.now() - 60000),
            },
          },
        }).catch(() => null);
      }

      if (recentTimeline) {
        this.logger.log(`[WHATSAPP] Duplicate WhatsApp notification within 60s for lead #${lead.id}. Skipping.`);
        return;
      }

      return await this.sendLeadWhatsApp(customerId, lead.id, userId, {
        message: customMessage,
        templateName,
        stageName: newStageName,
      });
    } catch (err: any) {
      this.logger.error(`[WHATSAPP] Failed to send lead stage change WhatsApp: ${err?.message}`);
    }
  }
}
