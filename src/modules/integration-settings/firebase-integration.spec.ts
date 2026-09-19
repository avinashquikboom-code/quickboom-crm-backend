import { Test, TestingModule } from '@nestjs/testing';
import {
  IntegrationSettingsService,
  IntegrationProvider,
} from './integration-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('Firebase Integration Settings Suite', () => {
  let service: IntegrationSettingsService;
  let prisma: PrismaService;

  const mockPrisma = {
    integrationSetting: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
    user: {
      findMany: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
    },
    userDeviceToken: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationSettingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<IntegrationSettingsService>(IntegrationSettingsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('Configuration & Masking', () => {
    it('returns masked credentials and never exposes privateKey in plain text', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 10,
        provider: 'FIREBASE',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          projectId: 'quikboom-crm-925d5',
          clientEmail: 'firebase-adminsdk-test@quikboom-crm-925d5.iam.gserviceaccount.com',
          privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----',
        },
        config: {
          lastTestedAt: '2026-09-19T22:00:00.000Z',
          lastTestResult: 'SUCCESS',
        },
        source: 'DATABASE',
      });

      const masked = await service.getMaskedProviderConfig('FIREBASE');

      expect(masked.provider).toBe('FIREBASE');
      expect(masked.isEnabled).toBe(true);
      expect(masked.credentials.projectId).toBe('quikboom-crm-925d5');
      // Private key MUST be masked
      expect(masked.credentials.privateKey).not.toContain('MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC');
      expect(masked.credentials.privateKey).toContain('***');
    });

    it('falls back to environment variables when database record is absent', async () => {
      process.env.FIREBASE_PROJECT_ID = 'quikboom-crm-925d5';
      process.env.FIREBASE_CLIENT_EMAIL = 'firebase-admin@quikboom-crm-925d5.iam.gserviceaccount.com';
      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);

      const masked = await service.getMaskedProviderConfig('FIREBASE');

      expect(masked.provider).toBe('FIREBASE');
      expect(masked.credentials.projectId).toBe('quikboom-crm-925d5');
      expect(masked.source).toBe('ENV_FALLBACK');
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_CLIENT_EMAIL;
    });

    it('encrypts privateKey when saving configuration to database', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);
      mockPrisma.integrationSetting.upsert.mockResolvedValue({
        id: 11,
        provider: 'FIREBASE',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          projectId: 'quikboom-crm-925d5',
          privateKey: 'enc:v1:test_encrypted_key',
        },
      });

      await service.updateIntegrationConfig(
        'FIREBASE',
        {
          isEnabled: true,
          credentials: {
            projectId: 'quikboom-crm-925d5',
            privateKey: 'raw_secret_private_key_123',
          },
        },
        1,
      );

      expect(mockPrisma.integrationSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'FIREBASE' },
          create: expect.objectContaining({
            provider: 'FIREBASE',
            isEnabled: true,
          }),
        }),
      );
    });

    it('allows saving empty FCM form without error', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);
      mockPrisma.integrationSetting.upsert.mockResolvedValue({
        id: 12,
        provider: 'FIREBASE',
        isEnabled: false,
        environment: 'LIVE',
        credentials: {},
        config: {},
      });

      await expect(
        service.updateIntegrationConfig(
          'FIREBASE',
          {
            isEnabled: false,
            credentials: {},
            config: {},
          },
          1,
        ),
      ).resolves.not.toThrow();

      expect(mockPrisma.integrationSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'FIREBASE' },
          create: expect.objectContaining({
            provider: 'FIREBASE',
            isEnabled: false,
          }),
        }),
      );
    });

    it('allows saving partial FCM configuration (e.g. only projectId)', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);
      mockPrisma.integrationSetting.upsert.mockResolvedValue({
        id: 13,
        provider: 'FIREBASE',
        isEnabled: false,
        environment: 'LIVE',
        credentials: { projectId: 'my-partial-project' },
        config: {},
      });

      await expect(
        service.updateIntegrationConfig(
          'FIREBASE',
          {
            isEnabled: false,
            credentials: { projectId: 'my-partial-project' },
          },
          1,
        ),
      ).resolves.not.toThrow();

      expect(mockPrisma.integrationSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'FIREBASE' },
          create: expect.objectContaining({
            provider: 'FIREBASE',
            credentials: expect.objectContaining({ projectId: 'my-partial-project' }),
          }),
        }),
      );
    });

    it('preserves existing privateKey when admin submits empty string or masked value', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 14,
        provider: 'FIREBASE',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          projectId: 'my-project',
          privateKey: 'enc:v1:existing_encrypted_key',
        },
        config: {},
      });
      mockPrisma.integrationSetting.upsert.mockResolvedValue({
        id: 14,
        provider: 'FIREBASE',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          projectId: 'my-project',
          privateKey: 'enc:v1:existing_encrypted_key',
        },
      });

      // Submit with blank privateKey
      await service.updateIntegrationConfig(
        'FIREBASE',
        {
          isEnabled: true,
          credentials: {
            projectId: 'my-project',
            privateKey: '',
          },
        },
        1,
      );

      // Verify existing privateKey was preserved
      expect(mockPrisma.integrationSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'FIREBASE' },
          update: expect.objectContaining({
            credentials: expect.objectContaining({
              privateKey: 'enc:v1:existing_encrypted_key',
            }),
          }),
        }),
      );
    });
  });

  describe('Testing & Diagnostics', () => {
    it('returns NOT CONFIGURED and clear message when testing unconfigured credentials', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);

      const result = await service.testIntegration('FIREBASE', {
        credentials: {
          projectId: '',
        },
      });

      expect(result.connected).toBe(false);
      expect(result.status).toBe('NOT CONFIGURED');
      expect(result.message).toBe(
        'FCM is not fully configured. Please add the required Firebase credentials to test the connection.',
      );
    });

    it('returns not configured message when sending test notification without credentials', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);

      const result = await service.sendFirebaseTestNotification({
        title: 'Test Notification',
        message: 'Hello World',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'FCM is not configured. Please configure Firebase credentials before sending a test notification.',
      );
    });
  });

  describe('Enable / Disable Check', () => {
    it('reports isEnabled: false when integration is toggled off', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 12,
        provider: 'FIREBASE',
        isEnabled: false,
        environment: 'LIVE',
        credentials: {
          projectId: 'quikboom-crm-925d5',
        },
        config: {},
      });

      const config = await service.getFirebaseConfig();
      expect(config.isEnabled).toBe(false);
    });

    it('allows toggling isEnabled without credentials', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);
      mockPrisma.integrationSetting.upsert.mockResolvedValue({
        id: 15,
        provider: 'FIREBASE',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {},
        config: {},
      });

      await expect(
        service.updateIntegrationConfig(
          'FIREBASE',
          {
            isEnabled: true,
          },
          1,
        ),
      ).resolves.not.toThrow();

      expect(mockPrisma.integrationSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'FIREBASE' },
          create: expect.objectContaining({
            isEnabled: true,
          }),
        }),
      );
    });
  });
});
