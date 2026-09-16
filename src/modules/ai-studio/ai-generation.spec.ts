import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AiGenerationService } from './ai-generation.service';
import { AiProviderService } from './ai-provider.service';
import { AiCreditService } from './ai-credit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AiGenerationService - Content Generation & Credit Invariants', () => {
  let service: AiGenerationService;

  const mockPrisma = {
    aiGeneration: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    aiGenerationAsset: {
      create: jest.fn(),
    },
  };

  const mockAiProvider = {
    generateText: jest.fn(),
    generateImage: jest.fn(),
    generatePoster: jest.fn(),
    startVideoJob: jest.fn(),
    checkVideoJobStatus: jest.fn(),
  };

  const mockAiCredit = {
    validateCreditAvailability: jest.fn(),
    deductCreditsOnSuccess: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiGenerationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiProviderService, useValue: mockAiProvider },
        { provide: AiCreditService, useValue: mockAiCredit },
      ],
    }).compile();

    service = module.get<AiGenerationService>(AiGenerationService);
    jest.clearAllMocks();

    mockAiCredit.validateCreditAvailability.mockResolvedValue({ requiredCredits: 5, currentBalance: 50 });
    mockAiCredit.deductCreditsOnSuccess.mockResolvedValue({ creditsSpent: 5, newBalance: 45 });
  });

  describe('POSTER Generation', () => {
    it('should generate poster, save with COMPLETED status, and deduct credits after saving', async () => {
      mockAiProvider.generateImage.mockResolvedValue({
        url: '/uploads/ai-posters/poster-test.svg',
      });
      mockPrisma.aiGeneration.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 101, ...data }),
      );

      const result = await service.generate(1, {
        type: 'POSTER',
        product: 'Organic Honey',
        objective: 'PROMOTION',
        platform: 'INSTAGRAM',
      });

      expect(mockAiCredit.validateCreditAvailability).toHaveBeenCalledWith(1, 'AI_POSTER');
      expect(mockAiProvider.generateImage).toHaveBeenCalled();
      expect(mockPrisma.aiGeneration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'POSTER',
            status: 'COMPLETED',
            mediaUrl: '/uploads/ai-posters/poster-test.svg',
            mediaType: 'IMAGE',
          }),
        }),
      );
      expect(mockAiCredit.deductCreditsOnSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 1,
          serviceCode: 'AI_POSTER',
          generationDbId: 101,
          requiredCredits: 5,
        }),
      );
      expect(result.generation.mediaUrl).toBe('/uploads/ai-posters/poster-test.svg');
      expect(result.generation.status).toBe('COMPLETED');
    });
  });

  describe('VIDEO Generation', () => {
    it('should start video job, resolve valid playable MP4, and deduct credits', async () => {
      mockAiProvider.startVideoJob.mockResolvedValue({
        jobId: 'vjob-12345',
        status: 'PROCESSING',
      });
      mockAiProvider.checkVideoJobStatus.mockResolvedValue({
        status: 'COMPLETED',
        url: '/uploads/ai-videos/template-video.mp4',
      });
      mockAiProvider.generateText.mockResolvedValue({
        caption: 'Sneakers commercial copy',
        hashtags: ['#sneakers', '#style'],
      });
      mockPrisma.aiGeneration.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 102, ...data }),
      );

      const result = await service.generate(1, {
        type: 'VIDEO',
        product: 'Sneakers Brand',
        objective: 'BRAND_AWARENESS',
        platform: 'INSTAGRAM',
      });

      expect(mockAiProvider.startVideoJob).toHaveBeenCalled();
      expect(mockAiProvider.checkVideoJobStatus).toHaveBeenCalledWith('vjob-12345');
      expect(mockPrisma.aiGeneration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'VIDEO',
            status: 'COMPLETED',
            mediaUrl: '/uploads/ai-videos/template-video.mp4',
            mediaType: 'VIDEO',
          }),
        }),
      );
      expect(mockAiCredit.deductCreditsOnSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 1,
          serviceCode: 'AI_VIDEO',
          generationDbId: 102,
          requiredCredits: 5,
        }),
      );
      expect(result.generation.mediaUrl).toContain('.mp4');
      expect(result.generation.status).toBe('COMPLETED');
    });
  });

  describe('POST Generation', () => {
    it('should generate text copy AND poster image for a social post', async () => {
      mockAiProvider.generateText.mockResolvedValue({
        caption: 'Boost your morning with natural sweetness! 🍯',
        hashtags: ['#honey', '#health', '#organic'],
      });
      mockAiProvider.generateImage.mockResolvedValue({
        url: '/uploads/ai-posters/social-post.svg',
      });
      mockPrisma.aiGeneration.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 103, ...data }),
      );

      const result = await service.generate(1, {
        type: 'POST',
        product: 'Organic Honey',
      });

      expect(mockAiProvider.generateText).toHaveBeenCalled();
      expect(mockAiProvider.generateImage).toHaveBeenCalled();
      expect(result.generation.caption).toBe('Boost your morning with natural sweetness! 🍯');
      expect(result.generation.mediaUrl).toBe('/uploads/ai-posters/social-post.svg');
      expect(result.generation.status).toBe('COMPLETED');
      expect(mockAiCredit.deductCreditsOnSuccess).toHaveBeenCalled();
    });
  });

  describe('CAPTION & HASHTAGS Generation', () => {
    it('should generate text only without media and complete successfully', async () => {
      mockAiProvider.generateText.mockResolvedValue({
        caption: 'The best captions for your marketing.',
        hashtags: ['#marketing', '#growth'],
      });
      mockPrisma.aiGeneration.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 104, ...data }),
      );

      const result = await service.generate(1, {
        type: 'CAPTION',
        product: 'SaaS Tool',
      });

      expect(mockAiProvider.generateText).toHaveBeenCalled();
      expect(mockAiProvider.generateImage).not.toHaveBeenCalled();
      expect(result.generation.mediaUrl).toBeNull();
      expect(result.generation.status).toBe('COMPLETED');
      expect(mockAiCredit.deductCreditsOnSuccess).toHaveBeenCalled();
    });
  });

  describe('Failure Resilience & Credit Preservation', () => {
    it('should NEVER deduct credits when AI provider throws an error', async () => {
      mockAiProvider.generateImage.mockRejectedValue(new Error('AI Engine timeout'));
      mockPrisma.aiGeneration.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 105, ...data }),
      );

      await expect(
        service.generate(1, {
          type: 'POSTER',
          product: 'Failed Item',
        }),
      ).rejects.toThrow('AI Generation failed: AI Engine timeout');

      // Generation was aborted before saving or credit deduction
      expect(mockPrisma.aiGeneration.create).not.toHaveBeenCalled();
      expect(mockAiCredit.deductCreditsOnSuccess).not.toHaveBeenCalled();
    });

    it('should reject generation when insufficient credits before calling AI provider', async () => {
      mockAiCredit.validateCreditAvailability.mockRejectedValue(
        new BadRequestException('Insufficient AI credits'),
      );

      await expect(
        service.generate(1, {
          type: 'POSTER',
          product: 'Failed Item',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockAiProvider.generateImage).not.toHaveBeenCalled();
      expect(mockPrisma.aiGeneration.create).not.toHaveBeenCalled();
      expect(mockAiCredit.deductCreditsOnSuccess).not.toHaveBeenCalled();
    });
  });
});
