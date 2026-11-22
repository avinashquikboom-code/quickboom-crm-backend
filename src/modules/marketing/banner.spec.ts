import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BannerService } from './banner.service';
import { BannerUploadService } from './banner-upload.service';
import { BannerController } from './banner.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateMarketingBannerDto, QueryMarketingBannerDto } from './dto/banner.dto';

describe('CreateMarketingBannerDto optional fields validation', () => {
  it('allows all optional fields to be empty strings, null, or omitted without errors', () => {
    const dto = plainToInstance(
      CreateMarketingBannerDto,
      {
        imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/valid.jpg',
        title: '',
        subtitle: '',
        description: '',
        ctaText: '',
        ctaUrl: '',
        priority: '',
        startAt: '',
        endAt: null,
      },
      { enableImplicitConversion: true },
    );
    const errors = validateSync(dto);
    expect(errors).toHaveLength(0);
    expect(dto.priority).toBe(0);
    expect(dto.startAt).toBeNull();
    expect(dto.endAt).toBeNull();
  });
});

describe('QueryMarketingBannerDto boolean query parsing', () => {
  it('parses string false as false for inactive banner filtering', () => {
    const query = plainToInstance(QueryMarketingBannerDto, { isActive: 'false' }, { enableImplicitConversion: true });
    expect(query.isActive).toBe(false);
    expect(validateSync(query)).toHaveLength(0);
  });

  it('parses string true as true for active and published filtering', () => {
    const query = plainToInstance(
      QueryMarketingBannerDto,
      { isActive: 'true', isPublished: 'true' },
      { enableImplicitConversion: true },
    );
    expect(query.isActive).toBe(true);
    expect(query.isPublished).toBe(true);
    expect(validateSync(query)).toHaveLength(0);
  });
});

