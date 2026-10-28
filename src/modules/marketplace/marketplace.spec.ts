import { Test, TestingModule } from '@nestjs/testing';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceController } from './marketplace.controller';
import { PrismaService } from '../../prisma/prisma.service';

describe('MarketplaceModule', () => {
  let service: MarketplaceService;
  let controller: MarketplaceController;

  const mockMarketplaceTools = [
    {
      id: 1,
      title: 'WhatsApp Marketing Tool',
      subtitle: 'Campaigns & Automation',
      description: 'Bulk messaging, auto-replies, campaigns.',
      icon: 'whatsapp',
      category: 'GROWTH_TOOLS',
      route: '/customer/social-media-work',
      externalUrl: null,
      badge: 'POPULAR',
      sortOrder: 1,
      isActive: true,
      isPublished: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    {
      id: 2,
      title: 'Social Media Scheduler',
      subtitle: 'Multi-platform planner',
      description: 'Instagram, Facebook, LinkedIn post scheduling.',
      icon: 'calendar',
      category: 'GROWTH_TOOLS',
      route: '/customer/calendar',
      externalUrl: null,
      badge: 'NEW',
      sortOrder: 2,
      isActive: true,
      isPublished: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
  ];

  const mockPrisma = {
    marketplaceTool: {
      findMany: jest.fn().mockImplementation((args) => {
        if (args?.where?.isActive === true) {
          return Promise.resolve(mockMarketplaceTools.filter(t => t.isActive && !t.deletedAt));
        }
        return Promise.resolve(mockMarketplaceTools);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        const item = mockMarketplaceTools.find(t => t.id === where.id && !t.deletedAt);
        return Promise.resolve(item || null);
      }),
      create: jest.fn().mockImplementation(({ data }) => {
        return Promise.resolve({ id: 99, ...data, createdAt: new Date(), updatedAt: new Date() });
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const item = mockMarketplaceTools.find(t => t.id === where.id);
        return Promise.resolve({ ...item, ...data, updatedAt: new Date() });
      }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MarketplaceController],
      providers: [
        MarketplaceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MarketplaceService>(MarketplaceService);
    controller = module.get<MarketplaceController>(MarketplaceController);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(controller).toBeDefined();
  });

  it('should return active marketplace tools sorted by order', async () => {
    const res = await controller.getMarketplaceTools();
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(2);
    expect(res.data[0].title).toBe('WhatsApp Marketing Tool');
    expect(res.data[0].sortOrder).toBe(1);
    expect(res.data[1].title).toBe('Social Media Scheduler');
    expect(res.data[1].sortOrder).toBe(2);
  });

  it('should allow admin to create a marketplace tool', async () => {
    const newTool = {
      title: 'Email Marketing Tool',
      description: 'Bulk email campaigns and automation.',
      icon: 'email',
      sortOrder: 6,
    };
    const res = await controller.createMarketplaceTool(newTool);
    expect(res.success).toBe(true);
    expect(res.data.title).toBe('Email Marketing Tool');
    expect(mockPrisma.marketplaceTool.create).toHaveBeenCalled();
  });

  it('should allow admin to update a marketplace tool status or order', async () => {
    const res = await controller.updateMarketplaceTool(1, { isActive: false, sortOrder: 10 });
    expect(res.success).toBe(true);
    expect(mockPrisma.marketplaceTool.update).toHaveBeenCalled();
  });

  it('should allow admin to soft delete a marketplace tool', async () => {
    const res = await controller.deleteMarketplaceTool(1);
    expect(res.success).toBe(true);
    expect(mockPrisma.marketplaceTool.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ isActive: false }),
      }),
    );
  });
});
