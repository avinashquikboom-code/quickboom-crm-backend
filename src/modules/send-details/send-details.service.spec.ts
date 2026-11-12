import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { SendDetailsService } from './send-details.service';

jest.mock('axios');
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { LeadRepository } from '../lead/lead.repository';
import { S3Service } from '../s3/s3.service';
import { SendDetailsCategory } from './dto/send-details.dto';

describe('SendDetailsService', () => {
  let service: SendDetailsService;
  let mockPrisma: any;
  let mockWhatsapp: any;
  let mockEmail: any;
  let mockLeadRepo: any;
  let mockS3: any;

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
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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

    (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: Buffer.from('%PDF-1.4 test') });
    mockWhatsapp = {
      sendLeadStageMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'wa_msg_123' }),
      sendDocumentMessage: jest.fn().mockResolvedValue({ success: true, messageId: 'wa_doc_123' }),
    };

    mockEmail = {
      sendEmail: jest.fn().mockResolvedValue({ messageId: 'email_msg_456' }),
    };

    mockLeadRepo = {
      logTimeline: jest.fn().mockResolvedValue({ id: 99 }),
    };

    mockS3 = {
      getPresignedUrl: jest.fn().mockImplementation((url: string) => Promise.resolve(url || null)),
      readPrivateObject: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendDetailsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WhatsappService, useValue: mockWhatsapp },
        { provide: EmailService, useValue: mockEmail },
        { provide: LeadRepository, useValue: mockLeadRepo },
        { provide: S3Service, useValue: mockS3 },
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
    expect(result.overallStatus).toBe('COMPLETED');
    expect(mockWhatsapp.sendDocumentMessage).toHaveBeenCalled();
    expect(result.whatsappMessageId).toBe('wa_doc_123');
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
    expect(result.emailStatus).toBe('SKIPPED');
    expect(result.emailError).toBe('Email skipped – Lead email address is missing.');
    expect(result.overallStatus).toBe('PARTIALLY_COMPLETED');
  });

  it('supports manual dispatch with custom channels', async () => {
    const result = await service.sendManual(1, 100, 5, {
      channels: ['WHATSAPP'],
      customNote: 'Special pricing for your team',
    });

    expect(mockWhatsapp.sendDocumentMessage).toHaveBeenCalled();
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    expect(result.triggerType).toBe('MANUAL');
  });

  it('keeps a sent WhatsApp message and retries only the failed email', async () => {
    mockPrisma.sendDetailsDelivery.findFirst.mockResolvedValue({
      id: 10,
      leadId: 100,
      customerId: 1,
      whatsappStatus: 'SENT',
      whatsappMessageId: 'wa_doc_123',
      emailStatus: 'FAILED',
      emailError: 'SMTP Email Integration is not configured.',
      documentIds: [1],
      channels: ['WHATSAPP', 'EMAIL'],
    });
    mockPrisma.sendDetailsDelivery.findUnique.mockResolvedValue({
      id: 10,
      whatsappStatus: 'SENT',
      whatsappMessageId: 'wa_doc_123',
      emailStatus: 'FAILED',
      channels: ['WHATSAPP', 'EMAIL'],
    });
    mockPrisma.sendDetailsDocument.findMany.mockResolvedValue([
      { id: 1, category: SendDetailsCategory.COMPANY_PROFILE, title: 'Company Profile', fileUrl: 'https://cdn/doc1.pdf', fileName: 'profile.pdf' },
    ]);

    const result: any = await service.retryDelivery(1, 10, 5, { channel: 'ALL' });

    expect(mockWhatsapp.sendDocumentMessage).not.toHaveBeenCalled();
    expect(mockEmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(result.whatsappStatus).toBe('SENT');
    expect(result.whatsappMessageId).toBe('wa_doc_123');
    expect(result.emailStatus).toBe('SENT');
  });

  it('rejects manual send when a selected document is not uploaded', async () => {
    mockPrisma.sendDetailsDocument.findMany.mockResolvedValue([
      {
        id: 1,
        category: SendDetailsCategory.COMPANY_PROFILE,
        title: 'Company Profile',
        fileUrl: 'https://storage.qbapp.online/documents/company_profile.pdf',
        fileName: 'profile.pdf',
      },
    ]);

    await expect(
      service.sendManual(1, 100, 5, {
        channels: ['EMAIL'],
        documentIds: [1],
      }),
    ).rejects.toThrow(/not been uploaded/i);
  });

  it('does not mark email as sent when an attachment could not be loaded', async () => {
    mockPrisma.sendDetailsDocument.findMany.mockResolvedValue([
      {
        id: 1,
        category: SendDetailsCategory.COMPANY_PROFILE,
        title: 'Company Profile',
        fileUrl: '',
        fileName: 'profile.pdf',
      },
    ]);

    await expect(
      service.sendManual(1, 100, 5, {
        channels: ['EMAIL'],
        documentIds: [1],
      }),
    ).rejects.toThrow();
  });

  it('sanitizes stale email errors in history when email already succeeded', async () => {
    mockPrisma.sendDetailsDelivery.findMany.mockResolvedValue([
      {
        id: 77,
        customerId: 1,
        leadId: 100,
        whatsappStatus: 'FAILED',
        whatsappError: 'Could not load 5 selected PDF(s)',
        emailStatus: 'SENT',
        emailError: 'Document "Company Profile" has not been uploaded',
        emailMessageId: 'email_msg_ok',
        channels: { selected: ['WHATSAPP', 'EMAIL'] },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const rows: any[] = await service.getDeliveryHistory(1);
    expect(rows[0].emailError).toBeNull();
    expect(rows[0].emailResult.error).toBeNull();
    expect(rows[0].whatsappError).toContain('Could not load');
  });

  it('records the provider reason when the WhatsApp document is not confirmed', async () => {
    mockWhatsapp.sendDocumentMessage.mockResolvedValue({
      success: false,
      error: '(#100) Tried accessing nonexisting field (whatsapp_business_account)',
      message: '(#100) Tried accessing nonexisting field (whatsapp_business_account)',
    });
    const lead = { id: 100, customerId: 1, firstName: 'Ada', phone: '+919876543210', email: 'ada@example.com' };
    const result: any = await service.triggerAutomaticSendDetails(1, lead, 'NEW', 'Details Sent', 10);
    expect(result.whatsappStatus).toBe('FAILED');
    expect(result.whatsappError).toContain('(#100)');
    expect(result.overallStatus).not.toBe('COMPLETED');
  });
});
