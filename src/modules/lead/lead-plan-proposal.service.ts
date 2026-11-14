import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LeadPlanProposal, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadRepository } from './lead.repository';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  CreateCustomPlanProposalDto,
  CreateStandardPlanProposalDto,
  CustomPlanProposalConfigDto,
  ResendPlanProposalDto,
  SetPlanPreferenceDto,
} from './dto/lead-plan-proposal.dto';
import { generatePlanProposalPdfBuffer } from '../../common/utils/plan-proposal-pdf.util';
import { normalizeStageToken } from './lead-stage-automation.util';

const DEFAULT_PLAN_CODE = 'STANDARD';

type PlanProposalWorkflowState = {
  planPreferenceType: string | null;
  customerRequirements: string | null;
  planPreferenceReady: boolean;
  activePlanProposalType: string | null;
  planProposalWorkflowAt: Date | null;
};

type PlanProposalLeadContext = {
  id: number;
  customerId: number;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  title: string;
  customerRequirements: string | null;
  planPreferenceReady: boolean;
  planPreferenceType: string | null;
  activePlanProposalType: string | null;
};

export interface PlanProposalSnapshot {
  planId?: number;
  planName: string;
  planPrice: number;
  features?: string[];
  requirements?: string | null;
  validUntil?: string;
  terms?: string;
  customSummary?: string;
  customConfig?: Record<string, unknown>;
}

@Injectable()
export class LeadPlanProposalService {
  private readonly logger = new Logger(LeadPlanProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadRepository: LeadRepository,
    private readonly emailService: EmailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  private parsePlanFeatures(features: unknown): string[] {
    if (Array.isArray(features)) {
      return features.map((item) => String(item)).filter(Boolean);
    }
    if (features && typeof features === 'object') {
      return Object.values(features as Record<string, unknown>)
        .map((item) => String(item))
        .filter(Boolean);
    }
    if (typeof features === 'string' && features.trim()) {
      return [features.trim()];
    }
    return [];
  }

  async listForLead(customerId: number, leadId: number) {
    await this.assertLead(customerId, leadId);
    const workflow = await this.prisma.lead.findFirst({
      where: { id: leadId, customerId, deletedAt: null },
      select: { planPreferenceType: true, customerRequirements: true, planPreferenceReady: true, activePlanProposalType: true, planProposalWorkflowAt: true },
    });
    const proposals = await this.prisma.leadPlanProposal.findMany({
      where: { customerId, leadId }, orderBy: [{ version: 'desc' }],
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    return { workflow, proposals };
  }

  async initiateWorkflow(customerId: number, lead: { id: number; title?: string; companyName?: string }) {
    const row = await this.prisma.lead.findFirst({
      where: { id: lead.id, customerId, deletedAt: null },
      select: { planProposalWorkflowAt: true, id: true },
    });
    if (!row) return;
    if (row.planProposalWorkflowAt) return;
    try {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          planProposalWorkflowAt: new Date(),
          planPreferenceReady: false,
        },
      });
    } catch (err: any) {
      this.logger.warn(`[PLAN_PROPOSAL] Workflow init skipped (schema not ready?): ${err?.message || err}`);
      return;
    }
    await this.leadRepository.logTimeline(
      lead.id,
      'PLAN_PROPOSAL_WORKFLOW',
      'Plan proposal workflow started. Capture plan preference and requirements before sending.',
      { trigger: 'STAGE_PROPOSAL' },
    );
  }

