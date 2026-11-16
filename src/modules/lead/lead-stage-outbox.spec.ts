import { createStageOutbox } from './lead-stage-outbox';
import { LeadStageOutboxWorker } from './lead-stage-outbox.worker';

describe('stage outbox', () => {
  const params = { customerId: 3, leadId: 4, userId: 5, transitionId: 6, previousStageId: 1, newStageId: 2, previousStage: 'New', newStage: 'Connected' };
  it('records two uniquely keyed channel events using the transaction client', async () => {
    const db: any = { leadStage: { findFirst: jest.fn().mockResolvedValue({ id: 2, emailTemplateId: 8, whatsappTemplateId: 9 }) },
      leadStageWhatsAppDelivery: { create: jest.fn() }, leadStageEmailDelivery: { create: jest.fn() } };
    await createStageOutbox(db, params);
    expect(db.leadStageWhatsAppDelivery.create.mock.calls[0][0].data).toMatchObject({ metaTemplateId: 9, idempotencyKey: 'stage_3_4_event_6_WHATSAPP' });
    expect(db.leadStageEmailDelivery.create.mock.calls[0][0].data).toMatchObject({ emailTemplateId: 8, idempotencyKey: 'stage_3_4_event_6_EMAIL' });
  });
  it('propagates an outbox insertion failure so the transaction can roll back', async () => {
    const db: any = { leadStage: { findFirst: jest.fn().mockResolvedValue({}) }, leadStageWhatsAppDelivery: { create: jest.fn().mockResolvedValue({}) }, leadStageEmailDelivery: { create: jest.fn().mockRejectedValue(new Error('write failed')) } };
    await expect(createStageOutbox(db, params)).rejects.toThrow('write failed');
  });
  it.each([
    [true, true, 8, 9, 'QUEUED', 'QUEUED'],
    [true, false, 8, 9, 'QUEUED', 'SKIPPED'],
    [false, true, 8, 9, 'SKIPPED', 'QUEUED'],
    [true, true, null, null, 'NOT_CONFIGURED', 'NOT_CONFIGURED'],
    [false, false, null, null, 'SKIPPED', 'SKIPPED'],
  ])('records only configured enabled channels as queued', async (emailEnabled, whatsappEnabled, emailTemplateId, whatsappTemplateId, emailStatus, whatsappStatus) => {
    const db: any = { leadStage: { findFirst: jest.fn().mockResolvedValue({ id: 2, emailEnabled, whatsappEnabled, emailTemplateId, whatsappTemplateId }) },
      leadStageWhatsAppDelivery: { create: jest.fn() }, leadStageEmailDelivery: { create: jest.fn() } };
    await createStageOutbox(db, params);
    expect(db.leadStageEmailDelivery.create.mock.calls[0][0].data.status).toBe(emailStatus);
    expect(db.leadStageWhatsAppDelivery.create.mock.calls[0][0].data.status).toBe(whatsappStatus);
  });
  it('does not process a row already claimed by another worker', async () => {
    const email: any = { claimQueued: jest.fn().mockResolvedValue(false) };
    const lead: any = { getLeadById: jest.fn() };
    const worker = new LeadStageOutboxWorker({} as any, lead, email, {} as any);
    await worker.process('EMAIL', { id: 1 });
    expect(lead.getLeadById).not.toHaveBeenCalled();
  });
  it('marks abandoned claims for reconciliation and does not resend them', async () => {
    const makeTable = () => ({ updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) });
    const email = makeTable(), whatsapp = makeTable();
    const worker = new LeadStageOutboxWorker({ leadStageEmailDelivery: email, leadStageWhatsAppDelivery: whatsapp } as any, {} as any, {} as any, {} as any);
    await worker.runOnce();
    expect(email.updateMany.mock.calls[0][0].data.status).toBe('RECONCILIATION_REQUIRED');
    expect(whatsapp.updateMany.mock.calls[0][0].data.status).toBe('RECONCILIATION_REQUIRED');
    expect(email.findMany.mock.calls[0][0].where.status).toBe('QUEUED');
  });
  it('processes the claimed channel without dispatching the other channel', async () => {
    const email: any = { claimQueued: jest.fn().mockResolvedValue(true), markResult: jest.fn() };
    const whatsapp: any = { claimQueued: jest.fn(), markResult: jest.fn() };
    const lead: any = { getLeadById: jest.fn().mockResolvedValue({ id: 4 }),
      handleLeadStageChangeNotification: jest.fn().mockResolvedValue({ status: 'SENT', messageId: 'mail-1', error: null }) };
    const prisma: any = { leadStage: { findFirst: jest.fn().mockResolvedValue({ name: 'Connected', emailTemplateId: 8 }) }, leadStageEmailDelivery: { updateMany: jest.fn() } };
    const worker = new LeadStageOutboxWorker(prisma, lead, email, whatsapp);
    await worker.process('EMAIL', { id: 1, customerId: 3, leadId: 4, newStageId: 2, emailTemplateId: 8, attemptCount: 0 });
    expect(prisma.leadStageEmailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT', providerMessageId: 'mail-1' }) }));
    expect(whatsapp.claimQueued).not.toHaveBeenCalled();
  });

  it.each([
    ['RETRYABLE_REJECTION', 0, 'QUEUED'],
    ['RETRYABLE_REJECTION', 2, 'FAILED'],
    ['AMBIGUOUS', 0, 'RECONCILIATION_REQUIRED'],
    ['DEFINITE_REJECTION', 0, 'FAILED'],
  ])('handles %s at attempt %i as %s', async (outcome, attemptCount, status) => {
    const table = { updateMany: jest.fn() };
    const email: any = { claimQueued: jest.fn().mockResolvedValue(true) };
    const lead: any = { getLeadById: jest.fn().mockResolvedValue({ id: 4 }),
      handleLeadStageChangeNotification: jest.fn().mockResolvedValue({ status: 'FAILED', error: 'provider rejected', stageProviderOutcome: outcome }) };
    const prisma: any = { leadStage: { findFirst: jest.fn().mockResolvedValue({ name: 'Connected', emailTemplateId: 8 }) }, leadStageEmailDelivery: table };
    const worker = new LeadStageOutboxWorker(prisma, lead, email, {} as any);
    await worker.process('EMAIL', { id: 1, customerId: 3, leadId: 4, newStageId: 2, emailTemplateId: 8, attemptCount });
    const update = table.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe(status);
    expect(update.where).toMatchObject({ status: 'PROCESSING', attemptCount: attemptCount + 1 });
    expect(update.data.nextAttemptAt instanceof Date).toBe(status === 'QUEUED');
  });

});
