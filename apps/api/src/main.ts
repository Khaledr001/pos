import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import { Logger as PinoLogger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import type { Env } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Buffer boot-time logs until pino is wired, so nothing is lost or
    // printed in a second format.
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService<Env, true>);
  const port = config.get("API_PORT", { infer: true });
  const prefix = config.get("API_PREFIX", { infer: true });
  const isProd = config.get("NODE_ENV", { infer: true }) === "production";

  app.setGlobalPrefix(prefix, {
    // Probes stay at the root: load balancers and the POS should not have to
    // know the API version to ask whether the service is alive.
    exclude: ["health", "ready"],
  });

  /**
   * Trust exactly one reverse proxy in front of us.
   *
   * Without this, `req.ip` is the proxy's address for every caller, so the rate
   * limiter buckets the entire internet together: the per-IP limits on login
   * and pin-login become one shared quota, and a single client can exhaust
   * signup for everybody. `audit_log.ipAddress` records the proxy too, making
   * the trail useless for "where did this come from".
   *
   * The count is `1`, not `true`. Trusting the whole chain lets a caller
   * prepend their own `X-Forwarded-For` and choose which IP gets rate-limited —
   * which hands back exactly the bypass this is meant to close. If a second
   * proxy is ever added, this number changes with it.
   */
  if (isProd) {
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }

  app.use(
    helmet({
      // The API serves JSON only; CSP belongs on the admin panel, which does
      // serve HTML. Leaving it on here just breaks the Swagger UI.
      contentSecurityPolicy: isProd ? undefined : false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(compression());

  app.enableCors({
    origin: config
      .get("API_CORS_ORIGINS", { infer: true })
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
    exposedHeaders: ["x-request-id"],
  });

  /**
   * There is deliberately no global ValidationPipe.
   *
   * Validation is per-route via ZodValidationPipe (see docs/PATTERNS.md).
   * Nest's ValidationPipe requires `class-validator`, which this project does
   * not use — the same Zod schema has to validate in the API, type the admin
   * form, and check a row in the Excel importer, and class-validator's
   * decorators only work on a class instance.
   *
   * Param-level pipes such as `ParseUUIDPipe` work without it.
   */

  // Waits for in-flight requests and closes the database pool. Without it, a
  // deploy can drop a sale mid-write.
  app.enableShutdownHooks();

  if (!isProd) {
    const swagger = new DocumentBuilder()
      .setTitle("DevsFleet Business Platform API")
      .setDescription("POS, inventory, WhatsApp AI, and admin backend")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();

    SwaggerModule.setup(
      `${prefix}/docs`,
      app,
      SwaggerModule.createDocument(app, swagger),
      { swaggerOptions: { persistAuthorization: true } },
    );
  }

  await app.listen(port, "0.0.0.0");

  const logger = new Logger("Bootstrap");
  logger.log(`API listening on http://localhost:${port}/${prefix}`);
  if (!isProd) logger.log(`Docs at   http://localhost:${port}/${prefix}/docs`);
}

void bootstrap();
