import { Test, TestingModule } from '@nestjs/testing';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService } from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';
import { LeadStatus } from '@prisma/client';

describe('Admin Panel Stage Change Automatic WhatsApp Verification', () => {
  let service: LeadService;
  let mockWhatsappService: any;
  let mockEmailService: any;
  let mockPrisma: any;
  let leadsTable: any[] = [];
  let stagesTable: any[] = [];
  let timelineTable: any[] = [];

  beforeEach(async () => {
    leadsTable = [
      {
        id: 101,
        customerId: 1,
        title: 'Enterprise Contract',
        firstName: 'Rahul',
        lastName: 'Sharma',
        email: 'rahul.customer@example.com',
        phone: '+919876543210',
        companyName: 'Acme Enterprise',
        source: 'WEBSITE',
        status: LeadStatus.NEW,
        stageId: 1,
        deletedAt: null,
      },
      {
        id: 102,
        customerId: 1,
        title: 'Lead Missing Phone',
        firstName: 'Aman',
        lastName: 'Verma',
        email: 'aman@example.com',
        phone: null,
        status: LeadStatus.NEW,
        stageId: 1,
        deletedAt: null,
      },
      {
        id: 103,
        customerId: 1,
        title: 'Lead Invalid Phone',
        firstName: 'Vikram',
        lastName: 'Singh',
        email: 'vikram@example.com',
        phone: '123',
        status: LeadStatus.NEW,
        stageId: 1,
        deletedAt: null,
      },
    ];

    stagesTable = [
      { id: 1, customerId: null, name: 'New', key: 'NEW', isActive: true, deletedAt: null },
      { id: 2, customerId: null, name: 'Contacted', key: 'CONTACTED', isActive: true, deletedAt: null },
      { id: 3, customerId: null, name: 'Qualified', key: 'QUALIFIED', isActive: true, deletedAt: null },
      { id: 4, customerId: null, name: 'Proposal', key: 'PROPOSAL_SENT', isActive: true, deletedAt: null },
      { id: 5, customerId: null, name: 'Negotiation', key: 'NEGOTIATION', isActive: true, deletedAt: null },
      { id: 6, customerId: null, name: 'Won', key: 'WON', isActive: true, deletedAt: null },
      { id: 7, customerId: null, name: 'Lost', key: 'LOST', isActive: true, deletedAt: null },
      { id: 8, customerId: null, name: 'Follow-up', key: 'FOLLOW_UP', isActive: true, deletedAt: null },
      { id: 99, customerId: null, name: 'Custom Stage No Template', key: 'CUSTOM_UNCONFIGURED_STAGE', isActive: true, deletedAt: null },
    ];

    timelineTable = [];

    mockPrisma = {
      lead: {
        findFirst: jest.fn(async ({ where }) => {
          return leadsTable.find((l) => l.id === where.id && l.deletedAt === null) || null;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const lead = leadsTable.find((l) => l.id === where.id);
          if (lead) Object.assign(lead, data);
          return { count: lead ? 1 : 0 };
        }),
      },
      leadStage: {
        findFirst: jest.fn(async ({ where }) => {
          if (where.id) return stagesTable.find((s) => s.id === where.id) || null;
          if (where.key) return stagesTable.find((s) => s.key === where.key) || null;
          return null;
        }),
        findMany: jest.fn(async () => stagesTable),
      },
      leadStatusHistory: {
        create: jest.fn(async ({ data }) => data),
      },
      leadActivityTimeline: {
        create: jest.fn(async ({ data }) => {
          timelineTable.push(data);
          return data;
        }),
        findFirst: jest.fn(async () => null),
      },
      emailLog: {
        create: jest.fn(async ({ data }) => data),
        findFirst: jest.fn(async () => null),
      },
      emailTemplate: {
        findFirst: jest.fn(async () => ({
          id: 1,
          key: 'QUIKBOOM_CONTACTED',
          name: 'Contacted',
          subject: 'Update',
          body: 'Hello',
          isActive: true,
        })),
      },
      user: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
      },
    };

    mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue({
        success: true,
        messageId: '<msg-email-123@quickboom.com>',
      }),
      getSmtpStatus: jest.fn().mockResolvedValue({
        isConfigured: true,
        isEnabled: true,
        host: 'smtp.mailgun.org',
        port: 587,
        source: 'DB_SETTINGS',
      }),
    };

    mockWhatsappService = {
      sendLeadStageMessage: jest.fn().mockResolvedValue({
        success: true,
        messageId: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgSMTEx',
      }),
      normalizePhoneNumber: jest.fn((p) => {
        if (!p) return null;
        const cleaned = String(p).replace(/\D/g, '');
        return cleaned.length >= 10 ? (cleaned.length === 10 ? `91${cleaned}` : cleaned) : null;
      }),
      getStageTemplate: jest.fn((stageKey: string) => {
        const templates: Record<string, any> = {
          CONTACTED: { templateName: 'lead_stage_contacted', name: 'Contacted Stage', body: 'Hi {{leadName}}, this is {{userName}} from {{companyName}}.' },
          QUALIFIED: { templateName: 'lead_stage_qualified', name: 'Qualified Stage', body: 'Hi {{leadName}}, requirements for {{leadTitle}} qualified.' },
          PROPOSAL_SENT: { templateName: 'lead_stage_proposal', name: 'Proposal Stage', body: 'Hi {{leadName}}, proposal for {{leadTitle}} is ready.' },
          NEGOTIATION: { templateName: 'lead_stage_negotiation', name: 'Negotiation Stage', body: 'Hi {{leadName}}, scope and terms for {{leadTitle}}.' },
          WON: { templateName: 'lead_stage_won', name: 'Won Stage', body: 'Congratulations {{leadName}}! Deal won for {{leadTitle}}.' },
          LOST: { templateName: 'lead_stage_lost', name: 'Lost Stage', body: 'Hi {{leadName}}, thank you for considering us.' },
        };
        return templates[stageKey] || null;
      }),
      getWhatsAppStatus: jest.fn().mockResolvedValue({
        isConfigured: true,
        isEnabled: true,
        source: 'DB_SETTINGS',
        phoneNumberId: '10987654321',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        LeadRepository,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        {
          provide: EmailTemplateService,
          useValue: {
            findByKey: jest.fn(async () => null),
            findOne: jest.fn(async () => null),
          },
        },
        { provide: WhatsappService, useValue: mockWhatsappService },
        {
          provide: PlanAccessService,
          useValue: { checkPlanFeature: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: LeadLimitService,
          useValue: { checkLeadLimit: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    service = module.get<LeadService>(LeadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Case 1: Admin changes stage New → Contacted (WhatsApp sent automatically with Contacted template and replaced variables)', async () => {
    leadsTable[0].stageId = 1;
    leadsTable[0].status = LeadStatus.NEW;

    const res = await service.updateStatus(1, 101, 42, { stageId: 2 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(2);
    expect(res.whatsappNotification?.sent).toBe(true);
    expect(res.whatsappNotification?.status).toBe('SENT');
    expect(res.whatsappNotification?.messageId).toBe('wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgSMTEx');

    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(1);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        stageKey: 'CONTACTED',
        variables: expect.objectContaining({
          leadName: 'Rahul Sharma',
          leadTitle: 'Enterprise Contract',
          companyName: expect.any(String),
        }),
      }),
    );

    expect(mockPrisma.leadActivityTimeline.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 101,
          action: 'WHATSAPP_SENT',
          description: expect.stringContaining('WhatsApp notification sent to +919876543210 for stage Contacted'),
        }),
      }),
    );
  });

  it('Case 2: Admin changes stage Contacted → Qualified (WhatsApp sent with Qualified template)', async () => {
    leadsTable[0].stageId = 2;
    leadsTable[0].status = LeadStatus.CONTACTED;

    const res = await service.updateStatus(1, 101, 42, { stageId: 3 });

    expect(res.stageId).toBe(3);
    expect(res.whatsappNotification?.sent).toBe(true);
    expect(res.whatsappNotification?.status).toBe('SENT');
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        stageKey: 'QUALIFIED',
      }),
    );
  });

  it('Case 3: Admin changes stage Qualified → Proposal (WhatsApp sent with Proposal template)', async () => {
    leadsTable[0].stageId = 3;
    leadsTable[0].status = LeadStatus.QUALIFIED;

    const res = await service.updateStatus(1, 101, 42, { stageId: 4 });

    expect(res.stageId).toBe(4);
    expect(res.whatsappNotification?.sent).toBe(true);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        stageKey: 'PROPOSAL_SENT',
      }),
    );
  });

  it('Case 4: Admin changes stage Proposal → Negotiation (WhatsApp sent with Negotiation template)', async () => {
    leadsTable[0].stageId = 4;
    leadsTable[0].status = LeadStatus.PROPOSAL;

    const res = await service.updateStatus(1, 101, 42, { stageId: 5 });

    expect(res.stageId).toBe(5);
    expect(res.whatsappNotification?.sent).toBe(true);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        stageKey: 'NEGOTIATION',
      }),
    );
  });

  it('Case 5: Admin changes stage Negotiation → Won (WhatsApp sent with Won template)', async () => {
    leadsTable[0].stageId = 5;
    leadsTable[0].status = LeadStatus.NEGOTIATION;

    const res = await service.updateStatus(1, 101, 42, { stageId: 6 });

    expect(res.stageId).toBe(6);
    expect(res.whatsappNotification?.sent).toBe(true);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        stageKey: 'WON',
      }),
    );
  });

  it('Case 6: Admin changes stage Negotiation → Lost (WhatsApp sent with Lost template)', async () => {
    leadsTable[0].stageId = 5;
    leadsTable[0].status = LeadStatus.NEGOTIATION;

    const res = await service.updateStatus(1, 101, 42, { stageId: 7 });

    expect(res.stageId).toBe(7);
    expect(res.whatsappNotification?.sent).toBe(true);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        stageKey: 'LOST',
      }),
    );
  });

  it('Case 7: Stage updated to same stage (WhatsApp skipped, no duplicate message sent)', async () => {
    leadsTable[0].stageId = 8;
    leadsTable[0].status = LeadStatus.FOLLOW_UP;

    const res = await service.updateStatus(1, 101, 42, { stageId: 8 });

    expect(res.stageId).toBe(8);
    expect(mockWhatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
    expect(res.whatsappNotification?.sent).toBe(false);
    expect(res.whatsappNotification?.status).toBe('SKIPPED');
  });

  it('Case 8: Lead has no phone number (stage updates successfully, WhatsApp skipped safely without crashing)', async () => {
    const res = await service.updateStatus(1, 102, 42, { stageId: 2 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(2);
    expect(res.whatsappNotification?.sent).toBe(false);
    expect(res.whatsappNotification?.status).toBe('SKIPPED');
    expect(mockWhatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
  });

  it('Case 9: Lead has invalid phone number format (stage updates successfully, WhatsApp marked FAILED without crashing)', async () => {
    const res = await service.updateStatus(1, 103, 42, { stageId: 2 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(2);
    expect(res.whatsappNotification?.sent).toBe(false);
    expect(res.whatsappNotification?.status).toBe('FAILED');
    expect(mockWhatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
  });

  it('Case 10: WhatsApp provider error (captures error, returns FAILED, stage update remains SUCCESS)', async () => {
    mockWhatsappService.sendLeadStageMessage.mockResolvedValueOnce({
      success: false,
      reason: 'PROVIDER_ERROR',
      details: 'Meta Cloud API rate limit exceeded',
    });

    const res = await service.updateStatus(1, 101, 42, { stageId: 2 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(2);
    expect(res.whatsappNotification?.sent).toBe(false);
    expect(res.whatsappNotification?.status).toBe('FAILED');
  });

  it('Case 11: Missing WhatsApp template for stage (stage updates successfully, WhatsApp skipped safely)', async () => {
    const res = await service.updateStatus(1, 101, 42, { stageId: 99 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(99);
    expect(res.whatsappNotification?.sent).toBe(false);
    expect(res.whatsappNotification?.status).toBe('SKIPPED');
    expect(mockWhatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
  });

  it('Case 12: Unconfigured WhatsApp integration logs warning and returns FAILED without crashing stage update', async () => {
    mockWhatsappService.getWhatsAppStatus.mockResolvedValueOnce({
      isConfigured: false,
      isEnabled: false,
      phoneNumberId: null,
    });

    const res = await service.updateStatus(1, 101, 42, { stageId: 2 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(2);
    expect(res.whatsappNotification?.sent).toBe(false);
    expect(res.whatsappNotification?.status).toBe('FAILED');
    expect(res.whatsappNotification?.error).toContain('WhatsApp Integration is not configured');
    expect(mockWhatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
  });

  it('Case 13: Stage update via updateLead also triggers WhatsApp automation automatically', async () => {
    leadsTable[0].stageId = 1;
    leadsTable[0].status = LeadStatus.NEW;

    const res = await service.updateLead(1, 101, { stageId: 2 }, 42);

    expect(res).toBeDefined();
    expect(res.whatsappNotification?.sent).toBe(true);
    expect(res.whatsappNotification?.status).toBe('SENT');
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(1);
  });

  it('Case 14: Concurrent Email & WhatsApp verification (both dispatch in parallel and return their statuses)', async () => {
    leadsTable[0].stageId = 1;
    leadsTable[0].status = LeadStatus.NEW;

    const res = await service.updateStatus(1, 101, 42, { stageId: 2 });

    expect(res.emailNotification?.sent).toBe(true);
    expect(res.whatsappNotification?.sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(1);
  });
});
