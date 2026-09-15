import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';

describe('Marketing Module - Video Service & Controller', () => {
  let service: VideoService;
  let controller: VideoController;

  let mockMarketingVideos: any[] = [];
  let mockVideoViews: any[] = [];
  let videoIdCounter = 1;
  let viewIdCounter = 1;

  const mockS3Service = {
    extractKey: jest.fn().mockImplementation((url: string) => (url ? url.split('.amazonaws.com/')[1] || url : '')),
    getPresignedUrl: jest.fn().mockImplementation((key: string) => Promise.resolve(`https://presigned.s3.amazonaws.com/${key}`)),
    uploadMedia: jest.fn().mockImplementation((file: any, folder: string, type: string) =>
      Promise.resolve({
        imageUrl: `https://s3.amazonaws.com/${folder}/mock-${file.originalname}`,
        imageKey: `${folder}/mock-${file.originalname}`,
      }),
    ),
  };

  const mockPrismaService = {
    marketingVideo: {
      create: jest.fn().mockImplementation(({ data }) => {
        const item = {
          id: videoIdCounter++,
          showOnHome: data.showOnHome !== undefined ? data.showOnHome : true,
          showInIntroduction: data.showInIntroduction !== undefined ? data.showInIntroduction : false,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        mockMarketingVideos.push(item);
        return Promise.resolve(item);
      }),
      findMany: jest.fn().mockImplementation(({ where, orderBy }) => {
        let list = mockMarketingVideos.filter((v) => {
          if (where.deletedAt === null && v.deletedAt !== null) return false;
          if (where.isActive !== undefined && v.isActive !== where.isActive) return false;
          if (where.isPublished !== undefined && v.isPublished !== where.isPublished) return false;
          if (where.status !== undefined && v.status !== where.status) return false;
          if (where.showOnHome !== undefined && v.showOnHome !== where.showOnHome) return false;
          if (where.showInIntroduction !== undefined && v.showInIntroduction !== where.showInIntroduction) return false;
          return true;
        });

        if (orderBy?.[0]?.priority === 'desc') {
          list = [...list].sort((a, b) => b.priority - a.priority);
        }

        return Promise.resolve(list);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        const item = mockMarketingVideos.find((v) => {
          if (where.id !== undefined && v.id !== where.id) return false;
          if (where.deletedAt === null && v.deletedAt !== null) return false;
          return true;
        });
        return Promise.resolve(item || null);
      }),
      count: jest.fn().mockImplementation(({ where }) => {
        const list = mockMarketingVideos.filter((v) => {
          if (where.deletedAt === null && v.deletedAt !== null) return false;
          if (where.status !== undefined && v.status !== where.status) return false;
          if (where.isActive !== undefined && v.isActive !== where.isActive) return false;
          return true;
        });
        return Promise.resolve(list.length);
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const idx = mockMarketingVideos.findIndex((v) => v.id === where.id);
        if (idx === -1) throw new Error('Not found');
        const updated = { ...mockMarketingVideos[idx], ...data, updatedAt: new Date() };
        mockMarketingVideos[idx] = updated;
        return Promise.resolve(updated);
      }),
    },
    customerMarketingVideoView: {
      findMany: jest.fn().mockImplementation(({ where }) => {
        const list = mockVideoViews.filter((v) => {
          if (where.customerId !== undefined && v.customerId !== where.customerId) return false;
          return true;
        });
        return Promise.resolve(list);
      }),
      upsert: jest.fn().mockImplementation(({ where, create, update }) => {
        const custId = where.customerId_marketingVideoId.customerId;
        const vidId = where.customerId_marketingVideoId.marketingVideoId;
        const idx = mockVideoViews.findIndex(
          (v) => v.customerId === custId && v.marketingVideoId === vidId,
        );
        if (idx >= 0) {
          mockVideoViews[idx] = { ...mockVideoViews[idx], ...update, updatedAt: new Date() };
          return Promise.resolve(mockVideoViews[idx]);
        }
        const created = {
          id: viewIdCounter++,
          customerId: custId,
          marketingVideoId: vidId,
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockVideoViews.push(created);
        return Promise.resolve(created);
      }),
      deleteMany: jest.fn().mockImplementation(({ where }) => {
        const before = mockVideoViews.length;
        mockVideoViews = mockVideoViews.filter((v) => {
          if (where.marketingVideoId !== undefined && v.marketingVideoId === where.marketingVideoId) return false;
          return true;
        });
        return Promise.resolve({ count: before - mockVideoViews.length });
      }),
    },
  };

  beforeEach(async () => {
    mockMarketingVideos = [];
    mockVideoViews = [];
    videoIdCounter = 1;
    viewIdCounter = 1;
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoController],
      providers: [
        VideoService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: S3Service, useValue: mockS3Service },
      ],
    }).compile();

    service = module.get<VideoService>(VideoService);
    controller = module.get<VideoController>(VideoController);
  });

  describe('Creation & Validation', () => {
    it('should create a marketing video with independent showOnHome and showInIntroduction flags', async () => {
      const dto = {
        title: 'Summer Sale Video',
        videoUrl: 'https://s3.amazonaws.com/marketing/videos/demo.mp4',
        thumbnailUrl: 'https://s3.amazonaws.com/marketing/thumbnails/thumb.jpg',
        priority: 10,
        status: 'ACTIVE',
        showOnHome: true,
        showInIntroduction: true,
      };

      const result = await service.create(dto, { id: 1, customerId: 5, role: 'COMPANYADMIN' });
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.showOnHome).toBe(true);
      expect(result.showInIntroduction).toBe(true);
    });

    it('should throw error if videoUrl is missing and no file is uploaded', async () => {
      await expect(
        service.create({ title: 'No Video' }, { id: 1, customerId: 5 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Customer Home Videos (findAllCustomer)', () => {
    it('should exclude videos with showOnHome = false from home feed', async () => {
      await service.create(
        { title: 'Home On', videoUrl: 'https://v1.mp4', showOnHome: true, status: 'ACTIVE' },
        { id: 1 },
      );
      await service.create(
        { title: 'Home Off', videoUrl: 'https://v2.mp4', showOnHome: false, showInIntroduction: true, status: 'ACTIVE' },
        { id: 1 },
      );

      const homeVideos = await service.findAllCustomer({ customerId: 10 });
      expect(homeVideos).toHaveLength(1);
      expect(homeVideos[0].title).toBe('Home On');
    });
  });

  describe('Customer Introduction / Onboarding Flow (One-Time-Per-Customer)', () => {
    let videoA: any;
    let videoB: any;
    let videoC: any;

    beforeEach(async () => {
      // Video A: Introduction = true, Priority 10
      videoA = await service.create(
        {
          title: 'Video A - Summer Campaign',
          videoUrl: 'https://s3.amazonaws.com/vA.mp4',
          status: 'ACTIVE',
          showInIntroduction: true,
          priority: 10,
        },
        { id: 1 },
      );

      // Video B: Introduction = true, Priority 20
      videoB = await service.create(
        {
          title: 'Video B - Diwali Campaign',
          videoUrl: 'https://s3.amazonaws.com/vB.mp4',
          status: 'ACTIVE',
          showInIntroduction: true,
          priority: 20,
        },
        { id: 1 },
      );

      // Video C: Introduction = false
      videoC = await service.create(
        {
          title: 'Video C - Regular Promo',
          videoUrl: 'https://s3.amazonaws.com/vC.mp4',
          status: 'ACTIVE',
          showInIntroduction: false,
          priority: 30,
        },
        { id: 1 },
      );
    });

    it('should return highest priority eligible introduction video (Video B) for new Customer X', async () => {
      const nextVid = await service.findIntroductionVideoCustomer({ customerId: 101 });
      expect(nextVid).toBeDefined();
      expect(nextVid?.id).toBe(videoB.id);
      expect(nextVid?.title).toBe('Video B - Diwali Campaign');
    });

    it('should NOT return Video B again after Customer X marks it as seen, then returns Video A', async () => {
      // 1. Customer X gets Video B
      const vid1 = await service.findIntroductionVideoCustomer({ customerId: 101 });
      expect(vid1?.id).toBe(videoB.id);

      // 2. Customer X completes/skips Video B
      await service.markIntroductionVideoSeen(videoB.id, { customerId: 101 });

      // 3. Next query should return Video A (next eligible unseen video)
      const vid2 = await service.findIntroductionVideoCustomer({ customerId: 101 });
      expect(vid2?.id).toBe(videoA.id);

      // 4. Customer X completes/skips Video A
      await service.markIntroductionVideoSeen(videoA.id, { customerId: 101 });

      // 5. Next query should return null (Video C has showInIntroduction = false)
      const vid3 = await service.findIntroductionVideoCustomer({ customerId: 101 });
      expect(vid3).toBeNull();
    });

    it('should maintain customer isolation: Customer Y can still see Video B even if Customer X saw it', async () => {
      // Customer X sees Video B
      await service.markIntroductionVideoSeen(videoB.id, { customerId: 101 });

      // Customer Y queries introduction video
      const vidForY = await service.findIntroductionVideoCustomer({ customerId: 202 });
      expect(vidForY?.id).toBe(videoB.id);
    });

    it('should allow Admin to reset views so eligible customers can see Video B again', async () => {
      // Customer X sees Video B
      await service.markIntroductionVideoSeen(videoB.id, { customerId: 101 });
      expect(await service.findIntroductionVideoCustomer({ customerId: 101 })).not.toMatchObject({ id: videoB.id });

      // Admin resets views for Video B
      await service.resetIntroductionViews(videoB.id, { id: 1, isSuperAdmin: true });

      // Customer X now sees Video B again!
      const vidAfterReset = await service.findIntroductionVideoCustomer({ customerId: 101 });
      expect(vidAfterReset?.id).toBe(videoB.id);
    });

    it('should NOT return expired introduction videos', async () => {
      const yesterday = new Date(Date.now() - 86400000);
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000);

      const expired = await service.create(
        {
          title: 'Expired Intro',
          videoUrl: 'https://v.mp4',
          status: 'ACTIVE',
          showInIntroduction: true,
          priority: 999,
          startAt: twoDaysAgo.toISOString(),
          endAt: yesterday.toISOString(),
        },
        { id: 1 },
      );

      const next = await service.findIntroductionVideoCustomer({ customerId: 303 });
      expect(next?.id).not.toBe(expired.id);
    });
  });
});
