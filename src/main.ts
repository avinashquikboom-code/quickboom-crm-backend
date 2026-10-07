import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import helmet from 'helmet';
import { join } from 'path';

(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app =
    await NestFactory.create<NestExpressApplication>(AppModule);

  // ============================================================
  // STATIC FILES
  // ============================================================

  // Serve locally uploaded banner images.
  // Files saved to <project_root>/uploads/ are reachable at:
  // /uploads/<path>
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });

  // ============================================================
  // SECURITY
  // ============================================================

  app.use(
    helmet({
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },

      crossOriginEmbedderPolicy: false,

      // REST API is consumed from different subdomains.
      crossOriginOpenerPolicy: {
        policy: 'unsafe-none',
      },

      // API responses are JSON.
      contentSecurityPolicy: false,
    }),
  );

  // ============================================================
  // CORS / OPTIONS DEBUG LOGGER
  // ============================================================

  app.use((req: any, res: any, next: any) => {
    if (req.method === 'OPTIONS') {
      const origin =
        req.headers['origin'] || 'NONE';

      const accessControlRequestMethod =
        req.headers['access-control-request-method'] || 'NONE';

      const accessControlRequestHeaders =
        req.headers['access-control-request-headers'] || 'NONE';

      logger.log(`
[CORS_DEBUG]
method: OPTIONS
origin: ${origin}
path: ${req.originalUrl || req.url}
accessControlRequestMethod: ${accessControlRequestMethod}
accessControlRequestHeaders: ${accessControlRequestHeaders}
handledBy: NestJS
`);
    }

    next();
  });

  // ============================================================
  // ALLOWED CORS ORIGINS
  // ============================================================

  const allowedOrigins = [
    'https://admin.qbapp.online',
    'https://qbapp.online',
    'https://app.qbapp.online',
    'https://api.qbapp.online',

    // Local development
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:8080',

    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5173',
  ];

  // ============================================================
  // CORS
  // ============================================================

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests without Origin.
      // Examples:
      // - Flutter/mobile applications
      // - curl
      // - Postman
      // - server-to-server requests
      if (!origin) {
        return callback(null, true);
      }

      const isAllowed =
        allowedOrigins.includes(origin) ||

        // Allow qbapp.online subdomains.
        /^https:\/\/([a-zA-Z0-9-]+\.)?qbapp\.online$/.test(
          origin,
        ) ||

        // Localhost development.
        /^http:\/\/localhost:[0-9]+$/.test(origin) ||

        // Local IP development.
        /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) ||

        // Preserve existing non-production behavior.
        process.env.NODE_ENV !== 'production';

      if (isAllowed) {
        callback(null, true);
      } else {
        logger.warn(
          `[CORS] Blocked request from unauthorized origin: ${origin}`,
        );

        callback(null, false);
      }
    },

    // ==========================================================
    // ALLOWED METHODS
    // ==========================================================

    methods: [
      'GET',
      'HEAD',
      'PUT',
      'PATCH',
      'POST',
      'DELETE',
      'OPTIONS',
    ],

    // ==========================================================
    // ALLOWED REQUEST HEADERS
    // ==========================================================

    allowedHeaders: [
      // Standard request headers
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',

      // Existing application headers
      'x-customer-id',
      'x-tenant-id',
      'x-client-type',

      // IMPORTANT:
      // Admin Panel sends this header.
      'x-portal-type',

      'x-refresh-token',

      // Browser preflight request headers
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],

    // ==========================================================
    // EXPOSED RESPONSE HEADERS
    // ==========================================================

    exposedHeaders: [
      'Content-Range',
      'X-Content-Range',
      'x-customer-id',
      'x-tenant-id',
      'x-total-count',
    ],

    // ==========================================================
    // CREDENTIALS
    // ==========================================================

    credentials: true,

    // Let CORS middleware handle OPTIONS.
    preflightContinue: false,

    // Successful OPTIONS response.
    optionsSuccessStatus: 204,

    // Cache successful preflight for 24 hours.
    maxAge: 86400,
  });

  // ============================================================
  // GLOBAL PREFIX
  // ============================================================

  app.setGlobalPrefix('api/v1');

  // ============================================================
  // GLOBAL VALIDATION
  // ============================================================

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

  // ============================================================
  // GLOBAL EXCEPTION FILTER
  // ============================================================

  app.useGlobalFilters(
    new GlobalExceptionFilter(),
  );

  // ============================================================
  // GLOBAL INTERCEPTORS
  // ============================================================

  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // ============================================================
  // SWAGGER
  // ============================================================

  const config = new DocumentBuilder()
    .setTitle('QuikBoom SaaS CRM API')
    .setDescription(
      'Enterprise Multi-Customer SaaS CRM Platform REST API',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-customer-id',
        in: 'header',
      },
      'x-customer-id',
    )
    .build();

  const document =
    SwaggerModule.createDocument(
      app,
      config,
    );

  SwaggerModule.setup(
    'api/docs',
    app,
    document,
  );

  // ============================================================
  // START SERVER
  // ============================================================

  const port = process.env.PORT || 3000;

  await app.listen(
    port,
    '0.0.0.0',
  );

  logger.log(
    `🚀 QuikBoom Backend running on port http://localhost:${port}/api/v1`,
  );

  logger.log(
    `📚 Swagger documentation at http://localhost:${port}/api/docs`,
  );
}

bootstrap();