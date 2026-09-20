import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadService } from './lead.service';

describe('LeadService - Lead Communications & Push Dispatch', () => {
  let service: LeadService;
  let mockPrisma: any;
  let mockLeadRepository: any;
  let mockEmailService: any;
  let mockNotificationService: any;
  let mockModuleRef: any;

  beforeEach(() => {
    mockLeadRepository = {
      update: jest.fn().mockResolvedValue({ id: 1 }),
      logTimeline: jest.fn().mockResolvedValue({ id: 1 }),
    };
    mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue({
        success: true,
        message: 'Email successfully sent',
        messageId: '<msg-12345@smtp.quickboom.com>',
      }),
    };
    mockNotificationService = {
      sendPushNotification: jest.fn().mockResolvedValue({ success: true }),
    };
    mockModuleRef = {
      get: jest.fn().mockReturnValue(mockNotificationService),
    };
    mockPrisma = {
      lead: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      emailLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      leadActivityTimeline: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    service = new LeadService(
      mockLeadRepository,
      mockPrisma,
      undefined,
      undefined,
      mockEmailService,
      undefined,
      undefined,
      mockModuleRef,
    );
  });

  describe('getLeadCommunications', () => {
    it('throws NotFoundException when lead is not found', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.getLeadCommunications(1, 999)).rejects.toThrow(NotFoundException);
    });

    it('returns combined and chronological communications from EmailLog and timeline', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 10,
        customerId: 1,
        assignedToId: 5,
        firstName: 'Amit',
        lastName: 'Sharma',
        email: 'amit@example.com',
        phone: '+919876543210',
      });

      mockPrisma.emailLog.findMany.mockResolvedValue([
        {
          id: 101,
          customerId: 1,
          leadId: 10,
          recipientEmail: 'amit@example.com',
          subject: 'Lead Details: Tech Corp',
          renderedContent: '<p>Here are your lead details</p>',
          status: 'SENT',
          providerMessageId: 'msg-abc-123',
          createdAt: new Date('2026-09-20T10:00:00Z'),
          user: { firstName: 'Agent', lastName: 'Smith', email: 'agent@smith.com' },
        },
      ]);

      mockPrisma.leadActivityTimeline.findMany.mockResolvedValue([
        {
          id: 201,
          leadId: 10,
          action: 'WHATSAPP_SENT',
          description: 'WhatsApp notification sent to +919876543210',
          metadata: {
            phone: '+919876543210',
            status: 'READ',
            messageId: 'wamid.HBgLMTY1MDI1',
            stageName: 'Proposal',
          },
          createdAt: new Date('2026-09-20T11:00:00Z'),
        },
        {
          id: 202,
          leadId: 10,
          action: 'WHATSAPP_INCOMING',
          description: 'Customer responded: Interested in proposal',
          metadata: {
            from: '+919876543210',
            text: 'Interested in proposal',
            messageId: 'wamid.HBgLMTY1MDI2',
          },
          createdAt: new Date('2026-09-20T12:00:00Z'),
        },
      ]);

      const result = await service.getLeadCommunications(1, 10);

      expect(result.leadId).toBe(10);
      expect(result.summary.totalCommunications).toBe(3);
      expect(result.summary.totalEmails).toBe(1);
      expect(result.summary.totalWhatsApp).toBe(2);
      expect(result.communications.length).toBe(3);

      // Most recent first: Incoming WhatsApp (12:00)
      expect(result.communications[0].channel).toBe('WHATSAPP');
      expect(result.communications[0].direction).toBe('INBOUND');
      expect(result.communications[0].status).toBe('RECEIVED');
      expect(result.communications[0].content).toBe('Interested in proposal');

      // Second: Outbound WhatsApp (11:00)
      expect(result.communications[1].channel).toBe('WHATSAPP');
      expect(result.communications[1].direction).toBe('OUTBOUND');
      expect(result.communications[1].status).toBe('READ');

      // Third: Email (10:00)
      expect(result.communications[2].channel).toBe('EMAIL');
      expect(result.communications[2].direction).toBe('OUTBOUND');
      expect(result.communications[2].status).toBe('SENT');
    });
  });

  describe('sendLeadEmail', () => {
    it('dispatches custom email and records timeline', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 10,
        customerId: 1,
        assignedToId: 5,
        email: 'client@example.com',
        customer: { companyName: 'QuickBoom Inc' },
      });

      const res = await service.sendLeadEmail(1, 10, { id: 5 }, {
        subject: 'Custom Followup',
        message: 'Hi client, just following up!',
      });

      expect(res.success).toBe(true);
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'client@example.com',
          subject: 'Custom Followup',
          recordType: 'lead',
          recordId: 10,
        }),
        { id: 5 },
      );
      expect(mockPrisma.leadActivityTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'EMAIL_SENT',
            leadId: 10,
          }),
        }),
      );
    });

    it('dispatches EMAIL_FAILED push when sending fails', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        id: 10,
        customerId: 1,
        assignedToId: 5,
        email: 'client@example.com',
        customer: { companyName: 'QuickBoom Inc' },
      });
      mockEmailService.sendEmail.mockRejectedValueOnce(new Error('SMTP connection timeout'));

      await expect(
        service.sendLeadEmail(1, 10, { id: 5 }, {
          subject: 'Custom Followup',
          message: 'Hi client!',
        }),
      ).rejects.toThrow('SMTP connection timeout');

      expect(mockNotificationService.sendPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 5,
          customerId: 1,
          type: 'EMAIL_FAILED',
        }),
      );
    });
  });
});
