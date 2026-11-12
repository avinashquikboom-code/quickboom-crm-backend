import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { LeadStatus, Prisma } from '@prisma/client';
import { CreateWhatsAppCampaignDto, QueryWhatsAppCampaignDto } from './dto/whatsapp-campaign.dto';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function isLeadStatus(value: string): value is LeadStatus {
  return Object.values(LeadStatus).some((status) => status === value);
}

@Injectable()
export class WhatsAppCampaignService {
  private readonly logger = new Logger(WhatsAppCampaignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
  ) {}

  private requireCustomerId(customerId?: number | string | null): number {
    const parsed = customerId !== undefined && customerId !== null ? Number(customerId) : NaN;
    if (!parsed || Number.isNaN(parsed)) {
      throw new ForbiddenException('Tenant context is required for WhatsApp campaigns.');
    }
    return parsed;
  }

  async getStats(customerId?: number | string | null) {
    const cid = this.requireCustomerId(customerId);
    const base = { customerId: cid };
    const [total, draft, scheduled, running, completed, failed] = await Promise.all([
      this.prisma.whatsAppCampaign.count({ where: base }),
      this.prisma.whatsAppCampaign.count({ where: { ...base, status: 'DRAFT' } }),
      this.prisma.whatsAppCampaign.count({ where: { ...base, status: 'SCHEDULED' } }),
      this.prisma.whatsAppCampaign.count({ where: { ...base, status: 'RUNNING' } }),
      this.prisma.whatsAppCampaign.count({ where: { ...base, status: 'COMPLETED' } }),
      this.prisma.whatsAppCampaign.count({ where: { ...base, status: 'FAILED' } }),
    ]);
    return { total, draft, scheduled, running, completed, failed };
  }

