import { Test, TestingModule } from '@nestjs/testing';
import { TrendingService } from './trending.service';
import { TrendingController } from './trending.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { TrendingCategory } from '@prisma/client';

describe('Trending Content Module', () => {
  let service: TrendingService;
  let controller: TrendingController;
  let prisma: any;
  let s3Service: any;

  beforeEach(async () => {
    prisma = {
      trendingContent: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    s3Service = {
      uploadMedia: jest.fn().mockResolvedValue({
        imageUrl: 'https://s3.ap-south-1.amazonaws.com/quikboom/marketing/trending/test.mp4',
        imageKey: 'marketing/trending/test.mp4',
      }),
      getPresignedUrl: jest.fn().mockImplementation((url) => Promise.resolve(url)),
      formatS3Url: jest.fn().mockReturnValue('https://s3.ap-south-1.amazonaws.com/quikboom/test.mp4'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrendingController],
      providers: [
        TrendingService,
        { provide: PrismaService, useValue: prisma },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get<TrendingService>(TrendingService);
    controller = module.get<TrendingController>(TrendingController);
  });

  describe('1. Company Admin Content Creation & Management', () => {
    it('creates a REEL trending item with valid fields and priority', async () => {
      const dto = {
        title: 'Summer Reel Campaign',
        description: 'Product reel promo',
        category: TrendingCategory.REEL,
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
        mediaUrl: 'https://cdn.example.com/reel.mp4',
        ctaText: 'View Idea',
        ctaUrl: 'https://instagram.com/reel/123',
        platform: 'INSTAGRAM',
        objective: 'ENGAGEMENT',
        priority: 15,
        isPublished: true,
        isActive: true,
      };

      const mockCreated = {
        id: 1,
        customerId: 101,
        ...dto,
        startAt: null,
        endAt: null,
        createdBy: 1,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      prisma.trendingContent.create.mockResolvedValue(mockCreated);

      const result = await service.create(101, 1, dto as any);
      expect(result.success).toBe(true);
      expect(result.data.category).toBe(TrendingCategory.REEL);
      expect(result.data.priority).toBe(15);
      expect(prisma.trendingContent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 101,
            title: 'Summer Reel Campaign',
            category: TrendingCategory.REEL,
            priority: 15,
          }),
        }),
      );
    });

    it('rejects creation if startAt is later than endAt', async () => {
      const dto = {
        title: 'Invalid Date Promo',
        category: TrendingCategory.OFFER,
        startAt: '2026-09-01T00:00:00.000Z',
        endAt: '2026-08-01T00:00:00.000Z', // earlier than start
      };

      await expect(service.create(101, 1, dto as any)).rejects.toThrow(BadRequestException);
    });

    it('toggles publish status of trending content', async () => {
      prisma.trendingContent.findFirst.mockResolvedValue({ id: 5, customerId: 101 });
      prisma.trendingContent.update.mockResolvedValue({ id: 5, isPublished: false });

      const result = await service.setPublished(101, 5, false);
      expect(result.success).toBe(true);
      expect(prisma.trendingContent.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { isPublished: false },
      });
    });

    it('toggles active status of trending content', async () => {
      prisma.trendingContent.findFirst.mockResolvedValue({ id: 5, customerId: 101 });
      prisma.trendingContent.update.mockResolvedValue({ id: 5, isActive: false });

      const result = await service.setStatus(101, 5, false);
      expect(result.success).toBe(true);
      expect(prisma.trendingContent.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { isActive: false },
      });
    });

    it('soft deletes trending content by setting deletedAt', async () => {
      prisma.trendingContent.findFirst.mockResolvedValue({ id: 5, customerId: 101 });
      prisma.trendingContent.update.mockResolvedValue({ id: 5, deletedAt: new Date() });

      const result = await service.remove(101, 5);
      expect(result.success).toBe(true);
      expect(prisma.trendingContent.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('uploads multiple images and creates separate database records for each', async () => {
      const dto = {
        title: 'Diwali Creative',
        description: 'Festival promotion',
      };

      const mockImageFiles: any[] = [
        { originalname: 'image1.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('img1') },
        { originalname: 'image2.png', mimetype: 'image/png', buffer: Buffer.from('img2') },
        { originalname: 'image3.webp', mimetype: 'image/webp', buffer: Buffer.from('img3') },
      ];

      prisma.trendingContent.create
        .mockResolvedValueOnce({ id: 101, customerId: 101, title: 'Diwali Creative (1)', category: TrendingCategory.STORY })
        .mockResolvedValueOnce({ id: 102, customerId: 101, title: 'Diwali Creative (2)', category: TrendingCategory.STORY })
        .mockResolvedValueOnce({ id: 103, customerId: 101, title: 'Diwali Creative (3)', category: TrendingCategory.STORY });

      const result = await service.create(101, 1, dto as any, false, mockImageFiles);

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(3);
      expect(prisma.trendingContent.create).toHaveBeenCalledTimes(3);
      expect(s3Service.uploadMedia).toHaveBeenCalledTimes(3);
    });

    it('uploads multiple videos and creates separate database records with VIDEO mediaType', async () => {
      const dto = {
        title: 'Reels Pack',
      };

      const mockVideoFiles: any[] = [
        { originalname: 'video1.mp4', mimetype: 'video/mp4', buffer: Buffer.from('vid1') },
        { originalname: 'video2.mov', mimetype: 'video/quicktime', buffer: Buffer.from('vid2') },
      ];

      prisma.trendingContent.create
        .mockResolvedValueOnce({ id: 201, customerId: 101, title: 'Reels Pack (1)', category: TrendingCategory.REEL })
        .mockResolvedValueOnce({ id: 202, customerId: 101, title: 'Reels Pack (2)', category: TrendingCategory.REEL });

      const result = await service.create(101, 1, dto as any, false, mockVideoFiles);

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(2);
      expect(prisma.trendingContent.create).toHaveBeenCalledTimes(2);
      expect(s3Service.uploadMedia).toHaveBeenCalledWith(
        expect.objectContaining({ originalname: 'video1.mp4' }),
        'marketing/trending',
        'VIDEO',
      );
      expect(s3Service.uploadMedia).toHaveBeenCalledWith(
        expect.objectContaining({ originalname: 'video2.mov' }),
        'marketing/trending',
        'VIDEO',
      );
    });

    it('uploads mixed images and videos in one operation with respective media types', async () => {
      const dto = {
        title: 'Mixed Campaign',
      };

      const mockMixedFiles: any[] = [
        { originalname: 'image1.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('img1') },
        { originalname: 'image2.png', mimetype: 'image/png', buffer: Buffer.from('img2') },
        { originalname: 'video1.mp4', mimetype: 'video/mp4', buffer: Buffer.from('vid1') },
        { originalname: 'video2.webm', mimetype: 'video/webm', buffer: Buffer.from('vid2') },
      ];

      prisma.trendingContent.create
        .mockResolvedValueOnce({ id: 301, customerId: 101, title: 'Mixed Campaign (1)', category: TrendingCategory.STORY })
        .mockResolvedValueOnce({ id: 302, customerId: 101, title: 'Mixed Campaign (2)', category: TrendingCategory.STORY })
        .mockResolvedValueOnce({ id: 303, customerId: 101, title: 'Mixed Campaign (3)', category: TrendingCategory.REEL })
        .mockResolvedValueOnce({ id: 304, customerId: 101, title: 'Mixed Campaign (4)', category: TrendingCategory.REEL });

      const result = await service.create(101, 1, dto as any, false, mockMixedFiles);

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(4);
      expect(prisma.trendingContent.create).toHaveBeenCalledTimes(4);
      expect(s3Service.uploadMedia).toHaveBeenCalledWith(
        expect.objectContaining({ originalname: 'image1.jpg' }),
        'marketing/trending',
        'IMAGE',
      );
      expect(s3Service.uploadMedia).toHaveBeenCalledWith(
        expect.objectContaining({ originalname: 'video1.mp4' }),
        'marketing/trending',
        'VIDEO',
      );
    });

    it('handles partial failure gracefully when one file in the batch fails', async () => {
      const dto = { title: 'Partial Batch' };
      const mockFiles: any[] = [
        { originalname: 'good1.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('good1') },
        { originalname: 'corrupt.xyz', mimetype: 'application/unknown', buffer: Buffer.from('bad') },
        { originalname: 'good2.mp4', mimetype: 'video/mp4', buffer: Buffer.from('good2') },
      ];

      s3Service.uploadMedia
        .mockResolvedValueOnce({ imageUrl: 'https://s3.ap-south-1.amazonaws.com/good1.jpg', imageKey: 'good1.jpg' })
        .mockRejectedValueOnce(new BadRequestException('Invalid format'))
        .mockResolvedValueOnce({ imageUrl: 'https://s3.ap-south-1.amazonaws.com/good2.mp4', imageKey: 'good2.mp4' });

      prisma.trendingContent.create
        .mockResolvedValueOnce({ id: 401, customerId: 101, title: 'Partial Batch (1)' })
        .mockResolvedValueOnce({ id: 402, customerId: 101, title: 'Partial Batch (3)' });

      const result = await service.create(101, 1, dto as any, false, mockFiles);

      expect(result.success).toBe(true);
      expect(result.createdCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.failedItems?.[0].name).toBe('corrupt.xyz');
      expect(prisma.trendingContent.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('2. Customer View & Date Scheduling & Priority Ordering', () => {
    it('returns only active, published items within valid schedule dates', async () => {
      const mockItems = [
        {
          id: 10,
          title: 'High Priority Reel',
          category: TrendingCategory.REEL,
          priority: 50,
          isPublished: true,
          isActive: true,
          createdAt: new Date(),
        },
        {
          id: 11,
          title: 'Monsoon Offer',
          category: TrendingCategory.OFFER,
          priority: 10,
          isPublished: true,
          isActive: true,
          createdAt: new Date(),
        },
      ];

      prisma.trendingContent.findMany.mockResolvedValue(mockItems);

      const result = await service.findAllCustomer(101, undefined, { id: 50 });
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(2);
      expect(prisma.trendingContent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            isPublished: true,
            deletedAt: null,
          }),
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        }),
      );
    });

    it('filters customer view by category (e.g. HIGH_ROI_AD)', async () => {
      prisma.trendingContent.findMany.mockResolvedValue([]);

      await service.findAllCustomer(101, TrendingCategory.HIGH_ROI_AD, { id: 50 });
      expect(prisma.trendingContent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: TrendingCategory.HIGH_ROI_AD,
          }),
        }),
      );
    });
  });

  describe('3. Multi-Tenant / Company Isolation', () => {
    it('isolates trending content to the authenticated customerId', async () => {
      prisma.trendingContent.findMany.mockResolvedValue([]);

      await service.findAllCustomer(202, undefined, { id: 88, customerId: 202 });
      expect(prisma.trendingContent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { customerId: 202 },
              { customerId: null },
            ],
          }),
        }),
      );
    });

    it('throws NotFoundException when Company A tries to update Company B content', async () => {
      prisma.trendingContent.findFirst.mockResolvedValue(null);

      await expect(
        service.update(101, 999, { title: 'Hacked Title' }, false),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('4. Controller Role Guarding & Permissions', () => {
    it('blocks regular Customer from calling Admin create endpoint', async () => {
      const customerUser = {
        id: 5,
        role: 'CUSTOMER',
        roles: ['CUSTOMER'],
        customerId: 101,
      };

      expect(() => {
        (controller as any).checkCompanyAdminAccess(customerUser);
      }).toThrow(ForbiddenException);
    });

    it('blocks Employee from calling Admin update endpoint', async () => {
      const employeeUser = {
        id: 6,
        role: 'EMPLOYEE',
        roles: ['EMPLOYEE'],
        customerId: 101,
      };

      expect(() => {
        (controller as any).checkCompanyAdminAccess(employeeUser);
      }).toThrow(ForbiddenException);
    });

    it('allows Company Admin and Super Admin to access Admin endpoints', async () => {
      const adminUser = {
        id: 2,
        role: 'COMPANY_ADMIN',
        roles: ['COMPANY_ADMIN'],
        customerId: 101,
      };

      const superAdminUser = {
        id: 1,
        role: 'SUPER_ADMIN',
        roles: ['SUPER_ADMIN'],
        customerId: null,
      };

      expect(() => (controller as any).checkCompanyAdminAccess(adminUser)).not.toThrow();
      expect(() => (controller as any).checkCompanyAdminAccess(superAdminUser)).not.toThrow();
    });
  });
});
