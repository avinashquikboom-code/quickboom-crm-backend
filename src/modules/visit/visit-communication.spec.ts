import { Test, TestingModule } from '@nestjs/testing';
import { VisitService } from './visit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService } from '../email/email-template.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { generateCalendarAppointmentPdfBuffer } from '../../common/utils/calendar-pdf.util';

describe('VisitService Communications', () => {
  let visitService: VisitService;
  let prisma: any;
  let emailService: any;
  let emailTemplateService: any;
  let whatsappService: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          name: 'Acme Corp',
          email: 'contact@acmecorp.com',
          phone: '+919876543210',
          users: [{ email: 'admin@acmecorp.com', phone: '+919876543210' }],
        }),
      },
      employee: {
        findFirst: jest.fn().mockResolvedValue({
          id: 5,
          firstName: 'Siddharth',
          lastName: 'Mehta',
          email: 'siddharth@quikboom.com',
        }),
        create: jest.fn(),
      },
      visit: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 101,
          ...data,
          employee: { id: 5, firstName: 'Siddharth', lastName: 'Mehta', email: 'siddharth@quikboom.com' },
          company: { id: 1, name: 'Acme Corp' },
          contact: { id: 2, firstName: 'Raj', lastName: 'Patel', email: 'raj@acmecorp.com', phone: '+919876543210' },
        })),
        findFirst: jest.fn(),
      },
    };

    emailService = {
      sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'email-123' }),
    };

    emailTemplateService = {
      findByKey: jest.fn().mockResolvedValue({
        id: 7,
        subject: 'Meeting Confirmed: {{eventTitle}}',
        body: '<p>Hi {{customerName}}, your meeting on {{date}} at {{time}} is confirmed.</p>',
      }),
    };

    whatsappService = {
      sendCalendarScheduledMessage: jest.fn().mockResolvedValue({
        success: true,
        messageId: 'wa-msg-123',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: EmailTemplateService, useValue: emailTemplateService },
        { provide: WhatsappService, useValue: whatsappService },
      ],
    }).compile();

    visitService = module.get<VisitService>(VisitService);
  });

  it('should generate Calendar Appointment PDF buffer successfully', async () => {
    const buffer = await generateCalendarAppointmentPdfBuffer({
      appointmentNo: 'APT-101',
      customerName: 'Raj Patel',
      companyName: 'Acme Corp',
      eventTitle: 'Social Media Strategy Session',
      date: '25/09/2026',
      time: '03:00 PM',
      location: 'Google Meet',
      assignedEmployeeName: 'Siddharth Mehta',
      assignedEmployeeEmail: 'siddharth@quikboom.com',
      notes: 'Review monthly reels and paid campaign targets.',
    });

    expect(buffer).toBeDefined();
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    // PDF magic bytes %PDF
    expect(buffer.toString('utf-8', 0, 4)).toBe('%PDF');
  });

  it('should automatically send Email with PDF attachment and WhatsApp with PDF when visit is created', async () => {
    const createdVisit = await visitService.create(1, {
      customerName: 'Raj Patel',
      purpose: 'Strategy Review & Content Planning',
      visitType: 'CLIENT_MEETING',
      date: '2026-09-25T09:30:00.000Z',
      time: '03:00 PM',
      location: 'Google Meet',
      notes: 'Discuss campaign deliverables',
    });

    expect(createdVisit).toBeDefined();
    expect(createdVisit.id).toBe(101);

    // Assert Email dispatch
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    const emailCall = emailService.sendEmail.mock.calls[0][0];
    expect(emailCall.to).toBe('raj@acmecorp.com');
    expect(emailCall.eventType).toBe('CALENDAR_SCHEDULED');
    expect(emailCall.attachments).toBeDefined();
    expect(emailCall.attachments.length).toBe(1);
    expect(emailCall.attachments[0].filename).toBe('Appointment-APT-101.pdf');
    expect(Buffer.isBuffer(emailCall.attachments[0].content)).toBe(true);

    // Assert WhatsApp dispatch
    expect(whatsappService.sendCalendarScheduledMessage).toHaveBeenCalledTimes(1);
    const waCall = whatsappService.sendCalendarScheduledMessage.mock.calls[0][0];
    expect(waCall.to).toBe('+919876543210');
    expect(waCall.customerName).toBe('Raj Patel');
    expect(waCall.eventTitle).toBe('Strategy Review & Content Planning');
    expect(waCall.pdfBuffer).toBeDefined();
    expect(Buffer.isBuffer(waCall.pdfBuffer)).toBe(true);
  });
});