  async findAll(customerId: number | string | null | undefined, query: QueryWhatsAppCampaignDto) {
    const cid = this.requireCustomerId(customerId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const where: any = { customerId: cid };
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [{ name: { contains: s, mode: 'insensitive' } }];
    }
    const [items, total] = await Promise.all([
      this.prisma.whatsAppCampaign.findMany({
        where,
        include: { metaTemplate: { select: { id: true, name: true, templateName: true, status: true, category: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.whatsAppCampaign.count({ where }),
    ]);
    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
      stats: await this.getStats(cid),
    };
  }

  async findOne(id: number, customerId?: number | string | null) {
    const cid = this.requireCustomerId(customerId);
    const row = await this.prisma.whatsAppCampaign.findFirst({
      where: { id, customerId: cid },
      include: {
        metaTemplate: true,
        recipients: { orderBy: { id: 'asc' }, take: 500 },
      },
    });
    if (!row) throw new NotFoundException(`WhatsApp campaign #${id} not found.`);
    return row;
  }

  async create(dto: CreateWhatsAppCampaignDto, customerId: number | string | null | undefined, createdById?: number) {
    const cid = this.requireCustomerId(customerId);
    const template = await this.prisma.metaTemplate.findFirst({
      where: {
        id: dto.metaTemplateId,
        deletedAt: null,
        OR: [{ customerId: null }, { customerId: cid }],
      },
    });
    if (!template) throw new NotFoundException('Selected template was not found.');
    if (template.status !== 'APPROVED') {
      throw new BadRequestException(
        `Only APPROVED Meta templates can be used in campaigns. This template is "${template.status}".`,
      );
    }
    if (!template.isLocalActive) {
      throw new BadRequestException('This template is deactivated locally and cannot be used.');
    }

    const phones = await this.resolveAudiencePhones(cid, dto);
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const status = scheduledAt && scheduledAt.getTime() > Date.now() ? 'SCHEDULED' : 'DRAFT';

    const campaign = await this.prisma.whatsAppCampaign.create({
      data: {
        customerId: cid,
        name: dto.name.trim(),
        status,
        metaTemplateId: template.id,
        variableMapping: dto.variableMapping || {},
        audienceType: dto.audienceType || 'LEAD_FILTER',
        audienceFilter: dto.audienceFilter || {},
        manualRecipients: dto.manualRecipients || [],
        recipientCount: phones.length,
        scheduledAt,
        createdById: createdById || null,
        recipients: {
          create: phones.map((phone) => ({
            phone,
            status: 'PENDING',
          })),
        },
      },
      include: { metaTemplate: true },
    });

    return campaign;
  }

  async launch(id: number, customerId: number | string | null | undefined) {
    const cid = this.requireCustomerId(customerId);
    const campaign = await this.findOne(id, cid);
    if (TERMINAL.has(campaign.status)) {
      throw new BadRequestException(`Campaign is already ${campaign.status}.`);
    }
    if (campaign.status === 'RUNNING') {
      throw new BadRequestException('Campaign is already running.');
    }
    const template = campaign.metaTemplate;
    if (!template || template.status !== 'APPROVED') {
      throw new BadRequestException('Campaign template is not approved on Meta.');
    }

    await this.prisma.whatsAppCampaign.update({
      where: { id: campaign.id },
      data: { status: 'RUNNING', startedAt: new Date(), lastError: null },
    });

    const mapping = (campaign.variableMapping as Record<string, string>) || {};
    const orderedKeys = Array.isArray(template.variables) && template.variables.length
      ? template.variables
      : Object.keys(mapping);
    const parameters = orderedKeys.map((key) => ({
      type: 'text' as const,
      text: String(mapping[key] ?? mapping[String(key)] ?? ''),
    }));
    const recipients = await this.prisma.whatsAppCampaignRecipient.findMany({
      where: { campaignId: campaign.id, status: 'PENDING' },
      take: 200,
    });

    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      try {
        const result = await this.whatsappService.sendTemplate(
          recipient.phone,
          template.templateName,
          parameters,
          template.language || 'en_US',
          template.body,
        );
        if (result?.success) {
          sent++;
          await this.prisma.whatsAppCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status: 'SENT',
              messageId: result.messageId || null,
              sentAt: new Date(),
            },
          });
        } else {
          failed++;
          await this.prisma.whatsAppCampaignRecipient.update({
            where: { id: recipient.id },
            data: { status: 'FAILED', error: result?.error || 'Send failed' },
          });
        }
      } catch (err: any) {
        failed++;
        await this.prisma.whatsAppCampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'FAILED', error: err?.message || 'Send failed' },
        });
      }
    }

    const finalStatus = failed > 0 && sent === 0 ? 'FAILED' : 'COMPLETED';
    const updated = await this.prisma.whatsAppCampaign.update({
      where: { id: campaign.id },
      data: {
        status: finalStatus,
        sentCount: { increment: sent },
        failedCount: { increment: failed },
        completedAt: new Date(),
      },
    });

    this.logger.log(`[WhatsAppCampaign] campaignId=${id} sent=${sent} failed=${failed}`);
    return { campaign: updated, sent, failed };
  }

  async cancel(id: number, customerId?: number | string | null) {
    const cid = this.requireCustomerId(customerId);
    const campaign = await this.findOne(id, cid);
    if (TERMINAL.has(campaign.status)) {
      throw new BadRequestException(`Cannot cancel a ${campaign.status} campaign.`);
    }
    return this.prisma.whatsAppCampaign.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }

  private async resolveAudiencePhones(customerId: number, dto: CreateWhatsAppCampaignDto): Promise<string[]> {
    if (dto.audienceType === 'MANUAL' && Array.isArray(dto.manualRecipients)) {
      const out = new Set<string>();
      for (const raw of dto.manualRecipients) {
        const normalized = this.whatsappService.normalizePhoneNumber(raw);
        if (normalized) out.add(normalized);
      }
      if (!out.size) throw new BadRequestException('No valid recipient phone numbers were provided.');
      return [...out];
    }

    const filter = dto.audienceFilter || {};
    const rawStatus = filter.status ? String(filter.status).trim().toUpperCase() : undefined;
    let status: LeadStatus | undefined;
    if (rawStatus) {
      if (!isLeadStatus(rawStatus)) {
        throw new BadRequestException(`Unsupported lead status: ${rawStatus}`);
      }
      status = rawStatus;
    }
    const where: Prisma.LeadWhereInput = {
      customerId,
      deletedAt: null,
      phone: { not: null },
      ...(status ? { status } : {}),
      ...(filter.stageId ? { stageId: Number(filter.stageId) } : {}),
    };
    const leads = await this.prisma.lead.findMany({
      where,
      select: { phone: true },
      take: 500,
    });

    const phones = new Set<string>();
    for (const lead of leads) {
      const normalized = this.whatsappService.normalizePhoneNumber(lead.phone || '');
      if (normalized) phones.add(normalized);
    }
    if (!phones.size) throw new BadRequestException('No leads with valid phone numbers match this audience.');
    return [...phones];
  }
}
