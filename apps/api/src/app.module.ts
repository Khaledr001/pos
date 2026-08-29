import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { resolve } from "node:path";
import { RequestContext } from "./common/context/request-context.js";
import { DomainEventsInterceptor } from "./common/events/domain-events.interceptor.js";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "./common/guards/permissions.guard.js";
import { PlatformGuard } from "./common/guards/platform.guard.js";
import { AuditInterceptor } from "./common/interceptors/audit.interceptor.js";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor.js";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware.js";
import { validateEnv } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BranchesModule } from "./modules/branches/branches.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { AiModule } from "./modules/ai/ai.module.js";
import { WhatsappModule } from "./modules/whatsapp/whatsapp.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { TenantsModule } from "./modules/tenants/tenants.module.js";
import { CashRegisterModule } from "./modules/cash-register/cash-register.module.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { InventoryModule } from "./modules/inventory/inventory.module.js";
import { ProductsModule } from "./modules/products/products.module.js";
import { PricingModule } from "./modules/pricing/pricing.module.js";
import { DayCloseModule } from "./modules/day-close/day-close.module.js";
import { ExpensesModule } from "./modules/expenses/expenses.module.js";
import { HeldCartsModule } from "./modules/held-carts/held-carts.module.js";
import { PurchasesModule } from "./modules/purchases/purchases.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { OrdersModule } from "./modules/orders/orders.module.js";
import { RolesModule } from "./modules/roles/roles.module.js";
import { QuotationsModule } from "./modules/quotations/quotations.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { CustomersModule } from "./modules/customers/customers.module.js";
import { PaintModule } from "./modules/paint/paint.module.js";
import { SerialsModule } from "./modules/serials/serials.module.js";
import { SalesModule } from "./modules/sales/sales.module.js";
import { StockTakeModule } from "./modules/stock-take/stock-take.module.js";
import { SuppliersModule } from "./modules/suppliers/suppliers.module.js";
import { SyncModule } from "./modules/sync/sync.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { DevicesModule } from "./modules/devices/devices.module.js";
import { TransfersModule } from "./modules/transfers/transfers.module.js";

/**
 * Application root.
 *
 * The global providers below establish the defaults every module inherits.
 * They are registered here rather than per-controller precisely so that a new
 * module cannot accidentally opt out of them:
 *
 *   JwtAuthGuard          every route authenticated unless @Public()
 *   PermissionsGuard      @RequirePermissions enforced
 *   ThrottlerGuard        rate limiting
 *   TransformInterceptor  ApiSuccess envelope on every response
 *   AllExceptionsFilter   ApiError envelope on every failure
 *
 * Guard order matters: JwtAuthGuard must run before PermissionsGuard, because
 * the latter reads the principal the former attaches.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      /**
       * This service owns its configuration.
       *
       * Order matters — earlier wins, and real `process.env` beats them all,
       * which is how the container and systemd inject settings in production.
       *
       *   1. apps/api/.env   the service's own file. In a Docker image this is
       *                      the ONLY one that exists.
       *   2. ../../.env      repo root, developer convenience so `pnpm dev`
       *                      works without copying secrets twice. Absent in
       *                      every production image.
       *
       * Missing files are skipped silently. Nothing here may become required,
       * or this service stops being independently deployable.
       */
      envFilePath: [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")],
      validate: validateEnv,
    }),

    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
        // Pretty output in development; newline-delimited JSON in production,
        // which is what a log shipper expects.
        transport:
          process.env.NODE_ENV === "production"
            ? undefined
            : { target: "pino-pretty", options: { singleLine: true, colorize: true } },
        // Ties every log line to the response header of the same name.
        customProps: () => ({ requestId: RequestContext.requestId }),
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.body.password",
            "req.body.pin",
            "req.body.refreshToken",
            "res.headers['set-cookie']",
          ],
          remove: true,
        },
        autoLogging: {
          // The POS polls /health every few seconds; logging it buries everything else.
          // Match both the prefixed path (via globalPrefix) and the bare path.
          ignore: (req) =>
            req.url === "/health" ||
            req.url === "/ready" ||
            req.url === "/api/v1/health" ||
            req.url === "/api/v1/ready",
        },
      },
    }),

    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
          limit: Number(process.env.THROTTLE_LIMIT ?? 120),
        },
      ],
    }),

    // Backs DomainEvents (common/events) — see docs/DECISIONS.md D17. A
    // service records an event and never learns who, if anyone, is listening.
    EventEmitterModule.forRoot(),

    DatabaseModule,

    // Feature modules. Add new ones here — see src/modules/README.md.
    HealthModule,
    AuthModule,
    TenantsModule,
    PlatformModule,
    UsersModule,
    RolesModule,
    AuditModule,
    BranchesModule,
    ProductsModule,
    PricingModule,
    CatalogModule,
    InventoryModule,
    CashRegisterModule,
    SalesModule,
    CustomersModule,
    HeldCartsModule,
    DayCloseModule,
    ExpensesModule,
    SuppliersModule,
    PurchasesModule,
    StockTakeModule,
    QuotationsModule,
    OrdersModule,
    ReportsModule,
    SerialsModule,
    PaintModule,
    SyncModule,
    DevicesModule,
    TransfersModule,
    NotificationsModule,
    AiModule,
    WhatsappModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    /**
     * Throttling sits ahead of the authorisation guards, not behind them.
     *
     * Registered last, a request rejected by PermissionsGuard or PlatformGuard
     * never reached the limiter, so probing `/admin/*` as an ordinary user cost
     * the caller nothing. It stays after JwtAuthGuard so the limiter can key on
     * an identified principal.
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: PlatformGuard },
    /**
     * Order matters: AuditInterceptor must see the handler's own return value,
     * so it has to sit INSIDE TransformInterceptor's envelope. Nest runs
     * interceptors outside-in on the way down and inside-out on the way back,
     * so the one listed second unwraps first on the response path.
     *
     * DomainEventsInterceptor doesn't touch the return value, so its position
     * relative to the other two is not load-bearing the way theirs is — it
     * just needs to run after the handler, which every APP_INTERCEPTOR does.
     */
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: DomainEventsInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Must run before the guards so there is a context for them to write into.
    consumer.apply(RequestContextMiddleware).forRoutes("*path");
  }
}
