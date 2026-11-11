import { Test, TestingModule } from '@nestjs/testing';
import { SendDetailsService } from './send-details.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { LeadRepository } from '../lead/lead.repository';
import { SendDetailsCategory } from './dto/send-details.dto';

describe('SendDetailsService', () => {
  let service: SendDetailsService;
  let mockPrisma: any;
  let mockWhatsapp: any;
  let mockEmail: any;
  let mockLeadRepo: any;

  beforeEach(async () => {
    let deliveryState: any = null;
    mockPrisma = {
      sendDetailsDocument: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...args.data })),
        findMany: jest.fn().mockResolvedValue([
          { id: 1, category: SendDetailsCategory.COMPANY_PROFILE, title: 'Company Profile', fileUrl: 'https://cdn/doc1.pdf' },
          { id: 2, category: SendDetailsCategory.SERVICE_CATALOGUE, title: 'Catalogue', fileUrl: 'https://cdn/doc2.pdf' },
        ]),
        findFirst: jest.fn().mockResolvedValue({ id: 1, title: 'Doc 1' }),
        update: jest.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      sendDetailsConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 1,
          customerId: 1,
          isAutomationEnabled: true,
          whatsappEnabled: true,
          emailEnabled: true,
          whatsappTemplateName: 'lead_stage_details_sent',
          emailSubject: 'Company Details',
        }),
        update: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...args.data })),
      },
      sendDetailsDelivery: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation((args) => {
          deliveryState = { id: 10, ...args.data };
          return Promise.resolve(deliveryState);
        }),
        update: jest.fn().mockImplementation((args) => {
          deliveryState = { ...deliveryState, ...args.data };
          return Promise.resolve(deliveryState);
        }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'Acme Corp', companyName: 'Acme Corp' }),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 100,
          customerId: 1,
          firstName: 'John',
          lastName: 'Doe',
          phone: '+919876543210',
          email: 'john@example.com',
        }),
      },
    };

    mockWhatsapp = {
      sendLeadStageMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'wa_msg_123' }),
      sendDocumentMessage: jest.fn().mockResolvedValue({ success: true }),
    };

    mockEmail = {
      sendEmail: jest.fn().mockResolvedValue({ messageId: 'email_msg_456' }),
    };

    mockLeadRepo = {
      logTimeline: jest.fn().mockResolvedValue({ id: 99 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendDetailsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WhatsappService, useValue: mockWhatsapp },
        { provide: EmailService, useValue: mockEmail },
        { provide: LeadRepository, useValue: mockLeadRepo },
      ],
    }).compile();

    service = module.get<SendDetailsService>(SendDetailsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('seeds 5 default documents if none exist for customer', async () => {
    mockPrisma.sendDetailsDocument.count.mockResolvedValue(0);
    await service.ensureDefaultDocuments(1);
    expect(mockPrisma.sendDetailsDocument.create).toHaveBeenCalledTimes(5);
  });

  it('triggers automatic send details on Details Sent transition and delivers via WhatsApp and Email', async () => {
    const lead = {
      id: 100,
      customerId: 1,
      firstName: 'Alice',
      lastName: 'Smith',
      phone: '+919999988888',
      email: 'alice@example.com',
    };

    const result: any = await service.triggerAutomaticSendDetails(1, lead, 'CONTACTED', 'Details Sent', 10);
    expect(result.overallStatus).toBe('SENT');
    expect(mockWhatsapp.sendLeadStageMessage).toHaveBeenCalled();
    expect(mockEmail.sendEmail).toHaveBeenCalled();
    expect(mockLeadRepo.logTimeline).toHaveBeenCalledWith(
      100,
      'AUTO_SEND_DETAILS',
      expect.stringContaining('SENT'),
      expect.any(Object),
    );
  });

  it('respects idempotency and skips duplicate dispatch if triggered within 2 minutes', async () => {
    mockPrisma.sendDetailsDelivery.findFirst.mockResolvedValue({ id: 55, createdAt: new Date() });

    const lead = { id: 100, customerId: 1, phone: '+919999988888', email: 'alice@example.com' };
    const result: any = await service.triggerAutomaticSendDetails(1, lead, 'CONTACTED', 'Details Sent', 10);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('DUPLICATE_THROTTLED');
    expect(mockWhatsapp.sendLeadStageMessage).not.toHaveBeenCalled();
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
  });

  it('handles partial delivery when WhatsApp succeeds but lead has no email', async () => {
    const lead = {
      id: 101,
      customerId: 1,
      firstName: 'Bob',
      phone: '+919999988888',
      email: '', // No email
    };

    const result: any = await service.triggerAutomaticSendDetails(1, lead, 'CONTACTED', 'Details Sent', 10);
    expect(result.whatsappStatus).toBe('SENT');
    expect(result.emailStatus).toBe('FAILED');
    expect(result.overallStatus).toBe('PARTIAL');
  });

  it('supports manual dispatch with custom channels', async () => {
    const result = await service.sendManual(1, 100, 5, {
      channels: ['WHATSAPP'],
      customNote: 'Special pricing for your team',
    });

    expect(mockWhatsapp.sendLeadStageMessage).toHaveBeenCalled();
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    expect(result.triggerType).toBe('MANUAL');
  });
});
