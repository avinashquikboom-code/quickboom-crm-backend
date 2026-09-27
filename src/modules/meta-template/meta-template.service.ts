import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import {
  CreateMetaTemplateDto,
  UpdateMetaTemplateDto,
  QueryMetaTemplateDto,
  PreviewMetaTemplateDto,
  TestSendMetaTemplateDto,
} from './dto/meta-template.dto';
import { LEAD_STAGE_WHATSAPP_TEMPLATES, WhatsappService } from '../whatsapp/whatsapp.service';
import { resolveCleanAccessToken } from '../whatsapp/whatsapp.util';

export const CRM_META_TEMPLATE_VARIABLES = [
  { key: 'leadName', label: '{{leadName}}', desc: 'Lead full name / contact title' },
  { key: 'leadTitle', label: '{{leadTitle}}', desc: 'Lead inquiry / company or business name' },
  { key: 'companyName', label: '{{companyName}}', desc: 'Your company / organization name' },
  { key: 'userName', label: '{{userName}}', desc: 'Assigned employee / telecaller name' },
  { key: 'assignedUser', label: '{{assignedUser}}', desc: 'Assigned representative name' },
  { key: 'assignedEmployeeName', label: '{{assignedEmployeeName}}', desc: 'Full name of assigned employee' },
  { key: 'assignedEmployeePhone', label: '{{assignedEmployeePhone}}', desc: 'Direct phone number of assigned employee' },
  { key: 'assignedEmployeeEmail', label: '{{assignedEmployeeEmail}}', desc: 'Email address of assigned employee' },
  { key: 'stage', label: '{{stage}}', desc: 'Current lead pipeline stage name' },
  { key: 'startDate', label: '{{startDate}}', desc: 'Scheduled follow-up / visit date' },
  { key: 'startTime', label: '{{startTime}}', desc: 'Scheduled follow-up / visit time' },
  { key: 'leadPhone', label: '{{leadPhone}}', desc: 'Lead phone number' },
  { key: 'leadEmail', label: '{{leadEmail}}', desc: 'Lead email address' },
];

