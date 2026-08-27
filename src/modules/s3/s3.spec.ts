import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3Service } from './s3.service';
import { BadRequestException } from '@nestjs/common';

describe('S3Service', () => {
  let service: S3Service;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'AWS_REGION') return 'ap-south-1';
              if (key === 'AWS_S3_BUCKET') return 'test-crm-bucket';
              return null;
            }),
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

    it('uploads valid image file and returns URL and key', async () => {
      const mockFile = {
        fieldname: 'image',
        originalname: 'promo_banner.webp',
        encoding: '7bit',
        mimetype: 'image/webp',
        buffer: Buffer.from('mock webp image data'),
        size: 2048,
      } as Express.Multer.File;

      const result = await service.uploadFile(mockFile, 'marketing/banners');
      expect(result).toHaveProperty('imageUrl');
      expect(result).toHaveProperty('imageKey');
      expect(result.imageKey).toContain('marketing/banners');
    });

    it('generates public file URL for S3 key', () => {
      const url = service.getFileUrl('marketing/banners/test-banner.png');
      expect(url).toBe(
        'https://test-crm-bucket.s3.ap-south-1.amazonaws.com/marketing/banners/test-banner.png',
      );
    });
  });
});
