/**
 * Shared helpers for tenant-scoped lead stage automation (email / WhatsApp).
 */

export function normalizeStageToken(value?: string | null): string {
  return (value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function tenantLeadStageScope(customerId?: number | string | null): Record<string, unknown> {
  const num = customerId !== undefined && customerId !== null ? Number(customerId) : NaN;
  if (!isNaN(num) && num > 0) {
    return { OR: [{ customerId: num }, { customerId: null }] };
  }
  return { customerId: null };
}

/** Prisma WHERE for resolving a pipeline stage by name/key within a tenant. */
export function leadStageMatchWhere(
  stageName: string,
  stageKey?: string | null,
  customerId?: number | string | null,
): Record<string, unknown> {
  const normKey = normalizeStageToken(stageKey || stageName);
  return {
    deletedAt: null,
    AND: [
      {
        OR: [
          { name: { equals: stageName, mode: 'insensitive' } },
          { key: normKey },
        ],
      },
      tenantLeadStageScope(customerId),
    ],
  };
}

/**
 * True only when the pipeline stage actually moved (prefer stageId; fall back to normalized labels).
 */
export function didLeadPipelineStageChange(params: {
  previousStageId?: number | null;
  nextStageId?: number | null;
  previousStageName?: string | null;
  nextStageName?: string | null;
  previousStatus?: string | null;
  nextStatus?: string | null;
}): boolean {
  const prevId = params.previousStageId != null ? Number(params.previousStageId) : null;
  const nextId = params.nextStageId != null ? Number(params.nextStageId) : null;

  if (prevId != null && nextId != null) {
    return prevId !== nextId;
  }
  if (nextId != null && prevId == null) {
    return true;
  }

  const prevLabel = normalizeStageToken(params.previousStageName || params.previousStatus);
  const nextLabel = normalizeStageToken(params.nextStageName || params.nextStatus);
  if (prevLabel && nextLabel) {
    return prevLabel !== nextLabel;
  }

  if (params.nextStatus && params.previousStatus) {
    return normalizeStageToken(params.previousStatus) !== normalizeStageToken(params.nextStatus);
  }

  return false;
}

export function stripUnresolvedTemplatePlaceholders(content: string): string {
  if (!content || typeof content !== 'string') return '';
  return content.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, '');
}

export function buildStageAutomationIdempotencyKey(params: {
  customerId: number | string;
  leadId: number | string;
  channel: 'EMAIL' | 'WHATSAPP';
  previousStageId?: number | null;
  nextStageId?: number | null;
  templateId?: number | string | null;
}): string {
  const tpl = params.templateId != null ? String(params.templateId) : 'auto';
  const from = params.previousStageId != null ? String(params.previousStageId) : 'none';
  const to = params.nextStageId != null ? String(params.nextStageId) : 'none';
  return `stage_${params.customerId}_${params.leadId}_${from}_${to}_${params.channel}_${tpl}`;
}
