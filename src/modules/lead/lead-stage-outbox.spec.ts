import { createLeadCreatedOutbox, createStageOutbox } from './lead-stage-outbox';
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
  it('queues valid lead-created channels with stable tenant-scoped keys and skips invalid contacts', async () => {
    const email = { upsert: jest.fn() };
    const whatsapp = { upsert: jest.fn() };
    const db: any = {
      leadStage: { findFirst: jest.fn().mockResolvedValue({ id: 2, name: 'New', emailEnabled: true, whatsappEnabled: true, emailTemplateId: 8, whatsappTemplateId: 9 }) },
      leadStageEmailDelivery: email,
      leadStageWhatsAppDelivery: whatsapp,
    };
    await createLeadCreatedOutbox(db, {
      customerId: 3, leadId: 4, userId: 5, stageId: 2, stageName: 'New',
      email: 'invalid-address', phone: '---',
    });
    expect(email.upsert).not.toHaveBeenCalled();
    expect(whatsapp.upsert).not.toHaveBeenCalled();

    await createLeadCreatedOutbox(db, {
      customerId: 3, leadId: 4, userId: 5, stageId: 2, stageName: 'New',
      email: 'lead@example.test', phone: '+919876543210',
    });
    expect(email.upsert.mock.calls[0][0]).toMatchObject({
      where: { idempotencyKey: 'lead_created_3_4_EMAIL' },
      create: { triggerSource: 'LEAD_CREATED', status: 'QUEUED', emailTemplateId: 8 },
    });
    expect(whatsapp.upsert.mock.calls[0][0]).toMatchObject({
      where: { idempotencyKey: 'lead_created_3_4_WHATSAPP' },
      create: { triggerSource: 'LEAD_CREATED', status: 'QUEUED', metaTemplateId: 9 },
    });
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
  it('logs claim errors and leaves the QUEUED row eligible for a later poll', async () => {
    const email: any = { claimQueued: jest.fn().mockRejectedValue(new Error('column nextAttemptAt does not exist')) };
    const emailTable = { updateMany: jest.fn() };
    const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    const worker = new LeadStageOutboxWorker({ leadStageEmailDelivery: emailTable } as any, {} as any, email, {} as any);
    Object.defineProperty(worker, 'logger', { value: logger });

    await worker.process('EMAIL', { id: 8, customerId: 3, leadId: 4, attemptCount: 0 });

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('claim failed; leaving row QUEUED'));
    expect(emailTable.updateMany).not.toHaveBeenCalled();
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

  it.each(['EMAIL', 'WHATSAPP'] as const)('dispatches a claimed %s outbox event and persists provider acceptance', async (channel) => {
    const delivery = { claimQueued: jest.fn().mockResolvedValue(true) };
    const other = { claimQueued: jest.fn() };
    const table = { updateMany: jest.fn() };
    const leadService: any = {
      getLeadById: jest.fn().mockResolvedValue({ id: 4 }),
      handleLeadStageChangeNotification: jest.fn().mockResolvedValue({ status: 'SENT', messageId: 'email-provider-1', error: null }),
      handleLeadStageChangeWhatsappNotification: jest.fn().mockResolvedValue({ status: 'SENT', messageId: 'wamid.provider-1', error: null }),
    };
    const stage = { id: 2, name: 'Connected', isActive: true, emailEnabled: true, whatsappEnabled: true, emailTemplateId: 8, whatsappTemplateId: 9 };
    const prisma: any = { leadStage: { findFirst: jest.fn().mockResolvedValue(stage) } };
    if (channel === 'EMAIL') prisma.leadStageEmailDelivery = table;
    else prisma.leadStageWhatsAppDelivery = table;
    const worker = new LeadStageOutboxWorker(prisma, leadService,
      (channel === 'EMAIL' ? delivery : other) as any,
      (channel === 'WHATSAPP' ? delivery : other) as any);
    const row = { id: 10, customerId: 3, leadId: 4, newStageId: 2, previousStageId: 1,
      newStage: 'Connected', previousStage: 'New', userId: 5, attemptCount: 0,
      emailTemplateId: 8, metaTemplateId: 9, variableMapping: null };

    await worker.process(channel, row);

    const expectedMessageId = channel === 'EMAIL' ? 'email-provider-1' : 'wamid.provider-1';
    expect(table.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SENT', ...(channel === 'EMAIL' ? { providerMessageId: expectedMessageId } : { metaMessageId: expectedMessageId }) }),
    }));
    expect(channel === 'EMAIL' ? leadService.handleLeadStageChangeNotification : leadService.handleLeadStageChangeWhatsappNotification).toHaveBeenCalled();
  });

  it('dispatches lead-created events even when the lead has no explicit stage mapping', async () => {
    const email: any = { claimQueued: jest.fn().mockResolvedValue(true) };
    const table = { updateMany: jest.fn() };
    const lead: any = {
      getLeadById: jest.fn().mockResolvedValue({ id: 4, stageId: null }),
      handleLeadStageChangeNotification: jest.fn().mockResolvedValue({ status: 'SENT', messageId: 'accepted', error: null }),
    };
    const prisma: any = { leadStage: { findFirst: jest.fn().mockResolvedValue(null) }, leadStageEmailDelivery: table };
    const worker = new LeadStageOutboxWorker(prisma, lead, email, {} as any);
    await worker.process('EMAIL', {
      id: 11, customerId: 3, leadId: 4, newStageId: null, previousStageId: null,
      newStage: 'New', previousStage: null, triggerSource: 'LEAD_CREATED',
      emailTemplateId: null, variableMapping: null, attemptCount: 0,
    });
    expect(lead.handleLeadStageChangeNotification).toHaveBeenCalledWith(
      3, { id: 4, stageId: null }, '', 'New', undefined, undefined, undefined, undefined,
      'LEAD_CREATED', undefined, null, 11, true,
    );
    expect(table.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SENT', providerMessageId: 'accepted' }),
    }));
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
