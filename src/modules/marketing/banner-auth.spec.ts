import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BannerService } from './banner.service';
import { BannerUploadService } from './banner-upload.service';
import { BannerController } from './banner.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { Reflector } from '@nestjs/core';
import { S3Service } from '../s3/s3.service';

describe('Admin Marketing Banners - End-to-End Authentication & Authorization Suite', () => {
  let controller: BannerController;
  let service: BannerService;

  const mockDbBanners: any[] = [
    {
      id: 1,
      title: 'Company 101 Exclusive Banner',
      imageUrl: 'https://s3.amazonaws.com/marketing/banners/b1.jpg',
      priority: 10,
      isActive: true,
      isPublished: true,
      customerId: 101,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      title: 'Company 202 Exclusive Banner',
      imageUrl: 'https://s3.amazonaws.com/marketing/banners/b2.jpg',
      priority: 20,
      isActive: true,
      isPublished: true,
      customerId: 202,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 3,
      title: 'Global Platform Banner',
      imageUrl: 'https://s3.amazonaws.com/marketing/banners/global.jpg',
      priority: 5,
      isActive: true,
      isPublished: true,
      customerId: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockPrisma = {
    marketingBanner: {
      findMany: jest.fn().mockImplementation(({ where }) => {
        let list = mockDbBanners.filter((b) => {
          if (where.deletedAt === null && b.deletedAt !== null) return false;
          if (where.OR && Array.isArray(where.OR)) {
            const matches = where.OR.some((clause: any) => {
              if (clause.customerId !== undefined) {
                return b.customerId === clause.customerId;
              }
              return false;
            });
            if (!matches) return false;
          }
          return true;
        });
        return Promise.resolve(list);
      }),
      count: jest.fn().mockImplementation(({ where }) => {
        return Promise.resolve(mockDbBanners.filter((b) => b.deletedAt === null).length);
      }),
    },
    customer: {
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where.id === 101 || where.id === 202) {
          return Promise.resolve({ id: where.id, name: `Customer ${where.id}`, domain: `cust${where.id}.com` });
        }
        return Promise.resolve(null);
      }),
    },
    user: {
      findUnique: jest.fn().mockImplementation(({ where }) => {
        if (where.id === 1) {
          return Promise.resolve({
            id: 1,
            email: 'superadmin@quikboom.com',
            isActive: true,
            deletedAt: null,
            customerId: null,
            userRoles: [{ role: { type: 'SUPER_ADMIN', rolePermissions: [] } }],
          });
        }
        if (where.id === 2) {
          return Promise.resolve({
            id: 2,
            email: 'admin@company101.com',
            isActive: true,
            deletedAt: null,
            customerId: 101,
            userRoles: [{ role: { type: 'COMPANY_ADMIN', rolePermissions: [] } }],
          });
        }
        if (where.id === 3) {
          return Promise.resolve({
            id: 3,
            email: 'employee@company101.com',
            isActive: true,
            deletedAt: null,
            customerId: 101,
            userRoles: [{ role: { type: 'EMPLOYEE', rolePermissions: [] } }],
          });
        }
        if (where.id === 4) {
          return Promise.resolve({
            id: 4,
            email: 'customer@company101.com',
            isActive: true,
            deletedAt: null,
            customerId: 101,
            userRoles: [{ role: { type: 'CUSTOMER', rolePermissions: [] } }],
          });
        }
        return Promise.resolve(null);
      }),
    },
  };

  const mockUploadService = {
    uploadBannerImage: jest.fn(),
    deleteBannerImage: jest.fn(),
  };

  const mockS3Service = {
    extractKey: jest.fn().mockImplementation((url: string) => (url ? url.split('.amazonaws.com/')[1] || url : '')),
    getPresignedUrl: jest.fn().mockImplementation((key: string) => Promise.resolve(`https://qbapp.online.s3.ap-south-1.amazonaws.com/${key}`)),
    uploadMedia: jest.fn().mockResolvedValue({ imageUrl: 'https://s3.amazonaws.com/uploaded.jpg' }),
    deleteMedia: jest.fn().mockResolvedValue({ success: true }),
    getSignedMediaUrl: jest.fn().mockImplementation((url) => Promise.resolve(url)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BannerController],
      providers: [
        BannerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BannerUploadService, useValue: mockUploadService },
        { provide: S3Service, useValue: mockS3Service },
        Reflector,
      ],
    }).compile();

    controller = module.get<BannerController>(BannerController);
    service = module.get<BannerService>(BannerService);
  });

  describe('1. JwtAuthGuard & Token Verification', () => {
    it('throws UnauthorizedException("Invalid or expired authentication token") on missing user/token', () => {
      const guard = new JwtAuthGuard(new Reflector());
      expect(() => guard.handleRequest(null, null)).toThrow(UnauthorizedException);
      try {
        guard.handleRequest(null, null);
      } catch (err: any) {
        expect(err.message).toBe('Invalid or expired authentication token');
        expect(err.getStatus()).toBe(401);
      }
    });

    it('passes through authenticated user entity from token validation', () => {
      const guard = new JwtAuthGuard(new Reflector());
      const mockUser = { id: 1, email: 'admin@quikboom.com', role: 'SUPER_ADMIN' };
      const result = guard.handleRequest(null, mockUser);
      expect(result).toEqual(mockUser);
    });
  });

  describe('2. CustomerGuard Scope Verification', () => {
    it('allows SUPER_ADMIN to activate without customer assignment', async () => {
      const customerGuard = new CustomerGuard(mockPrisma as any);
      const req: any = {
        user: { id: 1, email: 'superadmin@quikboom.com', role: 'SUPER_ADMIN', roles: ['SUPER_ADMIN'] },
        query: {},
        headers: {},
      };
      const context: any = {
        switchToHttp: () => ({ getRequest: () => req }),
      };

      const allowed = await customerGuard.canActivate(context);
      expect(allowed).toBe(true);
      expect(req.isSuperAdmin).toBe(true);
    });

    it('allows COMPANY_ADMIN with valid customerId to activate', async () => {
      const customerGuard = new CustomerGuard(mockPrisma as any);
      const req: any = {
        user: { id: 2, email: 'admin@company101.com', customerId: 101, role: 'COMPANY_ADMIN', roles: ['COMPANY_ADMIN'] },
        query: {},
        headers: { 'x-customer-id': '101' },
      };
      const context: any = {
        switchToHttp: () => ({ getRequest: () => req }),
      };

      const allowed = await customerGuard.canActivate(context);
      expect(allowed).toBe(true);
      expect(req.customerId).toBe(101);
    });

    it('rejects cross-customer header tampering', async () => {
      const customerGuard = new CustomerGuard(mockPrisma as any);
      const req: any = {
        user: { id: 2, email: 'admin@company101.com', customerId: 101, role: 'COMPANY_ADMIN', roles: ['COMPANY_ADMIN'] },
        query: {},
        headers: { 'x-customer-id': '999' },
      };
      const context: any = {
        switchToHttp: () => ({ getRequest: () => req }),
      };

      await expect(customerGuard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('3. BannerController Role Authorization & Listing', () => {
    it('allows SUPER_ADMIN to call GET /admin/marketing/banners and returns all banners', async () => {
      const superAdminUser = {
        id: 1,
        email: 'superadmin@quikboom.com',
        role: 'SUPER_ADMIN',
        roles: ['SUPER_ADMIN'],
        customerId: null,
      };

      const result = await controller.findAllAdmin('', superAdminUser, {});
      expect(result).toBeDefined();
      expect(result.items).toHaveLength(3);
    });

    it('allows COMPANY_ADMIN to call GET /admin/marketing/banners and returns tenant-isolated banners', async () => {
      const companyAdminUser = {
        id: 2,
        email: 'admin@company101.com',
        role: 'COMPANY_ADMIN',
        roles: ['COMPANY_ADMIN'],
        customerId: 101,
      };

      const result = await controller.findAllAdmin('101', companyAdminUser, {});
      expect(result).toBeDefined();
      expect(result.items).toHaveLength(2); // Company 101 exclusive + Global banner
      expect(result.items.some((b: any) => b.title === 'Company 101 Exclusive Banner')).toBe(true);
      expect(result.items.some((b: any) => b.title === 'Company 202 Exclusive Banner')).toBe(false);
    });

    it('blocks EMPLOYEE from calling GET /admin/marketing/banners with 403 Forbidden', async () => {
      const employeeUser = {
        id: 3,
        email: 'employee@company101.com',
        role: 'EMPLOYEE',
        roles: ['EMPLOYEE'],
        customerId: 101,
      };

      await expect(
        controller.findAllAdmin('101', employeeUser, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks regular CUSTOMER from calling GET /admin/marketing/banners with 403 Forbidden', async () => {
      const customerUser = {
        id: 4,
        email: 'customer@company101.com',
        role: 'CUSTOMER',
        roles: ['CUSTOMER'],
        customerId: 101,
      };

      await expect(
        controller.findAllAdmin('101', customerUser, {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