describe('Marketing Module - Banner Service & Controller', () => {
  let service: BannerService;
  let controller: BannerController;

  const mockMarketingBanners: any[] = [];
  let bannerIdCounter = 1;

  const mockS3Service = {
    extractKey: jest.fn().mockImplementation((url: string) => url ? url.split('.amazonaws.com/')[1] || url : ''),
    getPresignedUrl: jest.fn().mockImplementation((key: string) => Promise.resolve(`https://qbapp.online.s3.ap-south-1.amazonaws.com/${key}`)),
    uploadMedia: jest.fn().mockImplementation((file: any, folder: string) => Promise.resolve({
      imageUrl: `https://qbapp.online.s3.ap-south-1.amazonaws.com/${folder}/mock.jpg`,
      imagePublicId: `${folder}/mock.jpg`,
    })),
  };

  const mockPrismaService = {
    marketingBanner: {
      create: jest.fn().mockImplementation(({ data }) => {
        const item = {
          id: bannerIdCounter++,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        mockMarketingBanners.push(item);
        return Promise.resolve(item);
      }),
      findMany: jest.fn().mockImplementation(({ where, orderBy }) => {
        let list = mockMarketingBanners.filter((b) => {
          if (where.deletedAt === null && b.deletedAt !== null) return false;
          if (where.isActive !== undefined && b.isActive !== where.isActive) return false;
          if (where.isPublished !== undefined && b.isPublished !== where.isPublished) return false;

          // Tenant isolation check
          if (where.OR && Array.isArray(where.OR)) {
            const matchesTenant = where.OR.some((clause: any) => {
              if (clause.customerId !== undefined) {
                return b.customerId === clause.customerId;
              }
              return false;
            });
            if (!matchesTenant) return false;
          }

          // Date scheduling check
          if (where.AND && Array.isArray(where.AND)) {
            for (const cond of where.AND) {
              if (cond.OR) {
                const now = new Date();
                const matchesDate = cond.OR.some((sub: any) => {
                  if (sub.startAt === null && b.startAt === null) return true;
                  if (sub.startAt?.lte && b.startAt && b.startAt <= now) return true;
                  if (sub.endAt === null && b.endAt === null) return true;
                  if (sub.endAt?.gte && b.endAt && b.endAt >= now) return true;
                  return false;
                });
                if (!matchesDate) return false;
              }
            }
          }

          return true;
        });

        if (orderBy) {
          list.sort((a, b) => {
            for (const ord of orderBy) {
              if (ord.priority) {
                const diff = (b.priority ?? 0) - (a.priority ?? 0);
                if (diff !== 0) return ord.priority === 'desc' ? diff : -diff;
              }
              if (ord.createdAt) {
                const diff = b.createdAt.getTime() - a.createdAt.getTime();
                if (diff !== 0) return ord.createdAt === 'desc' ? diff : -diff;
              }
            }
            return 0;
          });
        }

        return Promise.resolve(list);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        const item = mockMarketingBanners.find((b) => {
          if (where.id !== undefined && b.id !== where.id) return false;
          if (where.deletedAt === null && b.deletedAt !== null) return false;
          return true;
        });
        return Promise.resolve(item || null);
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const idx = mockMarketingBanners.findIndex((b) => b.id === where.id);
        if (idx === -1) throw new Error('Not found');
        mockMarketingBanners[idx] = {
          ...mockMarketingBanners[idx],
          ...data,
          updatedAt: new Date(),
        };
        return Promise.resolve(mockMarketingBanners[idx]);
      }),
      count: jest.fn().mockImplementation(({ where }) => {
        return Promise.resolve(mockMarketingBanners.filter((b) => b.deletedAt === null).length);
      }),
    },
  };

  const mockUploadService = {
    uploadBannerImage: jest.fn().mockImplementation((file) =>
      Promise.resolve({
        imageUrl: `https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/${file.originalname}`,
        imagePublicId: `marketing/banners/${file.originalname}`,
      }),
    ),
    deleteBannerImage: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    mockMarketingBanners.length = 0;
    bannerIdCounter = 1;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BannerController],
      providers: [
        BannerService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: BannerUploadService,
          useValue: mockUploadService,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
      ],
    }).compile();

    service = module.get<BannerService>(BannerService);
    controller = module.get<BannerController>(BannerController);
  });

  describe('1. Company Admin Banner Creation & Management', () => {
    it('creates a new marketing banner with valid fields and priority', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const dto = {
        title: 'Festival 50% Flash Offer',
        subtitle: 'Valid on annual subscriptions',
        description: 'Upgrade your gym management package today.',
        imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/festival.jpg',
        ctaText: 'Claim 50% Off',
        ctaUrl: 'https://quickboom.com/offers/50',
        priority: 50,
        isActive: true,
        isPublished: true,
      };

      const result = await service.create(dto, user);

      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.title).toBe('Festival 50% Flash Offer');
      expect(result.priority).toBe(50);
      expect(result.customerId).toBe(101);
      expect(result.isPublished).toBe(true);
      expect(result.isActive).toBe(true);
    });

    it('creates a new marketing banner with uploaded image file', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const dto = {
        title: 'Uploaded Photo Banner',
        subtitle: 'From local device upload',
        ctaText: 'View More',
        priority: 60,
      };
      const mockFile = {
        originalname: 'promo_banner.png',
        mimetype: 'image/png',
        size: 204800,
        buffer: Buffer.from('test-image-data'),
      } as Express.Multer.File;

      const result = await service.create(dto as any, user, mockFile);

      expect(result).toBeDefined();
      expect(result.imageUrl).toContain('promo_banner.png');
      expect(result.imagePublicId).toBe('marketing/banners/promo_banner.png');
    });

    it('creates a new marketing banner when image is supplied as alias for imageUrl', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const dto = {
        title: 'Image Alias Banner',
        subtitle: 'From direct image property',
        image: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/alias.jpg',
        ctaText: 'Claim Offer',
        priority: 75,
      };

      const result = await service.create(dto as any, user);

      expect(result).toBeDefined();
      expect(result.imageUrl).toContain('alias.jpg');
    });

    it('rejects creation if neither image file nor imageUrl is provided', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const dto = {
        title: 'No Image Banner',
      };

      await expect(service.create(dto as any, user)).rejects.toThrow(BadRequestException);
    });

    it('rejects creation if startAt is later than endAt', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const dto = {
        title: 'Invalid Date Banner',
        imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/banner.jpg',
        startAt: '2026-09-01T00:00:00.000Z',
        endAt: '2026-08-01T00:00:00.000Z',
      };

      await expect(service.create(dto, user)).rejects.toThrow(BadRequestException);
    });

    it('toggles publish status of marketing banner', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const banner = await service.create(
        {
          title: 'Draft Banner',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/draft.jpg',
          isPublished: false,
        },
        user,
      );

      expect(banner.isPublished).toBe(false);

      const published = await service.setPublished(banner.id, true, user);
      expect(published.isPublished).toBe(true);

      const unpublished = await service.setPublished(banner.id, false, user);
      expect(unpublished.isPublished).toBe(false);
    });

    it('toggles active status of marketing banner', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const banner = await service.create(
        {
          title: 'Active Banner',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/banner.jpg',
          isActive: true,
        },
        user,
      );

      const deactivated = await service.setStatus(banner.id, false, user);
      expect(deactivated.isActive).toBe(false);

      const activated = await service.setStatus(banner.id, true, user);
      expect(activated.isActive).toBe(true);
    });

    it('creates banner with only the required image input (all optional fields omitted)', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const dto = {
        imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/only-image.jpg',
      };

      const result = await service.create(dto as any, user);
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.title).toBe('');
      expect(result.subtitle).toBeNull();
      expect(result.description).toBeNull();
      expect(result.ctaText).toBeNull();
      expect(result.ctaUrl).toBeNull();
      expect(result.priority).toBe(0);
      expect(result.startAt).toBeNull();
      expect(result.endAt).toBeNull();
    });

    it('creates banner with all optional fields empty strings or null', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const dto = {
        title: '',
        subtitle: '',
        description: '',
        imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/empty-fields.jpg',
        ctaText: '',
        ctaUrl: '',
        priority: 0,
        startAt: null,
        endAt: null,
      };

      const result = await service.create(dto as any, user);
      expect(result).toBeDefined();
      expect(result.title).toBe('');
      expect(result.subtitle).toBeNull();
      expect(result.description).toBeNull();
      expect(result.ctaText).toBeNull();
      expect(result.ctaUrl).toBeNull();
      expect(result.priority).toBe(0);
      expect(result.startAt).toBeNull();
      expect(result.endAt).toBeNull();
    });

    it('creates banner with some optional fields populated', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const dto = {
        title: 'Partial Banner',
        imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/partial.jpg',
        ctaText: 'Explore',
        // subtitle, description, ctaUrl, startAt, endAt omitted
      };

      const result = await service.create(dto as any, user);
      expect(result.title).toBe('Partial Banner');
      expect(result.ctaText).toBe('Explore');
      expect(result.subtitle).toBeNull();
      expect(result.description).toBeNull();
      expect(result.ctaUrl).toBeNull();
      expect(result.priority).toBe(0);
    });

    it('edits banner and clears optional fields', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const banner = await service.create(
        {
          title: 'Full Banner',
          subtitle: 'Original Subtitle',
          description: 'Original Description',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/full.jpg',
          ctaText: 'Original CTA',
          ctaUrl: 'https://example.com/orig',
          priority: 25,
          startAt: '2026-01-01T00:00:00.000Z',
          endAt: '2026-12-31T23:59:59.000Z',
        },
        user,
      );

      expect(banner.title).toBe('Full Banner');
      expect(banner.subtitle).toBe('Original Subtitle');
      expect(banner.startAt).toBeDefined();

      // Clear all optional fields
      const updated = await service.update(
        banner.id,
        {
          title: '',
          subtitle: '',
          description: '',
          ctaText: '',
          ctaUrl: '',
          priority: 0,
          startAt: null,
          endAt: null,
        } as any,
        user,
      );

      expect(updated.title).toBe('');
      expect(updated.subtitle).toBeNull();
      expect(updated.description).toBeNull();
      expect(updated.ctaText).toBeNull();
      expect(updated.ctaUrl).toBeNull();
      expect(updated.priority).toBe(0);
      expect(updated.startAt).toBeNull();
      expect(updated.endAt).toBeNull();
    });

    it('saves banner without dates and keeps them null', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const banner = await service.create(
        {
          title: 'Dateless Banner',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/dateless.jpg',
        },
        user,
      );

      expect(banner.startAt).toBeNull();
      expect(banner.endAt).toBeNull();
    });

    it('soft deletes marketing banner by setting deletedAt', async () => {
      const user = { id: 10, customerId: 101, role: 'COMPANY_ADMIN' };
      const banner = await service.create(
        {
          title: 'To Be Deleted',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/delete.jpg',
        },
        user,
      );

      const res = await service.remove(banner.id, user);
      expect(res.success).toBe(true);

      const itemInDb = mockMarketingBanners.find((b) => b.id === banner.id);
      expect(itemInDb.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('2. Customer View, Date Scheduling & Priority Ordering', () => {
    it('returns only active, published banners within valid schedule dates in priority order', async () => {
      const admin = { id: 1, customerId: 101, role: 'COMPANY_ADMIN' };

      // 1. High priority banner (priority 100)
      await service.create(
        {
          title: 'High Priority Offer',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/high.jpg',
          priority: 100,
          isActive: true,
          isPublished: true,
          startAt: new Date(Date.now() - 86400000).toISOString(),
          endAt: new Date(Date.now() + 86400000).toISOString(),
        },
        admin,
      );

      // 2. Medium priority banner (priority 50)
      await service.create(
        {
          title: 'Medium Priority Offer',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/medium.jpg',
          priority: 50,
          isActive: true,
          isPublished: true,
        },
        admin,
      );

      // 3. Draft banner (isPublished: false) -> should NOT appear
      await service.create(
        {
          title: 'Draft Offer',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/draft.jpg',
          priority: 999,
          isActive: true,
          isPublished: false,
        },
        admin,
      );

      // 4. Inactive banner (isActive: false) -> should NOT appear
      await service.create(
        {
          title: 'Inactive Offer',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/inactive.jpg',
          priority: 999,
          isActive: false,
          isPublished: true,
        },
        admin,
      );

      // 5. Expired banner (endAt in the past) -> should NOT appear
      await service.create(
        {
          title: 'Expired Offer',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/expired.jpg',
          priority: 999,
          isActive: true,
          isPublished: true,
          startAt: new Date(Date.now() - 172800000).toISOString(),
          endAt: new Date(Date.now() - 86400000).toISOString(),
        },
        admin,
      );

      const customerUser = { id: 50, customerId: 101, role: 'CUSTOMER' };
      const customerBanners = await service.findAllCustomer(customerUser);

      expect(customerBanners).toHaveLength(2);
      expect(customerBanners[0].title).toBe('High Priority Offer');
      expect(customerBanners[1].title).toBe('Medium Priority Offer');
    });
  });

  describe('3. Multi-Tenant / Company Isolation', () => {
    it('isolates banners to the authenticated companyId', async () => {
      const companyAdminA = { id: 1, customerId: 101, role: 'COMPANY_ADMIN' };
      const companyAdminB = { id: 2, customerId: 202, role: 'COMPANY_ADMIN' };

      await service.create(
        {
          title: 'Company A Exclusive Banner',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/a.jpg',
          priority: 10,
          isActive: true,
          isPublished: true,
        },
        companyAdminA,
      );

      await service.create(
        {
          title: 'Company B Exclusive Banner',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/b.jpg',
          priority: 10,
          isActive: true,
          isPublished: true,
        },
        companyAdminB,
      );

      // Customer A queries
      const customerA = { id: 50, customerId: 101, role: 'CUSTOMER' };
      const bannersForA = await service.findAllCustomer(customerA);
      expect(bannersForA).toHaveLength(1);
      expect(bannersForA[0].title).toBe('Company A Exclusive Banner');

      // Customer B queries
      const customerB = { id: 60, customerId: 202, role: 'CUSTOMER' };
      const bannersForB = await service.findAllCustomer(customerB);
      expect(bannersForB).toHaveLength(1);
      expect(bannersForB[0].title).toBe('Company B Exclusive Banner');
    });

    it('returns global banners (customerId: null) and customer-specific banners to Customer 11', async () => {
      const superAdmin = { id: 1, customerId: null, role: 'SUPER_ADMIN' };
      await service.create(
        {
          title: 'Global Promotional Banner',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/global.jpg',
          priority: 20,
          isActive: true,
          isPublished: true,
        },
        superAdmin,
      );

      const bannersFor11 = await service.findAllCustomer({ id: 11, customerId: 11, role: 'CUSTOMER' });
      expect(bannersFor11.some((b) => b.title === 'Global Promotional Banner')).toBe(true);

      const controllerResult = await controller.getCustomerBanners(
        { id: 11, role: 'CUSTOMER' },
        { headers: { 'x-customer-id': '11' } },
        '11',
        '11',
      );
      expect(controllerResult.some((b) => b.title === 'Global Promotional Banner')).toBe(true);
    });

    it('throws NotFoundException when Company A tries to access or update Company B banner', async () => {
      const companyAdminB = { id: 2, customerId: 202, role: 'COMPANY_ADMIN' };
      const bannerB = await service.create(
        {
          title: 'Company B Banner',
          imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/b.jpg',
        },
        companyAdminB,
      );

      const companyAdminA = { id: 1, customerId: 101, role: 'COMPANY_ADMIN' };
      await expect(
        service.update(bannerB.id, { title: 'Hacked Title' }, companyAdminA),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('4. Controller Role Guarding & Permissions', () => {
    it('blocks regular Customer from calling Admin banner create endpoint', async () => {
      const customerUser = { id: 50, customerId: 101, role: 'CUSTOMER' };
      const dto = {
        title: 'Customer Banner Attempt',
        imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/hack.jpg',
      };

      await expect(
        controller.create('101', customerUser, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks Employee from calling Admin banner update endpoint', async () => {
      const employeeUser = { id: 70, customerId: 101, role: 'EMPLOYEE' };
      const dto = { title: 'Employee Update Attempt' };

      await expect(
        controller.update('101', employeeUser, 1, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Company Admin and Super Admin to access Admin banner endpoints', async () => {
      const companyAdmin = { id: 1, customerId: 101, role: 'COMPANY_ADMIN' };
      const dto = {
        title: 'Admin Created Banner',
        imageUrl: 'https://quikboom-marketing-banners.s3.ap-south-1.amazonaws.com/marketing/banners/admin.jpg',
      };

      const banner = await controller.create('101', companyAdmin, dto);
      expect(banner).toBeDefined();
      expect(banner.title).toBe('Admin Created Banner');
    });
  });
});
