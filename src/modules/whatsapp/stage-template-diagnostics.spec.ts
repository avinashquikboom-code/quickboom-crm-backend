import { WhatsappService } from './whatsapp.service';

describe('stage template diagnostics', () => {
  const service = new WhatsappService({} as any, {} as any);
  const params = { to: '919999999999', stageKey: 'FINAL_CALL', variables: {} };

  it('distinguishes a mapped template without a Meta ID from a missing mapping', async () => {
    const result = await service.sendLeadStageMessage({ ...params, metaTemplate: { status: 'APPROVED', metaTemplateId: null } });
    expect(result.reason).toBe('TEMPLATE_NOT_SYNCED_WITH_META');
    expect(result.success).toBe(false);
  });

  it('reports an unapproved mapped template without sending', async () => {
    const result = await service.sendLeadStageMessage({ ...params, metaTemplate: { status: 'PENDING', metaTemplateId: '123' } });
    expect(result.reason).toBe('TEMPLATE_NOT_APPROVED');
    expect(result.success).toBe(false);
  });
});
