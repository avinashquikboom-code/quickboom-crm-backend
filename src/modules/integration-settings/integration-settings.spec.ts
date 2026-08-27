import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationSettingsService } from './integration-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
} from '../../common/utils/crypto.util';

describe('Integration Settings & Gateway Dynamic System', () => {
  let service: IntegrationSettingsService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      integrationSetting: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationSettingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<IntegrationSettingsService>(IntegrationSettingsService);
    service.clearCache();
  });

  describe('1. AES-256-GCM Cryptography & Masking', () => {
    it('encrypts and decrypts sensitive secrets accurately', () => {
      const originalSecret = 'rzp_sec_live_9876543210_SuperSecretPassword!';
      const encrypted = encryptSecret(originalSecret);

      expect(encrypted).toMatch(/^enc:v1:/);
      expect(encrypted).not.toEqual(originalSecret);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toEqual(originalSecret);
    });

    it('masks secrets safely without exposing plain values to Admin UI', () => {
      const plainSecret = 'rzp_sec_live_9876543210';
      const masked = maskSecret(plainSecret);

      expect(masked).toContain('***');
      expect(masked).toContain('3210');
      expect(masked).not.toEqual(plainSecret);
    });
  });

  describe('2. Dynamic Precedence: Database Overrides .env Fallback', () => {
    it('returns .env fallback when no database record exists', async () => {
      process.env.RAZORPAY_ENVIRONMENT = 'TEST';
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_env_fallback_key';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'rzp_sec_env_fallback_secret';
      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);

      const config = await service.getRazorpayConfig();

      expect(config.source).toBe('ENV_FALLBACK');
      expect(config.keyId).toBe('rzp_test_env_fallback_key');
      expect(config.keySecret).toBe('rzp_sec_env_fallback_secret');
    });

    it('prioritizes database record over .env variables immediately', async () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_env_fallback_key';
      process.env.RAZORPAY_KEY_SECRET = 'rzp_env_fallback_secret';

      const encryptedDbSecret = encryptSecret('rzp_sec_db_active_secret_4567');
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 1,
        provider: 'RAZORPAY',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          keyId: 'rzp_live_db_active_key_1234',
          keySecret: encryptedDbSecret,
          webhookSecret: 'whsec_db_2026',
        },
        config: {},
        updatedAt: new Date(),
        deletedAt: null,
      });

      const config = await service.getRazorpayConfig();

      expect(config.source).toBe('DATABASE');
      expect(config.keyId).toBe('rzp_live_db_active_key_1234');
      expect(config.keySecret).toBe('rzp_sec_db_active_secret_4567');
      expect(config.environment).toBe('LIVE');
    });
  });

  describe('3. Cache Invalidation on Admin Update', () => {
    it('invalidates cache immediately when admin saves new settings', async () => {
      // 1. Initial DB value cached
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 1,
        provider: 'RAZORPAY',
        isEnabled: true,
        environment: 'TEST',
        credentials: {
          keyId: 'rzp_test_old_key',
          keySecret: encryptSecret('rzp_sec_test_old_secret'),
        },
        config: {},
        updatedAt: new Date(),
        deletedAt: null,
      });

      const firstLookup = await service.getRazorpayConfig();
      expect(firstLookup.keyId).toBe('rzp_test_old_key');

      // 2. Admin saves new settings via updateIntegrationConfig
      mockPrisma.integrationSetting.upsert.mockResolvedValue({
        id: 1,
        provider: 'RAZORPAY',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          keyId: 'rzp_live_brand_new_key',
          keySecret: encryptSecret('rzp_sec_live_brand_new_secret'),
        },
        config: {},
        updatedAt: new Date(),
        deletedAt: null,
      });

      await service.updateIntegrationConfig(
        'RAZORPAY',
        {
          isEnabled: true,
          environment: 'LIVE',
          credentials: {
            keyId: 'rzp_live_brand_new_key',
            keySecret: 'rzp_sec_live_brand_new_secret',
          },
        },
        101, // Admin user ID
      );

      // Verify Audit Log was recorded
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'UPDATE_INTEGRATION_SETTINGS',
            module: 'INTEGRATIONS',
            userId: 101,
          }),
        }),
      );

      // 3. Next lookup reflects the new credentials immediately
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 1,
        provider: 'RAZORPAY',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          keyId: 'rzp_live_brand_new_key',
          keySecret: encryptSecret('rzp_sec_live_brand_new_secret'),
        },
        config: {},
        updatedAt: new Date(),
        deletedAt: null,
      });

      const secondLookup = await service.getRazorpayConfig();
      expect(secondLookup.keyId).toBe('rzp_live_brand_new_key');
      expect(secondLookup.keySecret).toBe('rzp_sec_live_brand_new_secret');
      expect(secondLookup.environment).toBe('LIVE');
    });
  });

  describe('4. Google Maps Dynamic Configuration', () => {
    it('resolves Google Maps config from Database', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 2,
        provider: 'GOOGLE_MAPS',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          apiKey: encryptSecret('AIzaSy_custom_db_maps_key_999'),
        },
        config: {
          enableEcoRouting: true,
          defaultCity: 'Bangalore, Karnataka',
        },
        updatedAt: new Date(),
        deletedAt: null,
      });

      const mapsConfig = await service.getGoogleMapsConfig();

      expect(mapsConfig.source).toBe('DATABASE');
      expect(mapsConfig.apiKey).toBe('AIzaSy_custom_db_maps_key_999');
      expect(mapsConfig.config.defaultCity).toBe('Bangalore, Karnataka');
    });
  });

  describe('5. Provider Normalization & Gateway Status Flags', () => {
    it('normalizes provider case and aliases', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 1,
        provider: 'RAZORPAY',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          keyId: 'rzp_live_norm_123',
          keySecret: encryptSecret('rzp_sec_norm_456'),
        },
        config: {},
        updatedAt: new Date(),
        deletedAt: null,
      });

      const resLower = await service.getIntegrationConfig('razorpay');
      expect(resLower.provider).toBe('RAZORPAY');
      expect(mockPrisma.integrationSetting.findUnique).toHaveBeenCalledWith({
        where: { provider: 'RAZORPAY' },
      });
    });

    it('identifies disabled state correctly', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 1,
        provider: 'RAZORPAY',
        isEnabled: false,
        environment: 'TEST',
        credentials: {
          keyId: 'rzp_test_disabled_key',
          keySecret: encryptSecret('rzp_sec_disabled_secret'),
        },
        config: {},
        updatedAt: new Date(),
        deletedAt: null,
      });

      const config = await service.getRazorpayConfig();
      expect(config.isEnabled).toBe(false);
      expect(config.isConfigured).toBe(true);
    });
  });

  describe('6. Environment-Driven Dual Configuration (TEST vs LIVE) & Mismatch Protection', () => {
    it('resolves TEST environment credentials when RAZORPAY_ENVIRONMENT=TEST', async () => {
      process.env.RAZORPAY_ENVIRONMENT = 'TEST';
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_testmode_key123';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'rzp_sec_testmode_secret456';
      process.env.RAZORPAY_LIVE_KEY_ID = 'rzp_live_livemode_key789';
      process.env.RAZORPAY_LIVE_KEY_SECRET = 'rzp_sec_livemode_secret012';

      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);

      const config = await service.getRazorpayConfig();
      expect(config.environment).toBe('TEST');
      expect(config.keyId).toBe('rzp_test_testmode_key123');
      expect(config.keySecret).toBe('rzp_sec_testmode_secret456');
    });

    it('resolves LIVE environment credentials when RAZORPAY_ENVIRONMENT=LIVE', async () => {
      process.env.RAZORPAY_ENVIRONMENT = 'LIVE';
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_testmode_key123';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'rzp_sec_testmode_secret456';
      process.env.RAZORPAY_LIVE_KEY_ID = 'rzp_live_livemode_key789';
      process.env.RAZORPAY_LIVE_KEY_SECRET = 'rzp_sec_livemode_secret012';

      mockPrisma.integrationSetting.findUnique.mockResolvedValue(null);

      const config = await service.getRazorpayConfig();
      expect(config.environment).toBe('LIVE');
      expect(config.keyId).toBe('rzp_live_livemode_key789');
      expect(config.keySecret).toBe('rzp_sec_livemode_secret012');
    });

    it('throws BadRequestException if TEST environment is configured with a LIVE key (rzp_live_...) mismatch', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 1,
        provider: 'RAZORPAY',
        isEnabled: true,
        environment: 'TEST',
        credentials: {
          keyId: 'rzp_live_accidentally_live_key',
          keySecret: encryptSecret('rzp_sec_some_secret'),
        },
        config: {},
        updatedAt: new Date(),
        deletedAt: null,
      });

      await expect(service.getRazorpayConfig()).rejects.toThrow(
        /Razorpay Environment Mismatch: Configured environment is TEST, but Key ID is/i,
      );
    });

    it('throws BadRequestException if LIVE environment is configured with a TEST key (rzp_test_...) mismatch', async () => {
      mockPrisma.integrationSetting.findUnique.mockResolvedValue({
        id: 1,
        provider: 'RAZORPAY',
        isEnabled: true,
        environment: 'LIVE',
        credentials: {
          keyId: 'rzp_test_accidentally_test_key',
          keySecret: encryptSecret('rzp_sec_some_secret'),
        },
        config: {},
        updatedAt: new Date(),
        deletedAt: null,
      });

      await expect(service.getRazorpayConfig()).rejects.toThrow(
        /Razorpay Environment Mismatch: Configured environment is LIVE, but Key ID is/i,
      );
    });
  });
});

