import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import * as crypto from 'crypto';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';

describe('WhatsappWebhook', () => {
  let controller: WhatsappWebhookController;
  let service: WhatsappService;
  let prisma: any;
  let integrationSettings: any;

  const mockVerifyToken = 'my_super_secret_verify_token_2026';
  const mockAppSecret = 'meta_app_secret_12345';

  beforeEach(async () => {
    prisma = {
      lead: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      leadActivityTimeline: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      notification: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      contact: {
        findFirst: jest.fn(),
      },
      communicationHistory: {
        create: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
      },
      leadStage: {
        findFirst: jest.fn(),
      },
    };

    integrationSettings = {
      getIntegrationConfig: jest.fn().mockResolvedValue({
        provider: 'WHATSAPP',
        isEnabled: true,
        credentials: {
          apiKey: 'test-token',
          phoneNumberId: '123456789',
          verifyToken: mockVerifyToken,
          appSecret: mockAppSecret,
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappWebhookController],
      providers: [
        WhatsappService,
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationSettingsService, useValue: integrationSettings },
      ],
    }).compile();

    controller = module.get<WhatsappWebhookController>(WhatsappWebhookController);
    service = module.get<WhatsappService>(WhatsappService);
    jest.clearAllMocks();
  });

  describe('GET Webhook Verification', () => {
    it('returns HTTP 200 with challenge when mode is subscribe and token matches', async () => {
      const res: any = {
        status: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };

      await controller.verifyWebhook('subscribe', mockVerifyToken, 'challenge_code_12345', res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.type).toHaveBeenCalledWith('text/plain');
      expect(res.send).toHaveBeenCalledWith('challenge_code_12345');
    });

    it('returns HTTP 403 when verify_token does not match', async () => {
      const res: any = {
        status: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };

      await controller.verifyWebhook('subscribe', 'wrong_token', 'challenge_code_12345', res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(res.send).toHaveBeenCalledWith('Verification token mismatch');
    });

    it('returns HTTP 403 when mode is not subscribe', async () => {
      const res: any = {
        status: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };

      await controller.verifyWebhook('unsubscribe', mockVerifyToken, 'challenge_code_12345', res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(res.send).toHaveBeenCalledWith('Verification token mismatch');
    });
  });

  describe('POST Webhook Signature Verification', () => {
    it('rejects request with HTTP 401 when signature header is invalid', async () => {
      const payload = { object: 'whatsapp_business_account', entry: [] };
      const req: any = { body: payload };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await controller.handleWebhook(payload, 'sha256=invalid_hash', req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' });
    });

    it('accepts request with HTTP 200 when signature header matches App Secret HMAC', async () => {
      const payload = { object: 'whatsapp_business_account', entry: [] };
      const rawBody = JSON.stringify(payload);
      const validHash = crypto.createHmac('sha256', mockAppSecret).update(rawBody, 'utf8').digest('hex');

      const req: any = { body: rawBody };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await controller.handleWebhook(payload, `sha256=${validHash}`, req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
    });
  });

  describe('POST Webhook Message Status Updates', () => {
    it('updates existing LeadActivityTimeline and Notification on DELIVERED status', async () => {
      const messageId = 'wamid.HBgLOTE3MDU4NzAwNzU1FQIAEhggTEST001';
      prisma.leadActivityTimeline.findMany.mockResolvedValue([
        {
          id: 101,
          leadId: 5,
          action: 'WHATSAPP_SENT',
          description: 'WhatsApp notification sent to 917058700755 for stage Follow-up (Sent)',
          metadata: { messageId, status: 'SENT' },
        },
      ]);
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 201,
          customerId: 1,
          userId: 2,
          data: { whatsappMessageId: messageId, whatsappStatus: 'SENT' },
        },
      ]);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '1234567890', phone_number_id: '123456789' },
                  statuses: [
                    {
                      id: messageId,
                      status: 'delivered',
                      timestamp: '1710000005',
                      recipient_id: '917058700755',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.processWebhookPayload(payload);

      expect(result.processed).toBe(true);
      expect(result.statusesCount).toBe(1);

      // Verify LeadActivityTimeline updated
      expect(prisma.leadActivityTimeline.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 101 },
          data: expect.objectContaining({
            description: expect.stringContaining('(Delivered)'),
            metadata: expect.objectContaining({
              status: 'DELIVERED',
              messageId,
            }),
          }),
        }),
      );

      // Verify Notification updated
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 201 },
          data: expect.objectContaining({
            data: expect.objectContaining({
              whatsappStatus: 'DELIVERED',
            }),
          }),
        }),
      );
    });

    it('updates status to FAILED with safe error code and description when Meta returns failed', async () => {
      const messageId = 'wamid.HBgLOTE3MDU4NzAwNzU1FQIAEhggTEST002';
      prisma.leadActivityTimeline.findMany.mockResolvedValue([
        {
          id: 102,
          leadId: 6,
          action: 'WHATSAPP_SENT',
          description: 'WhatsApp notification sent to 917058700755 for stage Won',
          metadata: { messageId, status: 'SENT' },
        },
      ]);
      prisma.notification.findMany.mockResolvedValue([]);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '1234567890', phone_number_id: '123456789' },
                  statuses: [
                    {
                      id: messageId,
                      status: 'failed',
                      timestamp: '1710000010',
                      recipient_id: '917058700755',
                      errors: [
                        {
                          code: 131026,
                          title: 'Message undeliverable',
                          message: 'User is unable to receive messages',
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.processWebhookPayload(payload);

      expect(result.processed).toBe(true);
      expect(prisma.leadActivityTimeline.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 102 },
          data: expect.objectContaining({
            description: expect.stringContaining('Failed: User is unable to receive messages'),
            metadata: expect.objectContaining({
              status: 'FAILED',
              errorCode: '131026',
              errorMessage: 'User is unable to receive messages',
            }),
          }),
        }),
      );
    });

    it('skips duplicate status events (idempotency)', async () => {
      const messageId = 'wamid.HBgLOTE3MDU4NzAwNzU1FQIAEhggTEST003';
      prisma.leadActivityTimeline.findMany.mockResolvedValue([
        {
          id: 103,
          leadId: 7,
          action: 'WHATSAPP_SENT',
          description: 'WhatsApp notification sent',
          metadata: { messageId, status: 'SENT' },
        },
      ]);
      prisma.notification.findMany.mockResolvedValue([]);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  statuses: [
                    {
                      id: messageId,
                      status: 'read',
                      timestamp: '1710000015',
                      recipient_id: '917058700755',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      // First call
      const res1 = await service.processWebhookPayload(payload);
      expect(res1.statusesCount).toBe(1);
      expect(prisma.leadActivityTimeline.update).toHaveBeenCalledTimes(1);

      // Duplicate second call
      const res2 = await service.processWebhookPayload(payload);
      expect(res2.statusesCount).toBe(0); // Duplicate skipped
      expect(prisma.leadActivityTimeline.update).toHaveBeenCalledTimes(1); // Not called again!
    });
  });

  describe('POST Webhook Incoming Messages & Customer/Lead Matching', () => {
    it('matches existing Lead by normalized phone number and logs WHATSAPP_INBOUND timeline + Notification', async () => {
      const messageId = 'wamid.HBgLOTE3MDU4NzAwNzU1FQIAEhggINBOUND001';
      const senderPhone = '917058700755';

      prisma.lead.findFirst.mockResolvedValue({
        id: 42,
        customerId: 1,
        assignedToId: 10,
        createdById: 1,
        firstName: 'Avinash',
        lastName: 'Magar',
        phone: '7058700755', // stored as 10-digit in DB
      });
      prisma.leadActivityTimeline.findFirst.mockResolvedValue(null); // not already recorded

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '1234567890', phone_number_id: '123456789' },
                  contacts: [
                    {
                      profile: { name: 'Avinash Sanjay Magar' },
                      wa_id: senderPhone,
                    },
                  ],
                  messages: [
                    {
                      from: senderPhone,
                      id: messageId,
                      timestamp: '1710000050',
                      type: 'text',
                      text: { body: 'Hello, please send more information about the CRM pricing' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.processWebhookPayload(payload);

      expect(result.processed).toBe(true);
      expect(result.messagesCount).toBe(1);

      // Verify LeadActivityTimeline created for matched Lead
      expect(prisma.leadActivityTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: 42,
            action: 'WHATSAPP_INBOUND',
            description: expect.stringContaining('Hello, please send more information'),
            metadata: expect.objectContaining({
              messageId,
              type: 'text',
              status: 'RECEIVED',
            }),
          }),
        }),
      );

      // Verify Notification sent to assigned user
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 1,
            userId: 10,
            type: 'WHATSAPP_INBOUND',
            title: expect.stringContaining('Avinash'),
            message: expect.stringContaining('pricing'),
          }),
        }),
      );
    });

    it('safely handles non-text incoming message types (e.g. image with caption)', async () => {
      const messageId = 'wamid.HBgLOTE3MDU4NzAwNzU1FQIAEhggINBOUND002';
      const senderPhone = '919876543210';

      prisma.lead.findFirst.mockResolvedValue({
        id: 43,
        customerId: 1,
        assignedToId: 11,
        createdById: 1,
        firstName: 'Jane',
        phone: '+91 9876543210',
      });
      prisma.leadActivityTimeline.findFirst.mockResolvedValue(null);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  messages: [
                    {
                      from: senderPhone,
                      id: messageId,
                      timestamp: '1710000060',
                      type: 'image',
                      image: {
                        caption: 'Here is our office layout screenshot',
                        mime_type: 'image/jpeg',
                        id: 'media_id_999',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.processWebhookPayload(payload);

      expect(result.processed).toBe(true);
      expect(prisma.leadActivityTimeline.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leadId: 43,
            action: 'WHATSAPP_INBOUND',
            description: expect.stringContaining('[Image] Here is our office layout screenshot'),
          }),
        }),
      );
    });

    it('auto-creates new Lead when incoming sender is unknown in CRM', async () => {
      const messageId = 'wamid.HBgLOTE3MDU4NzAwNzU1FQIAEhggINBOUND003';
      const senderPhone = '919123456789';

      prisma.lead.findFirst.mockResolvedValue(null);
      prisma.contact.findFirst.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({
        id: 1,
        users: [{ id: 5 }],
      });
      prisma.leadStage.findFirst.mockResolvedValue({
        id: 10,
        key: 'NEW',
      });
      prisma.lead.create.mockResolvedValue({
        id: 99,
        customerId: 1,
        assignedToId: 5,
        firstName: 'Rajesh',
        lastName: 'Sharma',
        phone: senderPhone,
      });

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  contacts: [{ profile: { name: 'Rajesh Sharma' }, wa_id: senderPhone }],
                  messages: [
                    {
                      from: senderPhone,
                      id: messageId,
                      timestamp: '1710000070',
                      type: 'text',
                      text: { body: 'I want to inquire about your enterprise plan' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.processWebhookPayload(payload);

      expect(result.processed).toBe(true);
      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 1,
            firstName: 'Rajesh',
            lastName: 'Sharma',
            phone: senderPhone,
            source: 'WHATSAPP',
            status: 'NEW',
          }),
        }),
      );
    });

    it('skips duplicate inbound messages (idempotency)', async () => {
      const messageId = 'wamid.HBgLOTE3MDU4NzAwNzU1FQIAEhggINBOUND004';
      const senderPhone = '917058700755';

      prisma.lead.findFirst.mockResolvedValue({
        id: 42,
        customerId: 1,
        assignedToId: 10,
        firstName: 'Avinash',
        phone: '7058700755',
      });
      prisma.leadActivityTimeline.findFirst.mockResolvedValue(null);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123456789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  messages: [
                    {
                      from: senderPhone,
                      id: messageId,
                      timestamp: '1710000080',
                      type: 'text',
                      text: { body: 'Hello again' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const res1 = await service.processWebhookPayload(payload);
      expect(res1.messagesCount).toBe(1);
      expect(prisma.leadActivityTimeline.create).toHaveBeenCalledTimes(1);

      // Duplicate second webhook
      const res2 = await service.processWebhookPayload(payload);
      expect(res2.messagesCount).toBe(0);
      expect(prisma.leadActivityTimeline.create).toHaveBeenCalledTimes(1); // No duplicate timeline record!
    });
  });
});
