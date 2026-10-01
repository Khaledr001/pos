import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { writeFile } from 'node:fs/promises';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.service.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true, // needed to verify POS and Stripe webhook signatures
  });
  app.useLogger(app.get(Logger));
  setupApp(app);

  const config = app.get(AppConfig);
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Al-Lahiq API')
      .setDescription('Building materials store — storefront, admin and POS integration API')
      .setVersion('1.0')
      .addCookieAuth('al_at')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
  if (!config.isProduction) {
    // Consumed by packages/api-client to generate typed frontend calls.
    await writeFile('openapi.json', JSON.stringify(document, null, 2));
  }

  await app.listen(config.get('PORT'));
}
await bootstrap();
