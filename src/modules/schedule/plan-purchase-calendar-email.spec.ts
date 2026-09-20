import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleService } from './schedule.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService } from '../email/email-template.service';
import { PaymentService } from '../payment/payment.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { WorkService } from '../work/work.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { NotificationService } from '../notification/notification.service';
import { InvoiceService } from '../invoice/invoice.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { CustomPlanService } from '../subscription/custom-plan.service';
import { InstallmentService } from '../subscription/installment.service';
import { generateICalendarInvite } from '../../common/utils/calendar-ics.util';
import { BUSINESS_TIMEZONE } from '../../common/utils/timezone.util';
import { SubscriptionStatus } from '@prisma/client';

describe('Customer Plan Purchase → Calendar Schedule Email Automation', () => {
  let scheduleService: ScheduleService;
  let paymentService: PaymentService;
  let subscriptionService: SubscriptionService;
  let prisma: any;
  let emailService: any;
  let emailTemplateService: any;
  let notificationService: any;
  let workService: any;

  // In-memory tables for realistic simulation
  let emailLogs: any[] = [];
  let schedules: any[] = [];

  const mockCustomer = {
    id: 101,
    name: 'Acme Technologies',
    companyName: 'Acme Technologies Pvt Ltd',
    email: 'contact@acme.com',
    phone: '+919876543210',
    city: 'Mumbai',
    state: 'Maharashtra',
    assignedEmployee: 'Rohan Sharma',
    assignedEmployeeId: 12,
    assignedEmployeeRel: {
      id: 12,
      firstName: 'Rohan',
      lastName: 'Sharma',
      email: 'rohan.sharma@quikboom.com',
      phone: '+919988776655',
    },
    users: [{ id: 5, email: 'admin@acme.com', firstName: 'Acme', lastName: 'Admin' }],
  };

  const mockPlan = {
    id: 1,
    name: 'Growth Accelerate Plan',
    code: 'GROWTH_PLAN',
    monthlyPrice: 15000,
    yearlyPrice: 150000,
    features: ['10 Reels', '20 Creative Posts', 'Dedicated Account Manager'],
    isActive: true,
  };

  const mockSubscription = {
    id: 201,
    customerId: 101,
    planId: 1,
    status: SubscriptionStatus.ACTIVE,
    billingCycle: 'MONTHLY',
    duration: 1,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-11-01T00:00:00.000Z'),
    customer: mockCustomer,
    plan: mockPlan,
  };

  beforeEach(async () => {
    emailLogs = [];
    schedules = [];

    prisma = {
      customer: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 101) return Promise.resolve(mockCustomer);
          if (where.id === 999) return Promise.resolve(null);
          return Promise.resolve(null);
        }),
      },
      customerSubscription: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 201) return Promise.resolve(mockSubscription);
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(mockSubscription)),
        update: jest.fn().mockResolvedValue(mockSubscription),
        create: jest.fn().mockResolvedValue(mockSubscription),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      plan: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 1) return Promise.resolve(mockPlan);
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(mockPlan)),
      },
      monthlySchedule: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id) {
            const found = schedules.find((s) => s.id === where.id);
            return Promise.resolve(found || null);
          }
          const found = schedules.find((s) => s.customerId === where.customerId && s.subscriptionId === where.subscriptionId);
          return Promise.resolve(found || null);
        }),
        findMany: jest.fn().mockImplementation(() => Promise.resolve(schedules)),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const emp = data.assignedEmployeeId ? mockCustomer.assignedEmployeeRel : null;
          const item = {
            id: schedules.length + 1,
            ...data,
            assignedEmployee: emp,
            plan: mockPlan,
            customer: mockCustomer,
            createdAt: new Date(),
          };
          schedules.push(item);
          return Promise.resolve(item);
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const idx = schedules.findIndex((s) => s.id === where.id);
          if (idx !== -1) {
            schedules[idx] = { ...schedules[idx], ...data };
            return Promise.resolve(schedules[idx]);
          }
          return Promise.resolve({ id: where.id, ...data });
        }),
      },
      emailLog: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          const found = emailLogs.find((l) => {
            if (where.customerId && l.customerId !== where.customerId) return false;
            if (where.planId && l.planId !== where.planId) return false;
            if (where.appointmentId && l.appointmentId !== where.appointmentId) return false;
            if (where.eventType && l.eventType !== where.eventType) return false;
            if (where.status && l.status !== where.status) return false;
            return true;
          });
          return Promise.resolve(found || null);
        }),
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          let filtered = [...emailLogs];
          if (where?.customerId) filtered = filtered.filter((l) => l.customerId === where.customerId);
          if (where?.appointmentId) filtered = filtered.filter((l) => l.appointmentId === where.appointmentId);
          return Promise.resolve(filtered);
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const log = { id: emailLogs.length + 1, createdAt: new Date(), ...data };
          emailLogs.push(log);
          return Promise.resolve(log);
        }),
      },
      lead: {
        findFirst: jest.fn().mockResolvedValue({ id: 55, customerId: 101, firstName: 'Acme', lastName: 'Lead' }),
      },
      employee: {
        findFirst: jest.fn().mockResolvedValue(mockCustomer.assignedEmployeeRel),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      integrationSetting: {
        findFirst: jest.fn().mockResolvedValue({
          provider: 'SMTP',
          isEnabled: true,
          config: { fromEmail: 'notifications@quikboom.com', fromName: 'QuikBoom Team' },
        }),
      },
    };

    emailService = {
      sendEmail: jest.fn().mockImplementation(async (dto: any) => {
        const log = {
          id: emailLogs.length + 1,
          customerId: dto.recordId ? Number(dto.recordId) : null,
          recipientEmail: dto.to,
          subject: dto.subject,
          renderedContent: dto.html || dto.text,
          eventType: dto.eventType,
          identifierKey: dto.identifierKey,
          appointmentId: dto.appointmentId,
          planId: dto.planId,
          channel: dto.channel || 'EMAIL',
          status: 'SENT',
          providerMessageId: 'msg-mock-12345',
          sentAt: new Date(),
          createdAt: new Date(),
        };
        emailLogs.push(log);
        return {
          success: true,
          messageId: 'msg-mock-12345',
          emailLogId: log.id,
        };
      }),
    };

    emailTemplateService = {
      findByKey: jest.fn().mockImplementation(async (key: string) => {
        if (key === 'PLAN_PURCHASE_CALENDAR_SCHEDULE') {
          return {
            id: 10,
            key: 'PLAN_PURCHASE_CALENDAR_SCHEDULE',
            subject: 'Your Scheduled Appointment for {{planName}} Plan – {{companyName}}',
            body: '<p>Hello {{customerName}}, your scheduled appointment: {{appointmentTitle}} on {{date}} from {{startTime}} to {{endTime}} ({{timezone}}). Location: {{location}}. Meeting: {{meetingLink}}. Rep: {{assignedEmployeeName}}.</p>',
            isActive: true,
          };
        }
        return null;
      }),
    };

    notificationService = {
      sendPlanPurchaseSuccessNotification: jest.fn().mockResolvedValue({ success: true }),
    };

    workService = {
      generatePlanSchedules: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: EmailTemplateService, useValue: emailTemplateService },
      ],
    }).compile();

    scheduleService = module.get<ScheduleService>(ScheduleService);
  });

  describe('1. Customer Plan Purchase → Calendar Schedule Email Flow', () => {
    it('creates/retrieves calendar schedule and dispatches email with .ics and PDF attachments to customer registered email', async () => {
      const result = await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
        planId: 1,
        paymentId: 'pay_online_123',
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBeFalsy();

      // Check EmailService was called
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      const emailCall = emailService.sendEmail.mock.calls[0][0];

      // Customer.email is recipient
      expect(emailCall.to).toBe('contact@acme.com');
      expect(emailCall.eventType).toBe('PLAN_PURCHASE_CALENDAR_SCHEDULE');
      expect(emailCall.channel).toBe('EMAIL');
      expect(emailCall.planId).toBe(1);
      expect(emailCall.appointmentId).toBeDefined();

      // Verify attachments: .ics calendar invitation
      expect(emailCall.attachments).toBeDefined();
      expect(emailCall.attachments.length).toBeGreaterThanOrEqual(1);

      const icsAttachment = emailCall.attachments.find((a: any) => a.filename === 'appointment.ics');
      expect(icsAttachment).toBeDefined();
      expect(icsAttachment.contentType).toContain('text/calendar');

      // Verify MIME icalEvent is provided
      expect(emailCall.icalEvent).toBeDefined();
      expect(emailCall.icalEvent.filename).toBe('appointment.ics');
      expect(emailCall.icalEvent.method).toBe('REQUEST');

      // Verify email communication record stored with status SENT
      expect(emailLogs.length).toBe(1);
      expect(emailLogs[0].status).toBe('SENT');
      expect(emailLogs[0].eventType).toBe('PLAN_PURCHASE_CALENDAR_SCHEDULE');
      expect(emailLogs[0].recipientEmail).toBe('contact@acme.com');
    });

    it('contains all required placeholders in the rendered email body and subject', async () => {
      await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
        planId: 1,
      });

      const emailCall = emailService.sendEmail.mock.calls[0][0];
      const subject = emailCall.subject;
      const html = emailCall.html;

      expect(subject).toContain('Growth Accelerate Plan');
      expect(subject).toContain('Acme Technologies');

      expect(html).toContain('Acme Technologies');
      expect(html).toContain('Growth Accelerate Plan');
      expect(html).toContain('10:00 AM');
      expect(html).toContain('11:00 AM');
      expect(html).toContain('Asia/Kolkata');
      expect(html).toContain('Rohan Sharma');
      expect(html).toContain('https://meet.google.com/qbm-crm-sync');
    });
  });

  describe('2. Customer Registered Email Validation & Crash Protection', () => {
    it('does NOT send to admin email or superadmin email; strictly targets Customer.email', async () => {
      await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
      });

      const emailCall = emailService.sendEmail.mock.calls[0][0];
      expect(emailCall.to).toBe('contact@acme.com');
      expect(emailCall.to).not.toBe('admin@quikboom.com');
      expect(emailCall.to).not.toBe('superadmin@quickboom.com');
      expect(emailCall.to).not.toBe('rohan.sharma@quikboom.com');
    });

    it('safely handles missing or invalid customer email without crashing or rolling back payment', async () => {
      // Customer without email
      prisma.customer.findUnique.mockResolvedValueOnce({
        ...mockCustomer,
        email: null,
      });

      const result = await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('MISSING_OR_INVALID_CUSTOMER_EMAIL');
      expect(emailService.sendEmail).not.toHaveBeenCalled();

      // Check failed communication record is safely stored
      expect(emailLogs.length).toBe(1);
      expect(emailLogs[0].status).toBe('FAILED');
      expect(emailLogs[0].errorMessage).toContain('Customer registered email is missing or invalid');
    });

    it('safely handles malformed customer email address', async () => {
      prisma.customer.findUnique.mockResolvedValueOnce({
        ...mockCustomer,
        email: 'invalid-not-an-email',
      });

      const result = await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('MISSING_OR_INVALID_CUSTOMER_EMAIL');
      expect(emailService.sendEmail).not.toHaveBeenCalled();
      expect(emailLogs[0].status).toBe('FAILED');
    });
  });

  describe('3. iCalendar (.ics) Standard Compliance (RFC 5545)', () => {
    it('generates a valid, parseable .ics calendar invitation with required properties', () => {
      const ics = generateICalendarInvite({
        uid: 'qb-sched-test-101@quikboom.com',
        title: 'Growth Plan Consultation',
        description: 'Kickoff meeting with Rohan Sharma.\nLink: https://meet.google.com/qbm-crm-sync',
        location: 'Online Video Conference',
        startDate: new Date('2026-10-01T10:00:00.000Z'),
        endDate: new Date('2026-10-01T11:00:00.000Z'),
        timezone: BUSINESS_TIMEZONE,
        organizerName: 'Rohan Sharma',
        organizerEmail: 'rohan.sharma@quikboom.com',
        attendeeName: 'Acme Technologies',
        attendeeEmail: 'contact@acme.com',
        status: 'CONFIRMED',
      });

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('VERSION:2.0');
      expect(ics).toContain('PRODID:-//QuikBoom CRM//Calendar Schedule//EN');
      expect(ics).toContain('METHOD:REQUEST');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('UID:qb-sched-test-101@quikboom.com');
      expect(ics).toContain('SUMMARY:Growth Plan Consultation');
      expect(ics).toContain('ORGANIZER;CN="Rohan Sharma":mailto:rohan.sharma@quikboom.com');
      // Verify ATTENDEE property (accounting for RFC 5545 75-character line folding)
      expect(ics.replace(/\r\n /g, '')).toContain(
        'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Acme Technologies":mailto:contact@acme.com',
      );
      expect(ics).toContain(`DTSTART;TZID=${BUSINESS_TIMEZONE}:`);
      expect(ics).toContain(`DTEND;TZID=${BUSINESS_TIMEZONE}:`);
      expect(ics).toContain('STATUS:CONFIRMED');
      expect(ics).toContain('END:VEVENT');
      expect(ics).toContain('END:VCALENDAR');

      // Verify line endings: all lines end with CRLF (\r\n)
      const lines = ics.split('\r\n');
      expect(lines.length).toBeGreaterThan(10);
      for (let i = 0; i < lines.length - 1; i++) {
        expect(lines[i]).not.toContain('\r');
      }
    });

    it('correctly escapes special characters in iCalendar fields', () => {
      const ics = generateICalendarInvite({
        uid: 'qb-sched-special@quikboom.com',
        title: 'Meeting, Consultation; Review & Planning',
        description: 'Line 1\nLine 2 with; semicolon, and comma\\backslash',
        startDate: new Date('2026-10-01T10:00:00.000Z'),
        endDate: new Date('2026-10-01T11:00:00.000Z'),
        organizerEmail: 'rep@quikboom.com',
        attendeeEmail: 'customer@acme.com',
      });

      expect(ics).toContain('SUMMARY:Meeting\\, Consultation\\; Review & Planning');
      expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2 with\\; semicolon\\, and comma\\\\backslash');
    });
  });

  describe('4. Idempotency & Duplicate Prevention', () => {
    it('prevents sending duplicate calendar emails when invoked twice for the same purchase/schedule', async () => {
      // First invocation: email should be sent
      const firstResult = await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
        planId: 1,
      });

      expect(firstResult.success).toBe(true);
      expect(firstResult.skipped).toBeFalsy();
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);

      // Second invocation (webhook retry or frontend callback): should detect existing SENT record and skip
      const secondResult = await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
        planId: 1,
      });

      expect(secondResult.success).toBe(true);
      expect(secondResult.skipped).toBe(true);
      expect(secondResult.reason).toBe('DUPLICATE_PREVENTED');
      // Still only 1 email call dispatched!
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. Assigned Employee / Representative Resolution', () => {
    it('uses the customer assigned employee name and email for organizer and signature', async () => {
      await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
      });

      const emailCall = emailService.sendEmail.mock.calls[0][0];
      const icsAttachment = emailCall.attachments.find((a: any) => a.filename === 'appointment.ics');
      const icsStr = icsAttachment.content.toString('utf-8');

      expect(icsStr).toContain('rohan.sharma@quikboom.com');
      expect(icsStr).toContain('Rohan Sharma');
      expect(emailCall.html).toContain('Rohan Sharma');
    });

    it('falls back to company representative when customer has no assigned employee without hardcoding superadmin', async () => {
      schedules = [];
      emailLogs = [];
      const unassignedCustomer = {
        ...mockCustomer,
        assignedEmployee: null,
        assignedEmployeeId: null,
        assignedEmployeeRel: null,
      };
      prisma.customer.findUnique.mockResolvedValue(unassignedCustomer);
      prisma.customerSubscription.findUnique.mockResolvedValue({
        ...mockSubscription,
        customer: unassignedCustomer,
      });

      await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
      });

      const emailCall = emailService.sendEmail.mock.calls[0][0];
      expect(emailCall.html).not.toContain('superadmin@quickboom.com');
      expect(emailCall.html).toContain('Account Executive');
    });
  });

  describe('6. Email Provider Failure Isolation', () => {
    it('records FAILED communication status without crashing payment or subscription confirmation', async () => {
      emailService.sendEmail.mockRejectedValueOnce(new Error('SMTP Connection Refused (550)'));

      const result = await scheduleService.sendPlanPurchaseCalendarScheduleEmail({
        customerId: 101,
        subscriptionId: 201,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('SMTP Connection Refused');

      // Failure record stored
      const failedLog = emailLogs.find((l) => l.status === 'FAILED');
      expect(failedLog).toBeDefined();
      expect(failedLog.errorMessage).toContain('SMTP Connection Refused');
    });
  });

  describe('7. Schedule Record Communication Integration', () => {
    it('attaches communication history to schedule item in findOne query', async () => {
      // Seed a schedule
      const created = await prisma.monthlySchedule.create({
        data: {
          id: 55,
          customerId: 101,
          subscriptionId: 201,
          planId: 1,
          month: 10,
          year: 2026,
          startDate: new Date('2026-10-01'),
          endDate: new Date('2026-10-31'),
          title: 'Growth Plan Consultation',
        },
      });

      // Seed email communication for this schedule
      emailLogs.push({
        id: 1,
        customerId: 101,
        appointmentId: 55,
        channel: 'EMAIL',
        eventType: 'PLAN_PURCHASE_CALENDAR_SCHEDULE',
        recipientEmail: 'contact@acme.com',
        subject: 'Scheduled Appointment',
        status: 'SENT',
        sentAt: new Date(),
        createdAt: new Date(),
      });

      const scheduleDetails: any = await scheduleService.findOne(101, 55);

      expect(scheduleDetails).toBeDefined();
      expect(scheduleDetails.communications).toBeDefined();
      expect(scheduleDetails.communications.length).toBe(1);
      expect(scheduleDetails.communications[0].eventType).toBe('PLAN_PURCHASE_CALENDAR_SCHEDULE');
      expect(scheduleDetails.communications[0].status).toBe('SENT');
      expect(scheduleDetails.communications[0].channel).toBe('EMAIL');
    });
  });
});
