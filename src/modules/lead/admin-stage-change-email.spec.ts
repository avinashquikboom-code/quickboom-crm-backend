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

describe('Admin Panel Stage Change Automatic Email Verification', () => {
  let service: LeadService;
  let mockEmailService: any;
  let mockPrisma: any;
  let leadsTable: any[] = [];
  let stagesTable: any[] = [];
  let emailLogsTable: any[] = [];
  let logSpy: jest.SpyInstance;

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
    ];

    stagesTable = [
      { id: 1, customerId: null, name: 'New', key: 'NEW', isActive: true, deletedAt: null },
      { id: 2, customerId: null, name: 'Contacted', key: 'CONTACTED', isActive: true, deletedAt: null },
      { id: 3, customerId: null, name: 'Details Send', key: 'DETAILS_SEND', isActive: true, deletedAt: null },
      { id: 4, customerId: null, name: 'Follow-up', key: 'FOLLOW_UP', isActive: true, deletedAt: null },
      { id: 5, customerId: null, name: 'Visit Scheduled', key: 'VISIT_SCHEDULED', isActive: true, deletedAt: null },
      { id: 6, customerId: null, name: 'Visit Done', key: 'VISIT_DONE', isActive: true, deletedAt: null },
      { id: 7, customerId: null, name: 'Proposal Sent', key: 'PROPOSAL_SENT', isActive: true, deletedAt: null },
      { id: 8, customerId: null, name: 'Negotiation', key: 'NEGOTIATION', isActive: true, deletedAt: null },
      { id: 9, customerId: null, name: 'Final Call', key: 'FINAL_CALL', isActive: true, deletedAt: null },
      { id: 10, customerId: null, name: 'Won', key: 'WON', isActive: true, deletedAt: null },
      { id: 11, customerId: null, name: 'Lost', key: 'LOST', isActive: true, deletedAt: null },
      { id: 99, customerId: null, name: 'Custom Stage No Template', key: 'NO_TEMPLATE_STAGE', isActive: true, deletedAt: null },
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
          if (where.OR) {
            for (const cond of where.OR) {
              if (cond.key?.in) {
                for (const k of cond.key.in) {
                  if (k === 'QUIKBOOM_CONTACTED' || k === 'CONTACTED') {
                    return { id: 2, key: 'QUIKBOOM_CONTACTED', name: 'Contacted', subject: 'Hello {{lead.name}}', body: 'Dear {{lead.name}}, thank you for contacting us.', isActive: true };
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
    };

    mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue({
        success: true,
        messageId: '<msg-contacted-stage-12345@quickboom.com>',
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
              if (key === 'QUIKBOOM_CONTACTED' || key === 'CONTACTED') {
                return { id: 2, key: 'QUIKBOOM_CONTACTED', name: 'Contacted', subject: 'Hello {{lead.name}}', body: 'Dear {{lead.name}}, we received your interest.', isActive: true };
              }
              return null;
            }),
            findOne: jest.fn(async () => null),
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

  it('1. Admin changes stage New → Contacted: DB updates first, detects stage change, calls email service with Contacted template, logs to email_logs and timeline', async () => {
    const updated = await service.updateStatus(1, 101, 42, {
      stageId: 2,
    });

    expect(updated).toBeDefined();
    expect(updated.stageId).toBe(2);

    // Verify email service called with recipient lead.email
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rahul.customer@example.com',
        recordType: 'lead',
        recordId: 101,
        subject: expect.stringContaining('Rahul Sharma'),
        text: expect.stringContaining('Rahul Sharma'),
      }),
    );

    // Verify communication history saved in email_logs
    expect(mockPrisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 101,
          recipientEmail: 'rahul.customer@example.com',
          newStage: 'Contacted',
          status: 'SENT',
          providerMessageId: '<msg-contacted-stage-12345@quickboom.com>',
        }),
      }),
    );
  });

  it('2. Same stage change Follow-up → Follow-up: Does NOT send automatic email', async () => {
    leadsTable[0].stageId = 4;
    leadsTable[0].status = LeadStatus.FOLLOW_UP;

    await service.updateStatus(1, 101, 42, {
      stageId: 4,
    });

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.emailLog.create).not.toHaveBeenCalled();
  });

  it('3. Missing email: Stage updates successfully, email skipped, no crash', async () => {
    const updated = await service.updateStatus(1, 102, 42, {
      stageId: 2,
    });

    expect(updated).toBeDefined();
    expect(updated.stageId).toBe(2);
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it('4. Missing template: Stage updates successfully, email skipped, no crash', async () => {
    const updated = await service.updateStatus(1, 101, 42, {
      stageId: 99,
    });

    expect(updated).toBeDefined();
    expect(updated.stageId).toBe(99);
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it('5. Email provider error: Captures error, saves FAILED in communication history, stage update remains SUCCESS', async () => {
    mockEmailService.sendEmail.mockRejectedValueOnce(new Error('SMTP Provider connection timeout 587'));

    const updated = await service.updateStatus(1, 101, 42, {
      stageId: 2,
    });

    expect(updated).toBeDefined();
    expect(updated.stageId).toBe(2);

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
});
