import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LeadPlanProposal, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadRepository } from './lead.repository';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  CreateCustomPlanProposalDto,
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
    let workflow: PlanProposalWorkflowState | null = null;
    let proposals: LeadPlanProposal[] = [];
    try {
      workflow = await this.prisma.lead.findFirst({
        where: { id: leadId, customerId, deletedAt: null },
        select: {
          planPreferenceType: true,
          customerRequirements: true,
          planPreferenceReady: true,
          activePlanProposalType: true,
          planProposalWorkflowAt: true,
        },
      });
    } catch (err: any) {
      this.logger.warn(`[PLAN_PROPOSAL] Workflow fields unavailable: ${err?.message || err}`);
      workflow = {
        planPreferenceType: null,
        customerRequirements: null,
        planPreferenceReady: false,
        activePlanProposalType: null,
        planProposalWorkflowAt: null,
      };
    }
    try {
      proposals = await this.prisma.leadPlanProposal.findMany({
        where: { customerId, leadId },
        orderBy: [{ version: 'desc' }],
      });
    } catch (err: any) {
      this.logger.warn(`[PLAN_PROPOSAL] History unavailable: ${err?.message || err}`);
      proposals = [];
    }
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
    const company = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, companyName: true } });
    const companyName = company?.companyName || company?.name || 'QUIKBOOM';

    const leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.title || 'Valued Customer';
    const pdfBuffer = await generatePlanProposalPdfBuffer({
      proposalNo,
      leadName,
      companyName,
      planName: snapshot.planName,
      planPrice: snapshot.planPrice,
      proposalType: record.proposalType,
      features: snapshot.features,
      customerRequirements: lead.customerRequirements || undefined,
      discount: record.discount || undefined,
      validUntil: snapshot.validUntil,
      terms: snapshot.terms,
      customSummary: snapshot.customSummary,
    });

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
      requirements: lead.customerRequirements,
    });

    if (channels.email) {
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

    if (channels.whatsapp) {
      const phone = (lead.phone || '').trim();
      if (!phone) {
        whatsappStatus = 'FAILED';
        whatsappError = 'Lead phone number is missing.';
      } else {
        try {
          const summary = `${snapshot.planName} – INR ${Number(snapshot.planPrice || 0).toLocaleString('en-IN')}`;
          const customMessage = `Hi ${leadName}, your ${record.proposalType === 'CUSTOM' ? 'customized' : 'standard'} plan proposal (${summary}) from ${companyName} is ready. Please check your email for the detailed PDF. Reply here if you have questions.`;
          const wa = await this.whatsappService.sendLeadStageMessage({
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
            await this.whatsappService.sendDocumentMessage({
              to: phone,
              pdfBuffer,
              filename: `${proposalNo}.pdf`,
              caption: `${snapshot.planName} proposal`,
            }).catch((docErr) => {
              this.logger.warn(`[PLAN_PROPOSAL] WhatsApp document follow-up failed: ${docErr?.message}`);
            });
          }
        } catch (err: any) {
          whatsappStatus = 'FAILED';
          whatsappError = err?.message || 'WhatsApp delivery failed';
        }
      }
    }

    const overall =
      emailStatus === 'SENT' && whatsappStatus === 'SENT'
        ? 'SENT'
        : emailStatus === 'SENT' || whatsappStatus === 'SENT'
          ? 'PARTIAL'
          : 'FAILED';

    const updated = await this.prisma.leadPlanProposal.update({
      where: { id: proposalId },
      data: {
        status: overall === 'FAILED' ? record.status : overall,
        emailStatus,
        emailMessageId,
        emailError,
        emailSentAt,
        whatsappStatus,
        whatsappMessageId,
        whatsappError,
        whatsappSentAt,
        sentAt: overall === 'SENT' || overall === 'PARTIAL' ? new Date() : record.sentAt,
        retryCount: isResend ? { increment: 1 } : record.retryCount,
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
