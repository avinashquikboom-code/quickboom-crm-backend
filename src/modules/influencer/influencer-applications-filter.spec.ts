import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { InfluencerController } from './influencer.controller';
import { InfluencerService } from './influencer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('Admin Influencer Applications Filter & Route Resolution', () => {
  let app: INestApplication;
  let influencerService: any;

  const mockApplications = [
    { id: 1, name: 'Pending Creator', status: 'PENDING', category: { name: 'Fashion' } },
    { id: 2, name: 'Approved Creator', status: 'APPROVED', category: { name: 'Tech' } },
    { id: 3, name: 'Rejected Creator', status: 'REJECTED', category: { name: 'Beauty' } },
    { id: 4, name: 'Suspended Creator', status: 'SUSPENDED', category: { name: 'Fitness' } },
  ];

  beforeAll(async () => {
    influencerService = {
      getInfluencerApplicationsAdmin: jest.fn().mockImplementation((query: any) => {
        let filtered = [...mockApplications];
        if (query?.status && query.status.toUpperCase() !== 'ALL') {
          const s = query.status.toUpperCase();
          if (s === 'APPROVED') {
            filtered = filtered.filter((i) => i.status === 'APPROVED' || (i as any).status === 'ACTIVE');
          } else {
            filtered = filtered.filter((i) => i.status === s);
          }
        }
        return Promise.resolve({
          items: filtered,
          counts: {
            total: mockApplications.length,
            pending: mockApplications.filter((i) => i.status === 'PENDING').length,
            approved: mockApplications.filter((i) => i.status === 'APPROVED').length,
            rejected: mockApplications.filter((i) => i.status === 'REJECTED').length,
            suspended: mockApplications.filter((i) => i.status === 'SUSPENDED').length,
          },
        });
      }),
      getInfluencerById: jest.fn().mockImplementation((id: number, isApplication = false) => {
        const item = mockApplications.find((i) => i.id === id);
        if (!item) {
          return Promise.resolve(null);
        }
        return Promise.resolve(item);
      }),
      getAllInfluencersAdmin: jest.fn().mockResolvedValue(mockApplications),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [InfluencerController],
      providers: [
        {
          provide: InfluencerService,
          useValue: influencerService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();

    // Mirror main.ts configuration exactly
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. GET /api/v1/admin/influencers/applications?status=PENDING
  it('GET /api/v1/admin/influencers/applications?status=PENDING returns 200 OK and only PENDING applications', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/influencers/applications?status=PENDING')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('PENDING');
    expect(influencerService.getInfluencerApplicationsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING' }),
    );
  });

  // Also support lowercase query: ?status=pending
  it('GET /api/v1/admin/influencers/applications?status=pending (case-insensitive) returns 200 OK and transforms to PENDING', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/influencers/applications?status=pending')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('PENDING');
  });

  // 2. GET /api/v1/admin/influencers/applications?status=APPROVED
  it('GET /api/v1/admin/influencers/applications?status=APPROVED returns 200 OK and only APPROVED applications', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/influencers/applications?status=APPROVED')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('APPROVED');
    expect(influencerService.getInfluencerApplicationsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED' }),
    );
  });

  // 3. GET /api/v1/admin/influencers/applications?status=REJECTED
  it('GET /api/v1/admin/influencers/applications?status=REJECTED returns 200 OK and only REJECTED applications', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/influencers/applications?status=REJECTED')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('REJECTED');
    expect(influencerService.getInfluencerApplicationsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REJECTED' }),
    );
  });

  // 4. GET /api/v1/admin/influencers/applications?status=SUSPENDED
  it('GET /api/v1/admin/influencers/applications?status=SUSPENDED returns 200 OK and only SUSPENDED applications', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/influencers/applications?status=SUSPENDED')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('SUSPENDED');
    expect(influencerService.getInfluencerApplicationsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUSPENDED' }),
    );
  });

  // 5. GET /api/v1/admin/influencers/applications (No status / Default behavior)
  it('GET /api/v1/admin/influencers/applications returns 200 OK with default behavior (all applications)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/influencers/applications')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(4);
    expect(influencerService.getInfluencerApplicationsAdmin).toHaveBeenCalled();
  });

  // 6. Invalid status: ?status=INVALID -> 400 Bad Request
  it('GET /api/v1/admin/influencers/applications?status=INVALID returns 400 Bad Request with enum validation failure', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/influencers/applications?status=INVALID')
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('status must be one of the following values: PENDING, APPROVED, REJECTED, SUSPENDED, ALL'),
      ]),
    );
    expect(influencerService.getInfluencerApplicationsAdmin).not.toHaveBeenCalled();
  });

  // 7. Route resolution integrity: /admin/influencers/:id does NOT shadow /admin/influencers/applications
  it('GET /api/v1/admin/influencers/1 correctly calls getInfluencerById with numeric id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/influencers/1')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(influencerService.getInfluencerById).toHaveBeenCalledWith(1);
  });

  // 8. GET /api/v1/admin/influencers/applications/2 correctly calls getApplicationByIdAdmin
  it('GET /api/v1/admin/influencers/applications/2 correctly calls getApplicationByIdAdmin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/influencers/applications/2')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(influencerService.getInfluencerById).toHaveBeenCalledWith(2, true);
  });
});
