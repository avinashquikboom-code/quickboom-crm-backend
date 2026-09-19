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
      process.env.FIREBASE_CLIENT_EMAIL = 'firebase-admin@quikboom-crm-925d5.iam.gserviceaccount.com';
      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);

      const masked = await service.getMaskedProviderConfig('FIREBASE');

      expect(masked.provider).toBe('FIREBASE');
      expect(masked.credentials.projectId).toBe('quikboom-crm-925d5');
      expect(masked.source).toBe('ENV_FALLBACK');
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
  });
});
