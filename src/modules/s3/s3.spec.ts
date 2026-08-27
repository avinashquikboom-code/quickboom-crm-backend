import { Test, TestingModule } from '@nestjs/testing';
import { S3Service } from './s3.service';
import { BadRequestException } from '@nestjs/common';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';

const mockAwsS3Config = {
  accessKeyId: 'FAKE_ACCESS_KEY_ID_12',
  secretAccessKey: 'FAKE_SECRET_KEY_XXXXXXXX',
  region: 'ap-south-1',
  bucket: 'test-crm-bucket',
  customDomain: '',
  isEnabled: true,
  isConfigured: true,
  source: 'ENV_FALLBACK' as const,
};

describe('S3Service', () => {
  let service: S3Service;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        {
          provide: IntegrationSettingsService,
          useValue: {
            getAwsS3Config: jest.fn().mockResolvedValue(mockAwsS3Config),
          },
        },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
  });

  describe('File Upload Validation', () => {
    it('throws error when file is missing', async () => {
      await expect(service.uploadFile(null as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects unsupported file mime types', async () => {
      const mockFile = {
        fieldname: 'image',
        originalname: 'script.exe',
        encoding: '7bit',
        mimetype: 'application/x-msdownload',
        buffer: Buffer.from('executable binary code'),
        size: 1024,
      } as Express.Multer.File;

      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects file larger than 10MB', async () => {
      const mockFile = {
        fieldname: 'image',
        originalname: 'huge_banner.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: Buffer.alloc(100),
        size: 11 * 1024 * 1024, // 11MB
      } as Express.Multer.File;

      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('generates public file URL for S3 key', async () => {
      const url = await service.getFileUrl('marketing/banners/test-banner.png');
      expect(url).toBe(
        'https://test-crm-bucket.s3.ap-south-1.amazonaws.com/marketing/banners/test-banner.png',
      );
    });

    it('uses customDomain when present in config', async () => {
      // Override mock to return a custom domain
      const integrationSettingsMock = {
        getAwsS3Config: jest.fn().mockResolvedValue({
          ...mockAwsS3Config,
          customDomain: 'cdn.example.com',
        }),
      };

      const module2: TestingModule = await Test.createTestingModule({
        providers: [
          S3Service,
          { provide: IntegrationSettingsService, useValue: integrationSettingsMock },
        ],
      }).compile();

      const svc2 = module2.get<S3Service>(S3Service);
      const url = await svc2.getFileUrl('marketing/banners/test-banner.png');
      expect(url).toBe('https://cdn.example.com/marketing/banners/test-banner.png');
    });
  });
});
