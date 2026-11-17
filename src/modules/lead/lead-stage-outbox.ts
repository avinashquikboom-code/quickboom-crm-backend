import { buildStageAutomationIdempotencyKey, tenantLeadStageScope } from './lead-stage-automation.util';

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
  const channelState = (enabled: boolean | undefined, templateId: number | null | undefined) =>
    enabled === false || stage?.isActive === false
      ? { status: 'SKIPPED', error: 'Channel or stage automation is disabled.' }
      : !stage || !templateId
        ? { status: 'NOT_CONFIGURED', error: 'No template configured for this stage.' }
        : { status: 'QUEUED', error: null };
  await db.leadStageWhatsAppDelivery.create({ data: {
    ...common, ...channelState(stage?.whatsappEnabled, stage?.whatsappTemplateId), idempotencyKey: buildStageAutomationIdempotencyKey({ ...p, channel: 'WHATSAPP' }),
    metaTemplateId: stage?.whatsappTemplateId ?? null, templateName: stage?.whatsappTemplate?.templateName ?? stage?.whatsappTemplate?.name ?? null,
    ...(stage?.whatsappVariableMapping != null ? { variableMapping: stage.whatsappVariableMapping } : {}),
  } });
  await db.leadStageEmailDelivery.create({ data: {
    ...common, ...channelState(stage?.emailEnabled, stage?.emailTemplateId), idempotencyKey: buildStageAutomationIdempotencyKey({ ...p, channel: 'EMAIL' }),
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
    await db.leadStageEmailDelivery.upsert({
      where: { idempotencyKey }, update: {}, create: {
        ...common, idempotencyKey, emailTemplateId: stage?.emailTemplateId ?? null,
        templateName: stage?.emailTemplate?.name ?? null,
        variableMapping: stage?.emailVariableMapping ?? undefined,
        status: stage?.emailEnabled === false ? 'SKIPPED' : 'QUEUED',
        error: stage?.emailEnabled === false ? 'Email automation is disabled for this stage.' : null,
      },
    });
  }
  if (validPhone) {
    const idempotencyKey = `lead_created_${p.customerId}_${p.leadId}_WHATSAPP`;
    await db.leadStageWhatsAppDelivery.upsert({
      where: { idempotencyKey }, update: {}, create: {
        ...common, idempotencyKey, metaTemplateId: stage?.whatsappTemplateId ?? null,
        templateName: stage?.whatsappTemplate?.templateName ?? stage?.whatsappTemplate?.name ?? null,
        variableMapping: stage?.whatsappVariableMapping ?? undefined,
        status: stage?.whatsappEnabled === false ? 'SKIPPED' : 'QUEUED',
        error: stage?.whatsappEnabled === false ? 'WhatsApp automation is disabled for this stage.' : null,
      },
    });
  }
}
