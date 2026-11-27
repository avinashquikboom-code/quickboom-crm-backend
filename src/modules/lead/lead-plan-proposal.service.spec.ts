import { LeadPlanProposalService } from './lead-plan-proposal.service';
import { BadRequestException } from '@nestjs/common';

describe('LeadPlanProposalService', () => {
  const leadRepository = { logTimeline: jest.fn().mockResolvedValue(undefined) } as any;
  const prisma = {
    lead: { findFirst: jest.fn(), update: jest.fn() },
    leadPlanProposal: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    plan: { findFirst: jest.fn() },
    customer: { findUnique: jest.fn() },
    emailTemplate: { findFirst: jest.fn() },
  } as any;

  let service: LeadPlanProposalService;

  const emailService = { sendEmail: jest.fn() } as any;
  const whatsappService = {
    sendLeadStageMessage: jest.fn(),
    sendDocumentMessage: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadPlanProposalService(prisma, leadRepository, emailService, whatsappService);
  });

  it('parses plan features from mixed JSON shapes', () => {
    expect((service as any).parsePlanFeatures(['A', 'B'])).toEqual(['A', 'B']);
    expect((service as any).parsePlanFeatures({ a: 'One', b: 'Two' })).toEqual(['One', 'Two']);
    expect((service as any).parsePlanFeatures('Single feature')).toEqual(['Single feature']);
  });

  it('blocks default send when custom plan is active on lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 10,
      customerId: 1,
      email: 'lead@example.com',
      phone: '919999999999',
      firstName: 'A',
      lastName: 'B',
      title: 'Biz',
      planPreferenceReady: true,
      customerRequirements: 'Need CRM',
      planPreferenceType: 'DEFAULT',
      activePlanProposalType: 'CUSTOM',
    });
    prisma.plan.findFirst.mockResolvedValue({
      id: 2,
      name: 'Standard Package',
      monthlyPrice: 14999,
      features: ['Feature 1'],
    });
    prisma.leadPlanProposal.findFirst.mockResolvedValue(null);

    await expect(service.sendDefaultPlan(1, 10, 99)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('isProposalStageToken accepts PROPOSAL, PROPOSAL_SEND, and PROPOSAL_SENT', () => {
    expect(service.isProposalStageToken('PROPOSAL', null)).toBe(true);
    expect(service.isProposalStageToken('proposal_send', null)).toBe(true);
    expect(service.isProposalStageToken('proposal_sent', null)).toBe(true);
    expect(service.isProposalStageToken('FOLLOW_UP', null)).toBe(false);
  });

  it('creates customer-specific custom proposal draft with idempotency without mutating global Plan', async () => {
    const row: any = {
      id: 22,
      customerId: 1,
      firstName: 'Ravi',
      lastName: 'Patel',
      title: 'Ravi Travels',
      companyName: 'Ravi Travels Pvt Ltd',
      planPreferenceReady: false,
      customerRequirements: null,
      planPreferenceType: null,
    };
    prisma.lead.findFirst.mockResolvedValue(row);
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 22 }]),
      leadPlanProposal: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 91, ...data })),
      },
      lead: { update: jest.fn().mockResolvedValue(row) },
    };
    prisma.$transaction = jest.fn((fn) => fn(tx));
    prisma.customer.findUnique.mockResolvedValue({ name: 'QuikBoom' });

    const dto = {
      idempotencyKey: 'custom-req-22',
      sendImmediately: false,
      config: {
        planId: 4,
        planName: 'Enterprise Custom',
        planCode: 'CUST-22-01',
        description: 'Tailored package for Ravi Travels',
        monthlyPrice: 12000,
        yearlyPrice: 120000,
        billingCycle: 'MONTHLY' as const,
        userLimit: 10,
        leadLimit: 2500,
        storageLimit: 20,
        storageUnit: 'GB' as const,
        features: [{ name: 'Reels', quantity: '4', description: 'Monthly reels' }],
      },
    };

    const res1 = await service.createCustomProposal(1, 22, 7, dto);
    expect((res1 as any).delivered).toBe(false);
    expect(res1.proposal.status).toBe('DRAFT');
    expect(res1.proposal.planPrice).toBe(12000);
    expect(res1.proposal.customConfig).toMatchObject({
      planCode: 'CUST-22-01',
      billingCycle: 'MONTHLY',
      userLimit: 10,
      leadLimit: 2500,
      storageLimit: 20,
      storageUnit: 'GB',
    });

    tx.leadPlanProposal.findUnique.mockResolvedValue(res1.proposal);
    const res2 = await service.createCustomProposal(1, 22, 7, dto);
    expect(res2.proposal.id).toBe(91);
    expect(tx.leadPlanProposal.create).toHaveBeenCalledTimes(1);
  });
  it.each([
    [false, true, '', '919999999999'],
    [true, false, 'lead@example.com', ''],
    [true, true, 'lead@example.com', '919999999999'],
  ])('sends only selected channels: email=%s whatsapp=%s', async (email, whatsapp, address, phone) => {
    const proposal: any = { id: 3, version: 1, proposalType: 'DEFAULT', emailStatus: 'PENDING', whatsappStatus: 'PENDING', customConfig: {}, planName: 'Plan', planPrice: 100 };
    prisma.lead.findFirst.mockResolvedValue({ id: 10, customerId: 1, email: address, phone, title: 'Lead' });
    prisma.leadPlanProposal.findFirst.mockImplementation(async () => proposal);
    prisma.leadPlanProposal.updateMany = jest.fn(async ({ data }) => { Object.assign(proposal, data); return { count: 1 }; });
    prisma.leadPlanProposal.update.mockImplementation(async ({ data }) => Object.assign(proposal, data));
    prisma.customer.findUnique.mockResolvedValue({ name: 'Tenant' });
    prisma.emailTemplate.findFirst.mockResolvedValue(null);
    emailService.sendEmail.mockResolvedValue({ messageId: 'mail' });
    whatsappService.sendLeadStageMessage.mockResolvedValue({ success: true, messageId: 'wa' });
    whatsappService.sendDocumentMessage.mockResolvedValue({ success: true, messageId: 'doc' });
    jest.spyOn(service as any, 'pdfForProposal').mockResolvedValue(Buffer.from('pdf'));
    await service.resend(1, 10, 3, 9, { email, whatsapp });
    expect(emailService.sendEmail).toHaveBeenCalledTimes(email ? 1 : 0);
    expect(whatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(whatsapp ? 1 : 0);
    expect(proposal.emailStatus).toBe(email ? 'SENT' : 'SKIPPED');
    expect(proposal.whatsappStatus).toBe(whatsapp ? 'SENT' : 'SKIPPED');
  });

  it('rejects a missing selected contact and no selected channels before sending', async () => {
    prisma.lead.findFirst.mockResolvedValue({ id: 10, customerId: 1, email: '', phone: '' });
    prisma.leadPlanProposal.findFirst.mockResolvedValue({ id: 3, version: 1, emailStatus: 'PENDING', whatsappStatus: 'PENDING', customConfig: {} });
    await expect(service.resend(1, 10, 3, 9, { email: true, whatsapp: false })).rejects.toThrow('valid email');
    await expect(service.resend(1, 10, 3, 9, { email: false, whatsapp: true })).rejects.toThrow('valid phone');
    await expect(service.resend(1, 10, 3, 9, { email: false, whatsapp: false })).rejects.toThrow('No unsent');
    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(whatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
  });
  it('saves the selected active catalog price and reuses a matching request', async () => {
    const row: any = { id: 8, customerId: 1, planPreferenceReady: true, customerRequirements: 'CRM', planPreferenceType: 'DEFAULT' };
    prisma.lead.findFirst.mockResolvedValue(row);
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 8 }]),
      leadPlanProposal: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 3, ...data })) },
      customer: { findUnique: jest.fn().mockResolvedValue({ name: 'Tenant' }) },
      plan: { findFirst: jest.fn().mockResolvedValue({ id: 4, name: 'Plan', monthlyPrice: 100, yearlyPrice: 900, features: ['A'], description: 'Configured' }) },
    };
    prisma.$transaction = jest.fn((fn) => fn(tx));
    const dto = { planId: 4, billingCycle: 'YEARLY' as const, idempotencyKey: 'unique-request' };
    const result = await service.createStandardDraft(1, 8, 9, dto);
    expect(result.proposal.planPrice).toBe(900);
    expect(result.proposal.customConfig).toMatchObject({ billingCycle: 'YEARLY', features: ['A'] });
    tx.leadPlanProposal.findUnique.mockResolvedValue(result.proposal);
    expect((await service.createStandardDraft(1, 8, 9, dto)).proposal.id).toBe(3);
    expect(tx.leadPlanProposal.create).toHaveBeenCalledTimes(1);
    await expect(service.createStandardDraft(2, 8, 9, dto)).rejects.toBeInstanceOf(BadRequestException);
  });

});