@Injectable()
export class MetaTemplateService {
  private readonly logger = new Logger(MetaTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSettingsService: IntegrationSettingsService,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Automatically extracts {{variable}} placeholders from body or header content.
   */
  private extractVariables(text: string): string[] {
    if (!text) return [];
    const matches = text.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
    if (!matches) return [];
    return Array.from(new Set(matches.map((m) => m.replace(/[\{\}\s]/g, ''))));
  }

  /**
   * Auto-seeds standard CRM stage templates from LEAD_STAGE_WHATSAPP_TEMPLATES if none exist.
   */
  async ensureDefaultTemplates(customerId?: number | null) {
    try {
      const count = await this.prisma.metaTemplate.count({
        where: { deletedAt: null },
      });
      if (count > 0) return;

      const entries = Object.entries(LEAD_STAGE_WHATSAPP_TEMPLATES);
      for (const [stageKey, tpl] of entries) {
        const vars = this.extractVariables(tpl.body);
        await this.prisma.metaTemplate.create({
          data: {
            customerId: customerId ? Number(customerId) : null,
            name: `${tpl.name} WhatsApp`,
            templateName: tpl.templateName,
            key: stageKey,
            language: 'en_US',
            category: 'UTILITY',
            status: 'APPROVED',
            metaTemplateId: `seed_${tpl.templateName}`,
            headerType: 'NONE',
            body: tpl.body,
            footer: 'Sent via QUIKBOOM CRM',
            variables: vars,
            isLocalActive: true,
            isSystem: true,
          },
        }).catch(() => null);
      }
      this.logger.log(`[MetaTemplateService] Seeded ${entries.length} default CRM stage Meta templates.`);
    } catch (err: any) {
      this.logger.warn(`[MetaTemplateService] Default template seeding warning: ${err?.message}`);
    }
  }

  /**
   * Retrieves all Meta templates with multi-tenant filtering, search, and pagination.
   */
  async findAll(customerId: number | string | undefined, query: QueryMetaTemplateDto) {
    const parsedCustId = customerId !== undefined && customerId !== null ? Number(customerId) : null;
    await this.ensureDefaultTemplates(parsedCustId);

    const where: any = {
      deletedAt: null,
      OR: [
        { customerId: null },
        ...(parsedCustId ? [{ customerId: parsedCustId }] : []),
      ],
    };

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.AND = [
        {
          OR: [
            { name: { contains: s, mode: 'insensitive' } },
            { templateName: { contains: s, mode: 'insensitive' } },
            { key: { contains: s, mode: 'insensitive' } },
            { body: { contains: s, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (query.category && query.category !== 'ALL') {
      where.category = query.category.toUpperCase();
    }

    const effectiveStatus = query.status || query.metaStatus;
    if (effectiveStatus && effectiveStatus !== 'ALL') {
      where.status = effectiveStatus.toUpperCase();
    }

    if (query.language && query.language !== 'ALL') {
      where.language = query.language;
    }

    const effectiveActive = query.isLocalActive !== undefined && query.isLocalActive !== null && query.isLocalActive !== ''
      ? query.isLocalActive
      : query.isActive;
    if (effectiveActive && effectiveActive !== 'ALL') {
      where.isLocalActive = String(effectiveActive) === 'true';
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const skip =
      query.offset !== undefined && !isNaN(Number(query.offset)) && Number(query.offset) >= 0
        ? Number(query.offset)
        : (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.metaTemplate.findMany({
        where,
        orderBy: [{ isSystem: 'asc' }, { updatedAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.metaTemplate.count({ where }),
    ]);

    // Statistics across all accessible non-deleted templates
    const baseStatsWhere: any = {
      deletedAt: null,
      OR: [
        { customerId: null },
        ...(parsedCustId ? [{ customerId: parsedCustId }] : []),
      ],
    };

    const [totalAll, totalActive, totalApproved, totalPending, totalRejected] = await Promise.all([
      this.prisma.metaTemplate.count({ where: baseStatsWhere }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, isLocalActive: true } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'APPROVED' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'PENDING' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'REJECTED' } }),
    ]);

    const formattedItems = items.map((t) => ({
      ...t,
      displayName: t.name,
      metaStatus: t.status,
      bodyText: t.body,
      footerText: t.footer,
      isActive: t.isLocalActive,
    }));

    return {
      items: formattedItems,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        total: totalAll,
        active: totalActive,
        approved: totalApproved,
        pending: totalPending,
        rejected: totalRejected,
      },
    };
  }

  /**
   * Retrieves aggregated statistics for Meta templates for the tenant/company.
   */
  async getStats(customerId?: number | string | null) {
    const parsedCustId = customerId !== undefined && customerId !== null ? Number(customerId) : null;
    await this.ensureDefaultTemplates(parsedCustId);

    const baseStatsWhere: any = {
      deletedAt: null,
      OR: [
        { customerId: null },
        ...(parsedCustId ? [{ customerId: parsedCustId }] : []),
      ],
    };

    const [totalAll, totalActive, totalApproved, totalPending, totalRejected] = await Promise.all([
      this.prisma.metaTemplate.count({ where: baseStatsWhere }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, isLocalActive: true } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'APPROVED' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'PENDING' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'REJECTED' } }),
    ]);

    const stats = {
      total: totalAll,
      active: totalActive,
      approved: totalApproved,
      pending: totalPending,
      rejected: totalRejected,
      inactive: Math.max(0, totalAll - totalActive),
    };

    return {
      success: true,
      data: stats,
      ...stats,
    };
  }


  /**
   * Retrieves single Meta template by ID.
   */
  async findOne(id: number, customerId?: number | string | null) {
    const parsedCustId = customerId !== undefined && customerId !== null ? Number(customerId) : null;
    const item = await this.prisma.metaTemplate.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [
          { customerId: null },
          ...(parsedCustId ? [{ customerId: parsedCustId }] : []),
        ],
      },
    });

    if (!item) {
      throw new NotFoundException(`Meta template #${id} not found.`);
    }

    return {
      ...item,
      displayName: item.name,
      metaStatus: item.status,
      bodyText: item.body,
      footerText: item.footer,
      isActive: item.isLocalActive,
    };
  }

