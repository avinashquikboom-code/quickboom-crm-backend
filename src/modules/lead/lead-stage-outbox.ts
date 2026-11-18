import { buildStageAutomationIdempotencyKey, tenantLeadStageScope } from './lead-stage-automation.util';

type StageChannel = 'EMAIL' | 'WHATSAPP';

/** Resolve channel configuration from the stage's FK relation, never template/stage names. */
export function resolveStageChannelState(
  channel: StageChannel,
  customerId: number,
  stage: any,
): { status: string; error: string | null } {
  const enabled = channel === 'EMAIL' ? stage?.emailEnabled : stage?.whatsappEnabled;
  const templateId = channel === 'EMAIL' ? stage?.emailTemplateId : stage?.whatsappTemplateId;
  const template = channel === 'EMAIL' ? stage?.emailTemplate : stage?.whatsappTemplate;

  if (!stage) {
    return { status: 'NOT_CONFIGURED', error: 'No lead stage is associated with this event.' };
  }
  if (stage.isActive === false || enabled === false) {
    return { status: 'SKIPPED', error: 'Stage or channel automation is disabled.' };
  }
  if (templateId == null) {
    return { status: 'NOT_CONFIGURED', error: 'No template is mapped to this stage for this channel.' };
  }
  if (!template || Number(template.id) !== Number(templateId)) {
    return { status: 'INACTIVE', error: 'The mapped template is unavailable.' };
  }

  const templateCustomerId = template.customerId == null ? null : Number(template.customerId);
  const stageCustomerId = stage.customerId == null ? null : Number(stage.customerId);
  if ((templateCustomerId != null && templateCustomerId !== customerId) ||
      (stageCustomerId == null && templateCustomerId != null)) {
    return { status: 'FAILED', error: 'The mapped template belongs to another workspace.' };
  }

  if (channel === 'EMAIL') {
    if (template.deletedAt || template.isActive !== true) {
      return { status: 'INACTIVE', error: 'The mapped email template is inactive.' };
    }
    return { status: 'QUEUED', error: null };
  }

  if (template.isLocalActive === false) {
    return { status: 'INACTIVE', error: 'The mapped WhatsApp template is inactive.' };
  }
  const metaStatus = String(template.status || '').toUpperCase();
  if (['PENDING', 'PENDING_APPROVAL', 'APPROVAL_PENDING'].includes(metaStatus)) {
    return { status: 'PENDING_APPROVAL', error: 'The mapped WhatsApp template is awaiting Meta approval.' };
  }
  if (metaStatus === 'REJECTED') {
    return { status: 'REJECTED', error: template.rejectionReason || 'Meta rejected the mapped WhatsApp template.' };
  }
  if (['PAUSED', 'DISABLED'].includes(metaStatus)) {
    return { status: 'INACTIVE', error: `The mapped WhatsApp template is ${metaStatus.toLowerCase()}.` };
  }
  const providerTemplateId = String(template.metaTemplateId || '').trim();
  if (metaStatus !== 'APPROVED' || !providerTemplateId || providerTemplateId.startsWith('seed_')) {
    return { status: 'INACTIVE', error: 'The mapped WhatsApp template is not synced and approved on Meta.' };
  }
  return { status: 'QUEUED', error: null };
}

