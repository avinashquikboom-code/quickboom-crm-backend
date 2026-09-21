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

describe('Admin Panel Stage Change Automatic Email Verification (9 Verification Scenarios)', () => {
  let service: LeadService;
  let mockEmailService: any;
  let mockPrisma: any;
  let leadsTable: any[] = [];
  let stagesTable: any[] = [];
  let emailLogsTable: any[] = [];
  let templatesTable: any[] = [];

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
        title: 'Lead Missing Email',
        firstName: 'Aman',
        lastName: 'Verma',
        email: null,
        phone: '+919876543211',
        status: LeadStatus.NEW,
        stageId: 1,
        deletedAt: null,
      },
      {
        id: 103,
        customerId: 1,
        title: 'Google Discovery Deal',
        firstName: 'Priya',
        lastName: 'Mehta',
        email: 'priya.discovery@example.com',
        phone: '+919876543299',
        source: 'GOOGLE_DISCOVERY',
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
      { id: 99, customerId: null, name: 'Custom Stage No Template', key: 'NO_TEMPLATE_STAGE', isActive: true, deletedAt: null },
    ];

    templatesTable = [
      { id: 1, key: 'QUIKBOOM_NEW_LEAD', name: 'New Lead', subject: 'Welcome {{customerName}} to QUIKBOOM', body: 'Hello {{customerName}}, thank you for connecting with us.', isActive: true },
      { id: 2, key: 'QUIKBOOM_CONTACTED', name: 'Contacted', subject: 'Thank you for speaking with QUIKBOOM, {{customerName}}', body: 'Dear {{customerName}}, thank you for taking the time to speak with our team. We are excited about your company {{companyName}}.', isActive: true },
      { id: 3, key: 'QUIKBOOM_QUALIFIED', name: 'Qualified', subject: 'Your Request is Qualified - QUIKBOOM Next Steps', body: 'Hello {{customerName}}, your inquiry for {{companyName}} has been qualified! Our team is preparing details for {{salesOwner}}.', isActive: true },
      { id: 4, key: 'QUIKBOOM_PROPOSAL_SENT', name: 'Proposal', subject: 'Your Digital Marketing Proposal from QUIKBOOM', body: 'Dear {{customerName}}, your customized proposal for {{companyName}} is ready.', isActive: true },
      { id: 5, key: 'QUIKBOOM_NEGOTIATION', name: 'Negotiation', subject: 'Finalizing Your Proposal - QUIKBOOM', body: 'Hello {{customerName}}, we are reviewing contract details for {{companyName}}.', isActive: true },
      { id: 6, key: 'QUIKBOOM_DEAL_WON', name: 'Won', subject: 'Welcome to QUIKBOOM - Deal Won!', body: 'Congratulations {{customerName}}, we are thrilled to partner with {{companyName}}! Lead source: {{leadSource}}.', isActive: true },
      { id: 7, key: 'QUIKBOOM_DEAL_LOST', name: 'Lost', subject: 'QUIKBOOM - Staying in Touch', body: 'Hello {{customerName}}, thank you for your time considering QUIKBOOM.', isActive: true },
    ];

    emailLogsTable = [];

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
        create: jest.fn(async ({ data }) => data),
      },
      emailLog: {
        create: jest.fn(async ({ data }) => {
          emailLogsTable.push(data);
          return data;
        }),
        findFirst: jest.fn(async () => null),
      },
      emailTemplate: {
        findFirst: jest.fn(async ({ where }) => {
          if (where.AND) {
            for (const item of where.AND) {
              if (item.OR) {
                for (const cond of item.OR) {
                  if (cond.key?.in) {
                    const match = templatesTable.find((t) => cond.key.in.includes(t.key));
                    if (match) return match;
                  }
                  if (cond.name?.equals) {
                    const match = templatesTable.find((t) => t.name.toLowerCase() === cond.name.equals.toLowerCase());
                    if (match) return match;
                  }
                }
              }
            }
          }
          return null;
        }),
      },
      user: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
      },
      integrationSetting: {
        findFirst: jest.fn(async () => ({
          provider: 'SMTP',
          category: 'EMAIL',
          status: 'ACTIVE',
          isEnabled: true,
          settings: { host: 'smtp.mailgun.org', port: 587, auth: { user: 'crm@qbapp.online' } },
        })),
      },
    };

    mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue({
        success: true,
        messageId: '<msg-stage-auto-12345@quickboom.com>',
      }),
      getSmtpStatus: jest.fn().mockResolvedValue({
        isConfigured: true,
        isEnabled: true,
        host: 'smtp.mailgun.org',
        port: 587,
        source: 'DB_SETTINGS',
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
            findByKey: jest.fn(async (key: string) => {
              return templatesTable.find((t) => t.key === key) || null;
            }),
            findOne: jest.fn(async (id: number) => {
              return templatesTable.find((t) => t.id === id) || null;
            }),
          },
        },
        {
          provide: WhatsappService,
          useValue: {
            sendLeadStageMessage: jest.fn().mockResolvedValue({ success: true }),
            normalizePhoneNumber: jest.fn((p) => p),
          },
        },
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

  it('Case 1: Admin changes stage New → Contacted (email sent to customer with replaced variables)', async () => {
    leadsTable[0].stageId = 1;
    leadsTable[0].status = LeadStatus.NEW;

    const res = await service.updateStatus(1, 101, 42, { stageId: 2 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(2);
    expect(res.emailNotification?.sent).toBe(true);
    expect(res.emailNotification?.recipient).toBe('rahul.customer@example.com');

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rahul.customer@example.com',
        subject: expect.stringContaining('Rahul Sharma'),
        text: expect.stringContaining('Acme Enterprise'),
      }),
    );
    expect(mockPrisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 101,
          recipientEmail: 'rahul.customer@example.com',
          newStage: 'Contacted',
          status: 'SENT',
        }),
      }),
    );
  });

  it('Case 2: Admin changes stage Contacted → Qualified (email sent to customer with Qualified template)', async () => {
    leadsTable[0].stageId = 2;
    leadsTable[0].status = LeadStatus.CONTACTED;

    const res = await service.updateStatus(1, 101, 42, { stageId: 3 });

    expect(res.stageId).toBe(3);
    expect(res.emailNotification?.sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rahul.customer@example.com',
        subject: expect.stringContaining('Your Request is Qualified'),
        text: expect.stringContaining('Acme Enterprise'),
      }),
    );
  });

  it('Case 3: Admin changes stage Qualified → Proposal (email sent to customer with Proposal template)', async () => {
    leadsTable[0].stageId = 3;
    leadsTable[0].status = LeadStatus.QUALIFIED;

    const res = await service.updateStatus(1, 101, 42, { stageId: 4 });

    expect(res.stageId).toBe(4);
    expect(res.emailNotification?.sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rahul.customer@example.com',
        subject: expect.stringContaining('Your Digital Marketing Proposal'),
      }),
    );
  });

  it('Case 4: Admin changes stage Proposal → Negotiation (email sent to customer with Negotiation template)', async () => {
    leadsTable[0].stageId = 4;
    leadsTable[0].status = LeadStatus.PROPOSAL;

    const res = await service.updateStatus(1, 101, 42, { stageId: 5 });

    expect(res.stageId).toBe(5);
    expect(res.emailNotification?.sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rahul.customer@example.com',
        subject: expect.stringContaining('Finalizing Your Proposal - QUIKBOOM'),
      }),
    );
  });

  it('Case 5: Admin changes stage Negotiation → Won (email sent to customer with Deal Won template)', async () => {
    leadsTable[0].stageId = 5;
    leadsTable[0].status = LeadStatus.NEGOTIATION;

    const res = await service.updateStatus(1, 101, 42, { stageId: 6 });

    expect(res.stageId).toBe(6);
    expect(res.emailNotification?.sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rahul.customer@example.com',
        subject: expect.stringContaining('Welcome to QUIKBOOM - Deal Won!'),
      }),
    );
  });

  it('Case 6: Admin changes stage Negotiation → Lost (email sent to customer with Deal Lost template)', async () => {
    leadsTable[0].stageId = 5;
    leadsTable[0].status = LeadStatus.NEGOTIATION;

    const res = await service.updateStatus(1, 101, 42, { stageId: 7 });

    expect(res.stageId).toBe(7);
    expect(res.emailNotification?.sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rahul.customer@example.com',
        subject: expect.stringContaining('QUIKBOOM - Staying in Touch'),
      }),
    );
  });

  it('Case 7: Stage updated to same stage (no email sent, no duplicate log)', async () => {
    leadsTable[0].stageId = 8;
    leadsTable[0].status = LeadStatus.FOLLOW_UP;

    const res = await service.updateStatus(1, 101, 42, { stageId: 8 });

    expect(res.stageId).toBe(8);
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.emailLog.create).not.toHaveBeenCalled();
  });

  it('Case 8: Lead has no customer email (stage updates successfully, email skipped with clear log, no crash)', async () => {
    const res = await service.updateStatus(1, 102, 42, { stageId: 2 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(2);
    expect(res.emailNotification?.sent).toBe(false);
    expect(res.emailNotification?.status).toBe('SKIPPED');
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it('Case 9: Google Discovery lead moves to Won (customer receives won email with source variable replaced)', async () => {
    leadsTable[2].stageId = 5;
    leadsTable[2].status = LeadStatus.NEGOTIATION;

    const res = await service.updateStatus(1, 103, 42, { stageId: 6 });

    expect(res.stageId).toBe(6);
    expect(res.emailNotification?.sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'priya.discovery@example.com',
        subject: expect.stringContaining('Welcome to QUIKBOOM - Deal Won!'),
        text: expect.stringContaining('GOOGLE_DISCOVERY'),
      }),
    );
  });

  it('Case 10: Email provider error (captures error, saves FAILED in communication history, stage update remains SUCCESS)', async () => {
    mockEmailService.sendEmail.mockRejectedValueOnce(new Error('SMTP Provider connection timeout 587'));

    const res = await service.updateStatus(1, 101, 42, { stageId: 2 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(2);
    expect(res.emailNotification?.sent).toBe(false);
    expect(res.emailNotification?.status).toBe('FAILED');
    expect(mockPrisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 101,
          recipientEmail: 'rahul.customer@example.com',
          status: 'FAILED',
          errorMessage: 'SMTP Provider connection timeout 587',
        }),
      }),
    );
  });

  it('Case 11: Missing template (stage updates successfully, email skipped safely without crash)', async () => {
    const res = await service.updateStatus(1, 101, 42, { stageId: 99 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(99);
    expect(res.emailNotification?.sent).toBe(false);
    expect(res.emailNotification?.status).toBe('SKIPPED');
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it('Case 12: Unconfigured SMTP integration logs warning and saves FAILED email_log without failing stage update', async () => {
    mockEmailService.getSmtpStatus.mockResolvedValueOnce({
      isConfigured: false,
      isEnabled: false,
      host: null,
    });

    const res = await service.updateStatus(1, 101, 42, { stageId: 2 });

    expect(res).toBeDefined();
    expect(res.stageId).toBe(2);
    expect(res.emailNotification?.sent).toBe(false);
    expect(res.emailNotification?.status).toBe('FAILED');
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 101,
          status: 'FAILED',
          errorMessage: expect.stringContaining('SMTP Email Integration is not configured'),
        }),
      }),
    );
  });
});
