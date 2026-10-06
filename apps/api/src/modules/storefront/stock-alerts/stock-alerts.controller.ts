import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { StorefrontRoute } from "../context/storefront.guard.js";
import { SubscribeStockAlertSchema, type SubscribeStockAlertDto } from "./dto.js";
import { StockAlertsService } from "./stock-alerts.service.js";

@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/stock-alerts")
export class StockAlertsController {
  constructor(private readonly alerts: StockAlertsService) {}

  /** Public: a guest has no account to hold this. The throttle is what stands between it and a mail-bomb. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  subscribe(@Body(zodPipe(SubscribeStockAlertSchema)) dto: SubscribeStockAlertDto) {
    return this.alerts.subscribe(dto);
  }

  @Post("unsubscribe/:token")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  unsubscribe(@Param("token", ParseUUIDPipe) token: string) {
    return this.alerts.unsubscribe(token);
  }
}
