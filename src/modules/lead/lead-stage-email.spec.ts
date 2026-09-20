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
      { id: 3, customerId: null, name: 'Details Send', key: 'DETAILS_SEND', isActive: true, deletedAt: null },
      { id: 4, customerId: null, name: 'Follow-up', key: 'FOLLOW_UP', isActive: true, deletedAt: null },
      { id: 5, customerId: null, name: 'Qualified', key: 'QUALIFIED', isActive: true, deletedAt: null },
      { id: 6, customerId: null, name: 'Proposal', key: 'PROPOSAL', isActive: true, deletedAt: null },
      { id: 7, customerId: null, name: 'Custom Review', key: 'CUSTOM_REVIEW', isActive: true, deletedAt: null },
      { id: 8, customerId: null, name: 'Visit Scheduled', key: 'VISIT_SCHEDULED', isActive: true, deletedAt: null },
      { id: 9, customerId: null, name: 'Visit Done', key: 'VISIT_DONE', isActive: true, deletedAt: null },
      { id: 10, customerId: null, name: 'Negotiation', key: 'NEGOTIATION', isActive: true, deletedAt: null },
      { id: 11, customerId: null, name: 'Final Call', key: 'FINAL_CALL', isActive: true, deletedAt: null },
      { id: 12, customerId: null, name: 'Won', key: 'WON', isActive: true, deletedAt: null },
      { id: 13, customerId: null, name: 'Lost', key: 'LOST', isActive: true, deletedAt: null },
      { id: 14, customerId: null, name: 'Proposal Sent', key: 'PROPOSAL_SENT', isActive: true, deletedAt: null },
    ];

    emailLogsTable = [];
    timelineTable = [];

    mockPrisma = {
      $transaction: jest.fn(async (cb) => cb(mockPrisma)),
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
        create: jest.fn(async ({ data }) => {
          const newLead = {
            id: leadsTable.length + 500,
            ...data,
            deletedAt: null,
          };
          leadsTable.push(newLead);
          return newLead;
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
        findUnique: jest.fn(async ({ where }) => {
          return stagesTable.find((s) => s.id === where.id) || null;
        }),
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
      leadNote: {
        create: jest.fn(async ({ data }) => data),
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
      getStageTemplate: jest.fn((key) => {
        const norm = (key || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
        if (norm === 'CUSTOM_REVIEW' || norm === 'CUSTOM_NO_TEMPLATE') return null;
        return {
          key: norm,
          templateName: `lead_stage_${norm.toLowerCase()}`,
          name: `${norm} Stage`,
          body: `Hi {{leadName}}, stage updated to ${norm}`,
        };
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
        { provide: PlanAccessService, useValue: { checkFeatureAccess: jest.fn(), checkLeadLimit: jest.fn() } },
        { provide: LeadLimitService, useValue: { checkLeadLimit: jest.fn(), validateAndConsumeLeadLimit: jest.fn().mockResolvedValue({ employeeId: null }) } },
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

  it('CASE 2: Lead stage changes CONTACTED → QUALIFIED -> Sends QUIKBOOM_QUALIFIED template email', async () => {
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
        subject: 'Your Requirements Have Been Qualified – QUIKBOOM',
        text: expect.stringContaining('Dear Alice Cooper'),
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

  it('CASE 9: Prompt Requirement: Rahul Sharma New → Qualified sends formatted email to rahul@example.com using Qualified template', async () => {
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
        subject: 'Your Requirements Have Been Qualified – QUIKBOOM',
        text: expect.stringContaining('Dear Rahul Sharma'),
      }),
    );
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('qualified'),
      }),
    );
  });

  it('CASE 10: Updating lead stage via updateLead also triggers stage-based QUIKBOOM_QUALIFIED email', async () => {
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
        subject: 'Your Requirements Have Been Qualified – QUIKBOOM',
        text: expect.stringContaining('Dear Alice Cooper'),
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

  it('CASE 15: Stage changed to a stage with NO configured email template -> Stage updates successfully, NO email sent, does not throw', async () => {
    mockEmailService.sendEmail.mockClear();

    // Reset lead 101 to stage 1 (New)
    leadsTable[0].status = LeadStatus.NEW;
    leadsTable[0].stageId = 1;

    // Stage 7 is 'Custom Review' (key: CUSTOM_REVIEW) which does NOT have an email template configured
    const updated = await service.updateStatus(1, 101, 999, {
      status: 'CUSTOM_REVIEW' as any,
      stageId: 7,
    });

    expect(updated.stageId).toBe(7);

    // Email must NOT be sent, no generic fallback, no error thrown
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it('CASE 15b: Qualified → Proposal sends the Proposal template (QUIKBOOM_PROPOSAL_SENT), NOT Qualified or generic template', async () => {
    mockEmailService.sendEmail.mockClear();

    // Set lead 101 to Qualified
    leadsTable[0].status = LeadStatus.QUALIFIED;
    leadsTable[0].stageId = 5;

    // Transition Qualified -> Proposal
    const updated = await service.updateStatus(1, 101, 999, {
      status: LeadStatus.PROPOSAL,
      stageId: 6,
    });

    expect(updated.status).toBe(LeadStatus.PROPOSAL);
    expect(updated.stageId).toBe(6);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice.contact@acme.com',
        subject: 'Your Digital Marketing Proposal from QUIKBOOM',
        text: expect.stringContaining('shared the proposal'),
      }),
    );
  });

  it('CASE 16: Lead assigned to specific employee -> Signature uses assigned employee details', async () => {
    mockEmailService.sendEmail.mockClear();

    // Reset lead 101 to NEW and assign to specific employee
    leadsTable[0].status = LeadStatus.NEW;
    leadsTable[0].stageId = 1;
    leadsTable[0].assignedTo = {
      id: 42,
      firstName: 'Rahul',
      lastName: 'Sharma',
      email: 'rahul@quikboom.com',
    };

    await service.updateStatus(1, 101, 999, {
      status: LeadStatus.QUALIFIED,
      stageId: 5,
    });

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice.contact@acme.com',
        text: expect.stringContaining('Rahul Sharma'),
      }),
    );
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('rahul@quikboom.com'),
      }),
    );
  });

  it('CASE 17: NEW LEAD CREATED -> Automatically triggers Email and WhatsApp using initial stage templates', async () => {
    mockEmailService.sendEmail.mockClear();
    mockWhatsappService.sendLeadStageMessage.mockClear();

    const created = await service.createLead(1, 999, {
      title: 'Digital Marketing Package',
      firstName: 'Vikram',
      lastName: 'Mehta',
      email: 'vikram@example.com',
      phone: '+919876543211',
      stageId: 1, // Stage: New
    });

    expect(created).toBeDefined();
    expect(created.id).toBeDefined();

    // 1. Email sent using New stage template (QUIKBOOM_NEW_LEAD)
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'vikram@example.com',
        subject: 'Thank You for Connecting with QUIKBOOM',
        eventType: 'LEAD_CREATED',
      }),
    );

    // 2. WhatsApp sent using New stage template (NEW)
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(1);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543211',
        stageKey: 'NEW',
      }),
    );
  });

  it('CASE 18: NEW LEAD CREATED without email -> Email skipped, WhatsApp still sent to phone', async () => {
    mockEmailService.sendEmail.mockClear();
    mockWhatsappService.sendLeadStageMessage.mockClear();

    const created = await service.createLead(1, 999, {
      title: 'Phone Only Lead',
      firstName: 'Suresh',
      lastName: 'Patel',
      email: undefined,
      phone: '+919876543212',
      stageId: 1,
    });

    expect(created).toBeDefined();
    // Email skipped gracefully
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    // WhatsApp sent to phone
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(1);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543212',
        stageKey: 'NEW',
      }),
    );
  });

  it('CASE 19: NEW LEAD CREATED without phone -> WhatsApp skipped, Email still sent to email', async () => {
    mockEmailService.sendEmail.mockClear();
    mockWhatsappService.sendLeadStageMessage.mockClear();

    const created = await service.createLead(1, 999, {
      title: 'Email Only Lead',
      firstName: 'Deepak',
      lastName: 'Joshi',
      email: 'deepak@example.com',
      phone: undefined,
      stageId: 1,
    });

    expect(created).toBeDefined();
    // WhatsApp skipped gracefully
    expect(mockWhatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
    // Email sent
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'deepak@example.com',
        subject: 'Thank You for Connecting with QUIKBOOM',
      }),
    );
  });

  it('CASE 20: Stage change Contacted -> Qualified automatically triggers BOTH Email and WhatsApp for new stage', async () => {
    mockEmailService.sendEmail.mockClear();
    mockWhatsappService.sendLeadStageMessage.mockClear();

    // Set lead 101 to Contacted
    leadsTable[0].status = LeadStatus.CONTACTED;
    leadsTable[0].stageId = 2;
    leadsTable[0].phone = '+919876543210';

    await service.updateStatus(1, 101, 999, {
      status: LeadStatus.QUALIFIED,
      stageId: 5,
    });

    // Email sent with Qualified template
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice.contact@acme.com',
        subject: 'Your Requirements Have Been Qualified – QUIKBOOM',
      }),
    );

    // WhatsApp sent with Qualified stage template
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(1);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        stageKey: 'QUALIFIED',
      }),
    );
  });

  it('CASE 21: Same stage transition (QUALIFIED -> QUALIFIED) does NOT trigger Email or WhatsApp', async () => {
    mockEmailService.sendEmail.mockClear();
    mockWhatsappService.sendLeadStageMessage.mockClear();

    leadsTable[0].status = LeadStatus.QUALIFIED;
    leadsTable[0].stageId = 5;

    await service.updateStatus(1, 101, 999, {
      status: LeadStatus.QUALIFIED,
      stageId: 5,
    });

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    expect(mockWhatsappService.sendLeadStageMessage).not.toHaveBeenCalled();
  });

  it('CASE 22: All 11 CRM Lead Stages trigger their respective Email and WhatsApp templates', async () => {
    const elevenStages = [
      { id: 1, name: 'New', expectedEmailSubject: 'Thank You for Connecting with QUIKBOOM', expectedWhatsappKey: 'NEW' },
      { id: 2, name: 'Contacted', expectedEmailSubject: 'Great Speaking With You – QUIKBOOM', expectedWhatsappKey: 'CONTACTED' },
      { id: 3, name: 'Details Send', expectedEmailSubject: 'Company Details & Services', expectedWhatsappKey: 'DETAILS_SENT' },
      { id: 4, name: 'Follow-up', expectedEmailSubject: 'Following Up on Our Discussion – QUIKBOOM', expectedWhatsappKey: 'FOLLOW_UP' },
      { id: 8, name: 'Visit Scheduled', expectedEmailSubject: 'Your Meeting with QUIKBOOM is Scheduled', expectedWhatsappKey: 'VISIT_SCHEDULED' },
      { id: 9, name: 'Visit Done', expectedEmailSubject: 'Thank You for Visiting QUIKBOOM', expectedWhatsappKey: 'VISIT_DONE' },
      { id: 14, name: 'Proposal Sent', expectedEmailSubject: 'Your Digital Marketing Proposal from QUIKBOOM', expectedWhatsappKey: 'PROPOSAL_SENT' },
      { id: 10, name: 'Negotiation', expectedEmailSubject: "Let's Discuss Your Proposal – QUIKBOOM", expectedWhatsappKey: 'NEGOTIATION' },
      { id: 11, name: 'Final Call', expectedEmailSubject: 'Final Discussion Regarding Your Digital Marketing Requirements', expectedWhatsappKey: 'FINAL_CALL' },
      { id: 12, name: 'Won', expectedEmailSubject: "Welcome to QUIKBOOM – Let's Grow Together!", expectedWhatsappKey: 'WON' },
      { id: 13, name: 'Lost', expectedEmailSubject: 'Thank You for Considering QUIKBOOM', expectedWhatsappKey: 'LOST' },
    ];

    for (let i = 0; i < elevenStages.length; i++) {
      const stage = elevenStages[i];
      mockEmailService.sendEmail.mockClear();
      mockWhatsappService.sendLeadStageMessage.mockClear();

      // Reset lead to a different stage first to ensure transition
      leadsTable[0].stageId = stage.id === 1 ? 2 : 1;
      leadsTable[0].status = stage.id === 1 ? LeadStatus.CONTACTED : LeadStatus.NEW;
      leadsTable[0].phone = '+919876543210';
      leadsTable[0].email = 'lead@example.com';

      await service.updateStatus(1, 101, 999, {
        stageId: stage.id,
      });

      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'lead@example.com',
          subject: expect.stringContaining(stage.expectedEmailSubject),
        }),
      );

      expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(1);
      expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '919876543210',
          stageKey: stage.expectedWhatsappKey,
        }),
      );
    }
  });

  it('✓ CASE 23: Replaces dot-notation variables {{lead.name}}, {{lead.email}}, {{lead.phone}}, {{lead.company}}, {{lead.stage}}', async () => {
    mockEmailService.sendEmail.mockClear();

    // Create custom template with dot-notation variables
    const customTemplate = {
      id: 99,
      key: 'QUIKBOOM_FOLLOW_UP',
      name: 'Custom Follow Up',
      subject: 'Hello {{lead.name}} from {{lead.company}}',
      body: 'Dear {{lead.name}}, email: {{lead.email}}, phone: {{lead.phone}}, stage: {{lead.stage}}',
      isActive: true,
    };
    stagesTable.find((s) => s.id === 4)!.key = 'FOLLOW_UP';

    // Mock template resolution
    mockPrisma.emailTemplate = {
      findFirst: jest.fn(async () => customTemplate),
    };

    leadsTable[0].stageId = 1;
    leadsTable[0].status = LeadStatus.NEW;
    leadsTable[0].firstName = 'David';
    leadsTable[0].lastName = 'Miller';
    leadsTable[0].email = 'david.m@example.com';
    leadsTable[0].phone = '+919988776655';
    leadsTable[0].companyName = 'Miller Tech';

    await service.updateStatus(1, 101, 999, {
      stageId: 4, // Follow-up
    });

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    const sentArg = mockEmailService.sendEmail.mock.calls[0][0];
    expect(sentArg.to).toBe('david.m@example.com');
    expect(sentArg.subject).toContain('David Miller');
    expect(sentArg.subject).toContain('Miller Tech');
    expect(sentArg.html).toContain('David Miller');
    expect(sentArg.html).toContain('david.m@example.com');
    expect(sentArg.html).toContain('+919988776655');
    expect(sentArg.html).toContain('Follow-up');
  });

  it('✓ CASE 24: Unconfigured stage does not fail stage update and does not send email', async () => {
    mockEmailService.sendEmail.mockClear();

    // Add stage with no corresponding template
    stagesTable.push({
      id: 999,
      customerId: 1,
      name: 'Custom Review Pending',
      key: 'CUSTOM_STAGE_NO_TEMPLATE',
      isActive: true,
      deletedAt: null,
    });

    mockPrisma.emailTemplate = {
      findFirst: jest.fn(async () => null),
    };

    leadsTable[0].stageId = 1;
    leadsTable[0].status = LeadStatus.NEW;
    leadsTable[0].email = 'client@example.com';

    const updated = await service.updateStatus(1, 101, 999, {
      stageId: 999,
    });

    expect(updated).toBeDefined();
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it('✓ CASE 25: Provider error captures real error, marks EmailLog as FAILED, and does not crash stage update', async () => {
    mockEmailService.sendEmail.mockClear();
    mockEmailService.sendEmail.mockRejectedValueOnce(new Error('SMTP connection timed out on port 587'));

    leadsTable[0].stageId = 1;
    leadsTable[0].status = LeadStatus.NEW;
    leadsTable[0].email = 'client@example.com';

    const updated = await service.updateStatus(1, 101, 999, {
      stageId: 2, // Contacted
    });

    expect(updated).toBeDefined();
    expect(emailLogsTable.length).toBeGreaterThan(0);
    const lastLog = emailLogsTable[emailLogsTable.length - 1];
    expect(lastLog.status).toBe('FAILED');
    expect(lastLog.errorMessage).toContain('SMTP connection timed out');
  });

  it('✓ CASE 26: Email and WhatsApp are dispatched in parallel and WhatsApp delay does not delay Email', async () => {
    mockEmailService.sendEmail.mockClear();
    mockWhatsappService.sendLeadStageMessage.mockClear();

    let emailSentTime = 0;
    let whatsappFinishedTime = 0;

    mockEmailService.sendEmail.mockImplementation(async () => {
      emailSentTime = Date.now();
      return { success: true, messageId: '<msg-123@smtp>', providerDurationMs: 50 };
    });

    mockWhatsappService.sendLeadStageMessage.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      whatsappFinishedTime = Date.now();
      return { success: true };
    });

    leadsTable[0].stageId = 1;
    leadsTable[0].status = LeadStatus.NEW;
    leadsTable[0].email = 'fast@example.com';
    leadsTable[0].phone = '+919876543210';

    await service.updateStatus(1, 101, 999, {
      stageId: 2, // Contacted
    });

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockWhatsappService.sendLeadStageMessage).toHaveBeenCalledTimes(1);
    expect(emailSentTime).toBeGreaterThan(0);
  });

  describe('User Requirement: Automatic Email on New Lead Creation (Cases 1-6)', () => {
    it('CASE 1: Create Lead with stage = New -> New-stage Email Template automatically sent', async () => {
      mockEmailService.sendEmail.mockClear();

      const created = await service.createLead(1, 999, {
        title: 'New Lead Auto Email',
        firstName: 'Ananya',
        lastName: 'Sharma',
        email: 'ananya@example.com',
        stageId: 1, // Stage 1 = New
      });

      expect(created).toBeDefined();
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ananya@example.com',
          subject: expect.stringContaining('Thank You for Connecting with QUIKBOOM'),
          eventType: 'LEAD_CREATED',
        }),
      );
    });

    it('CASE 2: Create Lead with stage = New but no email template exists -> Lead created successfully, No email sent, Warning logged', async () => {
      mockEmailService.sendEmail.mockClear();

      // Create with a custom stage that has no template configured in system or DB
      stagesTable.push({
        id: 99,
        customerId: 1,
        name: 'Custom Unconfigured Initial Stage',
        key: 'CUSTOM_INITIAL_STAGE_NO_TPL',
        color: '#10B981',
        isActive: true,
      });

      const created = await service.createLead(1, 999, {
        title: 'No Template Lead',
        firstName: 'Rajesh',
        lastName: 'Verma',
        email: 'rajesh@example.com',
        stageId: 99,
      });

      expect(created).toBeDefined();
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('CASE 3: Create Lead without email address -> Lead created successfully, Email skipped safely', async () => {
      mockEmailService.sendEmail.mockClear();

      const created = await service.createLead(1, 999, {
        title: 'No Email Lead',
        firstName: 'Pooja',
        lastName: 'Kulkarni',
        email: undefined,
        stageId: 1, // New
      });

      expect(created).toBeDefined();
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('CASE 4: Contacted -> Follow-up -> Follow-up email sent', async () => {
      mockEmailService.sendEmail.mockClear();

      leadsTable[0].stageId = 2; // Contacted
      leadsTable[0].status = LeadStatus.CONTACTED;
      leadsTable[0].email = 'followup.lead@example.com';

      const updated = await service.updateStatus(1, 101, 999, {
        stageId: 4, // Follow-up
      });

      expect(updated).toBeDefined();
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'followup.lead@example.com',
          subject: expect.stringContaining('Following Up on Our Discussion – QUIKBOOM'),
          eventType: 'LEAD_STAGE_CHANGED',
        }),
      );
    });

    it('CASE 5: Follow-up -> Follow-up -> No automatic email', async () => {
      mockEmailService.sendEmail.mockClear();

      leadsTable[0].stageId = 4; // Follow-up
      leadsTable[0].status = LeadStatus.FOLLOW_UP;
      leadsTable[0].email = 'followup.lead@example.com';

      const updated = await service.updateStatus(1, 101, 999, {
        stageId: 4, // Follow-up (same stage)
      });

      expect(updated).toBeDefined();
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('CASE 6: Create Lead -> New -> Exactly ONE New-stage email', async () => {
      mockEmailService.sendEmail.mockClear();

      const created = await service.createLead(1, 999, {
        title: 'Deduplicated New Lead',
        firstName: 'Sunil',
        lastName: 'Mehta',
        email: 'sunil@example.com',
        stageId: 1, // New
      });

      expect(created).toBeDefined();
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);

      // Attempt to immediately update same stage or trigger duplicate notification
      await service.updateStatus(1, created.id, 999, {
        stageId: 1, // New
      });

      // Email count must remain exactly 1
      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    });
  });
});

