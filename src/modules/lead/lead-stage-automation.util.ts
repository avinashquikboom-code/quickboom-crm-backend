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
/** Active tenant-scoped Visit Scheduled stage (Lead pipeline only — resolved from DB). */
export function visitScheduledStageWhere(customerId?: number | string | null): Record<string, unknown> {
  return {
    deletedAt: null,
    isActive: true,
    AND: [
      {
        OR: [
          { key: 'VISIT_SCHEDULED' },
          { key: 'VISIT' },
          { name: { equals: 'Visit Scheduled', mode: 'insensitive' } },
        ],
      },
      tenantLeadStageScope(customerId),
    ],
  };
}

export function isLeadAlreadyOnVisitScheduledStage(
  lead: { stageId?: number | null },
  visitScheduledStage: { id: number } | null | undefined,
): boolean {
  if (!visitScheduledStage?.id || lead.stageId == null) return false;
  return Number(lead.stageId) === Number(visitScheduledStage.id);
}

export function visitDoneStageWhere(customerId?: number | string | null): Record<string, unknown> {
  return {
    deletedAt: null,
    isActive: true,
    AND: [
      {
        OR: [
          { key: 'VISIT_DONE' },
          { name: { equals: 'Visit Done', mode: 'insensitive' } },
        ],
      },
      tenantLeadStageScope(customerId),
    ],
  };
}

function isVisitScheduledToken(value?: string | null): boolean {
  const token = normalizeStageToken(value);
  return token === 'VISIT_SCHEDULED' || token === 'VISIT' || token === 'VISITSCHEDULED';
}

function isVisitDoneToken(value?: string | null): boolean {
  const token = normalizeStageToken(value);
  return token === 'VISIT_DONE' || token === 'VISITDONE' || token === 'VISIT_COMPLETED';
}

/** Lead is already on Visit Done (no further visitor completion transition). */
export function isLeadOnVisitDoneStage(
  lead?: {
    stageId?: number | null;
    status?: string | null;
    stage?: { id?: number; key?: string; name?: string } | null;
  } | null,
  visitDoneStage?: { id: number } | null,
): boolean {
  if (!lead) return false;
  if (visitDoneStage?.id != null && lead.stageId != null && Number(lead.stageId) === Number(visitDoneStage.id)) {
    return true;
  }
  if (isVisitDoneToken(lead.stage?.key) || isVisitDoneToken(lead.status)) return true;
  const name = (lead.stage?.name || '').toLowerCase();
  return name.includes('visit done') || name.includes('visit completed');
}

/**
 * Whether a visitor may complete an assigned visit (VISIT_SCHEDULED → VISIT_DONE).
 * Prefers stageId / stage.key; falls back to legacy status when pipeline fields are out of sync.
 */
export function isLeadEligibleForVisitorVisitDoneTransition(
  lead?: {
    stageId?: number | null;
    status?: string | null;
    stage?: { id?: number; key?: string; name?: string; sortOrder?: number | null } | null;
  } | null,
  visitScheduledStage?: { id: number; sortOrder?: number | null } | null,
  options?: { hasActiveScheduledVisit?: boolean },
): boolean {
  if (!lead) return Boolean(options?.hasActiveScheduledVisit);
  if (isVisitDoneToken(lead.stage?.key) || isVisitDoneToken(lead.status)) return false;

  if (isLeadAlreadyOnVisitScheduledStage(lead, visitScheduledStage)) return true;
  if (isVisitScheduledToken(lead.stage?.key)) return true;

  const stageName = (lead.stage?.name || '').toLowerCase();
  if (stageName.includes('visit scheduled') || stageName === 'visit') return true;

  // Legacy: status says visit scheduled but stageId still points at an earlier stage.
  if (isVisitScheduledToken(lead.status) && !isVisitDoneToken(lead.stage?.key) && !isVisitDoneToken(lead.status)) {
    return true;
  }

  if (options?.hasActiveScheduledVisit) {
    if (isVisitDoneToken(lead.stage?.key) || isVisitDoneToken(lead.status)) return false;
    const currentOrder = lead.stage?.sortOrder;
    const scheduledOrder = visitScheduledStage?.sortOrder;
    if (scheduledOrder != null && currentOrder != null && currentOrder > scheduledOrder) {
      return false;
    }
    return true;
  }

  return false;
}

