import {
  didLeadPipelineStageChange,
  leadStageMatchWhere,
  stripUnresolvedTemplatePlaceholders,
  buildStageAutomationIdempotencyKey,
  isLeadAlreadyOnVisitScheduledStage,
  shouldAdvanceLeadToVisitScheduled,
} from './lead-stage-automation.util';

describe('lead-stage-automation.util', () => {
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

  it('does not downgrade leads past Visit Scheduled in pipeline order', () => {
    expect(
      shouldAdvanceLeadToVisitScheduled(
        { id: 8, sortOrder: 10 },
        { id: 6, sortOrder: 6 },
      ),
    ).toBe(false);
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
