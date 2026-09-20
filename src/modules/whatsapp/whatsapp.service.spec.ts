import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { WhatsappService } from './whatsapp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WhatsappService', () => {
  let service: WhatsappService;
  let prisma: any;
  let integrationSettings: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
      },
      notification: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    integrationSettings = {
      getIntegrationConfig: jest.fn().mockResolvedValue({
        provider: 'WHATSAPP',
        isEnabled: true,
        credentials: {
          apiKey: 'test-whatsapp-token',
          phoneNumberId: '109876543210',
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationSettingsService, useValue: integrationSettings },
      ],
    }).compile();

    service = module.get<WhatsappService>(WhatsappService);
    jest.clearAllMocks();
  });

  describe('Phone Normalization & Masking', () => {
    it('normalizes 10-digit Indian numbers starting with 6-9 by prepending 91', () => {
      expect(service.normalizePhoneNumber('9876543210')).toBe('919876543210');
      expect(service.normalizePhoneNumber('8123456789')).toBe('918123456789');
      expect(service.normalizePhoneNumber('7012345678')).toBe('917012345678');
      expect(service.normalizePhoneNumber('6987654321')).toBe('916987654321');
    });

    it('handles +91 prefix without duplicating the country code', () => {
      expect(service.normalizePhoneNumber('+919876543210')).toBe('919876543210');
      expect(service.normalizePhoneNumber('+91 98765-43210')).toBe('919876543210');
    });

    it('strips leading 0 from 11-digit numbers', () => {
      expect(service.normalizePhoneNumber('09876543210')).toBe('919876543210');
    });

    it('preserves valid 12-digit numbers already prefixed with 91', () => {
      expect(service.normalizePhoneNumber('919876543210')).toBe('919876543210');
    });

    it('handles international numbers in E.164 format', () => {
      expect(service.normalizePhoneNumber('+1 (415) 555-2671')).toBe('14155552671');
      expect(service.normalizePhoneNumber('+44 20 7946 0958')).toBe('442079460958');
    });

    it('returns null for empty, null, or invalid numbers', () => {
      expect(service.normalizePhoneNumber('')).toBeNull();
      expect(service.normalizePhoneNumber(null)).toBeNull();
      expect(service.normalizePhoneNumber(undefined)).toBeNull();
      expect(service.normalizePhoneNumber('12345')).toBeNull();
      expect(service.normalizePhoneNumber('abcdefghij')).toBeNull();
    });

    it('masks phone numbers safely without exposing full PII', () => {
      expect(service.maskPhone('919876543210')).toBe('****3210');
      expect(service.maskPhone('9876543210')).toBe('****3210');
      expect(service.maskPhone(null)).toBe('none');
    });
  });

  describe('Customer Welcome WhatsApp', () => {
    it('sends customer_welcome template successfully', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { messages: [{ id: 'wamid.test.welcome.123' }] },
      } as any);

      prisma.notification.findFirst.mockResolvedValueOnce(null);
      prisma.customer.findUnique.mockResolvedValueOnce({
        id: 101,
        name: 'Avinash Enterprises',
        phone: '+919876543210',
      });

      const result = await service.sendCustomerWelcomeMessage({
        customerId: 101,
        customerName: 'Avinash Enterprises',
        notificationId: 555,
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.test.welcome.123');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v25.0/109876543210/messages',
        expect.objectContaining({
          messaging_product: 'whatsapp',
          to: '919876543210',
          type: 'template',
          template: expect.objectContaining({
            name: 'customer_welcome',
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: 'Avinash Enterprises' }],
              },
            ],
          }),
        }),
        expect.any(Object),
      );
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 555 },
        data: expect.objectContaining({
          data: expect.objectContaining({
            whatsappSent: true,
            whatsappMessageId: 'wamid.test.welcome.123',
          }),
        }),
      });
    });

    it('skips duplicate welcome message if already sent', async () => {
      prisma.notification.findFirst.mockResolvedValueOnce({
        id: 555,
        data: { whatsappSent: true, whatsappMessageId: 'wamid.prev.111' },
      });

      const result = await service.sendCustomerWelcomeMessage({
        customerId: 101,
      });

      expect(result.success).toBe(true);
      expect(result.skippedDuplicate).toBe(true);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('skips gracefully if customer has no phone number without throwing', async () => {
      prisma.notification.findFirst.mockResolvedValueOnce(null);
      prisma.customer.findUnique.mockResolvedValueOnce({
        id: 102,
        name: 'No Phone Corp',
        phone: null,
        alternatePhone: null,
        users: [],
      });

      const result = await service.sendCustomerWelcomeMessage({
        customerId: 102,
      });

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('NO_PHONE');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('skips gracefully if WhatsApp integration is disabled in Admin Panel', async () => {
      integrationSettings.getIntegrationConfig.mockResolvedValueOnce({
        isEnabled: false,
      });
      prisma.notification.findFirst.mockResolvedValueOnce(null);
      prisma.customer.findUnique.mockResolvedValueOnce({
        id: 103,
        name: 'Disabled Client',
        phone: '9876543210',
      });

      const result = await service.sendCustomerWelcomeMessage({
        customerId: 103,
      });

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('INTEGRATION_DISABLED');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('Plan Activation WhatsApp', () => {
    it('sends plan_activation_success template successfully with all variables', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { messages: [{ id: 'wamid.test.plan.456' }] },
      } as any);

      prisma.notification.findMany.mockResolvedValueOnce([]);
      prisma.customer.findUnique.mockResolvedValueOnce({
        id: 201,
        name: 'Tech Solutions',
        phone: '9876543210',
      });
      prisma.notification.findUnique.mockResolvedValueOnce({
        id: 777,
        data: { type: 'PLAN_PURCHASE_SUCCESS' },
      });

      const result = await service.sendPlanActivationMessage({
        customerId: 201,
        customerName: 'Tech Solutions',
        planName: 'Enterprise Growth',
        billingCycle: 'Yearly',
        startDate: new Date('2026-01-01'),
        expiryDate: new Date('2027-01-01'),
        subscriptionId: 444,
        paymentId: 'pay_xyz123',
        notificationId: 777,
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('wamid.test.plan.456');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v25.0/109876543210/messages',
        expect.objectContaining({
          messaging_product: 'whatsapp',
          to: '919876543210',
          type: 'template',
          template: expect.objectContaining({
            name: 'plan_activation_success',
            components: [
              {
                type: 'body',
                parameters: expect.arrayContaining([
                  { type: 'text', text: 'Tech Solutions' },
                  { type: 'text', text: 'Enterprise Growth' },
                  { type: 'text', text: 'Yearly' },
                ]),
              },
            ],
          }),
        }),
        expect.any(Object),
      );
    });

    it('skips duplicate plan activation message for the same subscription', async () => {
      prisma.notification.findMany.mockResolvedValueOnce([
        {
          id: 888,
          data: {
            subscriptionId: '444',
            whatsappSent: true,
          },
        },
      ]);

      const result = await service.sendPlanActivationMessage({
        customerId: 201,
        planName: 'Enterprise Growth',
        subscriptionId: 444,
      });

      expect(result.success).toBe(true);
      expect(result.skippedDuplicate).toBe(true);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('handles Meta API failure gracefully without throwing unhandled exceptions', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: {
            error: {
              code: 100,
              message: 'Invalid parameter',
            },
          },
        },
      });

      // Fallback text attempt also fails
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: {
            error: {
              code: 131000,
              message: 'Service unavailable',
            },
          },
        },
      });

      prisma.notification.findMany.mockResolvedValueOnce([]);
      prisma.customer.findUnique.mockResolvedValueOnce({
        id: 202,
        name: 'Fail Test Corp',
        phone: '9876543210',
      });

      const result = await service.sendPlanActivationMessage({
        customerId: 202,
        planName: 'Basic Package',
        subscriptionId: 999,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('handles Meta Error 190 with clear authentication failure details', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: {
              code: 190,
              type: 'OAuthException',
              message: 'Error validating access token: Session has expired.',
            },
          },
        },
      });

      const result = await service.sendMessage('9876543210', 'Test message');
      expect(result.success).toBe(false);
      expect(result.error).toBe('190');
      expect(result.details).toContain('WhatsApp authentication failed');
    });
  });
});
