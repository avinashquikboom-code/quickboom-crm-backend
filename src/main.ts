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
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve locally uploaded banner images (fallback when S3 is unavailable)
  // Files saved to <project_root>/uploads/ are reachable at /uploads/<path>
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // Security & Cross-Origin Policy
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Temporary Production-Safe CORS & OPTIONS Preflight Debug Logger
  app.use((req: any, res: any, next: any) => {
    if (req.method === 'OPTIONS') {
      const origin = req.headers['origin'] || 'NONE';
      const accessControlRequestMethod = req.headers['access-control-request-method'] || 'NONE';
      const accessControlRequestHeaders = req.headers['access-control-request-headers'] || 'NONE';
      logger.log(`[CORS_DEBUG]
method: OPTIONS
origin: ${origin}
path: ${req.originalUrl || req.url}
accessControlRequestMethod: ${accessControlRequestMethod}
accessControlRequestHeaders: ${accessControlRequestHeaders}
handledBy: NestJS`);
    }
    next();
  });

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
      // Allow requests with no origin (mobile app clients, curl, server-to-server, Postman)
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
        logger.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
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
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
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

  // Global Prefix
  app.setGlobalPrefix('api/v1');

  // Pipes, Filters, Interceptors
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
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // Swagger OpenAPI Setup
  const config = new DocumentBuilder()
    .setTitle('QuikBoom SaaS CRM API')
    .setDescription('Enterprise Multi-Customer SaaS CRM Platform REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-customer-id', in: 'header' }, 'x-customer-id')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 QuikBoom Backend running on port http://localhost:${port}/api/v1`);
  logger.log(`📚 Swagger documentation at http://localhost:${port}/api/docs`);
}

bootstrap();