/** Called inside the same transaction that creates LeadStatusHistory. */
export async function createStageOutbox(db: any, p: {
  customerId: number; leadId: number; userId: number | null; transitionId: number;
  previousStageId: number | null; newStageId: number | null;
  previousStage: string; newStage: string;
}) {
  const stage = p.newStageId == null ? null : await db.leadStage.findFirst({
    where: { id: p.newStageId, deletedAt: null, ...tenantLeadStageScope(p.customerId) },
    include: { emailTemplate: true, whatsappTemplate: true },
  });
  if (p.newStageId != null && !stage) throw new Error('Selected stage is unavailable for this tenant.');
  const common = {
    customerId: p.customerId, leadId: p.leadId, userId: p.userId,
    previousStageId: p.previousStageId, newStageId: p.newStageId,
    previousStage: p.previousStage, newStage: p.newStage,
    triggerSource: 'LEAD_STAGE_CHANGED',
  };
  const emailState = resolveStageChannelState('EMAIL', p.customerId, stage);
  const whatsappState = resolveStageChannelState('WHATSAPP', p.customerId, stage);
  await db.leadStageWhatsAppDelivery.create({ data: {
    ...common, ...whatsappState, idempotencyKey: buildStageAutomationIdempotencyKey({ ...p, channel: 'WHATSAPP' }),
    metaTemplateId: stage?.whatsappTemplateId ?? null, templateName: stage?.whatsappTemplate?.templateName ?? stage?.whatsappTemplate?.name ?? null,
    ...(stage?.whatsappVariableMapping != null ? { variableMapping: stage.whatsappVariableMapping } : {}),
  } });
  await db.leadStageEmailDelivery.create({ data: {
    ...common, ...emailState, idempotencyKey: buildStageAutomationIdempotencyKey({ ...p, channel: 'EMAIL' }),
    emailTemplateId: stage?.emailTemplateId ?? null, templateName: stage?.emailTemplate?.name ?? null,
    ...(stage?.emailVariableMapping != null ? { variableMapping: stage.emailVariableMapping } : {}),
  } });
}

/** Queue first-contact automation in the same transaction as a lead import. */
export async function createLeadCreatedOutbox(db: any, p: {
  customerId: number; leadId: number; userId: number | null; stageId: number | null;
  stageName: string; leadName?: string | null; email?: string | null; phone?: string | null;
}) {
  const stage = p.stageId == null ? null : await db.leadStage.findFirst({
    where: { id: p.stageId, deletedAt: null, ...tenantLeadStageScope(p.customerId) },
    include: { emailTemplate: true, whatsappTemplate: true },
  });
  if (p.stageId != null && !stage) throw new Error('Selected lead stage is unavailable for this tenant.');

  const email = String(p.email || '').trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !['contact@company.com', 'placeholder@company.com', 'example@company.com', 'test@company.com', 'user@company.com', 'admin@quikboom.com'].includes(email.toLowerCase());
  const phone = String(p.phone || '').trim();
  const phoneDigits = phone.replace(/\D/g, '');
  const validPhone = /^\+?[\d\s().-]{8,25}$/.test(phone) &&
    phoneDigits.length >= 10 && phoneDigits.length <= 15 && !/^(\d)\1+$/.test(phoneDigits);
  const common = {
    customerId: p.customerId, leadId: p.leadId, userId: p.userId,
    previousStageId: null, newStageId: p.stageId,
    previousStage: null, newStage: p.stageName, triggerSource: 'LEAD_CREATED',
  };

  if (validEmail) {
    const idempotencyKey = `lead_created_${p.customerId}_${p.leadId}_EMAIL`;
    const emailState = resolveStageChannelState('EMAIL', p.customerId, stage);
    await db.leadStageEmailDelivery.upsert({
      where: { idempotencyKey }, update: {}, create: {
        ...common, idempotencyKey, emailTemplateId: stage?.emailTemplateId ?? null,
        templateName: stage?.emailTemplate?.name ?? null,
        variableMapping: stage?.emailVariableMapping ?? undefined,
        ...emailState,
      },
    });
  }
  if (validPhone) {
    const idempotencyKey = `lead_created_${p.customerId}_${p.leadId}_WHATSAPP`;
    const whatsappState = resolveStageChannelState('WHATSAPP', p.customerId, stage);
    await db.leadStageWhatsAppDelivery.upsert({
      where: { idempotencyKey }, update: {}, create: {
        ...common, idempotencyKey, metaTemplateId: stage?.whatsappTemplateId ?? null,
        templateName: stage?.whatsappTemplate?.templateName ?? stage?.whatsappTemplate?.name ?? null,
        variableMapping: stage?.whatsappVariableMapping ?? undefined,
        ...whatsappState,
      },
    });
  }
}