  /**
   * Creates a new Meta template.
   */
  async create(dto: CreateMetaTemplateDto, customerId?: number | string | null) {
    const parsedCustId = customerId !== undefined && customerId !== null ? Number(customerId) : null;
    const effectiveName = dto.name.trim();
    if (!effectiveName) {
      throw new BadRequestException('Template display name is required.');
    }

    const rawBody = dto.body.trim();
    if (!rawBody) {
      throw new BadRequestException('Template message body is required.');
    }

    const bodyVars = this.extractVariables(rawBody);
    const headerVars = dto.headerContent ? this.extractVariables(dto.headerContent) : [];
    const variables = Array.from(new Set([...(dto.variables || []), ...bodyVars, ...headerVars]));

    let rawTemplateName = (dto.templateName || dto.name || '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');

    if (!rawTemplateName) {
      throw new BadRequestException('Template name must contain valid alphanumeric characters or underscores.');
    }

    // Check duplicate
    const existing = await this.prisma.metaTemplate.findFirst({
      where: {
        templateName: rawTemplateName,
        language: dto.language || 'en_US',
        deletedAt: null,
        OR: [
          { customerId: null },
          ...(parsedCustId ? [{ customerId: parsedCustId }] : []),
        ],
      },
    });

    if (existing) {
      throw new BadRequestException(`A Meta template with name "${rawTemplateName}" already exists for language "${dto.language || 'en_US'}".`);
    }

    const effectiveIsLocalActive =
      dto.isLocalActive !== undefined
        ? dto.isLocalActive
        : true;

    return this.prisma.metaTemplate.create({
      data: {
        customerId: parsedCustId,
        name: effectiveName,
        templateName: rawTemplateName,
        key: dto.key ? dto.key.trim().toUpperCase().replace(/[\s-]+/g, '_') : null,
        language: dto.language || 'en_US',
        category: (dto.category || 'UTILITY').toUpperCase(),
        status: (dto.status || 'APPROVED').toUpperCase(),
        metaTemplateId: dto.metaTemplateId || null,
        headerType: dto.headerType || 'NONE',
        headerContent: dto.headerContent || null,
        body: rawBody,
        footer: dto.footer?.trim() || null,
        buttons: dto.buttons || null,
        variables,
        isLocalActive: effectiveIsLocalActive,
        isSystem: false,
      },
    });
  }

  /**
   * Updates an existing Meta template.
   */
  async update(id: number, dto: UpdateMetaTemplateDto, customerId?: number | string | null) {
    const item = await this.findOne(id, customerId);

    const effectiveName = dto.name !== undefined ? dto.name.trim() : item.name;
    const bodyToUse = dto.body !== undefined ? dto.body : item.body;
    const headerToUse = dto.headerContent !== undefined ? dto.headerContent : item.headerContent;
    const bodyVars = this.extractVariables(bodyToUse);
    const headerVars = headerToUse ? this.extractVariables(headerToUse) : [];
    const variables = Array.from(new Set([...(dto.variables || item.variables || []), ...bodyVars, ...headerVars]));

    let templateName = item.templateName;
    if (dto.templateName) {
      templateName = dto.templateName
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
    }

    const effectiveIsLocalActive =
      dto.isLocalActive !== undefined
        ? dto.isLocalActive
        : item.isLocalActive;

    const effectiveFooter =
      dto.footer !== undefined
        ? (dto.footer ? dto.footer.trim() : null)
        : item.footer;

    return this.prisma.metaTemplate.update({
      where: { id: item.id },
      data: {
        name: effectiveName,
        templateName,
        key: dto.key !== undefined ? (dto.key ? dto.key.trim().toUpperCase().replace(/[\s-]+/g, '_') : null) : item.key,
        language: dto.language !== undefined ? dto.language : item.language,
        category: dto.category !== undefined ? dto.category.toUpperCase() : item.category,
        status: dto.status !== undefined ? dto.status.toUpperCase() : item.status,
        metaTemplateId: dto.metaTemplateId !== undefined ? dto.metaTemplateId : item.metaTemplateId,
        headerType: dto.headerType !== undefined ? dto.headerType : item.headerType,
        headerContent: dto.headerContent !== undefined ? dto.headerContent : item.headerContent,
        body: bodyToUse.trim(),
        footer: effectiveFooter,
        buttons: dto.buttons !== undefined ? dto.buttons : (item.buttons as any),
        variables,
        isLocalActive: effectiveIsLocalActive,
      },
    });
  }

  /**
   * Toggles local active status.
   */
  async toggleActive(id: number, customerId?: number | string | null) {
    const item = await this.findOne(id, customerId);
    return this.prisma.metaTemplate.update({
      where: { id: item.id },
      data: { isLocalActive: !item.isLocalActive },
    });
  }

