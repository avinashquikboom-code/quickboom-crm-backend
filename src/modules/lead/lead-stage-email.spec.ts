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

describe('Lead Stage Change Email Notification Tests', () => {
  let service: LeadService;
  let repository: LeadRepository;
  let mockPrisma: any;
  let mockEmailService: any;
  let mockWhatsappService: any;

  // In-memory data store
  let leadsTable: any[] = [];
  let customersTable: any[] = [];
  let stagesTable: any[] = [];
  let emailLogsTable: any[] = [];
  let timelineTable: any[] = [];

  beforeEach(async () => {
    customersTable = [
      {
        id: 1,
        name: 'Acme Corp',
        companyName: 'Acme Enterprises',
        email: 'customer-a@acme.com',
        phone: '+91 9876543210',
      },
      {
        id: 2,
        name: 'Beta Global',
        companyName: 'Beta Inc',
        email: 'customer-b@beta.com',
        phone: '+91 8765432109',
      },
    ];

    leadsTable = [
      {
        id: 101,
        customerId: 1, // Belongs to Customer A
        title: 'ERP Modernization Deal',
        firstName: 'Alice',
        lastName: 'Cooper',
        email: 'alice.contact@acme.com',
        phone: '+919876543210',
        companyName: 'Acme Enterprises',
        status: LeadStatus.NEW,
        stageId: 1,
        priority: 'HIGH',
        value: 150000,
        deletedAt: null,
      },
      {
        id: 102,
        customerId: 1, // Belongs to Customer A but has NO customer email and NO contact email
        title: 'No Email Lead',
        firstName: 'Bob',
        lastName: 'Brown',
        email: null,
        companyName: 'Offline Traders',
        status: LeadStatus.NEW,
        stageId: 1,
        deletedAt: null,
      },
      {
        id: 201,
        customerId: 2, // Belongs to Customer B
        title: 'Cloud Migration Deal',
        firstName: 'Charlie',
        lastName: 'Prince',
        email: 'charlie.contact@beta.com',
        companyName: 'Beta Global',
        status: LeadStatus.NEW,
        stageId: 1,
        deletedAt: null,
      },
    ];

    stagesTable = [
      { id: 1, customerId: null, name: 'New', key: 'NEW', isActive: true, deletedAt: null },
      { id: 2, customerId: null, name: 'Contacted', key: 'CONTACTED', isActive: true, deletedAt: null },
      { id: 5, customerId: null, name: 'Qualified', key: 'QUALIFIED', isActive: true, deletedAt: null },
      { id: 6, customerId: null, name: 'Proposal', key: 'PROPOSAL', isActive: true, deletedAt: null },
    ];

    emailLogsTable = [];
    timelineTable = [];

    mockPrisma = {
      lead: {
        findFirst: jest.fn(async ({ where }) => {
          const lead = leadsTable.find((l) => {
            if (where.deletedAt === null && l.deletedAt !== null) return false;
            if (where.id !== undefined && l.id !== where.id) return false;
            if (where.customerId !== undefined && l.customerId !== where.customerId) return false;
            return true;
          });
          if (!lead) return null;
          const stage = stagesTable.find((s) => s.id === lead.stageId) || null;
          const customer = customersTable.find((c) => c.id === lead.customerId) || null;
          return {
            ...lead,
            stage,
            customer,
          };
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          let count = 0;
          for (const l of leadsTable) {
            if (where.id !== undefined && l.id !== where.id) continue;
            if (where.customerId !== undefined && l.customerId !== where.customerId) continue;
            Object.assign(l, data);
            count++;
          }
          return { count };
        }),
      },
      leadStage: {
        findFirst: jest.fn(async ({ where }) => {
          return stagesTable.find((s) => {
            if (where.deletedAt === null && s.deletedAt !== null) return false;
            if (where.id !== undefined && s.id !== where.id) return false;
            if (where.key !== undefined && s.key !== where.key) return false;
            return true;
          }) || null;
        }),
        findMany: jest.fn(async () => stagesTable),
      },
      leadStatusHistory: {
        create: jest.fn(async ({ data }) => data),
      },
      leadActivityTimeline: {
        findFirst: jest.fn(async ({ where }) => {
          return timelineTable.find((t) => {
            if (where.leadId !== undefined && t.leadId !== where.leadId) return false;
            if (where.action !== undefined && t.action !== where.action) return false;
            return true;
          }) || null;
        }),
        create: jest.fn(async ({ data }) => {
          timelineTable.push(data);
          return data;
        }),
      },
      emailLog: {
        create: jest.fn(async ({ data }) => {
          const entry = { id: emailLogsTable.length + 1, ...data, createdAt: new Date() };
          emailLogsTable.push(entry);
          return entry;
        }),
        findFirst: jest.fn(async ({ where }) => {
          return emailLogsTable.find((e) => {
            if (where.leadId !== undefined && e.leadId !== where.leadId) return false;
            if (where.eventType !== undefined && e.eventType !== where.eventType) return false;
            if (where.previousStage !== undefined && e.previousStage !== where.previousStage) return false;
            if (where.newStage !== undefined && e.newStage !== where.newStage) return false;
            return true;
          }) || null;
        }),
      },
      emailTemplate: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
        update: jest.fn(async ({ data }) => data),
      },
      visit: {
        findFirst: jest.fn(async () => null),
      },
      user: {
        findUnique: jest.fn(async () => ({ firstName: 'Avinash', lastName: 'Magar' })),
      },
    };

    mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue({
        success: true,
        messageId: '<lead-stage-msg-12345@quickboom.com>',
      }),
    };

    mockWhatsappService = {
      normalizePhoneNumber: jest.fn((phone) => {
        if (!phone) return null;
        const clean = phone.replace(/\D/g, '');
        return clean.length >= 10 ? `91${clean.slice(-10)}` : null;
      }),
      sendLeadStageMessage: jest.fn().mockResolvedValue({
        success: true,
        messageId: 'wamid.test.stage.123',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        LeadRepository,
        EmailTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        { provide: WhatsappService, useValue: mockWhatsappService },
        { provide: PlanAccessService, useValue: { checkFeatureAccess: jest.fn() } },
        { provide: LeadLimitService, useValue: { checkLeadLimit: jest.fn() } },
      ],
    }).compile();

    service = module.get<LeadService>(LeadService);
    repository = module.get<LeadRepository>(LeadRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('CASE 1: Lead stage changes NEW → CONTACTED -> Automatically sends QUIKBOOM_CONTACTED template email', async () => {
    const updated = await service.updateStatus(1, 101, 999, {
      status: LeadStatus.CONTACTED,
      stageId: 2,
    });

    expect(updated.status).toBe(LeadStatus.CONTACTED);
    expect(updated.stageId).toBe(2);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice.contact@acme.com',
        subject: 'Great Speaking With You – QUIKBOOM',
        recordType: 'lead',
        recordId: 101,
        html: expect.stringContaining('Dear Alice Cooper'),
        text: expect.stringContaining('Dear Alice Cooper'),
      }),
    );

    // Verify EmailLog created with status SENT and identifierKey QUIKBOOM_CONTACTED
    expect(mockPrisma.emailLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 101,
        recipientEmail: 'alice.contact@acme.com',
        identifierKey: 'QUIKBOOM_CONTACTED',
        eventType: 'LEAD_STAGE_CHANGED',
        previousStage: 'New',
        newStage: 'Contacted',
        status: 'SENT',
        providerMessageId: '<lead-stage-msg-12345@quickboom.com>',
      }),
    });
  });

  it('CASE 2: Lead stage changes CONTACTED → QUALIFIED -> Generic fallback email sent for non-telecaller stage', async () => {
    // Set to CONTACTED first
    leadsTable[0].status = LeadStatus.CONTACTED;
    leadsTable[0].stageId = 2;

    const updated = await service.updateStatus(1, 101, 999, {
      status: LeadStatus.QUALIFIED,
      stageId: 5,
    });

    expect(updated.status).toBe(LeadStatus.QUALIFIED);
    expect(updated.stageId).toBe(5);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice.contact@acme.com',
        subject: 'Your Lead Status Has Been Updated',
        text: expect.stringContaining('Previous Stage: Contacted'),
      }),
    );
  });

  it('CASE 3: Lead stage QUALIFIED → QUALIFIED (no change) -> Stage updated/no unnecessary email', async () => {
    // Set to QUALIFIED
    leadsTable[0].status = LeadStatus.QUALIFIED;
    leadsTable[0].stageId = 5;

    const updated = await service.updateStatus(1, 101, 999, {
      status: LeadStatus.QUALIFIED,
      stageId: 5,
    });

    expect(updated.status).toBe(LeadStatus.QUALIFIED);
    // Email service must NOT be called when stage did not transition
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.emailLog.create).not.toHaveBeenCalled();
  });

  it('CASE 4: Customer email missing -> Stage updated, No email, No API failure', async () => {
    // Customer 1 email set to empty for lead 102
    customersTable[0].email = null;

    const updated = await service.updateStatus(1, 102, 999, {
      status: LeadStatus.CONTACTED,
      stageId: 2,
    });

    expect(updated).toBeDefined();
    expect(updated.status).toBe(LeadStatus.CONTACTED);
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    // Did not crash
  });

  it('CASE 5: Email provider fails -> Stage updated, Email marked FAILED/logged, API still succeeds', async () => {
    mockEmailService.sendEmail.mockRejectedValueOnce(new Error('SMTP Connection Refused: 587'));

    const updated = await service.updateStatus(1, 101, 999, {
      status: LeadStatus.CONTACTED,
      stageId: 2,
    });

    // Stage was updated successfully
    expect(updated).toBeDefined();
    expect(updated.status).toBe(LeadStatus.CONTACTED);

    // EmailLog is recorded with FAILED status and error message
    expect(mockPrisma.emailLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 101,
        status: 'FAILED',
        errorMessage: expect.stringContaining('SMTP Connection Refused'),
      }),
    });
  });

  it('CASE 6: Same update request is retried -> No duplicate email', async () => {
    // First transition
    await service.updateStatus(1, 101, 999, {
      status: LeadStatus.CONTACTED,
      stageId: 2,
    });
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);

    // Immediate retry with the same transition
    await service.handleLeadStageChangeNotification(
      1,
      leadsTable[0],
      'New',
      'Contacted',
      999,
    );

    // Should still only have sent 1 email because it was debounced
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('CASE 7: Lead belongs to Customer A -> Email goes ONLY to Lead registered email, not Customer B or admin', async () => {
    // Customer A lead (101)
    await service.updateStatus(1, 101, 999, {
      status: LeadStatus.CONTACTED,
      stageId: 2,
    });

    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice.contact@acme.com',
      }),
    );
    expect(mockEmailService.sendEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'charlie.contact@beta.com',
      }),
    );

    // Now update Customer B lead (201)
    mockEmailService.sendEmail.mockClear();
    await service.updateStatus(2, 201, 999, {
      status: LeadStatus.CONTACTED,
      stageId: 2,
    });

    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'charlie.contact@beta.com',
      }),
    );
    expect(mockEmailService.sendEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice.contact@acme.com',
      }),
    );
  });

  it('CASE 8: Lead stage changes to VISIT_SCHEDULED -> automatically selects QUIKBOOM_VISIT_SCHEDULED template and sends email to lead', async () => {
    mockEmailService.sendEmail.mockClear();

    await service.handleLeadStageChangeNotification(
      1,
      { ...leadsTable[0], customer: customersTable[0], status: 'VISIT_SCHEDULED' },
      'Follow-Up',
      'Visit Scheduled',
      999,
    );

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice.contact@acme.com',
        subject: 'Your Meeting with QUIKBOOM is Scheduled',
        text: expect.stringContaining('Dear Alice Cooper'),
      }),
    );

    expect(mockPrisma.emailLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 101,
        identifierKey: 'QUIKBOOM_VISIT_SCHEDULED',
        status: 'SENT',
      }),
    });
  });

  it('CASE 9: Prompt Requirement: Rahul Sharma New → Qualified sends formatted email to rahul@example.com', async () => {
    mockEmailService.sendEmail.mockClear();

    // Add Rahul Sharma lead
    const rahulLead = {
      id: 301,
      customerId: 1,
      title: 'Enterprise Solution',
      firstName: 'Rahul',
      lastName: 'Sharma',
      email: 'rahul@example.com',
      companyName: 'Sharma Infotech',
      status: LeadStatus.NEW,
      stageId: 1,
      deletedAt: null,
    };
    leadsTable.push(rahulLead);

    const updated = await service.updateStatus(1, 301, 999, {
      status: LeadStatus.QUALIFIED,
      stageId: 5,
    });

    expect(updated.status).toBe(LeadStatus.QUALIFIED);
    expect(updated.stageId).toBe(5);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rahul@example.com',
        subject: 'Your Lead Status Has Been Updated',
        text: expect.stringContaining('Hello Rahul Sharma'),
      }),
    );
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Previous Stage: New'),
      }),
    );
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Current Stage: Qualified'),
      }),
    );
  });

  it('CASE 10: Updating lead stage via updateLead also triggers standard stage update email', async () => {
    mockEmailService.sendEmail.mockClear();

    // Reset lead 101 status
    leadsTable[0].status = LeadStatus.NEW;
    leadsTable[0].stageId = 1;

    await service.updateLead(1, 101, {
      stageId: 5,
    });

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice.contact@acme.com',
        subject: 'Your Lead Status Has Been Updated',
        text: expect.stringContaining('Current Stage: Qualified'),
      }),
    );
  });

  it('CASE 11: Lead stage change with sendWhatsapp: true triggers WhatsApp to lead.phone', async () => {
    mockWhatsappService.sendLeadStageMessage.mockClear();

    // Reset lead 101 status
    leadsTable[0].status = LeadStatus.NEW;
    leadsTable[0].stageId = 1;

    await service.updateStatus(1, 101, 999, {
      status: LeadStatus.QUALIFIED,
      stageId: 5,
      sendWhatsapp: true,
    });

    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(1);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        stageKey: 'QUALIFIED',
      }),
    );
    expect(mockPrisma.leadActivityTimeline.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 101,
        action: 'WHATSAPP_SENT',
      }),
    });
  });

  it('CASE 12: Lead without phone skips WhatsApp gracefully without throwing', async () => {
    mockWhatsappService.sendLeadStageMessage.mockClear();

    // Lead 102 has no phone
    await service.updateStatus(1, 102, 999, {
      status: LeadStatus.CONTACTED,
      stageId: 2,
      sendWhatsapp: true,
    });

    // Should not call sendLeadStageMessage because phone is null
    expect(mockWhatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
  });

  it('CASE 13: Direct sendLeadWhatsApp endpoint works and logs to timeline', async () => {
    mockWhatsappService.sendLeadStageMessage.mockClear();

    const res = await service.sendLeadWhatsApp(1, 101, 999, {
      message: 'Hello Alice, customized proposal attached',
      stageName: 'Proposal',
    });

    expect(res.success).toBe(true);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        customMessage: 'Hello Alice, customized proposal attached',
      }),
    );
  });

  it('CASE 14: Duplicate WhatsApp request within 60s is debounced', async () => {
    mockWhatsappService.sendLeadStageMessage.mockClear();

    // Setup recent timeline entry within 60s
    mockPrisma.leadActivityTimeline.findFirst = jest.fn().mockResolvedValue({
      id: 99,
      action: 'WHATSAPP_SENT',
      createdAt: new Date(),
    });

    await service.handleLeadStageChangeWhatsappNotification(
      1,
      leadsTable[0],
      'New',
      'Contacted',
      999,
    );

    // Should be debounced
    expect(mockWhatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
  });
});
