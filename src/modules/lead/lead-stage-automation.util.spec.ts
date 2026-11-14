import {
  didLeadPipelineStageChange,
  leadStageMatchWhere,
  stripUnresolvedTemplatePlaceholders,
  buildStageAutomationIdempotencyKey,
  isLeadAlreadyOnVisitScheduledStage,
  isLeadEligibleForVisitorVisitDoneTransition,
  isVisitScheduledStageToken,
  canonicalLeadStageToken,
  visitScheduledStageWhere,
  shouldAdvanceLeadToVisitScheduled,
  shouldMoveLeadToVisitScheduledOnExplicitSchedule,
  applyWhatsappVariableMapping,
} from './lead-stage-automation.util';
import { buildStageTemplateComponents } from '../whatsapp/whatsapp.util';
import { LeadStageWhatsappDeliveryService } from './lead-stage-whatsapp-delivery.service';
import { LeadStageEmailDeliveryService } from './lead-stage-email-delivery.service';

describe('lead-stage-automation.util', () => {
  it('uses event and channel identity independent of mapping corrections', () => {
    const event = { customerId: 2, leadId: 12, transitionId: 51, channel: 'WHATSAPP' as const };
    expect(buildStageAutomationIdempotencyKey({ ...event, templateId: 1 }))
      .toBe(buildStageAutomationIdempotencyKey({ ...event, templateId: 2 }));
    expect(buildStageAutomationIdempotencyKey(event))
      .not.toBe(buildStageAutomationIdempotencyKey({ ...event, transitionId: 52 }));
    expect(buildStageAutomationIdempotencyKey(event))
      .not.toBe(buildStageAutomationIdempotencyKey({ ...event, channel: 'EMAIL' }));
    expect(buildStageAutomationIdempotencyKey(event))
      .not.toBe(buildStageAutomationIdempotencyKey({ ...event, customerId: 3 }));
  });

  it('resolves the existing admin {{field}} mapping and rejects missing component variables', () => {
    const variables = applyWhatsappVariableMapping({ leadName: 'Ada', link: 'quote' }, {
      '1': '{{leadName}}', header_1: 'leadName', button_0_1: '{{link}}',
    });
    const components = buildStageTemplateComponents([
      { type: 'HEADER', format: 'TEXT', text: 'Hello {{1}}' },
      { type: 'BODY', text: 'Hi {{1}}' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://example.com/{{1}}' }] },
    ], variables);
    expect(components).toHaveLength(3);
    expect(components[2]).toMatchObject({ type: 'button', sub_type: 'url', parameters: [{ text: 'quote' }] });
    expect(() => buildStageTemplateComponents([{ type: 'BODY', text: '{{missing}}' }], variables))
      .toThrow('Missing WhatsApp template variable');
  });

  it.each([
    [LeadStageWhatsappDeliveryService, 'leadStageWhatsAppDelivery', 'metaMessageId'],
    [LeadStageEmailDeliveryService, 'leadStageEmailDelivery', 'providerMessageId'],
  ] as const)('claims a channel once and never retries provider-accepted records (%s)', async (Service, model, messageField) => {
    let row: any = { id: 1, status: 'QUEUED', attemptCount: 0, [messageField]: null };
    const db = {
      findFirst: jest.fn(async () => row),
      updateMany: jest.fn(async ({ where, data }) => {
        if (row.status !== where.status || row[messageField]) return { count: 0 };
        row = { ...row, status: data.status, attemptCount: row.attemptCount + 1 };
        return { count: 1 };
      }),
    };
    const service = new Service({ [model]: db } as any);
    expect(await service.claimQueued(1)).toBe(true);
    expect(await service.claimQueued(1)).toBe(false);
    row = { ...row, status: 'FAILED', [messageField]: 'provider-accepted-id' };
    await expect(service.retry(2, 12, 1)).rejects.toThrow('Only failed or skipped');
    row = { ...row, [messageField]: null };
    expect((await service.retry(2, 12, 1)).status).toBe('FAILED');
    await expect(service.retry(2, 12, 1)).rejects.toThrow();
  });
  it('detects pipeline movement by stageId even when labels match', () => {
    expect(
      didLeadPipelineStageChange({
        previousStageId: 1,
        nextStageId: 2,
        previousStageName: 'Connected',
        nextStageName: 'Connected',
      }),
    ).toBe(true);
  });

  it('ignores legacy status-only noise when stageId is unchanged', () => {
    expect(
      didLeadPipelineStageChange({
        previousStageId: 5,
        nextStageId: 5,
        previousStageName: 'Proposal',
        nextStageName: 'Proposal',
        previousStatus: 'NEGOTIATION',
        nextStatus: 'PROPOSAL_SENT',
      }),
    ).toBe(false);
  });

  it('builds tenant-scoped stage match without duplicate OR keys', () => {
    const where = leadStageMatchWhere('Qualified', 'QUALIFIED', 12);
    expect(where).toMatchObject({
      deletedAt: null,
      AND: expect.arrayContaining([
        expect.objectContaining({ OR: expect.any(Array) }),
        { OR: [{ customerId: 12 }, { customerId: null }] },
      ]),
    });
  });

  it('strips unresolved placeholders', () => {
    expect(stripUnresolvedTemplatePlaceholders('Hi {{lead_name}}, welcome!')).toBe('Hi , welcome!');
  });

  it('does not treat legacy status alone as already on Visit Scheduled', () => {
    expect(
      shouldAdvanceLeadToVisitScheduled(
        { id: 2, sortOrder: 3 },
        { id: 6, sortOrder: 6 },
      ),
    ).toBe(true);
    expect(isLeadAlreadyOnVisitScheduledStage({ stageId: 6 }, { id: 6 })).toBe(true);
    expect(isLeadAlreadyOnVisitScheduledStage({ stageId: 2 }, { id: 6 })).toBe(false);
  });

  it('resolves tenant Visit Schedule aliases used by configured pipelines', () => {
    const where = visitScheduledStageWhere(12) as any;
    const match = where.AND[0].OR;
    expect(match).toEqual(expect.arrayContaining([
      { key: { in: ['VISIT_SCHEDULED', 'VISIT_SCHEDULE', 'SCHEDULE_VISIT', 'VISIT'] } },
      { name: { in: ['Visit Scheduled', 'Visit Schedule', 'Schedule Visit'], mode: 'insensitive' } },
    ]));
    expect(where.AND).toContainEqual({ OR: [{ customerId: 12 }, { customerId: null }] });
    expect(isVisitScheduledStageToken('VISIT_SCHEDULE')).toBe(true);
    expect(isVisitScheduledStageToken('Visit Schedule')).toBe(true);
    expect(canonicalLeadStageToken('Visit Schedule')).toBe('VISIT_SCHEDULED');
  });

  it('explicit visit schedule moves leads from later pipeline stages (e.g. Final Call)', () => {
    const visitScheduled = { id: 6, sortOrder: 6 };
    expect(
      shouldMoveLeadToVisitScheduledOnExplicitSchedule(
        { stageId: 10, status: 'FINAL_CALL', stage: { id: 10, key: 'FINAL_CALL' } },
        visitScheduled,
      ),
    ).toBe(true);
  });

  it('explicit visit schedule does not move Won/Lost leads', () => {
    expect(
      shouldMoveLeadToVisitScheduledOnExplicitSchedule(
        { stageId: 12, status: 'WON', stage: { id: 12, key: 'WON' } },
        { id: 6 },
      ),
    ).toBe(false);
  });

  it('does not downgrade leads past Visit Scheduled in pipeline order', () => {
    expect(
      shouldAdvanceLeadToVisitScheduled(
        { id: 8, sortOrder: 10 },
        { id: 6, sortOrder: 6 },
      ),
    ).toBe(false);
  });

  it('allows visitor completion when stageId is Visit Scheduled even if legacy status lags', () => {
    const visitScheduled = { id: 6, sortOrder: 6 };
    expect(
      isLeadEligibleForVisitorVisitDoneTransition(
        { stageId: 6, status: 'NEW', stage: { id: 6, key: 'VISIT_SCHEDULED', sortOrder: 6 } },
        visitScheduled,
      ),
    ).toBe(true);
  });

  it('allows visitor completion from the configured Visit Schedule key', () => {
    expect(
      isLeadEligibleForVisitorVisitDoneTransition(
        { stageId: 15, status: 'VISIT_SCHEDULED', stage: { id: 15, key: 'VISIT_SCHEDULE', name: 'Visit Schedule' } },
        { id: 15 },
      ),
    ).toBe(true);
  });

  it('allows visitor completion on legacy status mismatch (VISIT_SCHEDULED status, earlier stageId)', () => {
    expect(
      isLeadEligibleForVisitorVisitDoneTransition(
        { stageId: 2, status: 'VISIT_SCHEDULED', stage: { id: 2, key: 'NEW', sortOrder: 2 } },
        { id: 6, sortOrder: 6 },
      ),
    ).toBe(true);
  });

  it('rejects visitor completion when lead is already Visit Done', () => {
    expect(
      isLeadEligibleForVisitorVisitDoneTransition(
        { stageId: 7, status: 'VISIT_DONE', stage: { id: 7, key: 'VISIT_DONE' } },
        { id: 6, sortOrder: 6 },
      ),
    ).toBe(false);
  });

  it('allows completion with active scheduled visit when pipeline is not past Visit Scheduled', () => {
    expect(
      isLeadEligibleForVisitorVisitDoneTransition(
        { stageId: 2, status: 'NEW', stage: { id: 2, key: 'NEW', sortOrder: 2 } },
        { id: 6, sortOrder: 6 },
        { hasActiveScheduledVisit: true },
      ),
    ).toBe(true);
  });

  it('builds stable idempotency keys', () => {
    const key = buildStageAutomationIdempotencyKey({
      customerId: 1,
      leadId: 99,
      channel: 'WHATSAPP',
      previousStageId: 2,
      nextStageId: 3,
      templateId: 7,
    });
    expect(key).toBe('stage_1_99_2_3_WHATSAPP_7');
  });
});