  /**
   * Deletes a Meta template with delete protection if in active use.
   */
  async remove(id: number, customerId?: number | string | null) {
    const item = await this.findOne(id, customerId);

    // Delete protection: Check if template key or templateName is currently configured/in-use by CRM lead stages
    if (item.key) {
      const activeStage = await this.prisma.leadStage.findFirst({
        where: {
          deletedAt: null,
          isActive: true,
          key: { equals: item.key, mode: 'insensitive' },
        },
      });

      if (activeStage && item.isLocalActive) {
        throw new BadRequestException(
          `This template is currently in use for pipeline stage "${activeStage.name}" and cannot be deleted. You can deactivate it instead.`,
        );
      }
    }

    await this.prisma.metaTemplate.update({
      where: { id: item.id },
      data: { deletedAt: new Date() },
    });

    return { success: true, message: `Meta template "${item.name}" deleted successfully.` };
  }

  /**
   * Synchronizes templates from Meta Graph API using existing WhatsApp credentials.
   */
  async syncFromMeta(customerId?: number | string | null) {
    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP');
    const creds = config?.credentials || {};
    const rawApiKey = creds.apiKey || creds.accessToken || creds.access_token || '';
    const { token: apiKey } = resolveCleanAccessToken(rawApiKey);
    const wabaId = (creds.businessAccountId || creds.wabaId || creds.business_account_id || '').trim();
    const phoneNumberId = (creds.phoneNumberId || creds.phone_number_id || '').trim();

    if (!apiKey) {
      throw new BadRequestException(
        'WhatsApp / Meta integration is not configured. Please configure Access Token in Settings → Integrations → WhatsApp.',
      );
    }

    const targetAccount = wabaId || phoneNumberId;
    if (!targetAccount) {
      throw new BadRequestException(
        'WhatsApp Business Account ID (WABA ID) or Phone Number ID is missing in Settings → Integrations → WhatsApp.',
      );
    }

    this.logger.log(`[MetaTemplateService] Syncing templates from Meta Graph API for account: ${targetAccount}`);

    let metaTemplates: any[] = [];
    try {
      const metaUrl = `https://graph.facebook.com/v21.0/${targetAccount}/message_templates?limit=100`;
      const response = await axios.get(metaUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 15000,
      });

      if (response.data && Array.isArray(response.data.data)) {
        metaTemplates = response.data.data;
      }
    } catch (err: any) {
      const errMsg = err?.response?.data?.error?.message || err?.message || 'Meta API communication error';
      this.logger.error(`[MetaTemplateService] Meta Graph API sync failed: ${errMsg}`);
      throw new BadRequestException(`Meta Graph API error: ${errMsg}`);
    }

    const parsedCustId = customerId !== undefined && customerId !== null ? Number(customerId) : null;
    let syncedCount = 0;

    for (const mt of metaTemplates) {
      const templateName = (mt.name || '').trim().toLowerCase();
      if (!templateName) continue;

      let bodyText = '';
      let headerType = 'NONE';
      let headerContent: string | null = null;
      let footerText: string | null = null;
      let buttonsList: any[] = [];

      if (Array.isArray(mt.components)) {
        for (const comp of mt.components) {
          if (comp.type === 'BODY') {
            bodyText = comp.text || '';
          } else if (comp.type === 'HEADER') {
            headerType = comp.format || 'TEXT';
            headerContent = comp.text || null;
          } else if (comp.type === 'FOOTER') {
            footerText = comp.text || null;
          } else if (comp.type === 'BUTTONS' && Array.isArray(comp.buttons)) {
            buttonsList = comp.buttons;
          }
        }
      }

      const language = mt.language || 'en_US';
      const category = (mt.category || 'UTILITY').toUpperCase();
      const status = (mt.status || 'APPROVED').toUpperCase();
      const variables = this.extractVariables(bodyText + ' ' + (headerContent || ''));

      const existing = await this.prisma.metaTemplate.findFirst({
        where: {
          templateName,
          language,
          deletedAt: null,
          OR: [
            { customerId: null },
            ...(parsedCustId ? [{ customerId: parsedCustId }] : []),
          ],
        },
      });

      if (existing) {
        await this.prisma.metaTemplate.update({
          where: { id: existing.id },
          data: {
            status,
            metaTemplateId: mt.id ? String(mt.id) : existing.metaTemplateId,
            body: bodyText || existing.body,
            headerType,
            headerContent: headerContent || existing.headerContent,
            footer: footerText || existing.footer,
            buttons: buttonsList.length > 0 ? buttonsList : (existing.buttons as any),
            rejectionReason: mt.rejected_reason || null,
            lastSyncedAt: new Date(),
          },
        });
      } else {
        await this.prisma.metaTemplate.create({
          data: {
            customerId: parsedCustId,
            name: (mt.name || templateName).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            templateName,
            language,
            category,
            status,
            metaTemplateId: mt.id ? String(mt.id) : null,
            headerType,
            headerContent,
            body: bodyText || 'Template synced from Meta',
            footer: footerText,
            buttons: buttonsList.length > 0 ? buttonsList : null,
            variables,
            isLocalActive: status === 'APPROVED',
            isSystem: false,
            lastSyncedAt: new Date(),
          },
        });
      }
      syncedCount++;
    }

