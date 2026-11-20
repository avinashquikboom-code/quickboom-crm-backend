import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import * as fs from 'fs';
import * as path from 'path';

describe('Root Endpoint, Favicon, and Error Routing Suite', () => {
  let app: INestApplication;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api/v1', {
      exclude: [
        { path: '', method: RequestMethod.GET },
        { path: 'favicon.ico', method: RequestMethod.GET },
        { path: 'favicon.png', method: RequestMethod.GET },
      ],
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

    await app.init();
  });

  beforeEach(() => {
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('1. Root Endpoint (GET /)', () => {
    it('returns standard API status response on GET /', async () => {
      const res = await request(app.getHttpServer()).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('API is running successfully');
      expect(typeof res.body.timestamp).toBe('string');
      expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    });
  });

  describe('2. Favicon Handling (GET /favicon.ico & GET /favicon.png)', () => {
    it('returns HTTP 204 No Content for GET /favicon.ico when no asset exists', async () => {
      const res = await request(app.getHttpServer()).get('/favicon.ico');

      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      // Ensures no ERROR-level stack trace was logged
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('returns HTTP 204 No Content for GET /favicon.png when no asset exists', async () => {
      const res = await request(app.getHttpServer()).get('/favicon.png');

      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      // Ensures no ERROR-level stack trace was logged
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('serves favicon file when asset exists', async () => {
      const publicDir = path.join(process.cwd(), 'public');
      const testFaviconPath = path.join(publicDir, 'favicon.ico');
      let createdDir = false;

      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
        createdDir = true;
      }
      fs.writeFileSync(testFaviconPath, 'fake-favicon-content');

      try {
        const res = await request(app.getHttpServer()).get('/favicon.ico');
        expect(res.status).toBe(200);
        const content = res.text || (Buffer.isBuffer(res.body) ? res.body.toString('utf8') : '');
        expect(content).toBe('fake-favicon-content');
      } finally {
        if (fs.existsSync(testFaviconPath)) {
          fs.unlinkSync(testFaviconPath);
        }
        if (createdDir && fs.existsSync(publicDir)) {
          fs.rmdirSync(publicDir);
        }
      }
    });
  });

  describe('3. Health Endpoint Verification', () => {
    it('preserves existing health endpoint on GET /api/v1/health', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
    });
  });

  describe('4. Genuine 404 Error Preservation', () => {
    it('returns HTTP 404 and logs error on missing route under /api/v1', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/genuine-missing-route');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Cannot GET /api/v1/genuine-missing-route');
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    it('returns HTTP 404 and logs error on missing route outside /api/v1', async () => {
      const res = await request(app.getHttpServer()).get('/random-unhandled-endpoint');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Cannot GET /random-unhandled-endpoint');
      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });
});
