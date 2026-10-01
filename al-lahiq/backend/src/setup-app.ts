import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { AppConfig } from './config/app-config.service.js';
import { UPLOAD_DIR } from './modules/storage/storage.service.js';

/** Shared by main.ts and the e2e tests, so tests run the real pipeline. */
export function setupApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  const config = app.get(AppConfig);

  express.set('query parser', 'extended'); // attr[size]=... filters
  express.set('trust proxy', 1);
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS').split(',').map((o) => o.trim()),
    credentials: true,
  });
  express.useStaticAssets(UPLOAD_DIR, { prefix: '/uploads/', maxAge: '30d', immutable: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
