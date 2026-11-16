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
