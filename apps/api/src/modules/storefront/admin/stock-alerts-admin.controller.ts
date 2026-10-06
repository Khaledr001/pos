import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../../../common/decorators/index.js";
import { StockAlertsService } from "../stock-alerts/stock-alerts.service.js";

@ApiTags("storefront-admin")
@Controller("storefront-admin/stock-alerts")
export class StockAlertsAdminController {
  constructor(private readonly alerts: StockAlertsService) {}

  /** Demand for sold-out products: a purchasing signal, so reading it needs the catalogue's own read permission. */
  @Get()
  @RequirePermissions("product:read")
  demand() {
    return this.alerts.demand();
  }
}
