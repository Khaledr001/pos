import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { LowStockNotificationListener } from "./low-stock.listener.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsGateway } from "./notifications.gateway.js";
import { NotificationsService } from "./notifications.service.js";

/**
 * `JwtModule.register({})` with no default secret, same as AuthModule: the
 * gateway passes the secret per-call to `verifyAsync`, because it is read
 * from ConfigService rather than baked into module registration.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, LowStockNotificationListener],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
