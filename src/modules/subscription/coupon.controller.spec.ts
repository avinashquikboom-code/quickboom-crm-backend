import { INestApplication, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { CouponController } from './coupon.controller';
import { CouponService } from './coupon.service';

describe('Coupon admin routes', () => {
  let app: INestApplication;
  const couponService = {
    stats: jest.fn(),
    list: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CouponController],
      providers: [{ provide: CouponService, useValue: couponService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context) => {
          context.switchToHttp().getRequest().user = { role: 'ADMIN' };
          return true;
        },
      })
      .overrideGuard(CustomerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    if (app) await app.close();
  });

  it('registers GET /api/v1/admin/coupons/stats before the dynamic id route', async () => {
    couponService.stats.mockResolvedValue({ total: 0, active: 0, inactive: 0, expired: 0, scheduled: 0, used: 0 });

    const response = await request(app.getHttpServer()).get('/api/v1/admin/coupons/stats').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ total: 0, active: 0, inactive: 0, expired: 0, scheduled: 0, used: 0 });
    expect(couponService.stats).toHaveBeenCalledTimes(1);
  });

  it('registers GET /api/v1/admin/coupons and passes the requested pagination and sort parameters', async () => {
    couponService.list.mockResolvedValue({ data: [], items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } });

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/coupons?page=1&limit=10&sortBy=createdAt&sortOrder=desc')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toEqual({ page: 1, limit: 10, total: 0, totalPages: 1 });
    expect(couponService.list).toHaveBeenCalledWith(expect.objectContaining({
      page: '1', limit: '10', sortBy: 'createdAt', sortOrder: 'desc',
    }));
  });

  it('keeps coupon administration behind the admin role check', async () => {
    expect(Reflect.getMetadata('__guards__', CouponController.prototype.getStats)).toContain(JwtAuthGuard);
    const controller = app.get(CouponController);
    await expect(Promise.resolve().then(() => controller.getStats({ role: 'CUSTOMER' }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
