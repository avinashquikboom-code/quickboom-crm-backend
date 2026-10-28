import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadService } from './lead.service';

describe('LeadService - sendLeadDetails', () => {
  let service: LeadService;
  let mockPrisma: any;
  let mockLeadRepository: any;
  let mockEmailService: any;

  beforeEach(() => {
    mockLeadRepository = {};
    mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue({
        success: true,
        message: 'Email successfully sent',
        messageId: '<msg-12345@smtp.quickboom.com>',
      }),
    };
    mockPrisma = {
      lead: {
        findFirst: jest.fn(),
      },
      leadActivityTimeline: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    service = new LeadService(
      mockLeadRepository,
      mockPrisma,
      undefined,
      undefined,
      mockEmailService,
    );
  });

  it('should throw NotFoundException if lead does not exist', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(null);

    await expect(service.sendLeadDetails(1, 999)).rejects.toThrow(NotFoundException);
  });

  it('should throw BadRequestException if lead has no email address', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 10,
      title: 'Acme Corp',
      firstName: 'John',
      lastName: 'Doe',
      email: null,
      companyName: 'Acme Corp',
    });

    await expect(service.sendLeadDetails(1, 10)).rejects.toThrow(
      'has no email address configured. Please add an email address to the lead first.',
    );
  });

  it('should successfully dispatch lead details email and log to activity timeline', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 15,
      title: 'TechCorp Lead',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@techcorp.com',
      phone: '+91 9876543210',
      companyName: 'TechCorp Solutions',
      website: 'https://techcorp.com',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
      category: 'IT Services',
      status: 'QUALIFIED',
      value: 250000,
      source: 'WEBSITE',
      stage: { name: 'Qualified Lead' },
      assignedTo: { firstName: 'Bob', lastName: 'Manager', email: 'bob@crm.com' },
      customer: { companyName: 'QuickBoom Enterprise', name: 'QuickBoom Enterprise' },
    });

    const result = await service.sendLeadDetails(1, 15, { id: 2 });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('<msg-12345@smtp.quickboom.com>');
    expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@techcorp.com',
        subject: 'Lead Details: TechCorp Solutions',
        recordType: 'lead',
        recordId: 15,
      }),
      { id: 2 },
    );
    expect(mockPrisma.leadActivityTimeline.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 15,
        action: 'EMAIL_SENT',
      }),
    });
  });

  it('should propagate SMTP errors if email sending fails', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 20,
      title: 'Beta LLC',
      firstName: 'Charlie',
      lastName: 'Brown',
      email: 'charlie@beta.com',
    });
    mockEmailService.sendEmail.mockRejectedValue(
      new BadRequestException('Failed to send email via SMTP: Connection timeout'),
    );

    await expect(service.sendLeadDetails(1, 20)).rejects.toThrow(
      'Failed to send email via SMTP: Connection timeout',
    );
  });
});
