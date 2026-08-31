import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './app.module';
import helmet from 'helmet';

describe('NestJS Production CORS & Preflight Verification Suite', () => {
  let app: INestApplication;
  jest.setTimeout(30000);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    // Replicate exact production bootstrap configuration
    app.use(
      helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        crossOriginEmbedderPolicy: false,
      }),
    );

    const allowedOrigins = [
      'https://admin.qbapp.online',
      'https://qbapp.online',
      'https://app.qbapp.online',
      'https://api.qbapp.online',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:5173',
    ];

    app.enableCors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isAllowed =
          allowedOrigins.includes(origin) ||
          /^https:\/\/([a-zA-Z0-9-]+\.)?qbapp\.online$/.test(origin) ||
          /^http:\/\/localhost:[0-9]+$/.test(origin) ||
          /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) ||
          process.env.NODE_ENV !== 'production';

        if (isAllowed) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'x-customer-id',
        'x-tenant-id',
        'x-client-type',
        'x-refresh-token',
        'Access-Control-Allow-Origin',
        'Access-Control-Allow-Headers',
        'Access-Control-Allow-Methods',
      ],
      exposedHeaders: [
        'Content-Range',
        'X-Content-Range',
        'x-customer-id',
        'x-tenant-id',
        'x-total-count',
      ],
      credentials: true,
      preflightContinue: false,
      optionsSuccessStatus: 204,
    });

    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('1. OPTIONS Preflight Requests from https://admin.qbapp.online', () => {
    it('handles OPTIONS /api/v1/customers preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/customers')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id,x-tenant-id,x-client-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toContain('GET');
      expect(res.headers['access-control-allow-methods']).toContain('OPTIONS');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('handles OPTIONS /api/v1/tasks preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/tasks')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-tenant-id');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/plans preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/plans')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/customers/metrics preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/customers/metrics')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id,x-client-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/health preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/departments preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/departments')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id,x-client-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/employees preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/employees')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id,x-client-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/shifts preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/shifts')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id,x-client-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/shifts/metrics preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/shifts/metrics')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id,x-client-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/admin/payroll/approve preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/admin/payroll/approve')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id,x-client-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/admin/payroll/disburse preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/admin/payroll/disburse')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id,x-client-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/admin/hrms/live-dashboard preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/admin/hrms/live-dashboard')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id,x-client-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('2. Actual Cross-Origin GET Requests & Error Responses', () => {
    it('returns health payload with CORS headers on GET /api/v1/health', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'https://admin.qbapp.online');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('ok');
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('returns Access-Control-Allow-Origin header on GET /api/v1/plans', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/plans')
        .set('Origin', 'https://admin.qbapp.online');

      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('preserves authentication requirement while returning CORS headers on guarded /api/v1/customers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Origin', 'https://admin.qbapp.online');

      // Guarded endpoint returns 401 without token, but CORS headers are present
      expect(res.status).toBe(401);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('preserves authentication requirement while returning CORS headers on guarded /api/v1/customers/metrics', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers/metrics')
        .set('Origin', 'https://admin.qbapp.online');

      expect(res.status).toBe(401);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('returns CORS headers even on 404 Not Found error responses', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/non-existent-endpoint')
        .set('Origin', 'https://admin.qbapp.online');

      expect(res.status).toBe(404);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('preserves authentication requirement while returning CORS headers on guarded /api/v1/tasks', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Origin', 'https://admin.qbapp.online');

      expect(res.status).toBe(401);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('3. Mobile & Originless Client Compatibility', () => {
    it('allows requests with no Origin header (mobile app, curl, backend services)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/plans');

      // No Origin header -> Should execute normally without CORS rejection
      expect(res.status).toBe(200);
    });
  });
});
