import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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
  DeleteMetaTemplateDto,
  BulkDeleteMetaTemplatesDto,
} from './dto/meta-template.dto';
import { LEAD_STAGE_WHATSAPP_TEMPLATES, WhatsappService } from '../whatsapp/whatsapp.service';
import { isLocalPlaceholderTemplate, isSendableMetaTemplate, resolveCleanAccessToken } from '../whatsapp/whatsapp.util';

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
      // Count archived rows too, so the next listing request does not recreate
      // defaults after an administrator intentionally removes the last template.
      const count = await this.prisma.metaTemplate.count({
        where: {},
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
            status: 'NOT_SYNCED',
            metaTemplateId: `seed_${tpl.templateName}`,
            headerType: 'NONE',
            body: tpl.body,
            footer: 'Sent via QUIKBOOM CRM',
            variables: vars,
            isLocalActive: true,
            isSystem: true,
            syncStatus: 'NOT_SYNCED',
            syncError: null,
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

    const rawSource = query.source || query.templateType || query.type;
    if (rawSource && rawSource !== 'ALL') {
      const normalized = String(rawSource).toUpperCase();
      if (normalized === 'SINGLE') where.source = 'QB_SINGLE';
      else if (normalized === 'CAMPAIGN') where.source = 'QB_CAMPAIGN';
      else if (normalized === 'SYNCED') where.source = 'META_SYNC';
      else where.source = normalized;
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

    const [totalAll, totalActive, totalApproved, totalPending, totalRejected, totalPaused, totalDisabled] = await Promise.all([
      this.prisma.metaTemplate.count({ where: baseStatsWhere }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, isLocalActive: true } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'APPROVED' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'PENDING' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'REJECTED' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'PAUSED' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: { in: ['DISABLED', 'DISABLED_BY_META'] } } }),
    ]);

    const formattedItems = items.map((t) => ({
      ...t,
      displayName: t.name,
      metaStatus: t.status,
      bodyText: t.body,
      footerText: t.footer,
      isActive: t.isLocalActive,
      sendable: isSendableMetaTemplate(t),
      isPlaceholder: isLocalPlaceholderTemplate(t),
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
        paused: totalPaused,
        disabled: totalDisabled,
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

    const [totalAll, totalActive, totalApproved, totalPending, totalRejected, totalPaused, totalDisabled] = await Promise.all([
      this.prisma.metaTemplate.count({ where: baseStatsWhere }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, isLocalActive: true } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'APPROVED' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'PENDING' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'REJECTED' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: 'PAUSED' } }),
      this.prisma.metaTemplate.count({ where: { ...baseStatsWhere, status: { in: ['DISABLED', 'DISABLED_BY_META'] } } }),
    ]);

    const stats = {
      total: totalAll,
      active: totalActive,
      approved: totalApproved,
      pending: totalPending,
      rejected: totalRejected,
      paused: totalPaused,
      disabled: totalDisabled,
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

  private validateTemplate(dto: CreateMetaTemplateDto, submitting = false) {
    const name = dto.templateName || dto.name;
    if (!name || !/^[a-z0-9_]{1,512}$/.test(name)) throw new BadRequestException('Meta template name must contain only lowercase letters, numbers and underscores.');
    if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes((dto.category || 'UTILITY').toUpperCase())) throw new BadRequestException('Invalid template category.');
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(dto.language || 'en_US')) throw new BadRequestException('Invalid template language.');
    if (!dto.body?.trim() || dto.body.trim().length > 1024) throw new BadRequestException('Body is required and must not exceed 1024 characters.');
    const header = (dto.headerType || 'NONE').toUpperCase();
    if (!['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(header)) throw new BadRequestException('Invalid header type.');
    if (header === 'TEXT' && (!dto.headerContent?.trim() || dto.headerContent.trim().length > 60)) throw new BadRequestException('Text header is required and must not exceed 60 characters.');
    if (dto.footer && (dto.footer.length > 60 || /[{}]/.test(dto.footer))) throw new BadRequestException('Footer must be at most 60 characters and cannot contain variables.');
    if (dto.buttons != null && (!Array.isArray(dto.buttons) || dto.buttons.length > 10)) throw new BadRequestException('Buttons must be an array with at most 10 entries.');
    for (const button of dto.buttons || []) {
      if (!button || !['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(button.type) || typeof button.text !== 'string' || !button.text.trim() || button.text.length > 25) throw new BadRequestException('Each button requires a valid type and label of at most 25 characters.');
      if (button.type === 'URL' && !/^https?:\/\//i.test(button.url || '')) throw new BadRequestException('URL buttons require an HTTP or HTTPS URL.');
      if (button.type === 'PHONE_NUMBER' && !/^\+?[0-9]{8,15}$/.test(button.phone_number || button.phoneNumber || '')) throw new BadRequestException('Phone buttons require a valid phone number.');
      if (button.type === 'URL' && /[{}]/.test(button.url)) throw new BadRequestException('Dynamic button URLs are not supported by this editor.');
    }
    const allKeys = this.extractVariables(`${dto.body} ${header === 'TEXT' ? dto.headerContent || '' : ''}`);
    if (allKeys.some(key => /^\d+$/.test(key)) && allKeys.some(key => !/^\d+$/.test(key))) throw new BadRequestException('Do not mix positional and named variables in a template.');
    for (const text of [dto.body, header === 'TEXT' ? dto.headerContent || '' : '']) {
      const matches = [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]);
      if (/[{}]/.test(text.replace(/\{\{[^{}]+\}\}/g, ''))) throw new BadRequestException('Malformed template variable.');
      if (matches.some(key => !(submitting ? /^(?:[1-9]\d*|[a-z][a-z0-9_]*)$/ : /^(?:[1-9]\d*|[a-zA-Z][a-zA-Z0-9_]*)$/).test(key))) throw new BadRequestException('Variables must use positional numbers or lowercase named parameters.');
      const numeric = matches.filter(key => /^\d+$/.test(key));
      if (numeric.length && numeric.length !== matches.length) throw new BadRequestException('Do not mix positional and named variables in a component.');
      const unique = [...new Set(numeric)];
      if (unique.some((key, index) => Number(key) !== index + 1)) throw new BadRequestException('Positional variables must start at {{1}} and be consecutive.');
      if (submitting && matches.some(key => typeof dto.sampleValues?.[key] !== 'string' || !dto.sampleValues[key].trim() || dto.sampleValues[key].trim() === `[${key}]`)) throw new BadRequestException('Provide a sample value for every variable before submitting to Meta.');
      if (header === 'TEXT' && text === dto.headerContent && new Set(matches).size > 1) throw new BadRequestException('Text headers support at most one variable.');
    }
    if (submitting && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header)) throw new BadRequestException('Media headers require a Meta upload handle, which this editor does not yet provide.');
  }

  private buildMetaGraphComponents(dto: CreateMetaTemplateDto) {
    this.validateTemplate(dto, true);
    const components: any[] = [];
    const examples = (text: string, field: 'header' | 'body') => {
      const keys = this.extractVariables(text);
      if (!keys.length) return undefined;
      const named = !/^\d+$/.test(keys[0]);
      if (named) return { [`${field}_text_named_params`]: keys.map(key => ({ param_name: key, example: dto.sampleValues[key].trim() })) };
      const values = keys.map(key => dto.sampleValues[key].trim());
      return { [`${field}_text`]: field === 'body' ? [values] : values };
    };
    const headerType = (dto.headerType || 'NONE').toUpperCase();
    if (headerType === 'TEXT') {
      const text = dto.headerContent.trim();
      const example = examples(text, 'header');
      components.push({ type: 'HEADER', format: 'TEXT', text, ...(example ? { example } : {}) });
    }
    const text = dto.body.trim();
    const example = examples(text, 'body');
    components.push({ type: 'BODY', text, ...(example ? { example } : {}) });
    if (dto.footer?.trim()) components.push({ type: 'FOOTER', text: dto.footer.trim() });
    if (dto.buttons?.length) components.push({ type: 'BUTTONS', buttons: dto.buttons.map(button => ({
      type: button.type, text: button.text.trim(),
      ...(button.type === 'URL' ? { url: button.url } : {}),
      ...(button.type === 'PHONE_NUMBER' ? { phone_number: button.phone_number || button.phoneNumber } : {}),
    })) });
    return components;
  }

  private async resolveWhatsAppCredentials(customerId?: number | string | null) {
    const config = await this.integrationSettingsService.getIntegrationConfig('WHATSAPP');
    const creds = config?.credentials || {};
    const rawApiKey = creds.apiKey || creds.accessToken || creds.access_token || '';
    const { token: apiKey } = resolveCleanAccessToken(rawApiKey);
    const wabaId = (creds.businessAccountId || creds.wabaId || creds.business_account_id || '').trim();
    const apiVersion = String(creds.apiVersion || config?.config?.apiVersion || 'v21.0').trim().replace(/^v?/i, 'v');
    return { config, apiKey, wabaId, apiVersion };
  }

  private metaApiError(err: any, token?: string) {
    const status = Number(err?.response?.status) || 0;
    const code = err?.response?.data?.error?.code;
    let message = String(err?.response?.data?.error?.message || err?.message || 'Meta Graph API request failed');
    if (token) message = message.split(token).join('[redacted]');
    const details = err?.response?.data?.error;
    const userMessage = typeof details?.error_user_msg === 'string' ? details.error_user_msg.split(token || '\0').join('[redacted]') : '';
    const trace = typeof details?.fbtrace_id === 'string' ? details.fbtrace_id : '';
    message += `${userMessage && userMessage !== message ? ` — ${userMessage}` : ''}${trace ? ` (Meta trace ${trace})` : ''}`;
    if (status === 429 || code === 4 || code === 17 || code === 32) return `Meta rate limit reached${status ? ` (HTTP ${status})` : ''}: ${message}`;
    if (status === 401 || code === 190) return `Meta rejected the access token${status ? ` (HTTP ${status})` : ''}: ${message}`;
    return `Meta Graph API error${status ? ` (HTTP ${status})` : ''}: ${message}`;
  }

  private async fetchMetaTemplatesFromWaba(customerId?: number | string | null) {
    const { config, apiKey, wabaId, apiVersion } = await this.resolveWhatsAppCredentials(customerId);
    if (config?.isEnabled === false) throw new BadRequestException('WhatsApp integration is disabled. Enable it in Settings → Integrations → WhatsApp.');
    if (!apiKey) throw new BadRequestException('WhatsApp / Meta integration is not configured. Access Token is missing.');
    if (!wabaId) throw new BadRequestException('WhatsApp Business Account ID (WABA ID) is missing. Configure the WABA ID in Settings → Integrations → WhatsApp.');

    const templates: any[] = [];
    let nextUrl: string | null = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,rejected_reason`;
    try {
      while (nextUrl) {
        const response = await axios.get(nextUrl, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 });
        if (!Array.isArray(response.data?.data)) throw new Error('Meta response did not contain a template list.');
        templates.push(...response.data.data);
        const next = response.data?.paging?.next;
        if (!next) break;
        const parsed = new URL(next);
        parsed.searchParams.delete('access_token');
        nextUrl = parsed.toString();
      }
    } catch (err: any) {
      const error = this.metaApiError(err, apiKey);
      this.logger.error(`[MetaTemplateService] Template sync failed for WABA ${wabaId}: ${error}`);
      throw new BadRequestException(error);
    }
    return { templates, wabaId };
  }

  private async submitTemplateToMeta(dto: CreateMetaTemplateDto, customerId?: number | string | null) {
    const { config, apiKey, wabaId, apiVersion } = await this.resolveWhatsAppCredentials(customerId);
    if (config?.isEnabled === false) {
      throw new BadRequestException('WhatsApp integration is disabled. Enable it before submitting templates to Meta.');
    }
    if (!apiKey || !wabaId) {
      throw new BadRequestException('WhatsApp / Meta credentials are not configured (access token and WABA ID required).');
    }

    const templateName = (dto.templateName || dto.name || '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    const payload = {
      name: templateName,
      language: dto.language || 'en_US',
      category: (dto.category || 'UTILITY').toUpperCase(),
      ...(this.extractVariables(`${dto.body} ${dto.headerContent || ''}`).some(key => !/^\d+$/.test(key)) ? { parameter_format: 'NAMED' } : {}),
      components: this.buildMetaGraphComponents(dto),
    };

    // A prior submission may have succeeded even if its response was lost. Adopt
    // an existing exact name/language match instead of creating a duplicate.
    const remote = await this.fetchMetaTemplatesFromWaba(customerId);
    const alreadyExists = remote.templates.find((item) =>
      String(item.name || '').toLowerCase() === templateName &&
      String(item.language || '') === String(payload.language),
    );
    if (alreadyExists) {
      return {
        templateName,
        metaTemplateId: alreadyExists.id ? String(alreadyExists.id) : null,
        status: String(alreadyExists.status || 'UNKNOWN').toUpperCase(),
        wabaId: remote.wabaId,
        alreadyExists: true,
      };
    }

    try {
      const response = await axios.post(
        `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`,
        payload,
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 20000 },
      );
      const data = response.data || {};
      return {
        templateName,
        metaTemplateId: data.id ? String(data.id) : null,
        status: String(data.status || 'UNKNOWN').toUpperCase(),
        wabaId,
        alreadyExists: false,
        raw: data,
      };
    } catch (err: any) {
      throw new BadRequestException(this.metaApiError(err, apiKey));
    }
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

    this.validateTemplate({ ...dto, templateName: rawTemplateName });
    const submitToMeta = dto.submitToMeta !== false;
    let metaSubmission: { templateName: string; metaTemplateId: string | null; status: string; raw?: any; wabaId?: string; alreadyExists?: boolean } | null = null;
    if (submitToMeta) {
      metaSubmission = await this.submitTemplateToMeta({ ...dto, templateName: rawTemplateName }, customerId);
    }

    const resolvedTemplateName = metaSubmission?.templateName || rawTemplateName;
    const resolvedStatus = metaSubmission?.status || 'NOT_SYNCED';
    const resolvedMetaId = metaSubmission?.metaTemplateId || null;
    const now = new Date();
    const syncStatus = !submitToMeta
      ? 'NOT_SYNCED'
      : resolvedMetaId
        ? 'SYNCED'
        : 'SYNC_FAILED';

    return this.prisma.metaTemplate.create({
      data: {
        customerId: parsedCustId,
        name: effectiveName,
        templateName: resolvedTemplateName,
        key: dto.key ? dto.key.trim().toUpperCase().replace(/[\s-]+/g, '_') : null,
        language: dto.language || 'en_US',
        category: (dto.category || 'UTILITY').toUpperCase(),
        status: resolvedStatus,
        metaTemplateId: resolvedMetaId,
        syncStatus,
        syncError: syncStatus === 'SYNC_FAILED' ? 'Meta accepted the submission without returning a template ID.' : null,
        lastSyncAttemptAt: submitToMeta ? now : null,
        lastSyncedAt: resolvedMetaId ? now : null,
        syncedWabaId: metaSubmission?.wabaId || null,
        headerType: dto.headerType || 'NONE',
        headerContent: dto.headerContent || null,
        body: rawBody,
        footer: dto.footer?.trim() || null,
        buttons: dto.buttons || null,
        variables,
        sampleValues: dto.sampleValues || undefined,
        isLocalActive: effectiveIsLocalActive,
        isSystem: false,
        source: submitToMeta ? 'QB_SINGLE' : 'QB_SINGLE',
      },
    });
  }

  /**
   * Updates an existing Meta template.
   */
  async update(id: number, dto: UpdateMetaTemplateDto, customerId?: number | string | null) {
    const item = await this.findOne(id, customerId);

    const hasRemoteTemplate = Boolean(item.metaTemplateId && !String(item.metaTemplateId).startsWith('seed_'));

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

    this.validateTemplate({ name: effectiveName, templateName, body: bodyToUse, language: dto.language ?? item.language, category: dto.category ?? item.category, headerType: dto.headerType ?? item.headerType, headerContent: headerToUse, footer: dto.footer ?? item.footer, buttons: dto.buttons ?? item.buttons, sampleValues: dto.sampleValues ?? item.sampleValues } as CreateMetaTemplateDto);

    const remoteContentChanged =
      templateName !== item.templateName ||
      (dto.language !== undefined && dto.language !== item.language) ||
      (dto.category !== undefined && dto.category.toUpperCase() !== item.category) ||
      (dto.headerType !== undefined && dto.headerType !== item.headerType) ||
      (dto.headerContent !== undefined && (dto.headerContent || null) !== (item.headerContent || null)) ||
      bodyToUse.trim() !== item.body ||
      (dto.footer !== undefined && (dto.footer ? dto.footer.trim() : null) !== (item.footer || null)) ||
      (dto.buttons !== undefined && JSON.stringify(dto.buttons ?? null) !== JSON.stringify(item.buttons ?? null));
    if (
      hasRemoteTemplate &&
      remoteContentChanged &&
      templateName === item.templateName &&
      (dto.language ?? item.language) === item.language
    ) {
      throw new BadRequestException(
        'Meta does not allow editing a submitted template in place. Choose a new Meta template name or language for this revision.',
      );
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
        status: hasRemoteTemplate && remoteContentChanged
          ? 'NOT_SYNCED'
          : item.status,
        metaTemplateId: hasRemoteTemplate && remoteContentChanged
          ? null
          : item.metaTemplateId,
        headerType: dto.headerType !== undefined ? dto.headerType : item.headerType,
        headerContent: dto.headerContent !== undefined ? dto.headerContent : item.headerContent,
        body: bodyToUse.trim(),
        footer: effectiveFooter,
        buttons: dto.buttons !== undefined ? dto.buttons : (item.buttons as any),
        variables,
        sampleValues: dto.sampleValues !== undefined ? dto.sampleValues : (item.sampleValues as any) ?? undefined,
        isLocalActive: effectiveIsLocalActive,
        ...(hasRemoteTemplate && remoteContentChanged
          ? {
              syncStatus: 'NOT_SYNCED',
              syncError: 'Template content changed locally. Submit this revision to Meta for approval.',
              syncedWabaId: null,
              lastSyncedAt: null,
            }
          : {}),
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
   * Loads a template for a destructive or preview operation. Non-platform users
   * only ever see their own tenant's rows; platform (customerId = null) templates
   * are visible to Super Admins only, so one tenant can never reach another's data.
   */
  private async findTemplateForUser(id: number, customerId?: number | string | null, user?: any) {
    const parsedCustId = customerId !== undefined && customerId !== null ? Number(customerId) : null;
    const platformWide = !user || this.isSuperAdmin(user);
    const item = await this.prisma.metaTemplate.findFirst({
      where: {
        id,
        ...(platformWide
          ? { OR: [{ customerId: null }, ...(parsedCustId ? [{ customerId: parsedCustId }] : [])] }
          : { customerId: parsedCustId }),
      },
    });
    if (!item) throw new NotFoundException(`Meta template #${id} not found.`);
    return item;
  }

  private static normalizeRole(value: unknown) {
    return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  }

  private isSuperAdmin(user: any) {
    const roles = [user?.role, user?.roleType, ...(Array.isArray(user?.roles) ? user.roles : [])];
    return roles.some((role) => MetaTemplateService.normalizeRole(role) === 'SUPER_ADMIN');
  }

  private assertTemplateAccess(item: any, user: any) {
    const customerId = user?.customerId !== undefined && user?.customerId !== null ? Number(user.customerId) : null;
    const ownedByTenant = customerId != null && Number(item.customerId) === customerId;
    if (!ownedByTenant && !this.isSuperAdmin(user)) {
      throw new ForbiddenException('You cannot delete a template that belongs to another tenant or the platform.');
    }
  }

  private async findTemplateReferences(item: any) {
    const [byLink, byKey, campaigns, deliveries] = await Promise.all([
      this.prisma.leadStage.findMany({
        where: { deletedAt: null, whatsappTemplateId: item.id },
        select: { id: true, name: true, key: true, isActive: true, whatsappTemplateId: true, whatsappEnabled: true },
      }),
      item.key
        ? this.prisma.leadStage.findMany({
            where: { deletedAt: null, key: { equals: item.key, mode: 'insensitive' } },
            select: { id: true, name: true, key: true, isActive: true, whatsappTemplateId: true, whatsappEnabled: true },
          })
        : Promise.resolve([]),
      this.prisma.whatsAppCampaign?.count
        ? this.prisma.whatsAppCampaign.count({ where: { metaTemplateId: item.id } })
        : Promise.resolve(0),
      this.prisma.leadStageWhatsAppDelivery?.count
        ? this.prisma.leadStageWhatsAppDelivery.count({ where: { metaTemplateId: item.id } })
        : Promise.resolve(0),
    ]);
    const linkedIds = new Set(byLink.map((s) => s.id));
    const stages = [...byLink, ...byKey.filter((stage) => !linkedIds.has(stage.id))].filter((stage) =>
      stage.whatsappTemplateId === item.id ||
      (!stage.whatsappTemplateId && stage.whatsappEnabled === true && stage.key && item.key && String(stage.key).toUpperCase() === String(item.key).toUpperCase()),
    );
    return {
      leadStages: stages,
      whatsappCampaigns: campaigns,
      deliveryRecords: deliveries,
      blockers: stages
        .filter((stage) => stage.isActive && stage.whatsappEnabled === true)
        .map((stage) => `Lead stage "${stage.name}" is actively mapped to this template.`),
    };
  }

  async previewDelete(id: number, user: any) {
    const item = await this.findTemplateForUser(id, user?.customerId, user);
    this.assertTemplateAccess(item, user);
    const references = await this.findTemplateReferences(item);
    const syncedToMeta = Boolean(item.metaTemplateId && !String(item.metaTemplateId).startsWith('seed_'));
    return {
      id: item.id,
      name: item.name,
      templateName: item.templateName,
      language: item.language,
      category: item.category,
      status: item.status,
      syncStatus: item.syncStatus,
      isSystem: item.isSystem,
      syncedToMeta,
      deletionState: item.deletionState,
      deletedAt: item.deletedAt,
      references,
      canDelete: references.blockers.length === 0,
      blockers: references.blockers,
      whatsappCampaigns: references.whatsappCampaigns,
      deliveryRecords: references.deliveryRecords,
    };
  }

  private isMetaNotFoundError(err: any) {
    const error = err?.response?.data?.error;
    if (!error) return false;
    const code = Number(error.code);
    const subcode = Number(error.error_subcode);
    const message = String(error.message || '');
    // Graph error 100 is also used for malformed parameters. Only treat it as
    // absence when Meta's message explicitly describes a missing object/path.
    if (code === 803) return true;
    if (code === 10 && (subcode === 33 || subcode === 200 || subcode === 201)) return true;
    return /does not exist|not found|unsupported (get|delete) request/i.test(message);
  }

  private async isTemplateOnMeta(customerId: number | string | null | undefined, templateName: string, language: string) {
    const { templates } = await this.fetchMetaTemplatesFromWaba(customerId);
    const target = String(templateName || '').trim().toLowerCase();
    return templates.some((remote) =>
      String(remote.name || '').trim().toLowerCase() === target &&
      String(remote.language || '') === String(language || ''),
    );
  }

  /**
   * Deletes the template from Meta first, then archives the local record.
   * Local state is never removed unless Meta confirms the template is gone.
   */
  async remove(id: number, user: any, dto?: DeleteMetaTemplateDto) {
    const customerId = user?.customerId !== undefined && user?.customerId !== null ? Number(user.customerId) : null;
    let item = await this.findTemplateForUser(id, customerId, user);
    this.assertTemplateAccess(item, user);
    let alreadyArchived = Boolean(item.deletedAt);
    let previouslyDeletedOnMeta = item.deletionState === 'META_DELETED' || item.deletionState === 'LOCAL_DELETED';
    if (alreadyArchived && !previouslyDeletedOnMeta) {
      throw new BadRequestException(`Meta template "${item.name}" was already archived locally.`);
    }
    if (!alreadyArchived && item.deletionState === 'PENDING') {
      const cleaned = await this.completeLocalDeletion(item, user, dto?.reason);
      const fresh = await this.findTemplateForUser(id, customerId, user);
      await this.writeDeletionAudit(fresh, user, this.actorLabel(user), 'META_DELETED', await this.findTemplateReferences(fresh), dto?.reason);
      return { success: true, message: 'Template deleted successfully. Local record archived after retry.', metaResult: 'META_DELETED', templateId: item.id, ...cleaned };
    }

    const references = await this.findTemplateReferences(item);
    if (references.blockers.length) {
      throw new BadRequestException(`Template cannot be deleted: ${references.blockers.join(' ')}`);
    }

    // Check active campaigns
    if (this.prisma.whatsAppCampaign?.findFirst) {
      const activeCampaign = await this.prisma.whatsAppCampaign.findFirst({
        where: {
          metaTemplateId: item.id,
          status: { in: ['RUNNING', 'SCHEDULED', 'DRAFT', 'PAUSED'] },
        },
        select: { id: true, name: true, status: true },
      });
      if (activeCampaign) {
        throw new BadRequestException(
          `Template cannot be deleted because it is linked to an active WhatsApp campaign: "${activeCampaign.name}" (${activeCampaign.status}). Cancel or delete the campaign first.`,
        );
      }
    }

    const actor = this.actorLabel(user);
    let metaResult: 'NOT_REQUIRED' | 'DELETED' | 'ALREADY_ABSENT';
    const syncedToMeta = Boolean(item.metaTemplateId && !String(item.metaTemplateId).startsWith('seed_'));

    if (alreadyArchived) {
      metaResult = 'DELETED';
    } else if (previouslyDeletedOnMeta || !syncedToMeta) {
      metaResult = 'NOT_REQUIRED';
    } else {
      metaResult = await this.deleteFromMeta(item, customerId);
    }

    const now = new Date();
    await this.prisma.metaTemplate.update({
      where: { id: item.id },
      data: {
        deletionState: metaResult === 'DELETED' || metaResult === 'ALREADY_ABSENT' ? 'META_DELETED' : 'NONE',
        deletionError: null,
        deletionAttempts: { increment: 1 },
        lastDeletionAt: now,
        deletedByUserId: Number.isInteger(Number(user?.id)) ? Number(user.id) : null,
        deletedByName: actor,
      },
    });
    item = await this.findTemplateForUser(id, customerId, user);
    alreadyArchived = Boolean(item.deletedAt);
    previouslyDeletedOnMeta = item.deletionState === 'META_DELETED' || item.deletionState === 'LOCAL_DELETED';

    try {
      await this.completeLocalDeletion(item, user, dto?.reason);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Local template cleanup failed';
      await this.prisma.metaTemplate.update({
        where: { id: item.id },
        data: { deletionState: 'PENDING', deletionError: message },
      });
      this.logger.error(`[MetaTemplateService] Local deletion pending for template ${item.id}: ${message}`);
      return {
        success: false,
        deletionPending: true,
        message: `The template was ${metaResult === 'ALREADY_ABSENT' ? 'already absent from' : 'deleted from'} Meta, but the local record could not be permanently deleted: ${message}. Use Retry to finish the local cleanup.`,
        metaResult,
        templateId: item.id,
      };
    }

    await this.writeDeletionAudit(item, user, actor, metaResult, references, dto?.reason);
    return {
      success: true,
      message: `Template deleted successfully. Permanently removed from ${metaResult === 'NOT_REQUIRED' ? 'QB Suite (template was not synced to Meta)' : 'Meta and QB Suite'}.`,
      metaResult,
      templateId: item.id,
      deletedIds: [item.id],
    };
  }

  /**
   * Bulk permanently deletes multiple Meta message templates.
   */
  async bulkRemove(dto: BulkDeleteMetaTemplatesDto, user: any) {
    const rawIds = Array.isArray(dto?.ids) ? dto.ids : [];
    const uniqueIds = Array.from(new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));

    if (!uniqueIds.length) {
      throw new BadRequestException('At least one valid template ID must be provided.');
    }

    const customerId = user?.customerId !== undefined && user?.customerId !== null ? Number(user.customerId) : null;
    const deletedIds: number[] = [];
    const failed: Array<{ id: number; name?: string; reason: string }> = [];

    for (const id of uniqueIds) {
      let item: any;
      try {
        item = await this.findTemplateForUser(id, customerId, user);
        this.assertTemplateAccess(item, user);
      } catch (err: any) {
        failed.push({
          id,
          name: `ID #${id}`,
          reason: err?.message || 'Template not found or access denied.',
        });
        continue;
      }

      if (item.isSystem) {
        failed.push({
          id,
          name: item.name || item.templateName,
          reason: 'System templates cannot be deleted.',
        });
        continue;
      }

      const references = await this.findTemplateReferences(item);
      if (references.blockers.length) {
        failed.push({
          id,
          name: item.name || item.templateName,
          reason: `Template cannot be deleted: ${references.blockers.join(' ')}`,
        });
        continue;
      }

      // Check active campaigns
      if (this.prisma.whatsAppCampaign?.findFirst) {
        const activeCampaign = await this.prisma.whatsAppCampaign.findFirst({
          where: {
            metaTemplateId: item.id,
            status: { in: ['RUNNING', 'SCHEDULED', 'DRAFT', 'PAUSED'] },
          },
          select: { id: true, name: true, status: true },
        });
        if (activeCampaign) {
          failed.push({
            id,
            name: item.name || item.templateName,
            reason: `Linked to active WhatsApp campaign "${activeCampaign.name}" (${activeCampaign.status}). Cancel or delete the campaign first.`,
          });
          continue;
        }
      }

      const actor = this.actorLabel(user);
      let metaResult: 'NOT_REQUIRED' | 'DELETED' | 'ALREADY_ABSENT' = 'NOT_REQUIRED';
      const syncedToMeta = Boolean(item.metaTemplateId && !String(item.metaTemplateId).startsWith('seed_'));

      if (syncedToMeta && item.deletionState !== 'META_DELETED' && item.deletionState !== 'LOCAL_DELETED') {
        try {
          metaResult = await this.deleteFromMeta(item, customerId);
        } catch (metaErr: any) {
          failed.push({
            id,
            name: item.name || item.templateName,
            reason: metaErr?.message || 'Failed to delete template from Meta API.',
          });
          continue;
        }
      }

      try {
        await this.completeLocalDeletion(item, user, dto?.reason);
        await this.writeDeletionAudit(item, user, actor, metaResult, references, dto?.reason);
        deletedIds.push(item.id);
      } catch (localErr: any) {
        failed.push({
          id,
          name: item.name || item.templateName,
          reason: localErr?.message || 'Failed to permanently delete local template record.',
        });
      }
    }

    return {
      success: deletedIds.length > 0,
      message: deletedIds.length === uniqueIds.length
        ? `Successfully permanently deleted ${deletedIds.length} Meta template(s).`
        : `Permanently deleted ${deletedIds.length} Meta template(s). ${failed.length} failed.`,
      total: uniqueIds.length,
      deletedCount: deletedIds.length,
      failedCount: failed.length,
      deletedIds,
      failed,
    };
  }

  private actorLabel(user: any) {
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    return name || user?.email || user?.username || (user?.id ? `User #${user.id}` : 'Unknown user');
  }

  private async deleteFromMeta(item: any, customerId: number | null): Promise<'DELETED' | 'ALREADY_ABSENT'> {
    const { config, apiKey, wabaId, apiVersion } = await this.resolveWhatsAppCredentials(customerId);
    if (config?.isEnabled === false) {
      throw new BadRequestException('WhatsApp integration is disabled, so the Meta template cannot be deleted. Re-enable it in Settings → Integrations → WhatsApp and retry.');
    }
    if (!apiKey) throw new BadRequestException('WhatsApp / Meta integration is not configured. Access Token is missing, so the Meta template was not deleted.');
    if (!wabaId) throw new BadRequestException('WhatsApp Business Account ID (WABA ID) is missing, so the Meta template was not deleted.');
    if (item.syncedWabaId && String(item.syncedWabaId) !== String(wabaId)) {
      throw new BadRequestException(`This template was synced from WABA ${item.syncedWabaId}, but the connected WABA is ${wabaId}. Switch to the correct WhatsApp account before deleting it.`);
    }

    const remoteId = item.metaTemplateId && !String(item.metaTemplateId).startsWith('seed_') ? String(item.metaTemplateId) : null;
    const base = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`;
    const headers = { Authorization: `Bearer ${apiKey}` };
    try {
      // Meta deletes templates from the WABA edge. The template ID belongs in
      // `hsm_id`, not as a path segment (which Graph API rejects as an unknown
      // path component).
      await axios.delete(base, {
        headers,
        params: remoteId
          ? { hsm_id: remoteId, name: item.templateName }
          : { name: item.templateName },
        timeout: 20000,
      });
      return 'DELETED';
    } catch (error: any) {
      const safeMessage = this.metaApiError(error, apiKey);
      if (this.isMetaNotFoundError(error)) {
        const stillThere = await this.isTemplateOnMeta(customerId, item.templateName, item.language).catch(() => true);
        if (!stillThere) return 'ALREADY_ABSENT';
        throw new BadRequestException(`Meta reported the template as missing, but it still exists in WABA ${wabaId}. Local record was preserved. ${safeMessage}`);
      }
      if (this.isMetaInvalidParameterError(error)) {
        // Meta's delete edge accepts the template ID (hsm_id) or the name.
        // Some Graph versions reject the pair together as an invalid parameter.
        // Verify presence first; only retry when the exact template is found.
        const templates = await this.fetchMetaTemplatesFromWaba(customerId);
        const remote = templates.templates.find((candidate) =>
          String(candidate.name || '').trim().toLowerCase() === String(item.templateName || '').trim().toLowerCase() &&
          String(candidate.language || '') === String(item.language || ''),
        );
        if (!remote) return 'ALREADY_ABSENT';

        const selectors = [
          // Meta requires name together with hsm_id when targeting a specific
          // template. Keep both in the retry, matching the Graph API contract.
          remote.id ? { hsm_id: String(remote.id), name: String(remote.name || item.templateName) } : null,
          { name: item.templateName },
        ].filter(Boolean);
        let lastError = error;
        for (const selector of selectors) {
          try {
            await axios.delete(base, { headers, params: selector, timeout: 20000 });
            return 'DELETED';
          } catch (retryError: any) {
            lastError = retryError;
            if (this.isMetaNotFoundError(retryError)) {
              const stillThere = await this.isTemplateOnMeta(customerId, item.templateName, item.language).catch(() => true);
              if (!stillThere) return 'ALREADY_ABSENT';
            }
          }
        }
        const finalMessage = this.metaApiError(lastError, apiKey);
        throw new BadRequestException(`Meta deletion failed; the local template was preserved. Template is still present in WABA ${wabaId}. ${finalMessage}`);
      }
      if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || !error?.response) {
        // The request may have reached Meta. Verify before deciding anything.
        const stillThere = await this.isTemplateOnMeta(customerId, item.templateName, item.language);
        if (!stillThere) return 'ALREADY_ABSENT';
        throw new BadRequestException(`Meta did not confirm the deletion (${safeMessage}). The template is still present in WABA ${wabaId}; local record was preserved. Check the connection and retry.`);
      }
      throw new BadRequestException(`Meta deletion failed; the local template was preserved. ${safeMessage}`);
    }
  }

  private isMetaInvalidParameterError(err: any) {
    const metaError = err?.response?.data?.error;
    if (!metaError) return false;
    const message = String(metaError.message || '');
    return Number(metaError.code) === 100 && /invalid parameter/i.test(message);
  }

  private async completeLocalDeletion(item: any, user: any, reason?: string) {
    const now = new Date();
    const actor = this.actorLabel(user);
    await this.prisma.$transaction(async (tx) => {
      const stages = await tx.leadStage.findMany({
        where: { deletedAt: null, whatsappTemplateId: item.id },
        select: { id: true },
      });
      if (stages.length) {
        await tx.leadStage.updateMany({
          where: { id: { in: stages.map((stage) => stage.id) } },
          data: { whatsappTemplateId: null, whatsappEnabled: false },
        });
      }
      if (tx.whatsAppCampaign) {
        await tx.whatsAppCampaign.updateMany({
          where: { metaTemplateId: item.id },
          data: { metaTemplateId: null },
        });
      }
      // Keep a tombstone so list calls do not reseed or re-import the deleted
      // local row, while normal queries hide it through `deletedAt: null`.
      await tx.metaTemplate.update({
        where: { id: item.id },
        data: {
          deletedAt: now,
          isLocalActive: false,
          deletionState: 'LOCAL_DELETED',
          deletionError: null,
          deletedByUserId: Number.isInteger(Number(user?.id)) ? Number(user.id) : null,
          deletedByName: actor,
        },
      });
    });
    return { deletedAt: now, reason };
  }

  private async writeDeletionAudit(item: any, user: any, actor: string, metaResult: string, references: any, reason?: string) {
    try {
      await this.prisma.auditLog.create({
        data: {
          customerId: item.customerId ?? null,
          userId: Number.isInteger(Number(user?.id)) ? Number(user.id) : null,
          userName: actor,
          userRole: user?.role || user?.roleType || null,
          source: 'ADMIN_PANEL',
          action: 'DELETE',
          module: 'Meta Templates',
          description: `Deleted WhatsApp template "${item.name}" (${item.templateName}, ${item.language}) from Meta and QB Suite`,
          entityType: 'MetaTemplate',
          entityId: String(item.id),
          method: 'DELETE',
          status: 'SUCCESS',
          details: {
            templateId: item.id,
            templateName: item.templateName,
            language: item.language,
            category: item.category,
            metaResult,
            wabaId: item.syncedWabaId || null,
            leadStagesUnmapped: references.leadStages.map((stage) => stage.name),
            whatsappCampaignsCancelled: references.whatsappCampaigns,
            deliveryRecordsPreserved: references.deliveryRecords,
            reason: reason || null,
            deletedBy: actor,
            deletedAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      this.logger.warn(`[MetaTemplateService] Could not write deletion audit for template ${item.id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Synchronizes templates from Meta Graph API using existing WhatsApp credentials.
   */
  async syncFromMeta(customerId?: number | string | null) {
    const parsedCustId = customerId !== undefined && customerId !== null ? Number(customerId) : null;
    const scope: any = { deletedAt: null, ...(parsedCustId ? { OR: [{ customerId: null }, { customerId: parsedCustId }] } : { customerId: null }) };
    const now = new Date();
    let metaTemplates: any[];
    let wabaId: string;
    try {
      ({ templates: metaTemplates, wabaId } = await this.fetchMetaTemplatesFromWaba(customerId));
    } catch (err: any) {
      const error = err?.message || 'Meta Graph API request failed.';
      await this.prisma.metaTemplate.updateMany({ where: scope, data: { syncStatus: 'SYNC_FAILED', syncError: error, lastSyncAttemptAt: now } }).catch(() => null);
      throw err;
    }

    let syncedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const failed: Array<{ name: string; reason: string }> = [];
    const matchedLocalIds = new Set<number>();

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

      const language = mt.language || 'en';
      const category = (mt.category || 'UTILITY').toUpperCase();
      const status = String(mt.status || 'UNKNOWN').toUpperCase();
      const variables = this.extractVariables(bodyText + ' ' + (headerContent || ''));

      const existing = (mt.id
        ? await this.prisma.metaTemplate.findFirst({ where: { ...scope, metaTemplateId: String(mt.id) } })
        : null) || await this.prisma.metaTemplate.findFirst({ where: { ...scope, templateName, language } });

      try {
        if (existing) {
          matchedLocalIds.add(existing.id);
          const nextMetaId = mt.id ? String(mt.id) : existing.metaTemplateId;
          const unchanged = existing.status === status && existing.language === language && existing.category === category &&
            String(existing.metaTemplateId || '') === String(nextMetaId || '') && existing.syncStatus === 'SYNCED' &&
            (existing.rejectionReason || null) === (mt.rejected_reason || null);
          await this.prisma.metaTemplate.update({
            where: { id: existing.id },
            data: {
              status, language, category, metaTemplateId: nextMetaId,
              rejectionReason: mt.rejected_reason || null,
              syncStatus: 'SYNCED', syncError: null, syncedWabaId: wabaId,
              lastSyncAttemptAt: now, lastSyncedAt: now,
            },
          });
          if (unchanged) unchangedCount++;
          else updatedCount++;
        } else {
          const created = await this.prisma.metaTemplate.create({
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
            source: 'META_SYNC',
            syncStatus: 'SYNCED', syncError: null, syncedWabaId: wabaId,
            lastSyncAttemptAt: now, lastSyncedAt: now,
          },
        });
          matchedLocalIds.add(created.id);
          createdCount++;
        }
        syncedCount++;
      } catch (error: any) {
        const reason = error?.message || 'Could not save template';
        failed.push({ name: templateName, reason });
        if (existing?.id) {
          await this.prisma.metaTemplate.update({ where: { id: existing.id }, data: { syncStatus: 'SYNC_FAILED', syncError: reason, lastSyncAttemptAt: now } }).catch(() => null);
        }
      }
    }

    const unmatched = await this.prisma.metaTemplate.findMany({ where: scope, select: { id: true } }).catch(() => []);
    const unmatchedIds = unmatched.map((row: any) => row.id).filter((id: number) => !matchedLocalIds.has(id));
    if (unmatchedIds.length) {
      await this.prisma.metaTemplate.updateMany({
        where: { id: { in: unmatchedIds }, ...scope },
        data: { syncStatus: 'NOT_SYNCED', syncError: null, lastSyncAttemptAt: now },
      });
    }

    return {
      success: failed.length === 0,
      message: `Synchronized ${syncedCount} of ${metaTemplates.length} templates from Meta.`,
      syncedCount,
      fetched: metaTemplates.length,
      created: createdCount,
      updated: updatedCount,
      unchanged: unchangedCount,
      approved: metaTemplates.filter((item) => String(item.status || '').toUpperCase() === 'APPROVED').length,
      pending: metaTemplates.filter((item) => String(item.status || '').toUpperCase() === 'PENDING').length,
      rejected: metaTemplates.filter((item) => String(item.status || '').toUpperCase() === 'REJECTED').length,
      failed,
      wabaId,
      lastSyncedAt: now.toISOString(),
    };
  }

  async syncOne(id: number, customerId?: number | string | null) {
    const item = await this.findOne(id, customerId);
    const now = new Date();
    await this.prisma.metaTemplate.update({ where: { id: item.id }, data: { lastSyncAttemptAt: now, syncError: null } });
    let templates: any[];
    let wabaId: string;
    try {
      ({ templates, wabaId } = await this.fetchMetaTemplatesFromWaba(customerId));
    } catch (err: any) {
      const error = err?.message || 'Meta Graph API request failed.';
      await this.prisma.metaTemplate.update({ where: { id: item.id }, data: { syncStatus: 'SYNC_FAILED', syncError: error, lastSyncAttemptAt: now } });
      throw err;
    }
    const remote = templates.find((candidate) =>
      String(candidate.name || '').toLowerCase() === String(item.templateName || '').toLowerCase() &&
      String(candidate.language || '') === String(item.language || ''),
    );
    if (!remote) {
      return this.prisma.metaTemplate.update({
        where: { id: item.id },
        data: { syncStatus: 'NOT_SYNCED', syncError: null, lastSyncAttemptAt: now },
      });
    }
    return this.prisma.metaTemplate.update({
      where: { id: item.id },
      data: {
        metaTemplateId: remote.id ? String(remote.id) : item.metaTemplateId,
        status: String(remote.status || 'UNKNOWN').toUpperCase(),
        language: String(remote.language || item.language),
        category: String(remote.category || item.category).toUpperCase(),
        rejectionReason: remote.rejected_reason || null,
        syncStatus: remote.id ? 'SYNCED' : 'SYNC_FAILED',
        syncError: remote.id ? null : 'Meta returned a matching template without an ID.',
        syncedWabaId: remote.id ? wabaId : item.syncedWabaId,
        lastSyncAttemptAt: now,
        lastSyncedAt: remote.id ? now : item.lastSyncedAt,
      },
    });
  }

  async submitOne(id: number, customerId?: number | string | null) {
    const item = await this.findOne(id, customerId);
    const syncResult = await this.syncOne(id, customerId);
    if (syncResult.syncStatus === 'SYNCED') return { ...syncResult, alreadyExists: true, message: 'Template already exists on Meta; local status was refreshed.' };

    let result: Awaited<ReturnType<MetaTemplateService['submitTemplateToMeta']>>;
    try {
      result = await this.submitTemplateToMeta({
        name: item.name, templateName: item.templateName, language: item.language, category: item.category,
        body: item.body, headerType: item.headerType || 'NONE', headerContent: item.headerContent || undefined,
        footer: item.footer || undefined, buttons: Array.isArray(item.buttons) ? item.buttons as any : undefined,
        variables: item.variables, sampleValues: item.sampleValues as Record<string, string> || undefined, submitToMeta: true,
      } as CreateMetaTemplateDto, customerId);
    } catch (err: any) {
      await this.prisma.metaTemplate.update({ where: { id: item.id }, data: { syncStatus: 'SYNC_FAILED', syncError: String(err?.message || 'Meta submission failed'), lastSyncAttemptAt: new Date() } });
      throw err;
    }
    const now = new Date();
    const synced = Boolean(result.metaTemplateId);
    const updated = await this.prisma.metaTemplate.update({
      where: { id: item.id },
      data: {
        metaTemplateId: result.metaTemplateId,
        status: result.status,
        syncStatus: synced ? 'SYNCED' : 'SYNC_FAILED',
        syncError: synced ? null : 'Meta accepted the submission without returning a template ID.',
        syncedWabaId: result.wabaId || null,
        lastSyncAttemptAt: now,
        lastSyncedAt: synced ? now : item.lastSyncedAt,
      },
    });
    return { ...updated, alreadyExists: Boolean(result.alreadyExists), message: !synced ? 'Meta did not return a template ID; submission is unconfirmed.' : result.alreadyExists ? 'Existing Meta template was linked; no duplicate was created.' : `Meta confirmed template ${result.metaTemplateId}; status ${result.status}.` };
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
    const templateWhere: any = { deletedAt: null };
    if (dto.templateId) {
      templateWhere.id = Number(dto.templateId);
    } else if (dto.templateName) {
      const norm = dto.templateName.trim().toLowerCase();
      templateWhere.OR = [
        { templateName: dto.templateName.trim() },
        { templateName: norm },
        { name: dto.templateName.trim() },
      ];
    } else {
      throw new BadRequestException('Template ID or Template Name is required');
    }

    if (customerId) {
      // Enforce tenant boundary: can access system global (null) or own tenant's templates
      templateWhere.AND = [
        { OR: [{ customerId: null }, { customerId }] },
      ];
    }

    template = await this.prisma.metaTemplate.findFirst({
      where: templateWhere,
    });

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

    const resolvedLang = template.language || dto.language || 'en';

    this.logger.log(
      `[WHATSAPP TEST SEND] Dispatching template "${template.templateName}" (lang: ${resolvedLang}) ` +
      `to recipient ${this.whatsappService.maskPhone(normalizedPhone)} with ${parameters.length} parameters. ` +
      `Company ID: ${customerId || 'GLOBAL'}`
    );

    // 5. Send via existing WhatsappService (Meta WhatsApp Cloud API)
    // NOTE: fallbackText is intentionally undefined so only the actual template is tested
    const sendResult = await this.whatsappService.sendTemplate(
      normalizedPhone,
      template.templateName,
      parameters,
      resolvedLang,
      undefined,
      'TEMPLATE_TEST',
      customerId ? Number(customerId) : undefined,
      user?.id ? Number(user.id) : undefined,
      {
        templateId: template.id ? String(template.id) : undefined,
        providerTemplateId: template.metaTemplateId || undefined,
        templateStatus: template.status || undefined,
        isApproved: template.status === 'APPROVED',
      },
    );

    if (!sendResult.success) {
      const errStatus = sendResult.providerStatus || 400;
      const errMsg = sendResult.details || sendResult.message || 'Failed to send WhatsApp test message via Meta';

      // Log safe diagnostic metadata (never logs secrets, auth headers, or raw tokens)
      this.logger.error(
        `[WHATSAPP_TEST_SEND_DIAGNOSTIC]\n` +
        `endpoint: POST /api/v1/templates/meta/test-send\n` +
        `companyId: ${customerId || 'GLOBAL'}\n` +
        `templateId: ${template.id}\n` +
        `templateName: ${template.templateName}\n` +
        `language: ${resolvedLang}\n` +
        `recipientMasked: ${this.whatsappService.maskPhone(normalizedPhone)}\n` +
        `internalErrorCode: ${sendResult.errorCode || 'UNKNOWN'}\n` +
        `metaHttpStatus: ${sendResult.providerStatus || 'N/A'}\n` +
        `metaErrorCode: ${sendResult.metaErrorCode || sendResult.error || 'N/A'}\n` +
        `metaErrorType: ${sendResult.metaErrorType || 'N/A'}\n` +
        `metaErrorMessage: "${sendResult.metaErrorMessage || sendResult.providerMessage || 'N/A'}"\n` +
        `failureOrigin: ${sendResult.providerStatus ? 'META_GRAPH_API' : 'BACKEND_VALIDATION'}`
      );

      throw new BadRequestException({
        statusCode: 400,
        message: errMsg,
        errorCode: sendResult.errorCode,
        metaErrorCode: sendResult.metaErrorCode,
        metaErrorType: sendResult.metaErrorType,
        metaErrorMessage: sendResult.metaErrorMessage,
        details: sendResult.details,
      });
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
