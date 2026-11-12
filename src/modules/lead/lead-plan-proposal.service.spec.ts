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

  it('isProposalStageToken accepts PROPOSAL and PROPOSAL_SENT', () => {
    expect(service.isProposalStageToken('PROPOSAL', null)).toBe(true);
    expect(service.isProposalStageToken('proposal_sent', null)).toBe(true);
    expect(service.isProposalStageToken('FOLLOW_UP', null)).toBe(false);
  });
});