  async setPreference(customerId: number, leadId: number, _userId: number, dto: SetPlanPreferenceDto) {
    await this.assertLead(customerId, leadId);
    const requirements = dto.customerRequirements.trim();
    if (!requirements) {
      throw new BadRequestException('Customer requirements are required before proposing a plan.');
    }
    const ready = dto.readyToPropose !== false;
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        planPreferenceType: dto.planPreferenceType,
        customerRequirements: requirements,
        planPreferenceReady: ready,
        activePlanProposalType: dto.planPreferenceType === 'CUSTOM' ? 'CUSTOM' : null,
      },
    });
    await this.leadRepository.logTimeline(leadId, 'PLAN_PREFERENCE_SET', `Plan preference recorded: ${dto.planPreferenceType}`, {
      planPreferenceType: dto.planPreferenceType,
      ready,
    });
    return this.listForLead(customerId, leadId);
  }

  async listForTenant(customerId: number, query: { page?: string; limit?: string; search?: string; type?: string; status?: string; startDate?: string; endDate?: string }) {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const limit = Math.max(1, Math.min(50, Math.floor(Number(query.limit) || 20)));
    if (!Number.isSafeInteger(page)) throw new BadRequestException('Invalid page.');
    const where: Prisma.LeadPlanProposalWhereInput = { customerId };
    if (query.type) where.proposalType = query.type;
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { planName: { contains: search, mode: 'insensitive' } },
        { lead: { companyName: { contains: search, mode: 'insensitive' } } },
        { lead: { firstName: { contains: search, mode: 'insensitive' } } },
        { lead: { lastName: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (query.startDate || query.endDate) {
      const start = query.startDate ? new Date(query.startDate) : undefined;
      const end = query.endDate ? new Date(query.endDate) : undefined;
      if ((start && !Number.isFinite(+start)) || (end && !Number.isFinite(+end))) throw new BadRequestException('Invalid date range.');
      if (end) end.setUTCHours(23, 59, 59, 999);
      if (start && end && start > end) throw new BadRequestException('Invalid date range.');
      where.createdAt = { gte: start, lte: end };
    }
    const [data, total] = await Promise.all([
      this.prisma.leadPlanProposal.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { lead: { select: { companyName: true, firstName: true, lastName: true } }, createdBy: { select: { id: true, firstName: true, lastName: true } } } }),
      this.prisma.leadPlanProposal.count({ where }),
    ]);
    return { data, meta: { page, limit, total } };
  }

  async availablePlans(customerId: number, leadId: number) {
    await this.assertLead(customerId, leadId);
    // Plans are global catalog entries in the current schema; no tenant-specific
    // availability setting exists. Return only active, non-deleted plans.
    return this.prisma.plan.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, description: true, monthlyPrice: true, yearlyPrice: true, features: true },
      orderBy: { name: 'asc' },
    });
  }

  async createStandardDraft(customerId: number, leadId: number, userId: number, dto: CreateStandardPlanProposalDto) {
    const lead = await this.assertLead(customerId, leadId);
    this.assertReadyToSend(lead, 'DEFAULT');
    if (dto.idempotencyKey.length > 128) throw new BadRequestException('Invalid request key.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${leadId} AND "customerId" = ${customerId} FOR UPDATE`;
      const previous = await tx.leadPlanProposal.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (previous) {
        if (previous.customerId !== customerId || previous.leadId !== leadId || previous.planId !== dto.planId || (previous.customConfig as any)?.billingCycle !== dto.billingCycle) {
          throw new BadRequestException('Request key is already in use.');
        }
        return { proposal: previous };
      }
      const plan = await tx.plan.findFirst({ where: { id: dto.planId, isActive: true, deletedAt: null } });
      if (!plan) throw new BadRequestException('Selected plan is not active.');
      const latest = await tx.leadPlanProposal.findFirst({ where: { customerId, leadId }, orderBy: { version: 'desc' }, select: { version: true } });
      const company = await tx.customer.findUnique({ where: { id: customerId }, select: { name: true, companyName: true } });
      const proposal = await tx.leadPlanProposal.create({ data: {
        customerId, leadId, createdById: userId, version: (latest?.version || 0) + 1,
        proposalType: 'DEFAULT', status: 'DRAFT', planId: plan.id, planName: plan.name,
        planPrice: dto.billingCycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice,
        customerRequirements: lead.customerRequirements, idempotencyKey: dto.idempotencyKey,
        customConfig: this.toJson({ features: this.parsePlanFeatures(plan.features), description: plan.description, billingCycle: dto.billingCycle, recipientName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title, issuerName: company?.companyName || company?.name || '' }),
      } });
      return { proposal };
    });
  }

  async pdfForProposal(customerId: number, leadId: number, proposalId: number) {
    const lead = await this.assertLead(customerId, leadId);
    const record = await this.getProposal(customerId, leadId, proposalId);
    const snapshot = this.snapshotFromRecord(record);
    const company = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, companyName: true } });
    const saved = (record.customConfig || {}) as Record<string, unknown>;
    return generatePlanProposalPdfBuffer({
      proposalNo: `PLAN-${leadId}-${record.version}`,
      leadName: typeof saved.recipientName === 'string' ? saved.recipientName : `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title,
      companyName: typeof saved.issuerName === 'string' ? saved.issuerName : company?.companyName || company?.name || '',
      planName: snapshot.planName, planPrice: snapshot.planPrice, proposalType: record.proposalType,
      features: snapshot.features, customerRequirements: record.customerRequirements || undefined,
      discount: record.discount || undefined, validUntil: snapshot.validUntil, terms: snapshot.terms,
      customSummary: snapshot.customSummary,
    });
  }

  async previewDefault(customerId: number, leadId: number) {
    const lead = await this.assertLead(customerId, leadId);
    const plan = await this.resolveDefaultPlan();
    const snapshot = this.buildDefaultSnapshot(plan, lead.customerRequirements);
    return { proposalType: 'DEFAULT', preview: snapshot };
  }

  async previewCustom(customerId: number, leadId: number, config: CustomPlanProposalConfigDto) {
    const lead = await this.assertLead(customerId, leadId);
    return { proposalType: 'CUSTOM', preview: this.buildCustomSnapshot(config, lead.customerRequirements) };
  }

  async sendDefaultPlan(customerId: number, leadId: number, userId: number) {
    const lead = await this.assertLead(customerId, leadId);
    this.assertReadyToSend(lead, 'DEFAULT');
    if (lead.activePlanProposalType === 'CUSTOM') {
      throw new BadRequestException('A customized plan is selected. Send the custom proposal instead of the default package.');
    }
    const plan = await this.resolveDefaultPlan();
    const version = await this.nextVersion(leadId);
    const proposalNo = `PLAN-${leadId}-${version}`;
    const snapshot = this.buildDefaultSnapshot(plan, lead.customerRequirements);
    const record = await this.prisma.leadPlanProposal.create({
      data: {
        customerId,
        leadId,
        version,
        proposalType: 'DEFAULT',
        status: 'DRAFT',
        planId: plan.id,
        planName: snapshot.planName,
        planPrice: snapshot.planPrice,
        currency: 'INR',
        customerRequirements: lead.customerRequirements,
        discount: 0,
        validUntil: snapshot.validUntil ? new Date(snapshot.validUntil) : undefined,
        terms: snapshot.terms,
        customConfig: this.toJson({ features: snapshot.features ?? [] }),
        createdById: userId || null,
        idempotencyKey: `plan-proposal:${leadId}:v${version}:default`,
      },
    });
    return this.deliverProposal(customerId, leadId, userId, record.id, { email: true, whatsapp: true }, snapshot, proposalNo);
  }

  async createCustomProposal(customerId: number, leadId: number, userId: number, dto: CreateCustomPlanProposalDto) {
    const lead = await this.assertLead(customerId, leadId);
    this.assertReadyToSend(lead, 'CUSTOM');
    const version = await this.nextVersion(leadId);
    const snapshot = this.buildCustomSnapshot(dto.config, lead.customerRequirements);
    const record = await this.prisma.leadPlanProposal.create({
      data: {
        customerId,
        leadId,
        version,
        proposalType: 'CUSTOM',
        status: 'DRAFT',
        planName: snapshot.planName,
        planPrice: snapshot.planPrice,
        currency: 'INR',
        customerRequirements: lead.customerRequirements,
        customConfig: this.toJson(snapshot.customConfig ?? {}),
        discount: dto.config.discount || 0,
        validUntil: snapshot.validUntil ? new Date(snapshot.validUntil) : undefined,
        terms: snapshot.terms,
        createdById: userId || null,
        idempotencyKey: `plan-proposal:${leadId}:v${version}:custom`,
      },
    });
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { activePlanProposalType: 'CUSTOM', planPreferenceType: 'CUSTOM' },
    });
    if (dto.sendImmediately === false) {
      return { proposal: record, delivered: false };
    }
    const proposalNo = `PLAN-${leadId}-${version}`;
    return this.deliverProposal(customerId, leadId, userId, record.id, { email: true, whatsapp: true }, snapshot, proposalNo);
  }

  async sendDraft(customerId: number, leadId: number, proposalId: number, userId: number) {
    const record = await this.getProposal(customerId, leadId, proposalId);
    if (record.status === 'SENT' && record.emailStatus === 'SENT' && record.whatsappStatus === 'SENT') {
      throw new BadRequestException('This proposal version was already sent. Use resend to retry failed channels.');
    }
    const snapshot = this.snapshotFromRecord(record);
    const proposalNo = `PLAN-${leadId}-${record.version}`;
    return this.deliverProposal(customerId, leadId, userId, record.id, { email: true, whatsapp: true }, snapshot, proposalNo);
  }

  async resend(customerId: number, leadId: number, proposalId: number, userId: number, dto: ResendPlanProposalDto) {
    const record = await this.getProposal(customerId, leadId, proposalId);
    const snapshot = this.snapshotFromRecord(record);
    const proposalNo = `PLAN-${leadId}-${record.version}`;
    return this.deliverProposal(
      customerId,
      leadId,
      userId,
      record.id,
      { email: dto.email !== false, whatsapp: dto.whatsapp !== false },
      snapshot,
      proposalNo,
      true,
    );
  }

  private async deliverProposal(
    customerId: number,
    leadId: number,
    userId: number,
    proposalId: number,
    channels: { email: boolean; whatsapp: boolean },
    snapshot: PlanProposalSnapshot,
    proposalNo: string,
    isResend = false,
  ) {
    const lead = await this.assertLead(customerId, leadId);
    const record = await this.getProposal(customerId, leadId, proposalId);
    // A retry must never send a channel already accepted by its provider.
    channels = {
      email: channels.email && record.emailStatus !== 'SENT',
      whatsapp: channels.whatsapp && record.whatsappStatus !== 'SENT',
    };
    if (!channels.email && !channels.whatsapp) {
      throw new BadRequestException('No unsent delivery channel selected.');
    }
    if (!channels.email && record.emailStatus === 'PENDING') {
      await this.prisma.leadPlanProposal.updateMany({ where: { id: proposalId, customerId, leadId, emailStatus: 'PENDING' }, data: { emailStatus: 'SKIPPED' } });
    }
    if (!channels.whatsapp && record.whatsappStatus === 'PENDING') {
      await this.prisma.leadPlanProposal.updateMany({ where: { id: proposalId, customerId, leadId, whatsappStatus: 'PENDING' }, data: { whatsappStatus: 'SKIPPED' } });
    }
    const company = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, companyName: true } });
    const companyName = company?.companyName || company?.name || 'QUIKBOOM';

    const leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title || 'Valued Customer';
    const pdfBuffer = await this.pdfForProposal(customerId, leadId, proposalId);

    let emailStatus = record.emailStatus;
    let emailMessageId = record.emailMessageId;
    let emailError = record.emailError;
    let emailSentAt = record.emailSentAt;
    let whatsappStatus = record.whatsappStatus;
    let whatsappMessageId = record.whatsappMessageId;
    let whatsappError = record.whatsappError;
    let whatsappSentAt = record.whatsappSentAt;

    const htmlBody = this.buildEmailHtml({
      leadName,
      companyName,
      snapshot,
      requirements: record.customerRequirements,
    });

    if (channels.email) {
      const claim = await this.prisma.leadPlanProposal.updateMany({ where: { id: proposalId, customerId, leadId, emailStatus: { in: ['PENDING', 'FAILED', 'SKIPPED'] } }, data: { emailStatus: 'PROCESSING' } });
      if (!claim.count) throw new BadRequestException('Email delivery is already in progress or has been sent.');
      const recipient = (lead.email || '').trim();
      if (!recipient) {
        emailStatus = 'FAILED';
        emailError = 'Lead email address is missing.';
      } else {
        try {
          const tpl = await this.prisma.emailTemplate.findFirst({
            where: { key: 'QUIKBOOM_PROPOSAL_SENT', deletedAt: null, isActive: true },
          }).catch(() => null);
          const subject = tpl?.subject?.replace(/\{\{\s*leadTitle\s*\}\}/g, leadName) || `Your Plan Proposal from ${companyName}`;
          const res = await this.emailService.sendEmail(
            {
              to: recipient,
              subject,
              html: htmlBody,
              attachments: [{ filename: `${proposalNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
            },
            { customerId, id: userId },
          );
          emailStatus = res?.messageId ? 'SENT' : 'FAILED';
          emailMessageId = res?.messageId || null;
          emailError = res?.messageId ? null : 'Email provider did not confirm delivery.';
          emailSentAt = res?.messageId ? new Date() : null;
        } catch (err: any) {
          emailStatus = 'FAILED';
          emailError = err?.message || 'Email delivery failed';
        }
      }
    }

    if (channels.email) {
      await this.prisma.leadPlanProposal.update({ where: { id: proposalId }, data: { emailStatus, emailMessageId, emailError, emailSentAt } });
    }
    if (channels.whatsapp) {
      const claim = await this.prisma.leadPlanProposal.updateMany({ where: { id: proposalId, customerId, leadId, whatsappStatus: { in: ['PENDING', 'FAILED', 'SKIPPED'] } }, data: { whatsappStatus: 'PROCESSING' } });
      if (!claim.count) throw new BadRequestException('WhatsApp delivery is already in progress or has been sent.');
      const phone = (lead.phone || '').trim();
      if (!phone) {
        whatsappStatus = 'FAILED';
        whatsappError = 'Lead phone number is missing.';
      } else {
        try {
          const summary = `${snapshot.planName} – INR ${Number(snapshot.planPrice || 0).toLocaleString('en-IN')}`;
          const customMessage = `Hi ${leadName}, your ${record.proposalType === 'CUSTOM' ? 'customized' : 'standard'} plan proposal (${summary}) from ${companyName} is ready. Please check your email for the detailed PDF. Reply here if you have questions.`;
          const wa = record.whatsappMessageId && record.whatsappStatus === 'FAILED'
            ? { success: true, messageId: record.whatsappMessageId, message: undefined, details: undefined }
            : await this.whatsappService.sendLeadStageMessage({
            to: phone,
            stageKey: 'PROPOSAL',
            variables: {
              leadName,
              leadTitle: lead.title || leadName,
              companyName,
              userName: companyName,
            },
            customMessage,
            customerId,
            userId,
          });
          whatsappStatus = wa.success ? 'SENT' : 'FAILED';
          whatsappMessageId = wa.messageId || null;
          whatsappError = wa.success ? null : wa.message || wa.details || 'WhatsApp delivery failed';
          whatsappSentAt = wa.success ? new Date() : null;
          if (wa.success && pdfBuffer?.length) {
            const document = await this.whatsappService.sendDocumentMessage({
              to: phone, pdfBuffer, filename: `${proposalNo}.pdf`,
              caption: `${snapshot.planName} proposal`, requireDocument: true,
            });
            if (!document.success || !document.messageId) {
              whatsappStatus = 'FAILED';
              whatsappError = document.error || document.message || document.reason || 'WhatsApp document delivery failed';
              whatsappSentAt = null;
            } else {
              whatsappMessageId = document.messageId;
            }
          }
        } catch (err: any) {
          whatsappStatus = 'FAILED';
          whatsappError = err?.message || 'WhatsApp delivery failed';
        }
      }
    }

    if (channels.whatsapp) {
      await this.prisma.leadPlanProposal.update({ where: { id: proposalId }, data: { whatsappStatus, whatsappMessageId, whatsappError, whatsappSentAt } });
    }
    // Reload channel results so concurrent requests cannot overwrite each other.
    const actual = await this.getProposal(customerId, leadId, proposalId);
    emailStatus = actual.emailStatus;
    whatsappStatus = actual.whatsappStatus;
    const overall = (emailStatus === 'SENT' || whatsappStatus === 'SENT') && ['SENT', 'SKIPPED'].includes(emailStatus) && ['SENT', 'SKIPPED'].includes(whatsappStatus) ? 'SENT'
      : emailStatus === 'SENT' || whatsappStatus === 'SENT' ? 'PARTIAL' : 'FAILED';
    const updated = await this.prisma.leadPlanProposal.update({
      where: { id: proposalId },
      data: {
        status: overall === 'FAILED' ? actual.status : overall,
        sentAt: overall === 'SENT' || overall === 'PARTIAL' ? actual.sentAt ?? new Date() : actual.sentAt,
        ...(isResend ? { retryCount: { increment: 1 } } : {}),
      },
    });

    await this.leadRepository.logTimeline(
      leadId,
      'PLAN_PROPOSAL_SENT',
      `Plan proposal v${record.version} (${record.proposalType}) delivery: email=${emailStatus}, whatsapp=${whatsappStatus}`,
      { proposalId, version: record.version, emailStatus, whatsappStatus, isResend },
    );

    return { proposal: updated, emailStatus, whatsappStatus, overall };
  }

  private buildEmailHtml(params: {
    leadName: string;
    companyName: string;
    snapshot: PlanProposalSnapshot;
    requirements?: string | null;
  }) {
    const { leadName, companyName, snapshot, requirements } = params;
    const features = (snapshot.features || []) as string[];
    const featureHtml = features.length
      ? `<ul style="padding-left:18px;margin:12px 0;">${features.map((f) => `<li style="margin-bottom:6px;">${f}</li>`).join('')}</ul>`
      : snapshot.customSummary
        ? `<p style="font-size:14px;color:#334155;">${snapshot.customSummary}</p>`
        : '';
    return `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;padding:24px;">
        <h2 style="color:#163A2E;margin:0 0 12px 0;">Your Plan Proposal</h2>
        <p>Dear <strong>${leadName}</strong>,</p>
        <p>Thank you for sharing your requirements. Please find below our recommended <strong>${snapshot.planName}</strong> package.</p>
        ${requirements ? `<p style="background:#f8fafc;border-left:4px solid #23C45E;padding:12px 16px;font-size:14px;color:#334155;"><strong>Your requirements:</strong><br/>${requirements}</p>` : ''}
        <p style="font-size:16px;font-weight:700;color:#163A2E;">Investment: INR ${Number(snapshot.planPrice || 0).toLocaleString('en-IN')}</p>
        ${featureHtml}
        <p style="font-size:14px;color:#475569;">The detailed proposal PDF is attached. Reply to this email or message us on WhatsApp for clarifications.</p>
        <p style="margin-top:24px;">Regards,<br/><strong>${companyName}</strong></p>
      </div>`;
  }

  private snapshotFromRecord(record: LeadPlanProposal): PlanProposalSnapshot {
    const cfg = (record.customConfig || {}) as Record<string, any>;
    if (record.proposalType === 'CUSTOM') {
      return this.buildCustomSnapshot(
        {
          planName: record.planName,
          customPrice: Number(record.planPrice || 0) + Number(record.discount || 0),
          discount: record.discount,
          modules: cfg.modules,
          userLimit: cfg.userLimit,
          whatsappLimit: cfg.whatsappLimit,
          emailLimit: cfg.emailLimit,
          additionalServices: cfg.additionalServices,
          validUntil: record.validUntil ? new Date(record.validUntil).toISOString().slice(0, 10) : undefined,
          terms: record.terms,
        } as CustomPlanProposalConfigDto,
        record.customerRequirements,
      );
    }
    return {
      planName: record.planName,
      planPrice: record.planPrice,
      features: cfg.features || [],
      validUntil: record.validUntil ? new Date(record.validUntil).toISOString().slice(0, 10) : undefined,
      terms: record.terms,
    };
  }

  private buildDefaultSnapshot(plan: { id: number; name: string; monthlyPrice: number; features: unknown }, requirements?: string | null): PlanProposalSnapshot {
    const features = this.parsePlanFeatures(plan.features);
    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return {
      planId: plan.id,
      planName: plan.name,
      planPrice: plan.monthlyPrice,
      features,
      requirements,
      validUntil,
      terms: 'Pricing is exclusive of applicable taxes. Meta & Google ad spends are billed separately unless noted in the plan features.',
    };
  }

  private buildCustomSnapshot(config: CustomPlanProposalConfigDto, requirements?: string | null): PlanProposalSnapshot {
    const discount = Number(config.discount || 0);
    const price = Math.max(0, Number(config.customPrice) - discount);
    const modules = config.modules || [];
    const services = config.additionalServices || [];
    const customSummary = [
      modules.length ? `Modules: ${modules.join(', ')}` : null,
      config.userLimit ? `Users: ${config.userLimit}` : null,
      config.whatsappLimit ? `WhatsApp limit: ${config.whatsappLimit}/month` : null,
      config.emailLimit ? `Email limit: ${config.emailLimit}/month` : null,
      services.length ? `Add-ons: ${services.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' • ');
    return {
      planName: config.planName,
      planPrice: price,
      validUntil: config.validUntil,
      terms: config.terms,
      customSummary,
      customConfig: {
        modules: config.modules,
        userLimit: config.userLimit,
        whatsappLimit: config.whatsappLimit,
        emailLimit: config.emailLimit,
        additionalServices: config.additionalServices,
      },
      requirements,
    };
  }

  private async resolveDefaultPlan() {
    const plan =
      (await this.prisma.plan.findFirst({ where: { code: DEFAULT_PLAN_CODE, deletedAt: null, isActive: true } })) ||
      (await this.prisma.plan.findFirst({ where: { deletedAt: null, isActive: true }, orderBy: { monthlyPrice: 'asc' } }));
    if (!plan) throw new BadRequestException('No active default plan is configured in the system.');
    return plan;
  }

  private async nextVersion(leadId: number) {
    const latest = await this.prisma.leadPlanProposal.findFirst({
      where: { leadId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version || 0) + 1;
  }

  private toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private assertReadyToSend(lead: Pick<PlanProposalLeadContext, 'planPreferenceReady' | 'customerRequirements' | 'planPreferenceType'>, mode: 'DEFAULT' | 'CUSTOM') {
    if (!lead.planPreferenceReady) {
      throw new BadRequestException('Record the customer plan preference and requirements before sending a proposal.');
    }
    if (!String(lead.customerRequirements || '').trim()) {
      throw new BadRequestException('Customer requirements must be documented before sending a proposal.');
    }
    if (mode === 'DEFAULT' && lead.planPreferenceType === 'CUSTOM') {
      throw new BadRequestException('Customer requested a customized plan. Create and send a custom proposal.');
    }
  }

  private async assertLead(customerId: number, leadId: number): Promise<PlanProposalLeadContext> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, customerId, deletedAt: null },
      select: {
        id: true,
        customerId: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        title: true,
        customerRequirements: true,
        planPreferenceReady: true,
        planPreferenceType: true,
        activePlanProposalType: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  private async getProposal(customerId: number, leadId: number, proposalId: number) {
    const record = await this.prisma.leadPlanProposal.findFirst({ where: { id: proposalId, customerId, leadId } });
    if (!record) throw new NotFoundException('Plan proposal not found');
    return record;
  }

  isProposalStageToken(stageKey?: string | null, status?: string | null): boolean {
    const token = normalizeStageToken(stageKey || status || '');
    return token === 'PROPOSAL' || token === 'PROPOSAL_SENT';
  }
}
