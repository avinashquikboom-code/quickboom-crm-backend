import { WhatsAppCampaignService } from './whatsapp-campaign.service';

describe('WhatsApp campaign sending', () => {
  it('uses the shared sender with the campaign template and records the accepted message', async () => {
    const template = { status: 'APPROVED', templateName: 'campaign_offer', language: 'en', body: 'Hello {{1}}', variables: ['1'] };
    const prisma: any = {
      whatsAppCampaign: {
        findFirst: jest.fn().mockResolvedValue({ id: 10, customerId: 3, status: 'DRAFT', metaTemplate: template, variableMapping: { '1': 'Customer' } }),
        update: jest.fn().mockResolvedValue({ id: 10, status: 'COMPLETED' }),
      },
      whatsAppCampaignRecipient: {
        findMany: jest.fn().mockResolvedValue([{ id: 20, phone: '919876543210' }]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const whatsapp: any = { sendTemplate: jest.fn().mockResolvedValue({ success: true, messageId: 'wamid.campaign-test' }) };
    const result = await new WhatsAppCampaignService(prisma, whatsapp).launch(10, 3);
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith('919876543210', 'campaign_offer', [{ type: 'text', text: 'Customer' }], 'en', template.body);
    expect(prisma.whatsAppCampaignRecipient.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT', messageId: 'wamid.campaign-test' }) }));
    expect(result).toMatchObject({ sent: 1, failed: 0 });
  });
});