/** Do not downgrade leads that have already progressed past Visit Scheduled in pipeline order. */
export function shouldAdvanceLeadToVisitScheduled(
  currentStage: { id?: number | null; sortOrder?: number | null } | null | undefined,
  visitScheduledStage: { id: number; sortOrder?: number | null } | null | undefined,
): boolean {
  if (!visitScheduledStage?.id) return false;
  if (currentStage?.id != null && Number(currentStage.id) === Number(visitScheduledStage.id)) {
    return false;
  }
  const currentOrder = currentStage?.sortOrder;
  const targetOrder = visitScheduledStage.sortOrder;
  if (currentOrder != null && targetOrder != null && currentOrder > targetOrder) {
    return false;
  }
  return true;
}

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

/** Resolve a single template tag against lead/stage variable bag (positional + named). */
export function resolveWhatsappVariableTag(
  tag: string,
  variables: Record<string, string>,
): string {
  let val = variables[tag];
  if (val !== undefined && String(val).trim() !== '') return String(val);

  const lower = tag.toLowerCase().replace(/_/g, '');
  if (lower === 'customername' || lower === 'name' || lower === 'firstname' || lower === 'leadname') {
    val = variables.customerName || variables.name || variables.firstName || variables.leadName;
  } else if (lower === 'companyname' || lower === 'businessname') {
    val = variables.companyName || variables.businessName;
  } else if (lower === 'username' || lower === 'assigneduser' || lower === 'assignedemployeename') {
    val = variables.userName || variables.assignedUser || variables.assignedEmployeeName;
  } else if (lower === 'phone' || lower === 'mobile') {
    val = variables.phone || variables.mobile;
  }

  const positionalFallback: Record<string, string> = {
    '1': variables.customerName || variables.name || variables.firstName || variables.leadName || variables.leadTitle || '',
    '2': variables.companyName || variables.businessName || '',
    '3': variables.leadTitle || variables.userName || variables.assignedUser || '',
    '4': variables.userName || variables.assignedUser || variables.assignedEmployeeName || '',
  };
  if (val === undefined && positionalFallback[tag] !== undefined) {
    val = positionalFallback[tag];
  }
  return val !== undefined ? String(val) : '';
}

/** Apply admin-configured stage mapping (Meta tag → lead field key or literal). */
export function applyWhatsappVariableMapping(
  base: Record<string, string>,
  mapping?: Record<string, unknown> | null,
): Record<string, string> {
  const out = { ...base };
  if (!mapping || typeof mapping !== 'object') return out;
  for (const [targetKey, source] of Object.entries(mapping)) {
    const src = String(source ?? '').trim();
    if (!src) continue;
    const resolved = base[src] ?? src;
    out[targetKey] = String(resolved ?? '').trim();
  }
  return out;
}

export function validateTemplateVariableBag(
  templateBody: string,
  variables: Record<string, string>,
): { ok: boolean; message?: string; missing?: string[] } {
  if (!templateBody) return { ok: true };
  const matches = templateBody.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
  const missing: string[] = [];
  for (const raw of matches) {
    const tag = raw.replace(/[\{\}\s]/g, '');
    if (!resolveWhatsappVariableTag(tag, variables).trim()) {
      missing.push(tag);
    }
  }
  if (missing.length) {
    return {
      ok: false,
      missing,
      message: `Missing WhatsApp template variables: ${missing.join(', ')}`,
    };
  }
  return { ok: true };
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
