import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module';
import helmet from 'helmet';

describe('NestJS Production CORS & Preflight Verification Suite', () => {
  let app: INestApplication;

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
          process.env.NODE_ENV !== 'production';

        if (isAllowed) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} not allowed by CORS`));
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
        'x-client-type',
        'Access-Control-Allow-Origin',
        'Access-Control-Allow-Headers',
        'Access-Control-Allow-Methods',
      ],
      exposedHeaders: [
        'Content-Range',
        'X-Content-Range',
        'x-customer-id',
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
    it('handles OPTIONS /api/v1/contacts preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/contacts')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type,x-customer-id');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toContain('GET');
      expect(res.headers['access-control-allow-methods']).toContain('OPTIONS');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('handles OPTIONS /api/v1/invoices preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/invoices?page=1&limit=20')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('handles OPTIONS /api/v1/admin/plans preflight from https://admin.qbapp.online', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/admin/plans')
        .set('Origin', 'https://admin.qbapp.online')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

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
  });

  describe('2. Actual Cross-Origin GET Requests', () => {
    it('returns Access-Control-Allow-Origin header on GET /api/v1/plans', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/plans')
        .set('Origin', 'https://admin.qbapp.online');

      expect(res.headers['access-control-allow-origin']).toBe('https://admin.qbapp.online');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('preserves authentication requirement while returning CORS headers on guarded /api/v1/contacts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/contacts')
        .set('Origin', 'https://admin.qbapp.online');

      // Authentication guard rejects missing token with 401, but CORS headers MUST still be present
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