    return {
      success: true,
      message: `Successfully synchronized ${syncedCount} templates from Meta Business Cloud API.`,
      syncedCount,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  /**
   * Returns CRM variable dictionary.
   */
  getVariables() {
    return CRM_META_TEMPLATE_VARIABLES;
  }

  /**
   * Generates live preview with resolved sample variable values.
   */
  async preview(dto: PreviewMetaTemplateDto, customerId?: number | string | null) {
    let body = dto.body || '';
    let headerContent = dto.headerContent || '';

    if (dto.templateId) {
      const tpl = await this.findOne(Number(dto.templateId), customerId);
      body = body || tpl.body;
      headerContent = headerContent || tpl.headerContent || '';
    }

    const sampleVars: Record<string, string> = {
      leadName: 'Mr. Raj Sharma',
      leadTitle: 'Enrich Salon & Luxury Spa',
      companyName: 'QUIKBOOM Digital Marketing Agency',
      userName: 'Avinash',
      assignedUser: 'Avinash',
      assignedEmployeeName: 'Avinash Magar',
      assignedEmployeePhone: '+91 98765 43210',
      assignedEmployeeEmail: 'sales@quikboom.com',
      stage: 'Contacted',
      startDate: '25 September 2026',
      startTime: '11:30 AM',
      leadPhone: '+91 98765 12345',
      leadEmail: 'raj@enrichspa.com',
      ...(dto.variables || {}),
    };

    let resolvedBody = body;
    let resolvedHeader = headerContent;

    for (const [key, val] of Object.entries(sampleVars)) {
      const reg = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
      resolvedBody = resolvedBody.replace(reg, String(val));
      resolvedHeader = resolvedHeader.replace(reg, String(val));
    }

    // Numbered parameters {{1}}, {{2}} fallback
    let paramIndex = 1;
    for (const val of Object.values(sampleVars)) {
      resolvedBody = resolvedBody.replace(new RegExp(`\\{\\{\\s*${paramIndex}\\s*\\}\\}`, 'g'), String(val));
      resolvedHeader = resolvedHeader.replace(new RegExp(`\\{\\{\\s*${paramIndex}\\s*\\}\\}`, 'g'), String(val));
      paramIndex++;
    }

    return {
      resolvedHeader,
      resolvedBody,
      variablesUsed: this.extractVariables(body + ' ' + headerContent),
    };
  }

  /**
   * Dispatches a live test WhatsApp template message using Meta Cloud API.
   * - Validates recipient phone number using WhatsappService.normalizePhoneNumber
   * - Scopes template to authenticated admin / tenant (or global system template)
   * - Verifies template is APPROVED on Meta
   * - Dynamically detects & orders variables from body & header
   * - Reuses existing Meta WhatsApp Cloud API credentials
   * - Captures message ID on success
   */
  async testSend(dto: TestSendMetaTemplateDto, user: any) {
    if (!dto.to || !dto.to.trim()) {
      throw new BadRequestException('Recipient WhatsApp number is required');
    }

    const normalizedPhone = this.whatsappService.normalizePhoneNumber(dto.to);
    if (!normalizedPhone) {
      throw new BadRequestException(
        'Invalid WhatsApp phone number format. Please provide a valid 10-15 digit phone number (e.g. +91 98200 10000).',
      );
    }

    const customerId = user?.customerId !== undefined && user?.customerId !== null ? Number(user.customerId) : null;

    // 1. Locate the exact selected template with tenant isolation
    let template: any = null;
    if (dto.templateId) {
      template = await this.prisma.metaTemplate.findFirst({
        where: {
          id: Number(dto.templateId),
          deletedAt: null,
          OR: [
            { customerId: null },
            ...(customerId ? [{ customerId }] : []),
          ],
        },
      });
    } else if (dto.templateName) {
      template = await this.prisma.metaTemplate.findFirst({
        where: {
          templateName: dto.templateName.trim().toLowerCase(),
          deletedAt: null,
          OR: [
            { customerId: null },
            ...(customerId ? [{ customerId }] : []),
          ],
        },
      });
    }

    if (!template) {
      throw new NotFoundException('Selected WhatsApp template not found or access denied.');
    }

    // 2. Validate template status on Meta (Requirement 4: Only APPROVED templates can be tested)
    const status = (template.status || '').toUpperCase();
    if (status !== 'APPROVED') {
      throw new BadRequestException(
        `This WhatsApp template is currently "${status || 'NOT APPROVED'}" on Meta and cannot be tested. Only APPROVED templates can be sent via Meta Cloud API.`,
      );
    }

    if (template.isLocalActive === false) {
      throw new BadRequestException('This WhatsApp template is currently deactivated in your CRM settings.');
    }

    // 3. Extract variables from body & header in exact order of appearance
    const bodyText = template.body || '';
    const headerText = template.headerContent || '';
    const fullText = `${headerText} ${bodyText}`;
    const matches = fullText.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
    const orderedVars: string[] = [];
    const seen = new Set<string>();
    for (const m of matches) {
      const v = m.replace(/[\{\}\s]/g, '');
      if (!seen.has(v)) {
        seen.add(v);
        orderedVars.push(v);
      }
    }

    // 4. Build parameters for Meta Cloud API
    const userVars = dto.variables || {};
    const sampleVars: Record<string, string> = {
      leadName: 'Mr. Raj Sharma',
      leadTitle: 'Mr. Raj Sharma',
      companyName: 'QUIKBOOM',
      userName: user?.firstName || 'Admin',
      assignedUser: user?.firstName || 'Admin',
      assignedEmployeeName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Admin Team',
      assignedEmployeePhone: user?.phone || '+91 98765 43210',
      assignedEmployeeEmail: user?.email || 'admin@quikboom.com',
      stage: 'Contacted',
      startDate: '25 September 2026',
      startTime: '11:30 AM',
      dealValue: '₹1,50,000',
      serviceName: 'Digital Marketing',
      1: 'Mr. Raj Sharma',
      2: 'QUIKBOOM',
      3: '25 September 2026',
      4: '11:30 AM',
    };

    const parameters: Array<{ type: 'text'; text: string }> = orderedVars.map((varName, idx) => {
      const val =
        userVars[varName] !== undefined && userVars[varName] !== null && String(userVars[varName]).trim() !== ''
          ? String(userVars[varName]).trim()
          : userVars[String(idx + 1)] !== undefined && String(userVars[String(idx + 1)]).trim() !== ''
          ? String(userVars[String(idx + 1)]).trim()
          : sampleVars[varName] || sampleVars[String(idx + 1)] || `Sample ${varName}`;

      return {
        type: 'text',
        text: val,
      };
    });

    this.logger.log(
      `[WHATSAPP TEST SEND] Dispatching template "${template.templateName}" (lang: ${template.language || dto.language || 'en_US'}) ` +
      `to recipient ${this.whatsappService.maskPhone(normalizedPhone)} with ${parameters.length} parameters. ` +
      `Company ID: ${customerId || 'GLOBAL'}`
    );

    // 5. Send via existing WhatsappService (Meta WhatsApp Cloud API)
    // NOTE: fallbackText is intentionally undefined so only the actual template is tested
    const sendResult = await this.whatsappService.sendTemplate(
      normalizedPhone,
      template.templateName,
      parameters,
      template.language || dto.language || 'en_US',
      undefined,
      'TEMPLATE_TEST',
      customerId ? Number(customerId) : undefined,
      user?.id ? Number(user.id) : undefined,
    );

    if (!sendResult.success) {
      const errStatus = sendResult.providerStatus || 400;
      const errMsg = sendResult.message || sendResult.details || 'Failed to send WhatsApp test message via Meta';
      this.logger.warn(`[WHATSAPP TEST SEND FAILED] Template: "${template.templateName}", Error: ${errMsg}, ProviderStatus: ${errStatus}`);

      throw new BadRequestException(errMsg);
    }

    return {
      success: true,
      message: 'Test WhatsApp message sent successfully.',
      messageId: sendResult.messageId || null,
      status: 'SENT',
      recipient: normalizedPhone,
      template: {
        id: template.id,
        name: template.name,
        templateName: template.templateName,
        language: template.language,
      },
    };
  }
}
