import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from './config/app-config.service.js';
import { AppConfigModule } from './config/config.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CheckoutModule } from './modules/checkout/checkout.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { InvoicesModule } from './modules/invoices/invoices.service.js';
import { JobsModule } from './modules/jobs/jobs.service.js';
import { NotificationsModule } from './modules/notifications/notifications.service.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { OutboxModule, PosSyncModule } from './modules/pos-sync/pos-sync.module.js';
import { PricingModule } from './modules/pricing/pricing.module.js';
import { PromotionsModule } from './modules/promotions/promotions.service.js';
import { RevalidationModule } from './modules/revalidation/revalidation.service.js';
import { SchedulerModule } from './modules/scheduler/scheduler.service.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ShippingModule } from './modules/shipping/shipping.module.js';
import { StorageModule } from './modules/storage/storage.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    // infrastructure
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === 'test' ? 'silent' : config.isProduction ? 'info' : 'debug',
          transport: config.isProduction ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
        },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({ secret: config.get('JWT_SECRET') }),
    }),
    PrismaModule,
    RedisModule,
    JobsModule,
    SettingsModule,
    RevalidationModule,
    StorageModule,

    // domain
    PricingModule,
    InventoryModule,
    CatalogModule,
    PromotionsModule,
    ShippingModule,
    InvoicesModule,
    NotificationsModule,
    OutboxModule,
    OrdersModule,
    PaymentsModule,
    CartModule,
    CheckoutModule,
    AuthModule,
    AccountModule,
    ContentModule,
    PosSyncModule,
    AdminModule,
    SchedulerModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
