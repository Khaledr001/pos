import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { StorefrontRoute } from "../context/storefront.guard.js";
import { WebOrdersService } from "./web-orders.service.js";

@ApiTags("storefront")
@StorefrontRoute()
@Controller("storefront/orders")
export class WebOrdersController {
  constructor(private readonly orders: WebOrdersService) {}

  /** A guest's tracking link. The token is a random UUID; the throttle keeps guessing pointless. */
  @Get("track/:token")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  track(@Param("token", ParseUUIDPipe) token: string) {
    return this.orders.track(token);
  }
}
