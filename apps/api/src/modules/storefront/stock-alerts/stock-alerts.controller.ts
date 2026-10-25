import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { RequireSiteFeature, StorefrontRoute } from "../context/storefront.guard.js";
import { SubscribeStockAlertSchema, type SubscribeStockAlertDto } from "./dto.js";
import { StockAlertsService } from "./stock-alerts.service.js";
import { UNSUBSCRIBE_PAGE_HEADERS } from "./unsubscribe-page.js";

@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/stock-alerts")
export class StockAlertsController {
  constructor(private readonly alerts: StockAlertsService) {}

  /**
   * Public: a guest has no account to hold this. The throttle is what stands between it and a mail-bomb.
   * Only subscribing needs the feature: unsubscribe links already sent must keep working after a shop changes mode.
   */
  @Post()
  @RequireSiteFeature("stockAlerts")
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

  /** The link in an alert email. Shows a button; the GET itself changes nothing. */
  @Get("unsubscribe/:token")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  unsubscribePage(@Param("token", ParseUUIDPipe) token: string, @Res() res: Response): void {
    res.set(UNSUBSCRIBE_PAGE_HEADERS).send(this.alerts.confirmPage(token));
  }

  /** The page's button. */
  @Post("unsubscribe/:token/confirm")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async confirmUnsubscribe(@Param("token", ParseUUIDPipe) token: string, @Res() res: Response): Promise<void> {
    res.set(UNSUBSCRIBE_PAGE_HEADERS).send(await this.alerts.unsubscribeWithPage(token));
  }
}
