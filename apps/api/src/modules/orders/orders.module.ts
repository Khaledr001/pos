import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { SalesModule } from "../sales/sales.module.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";

/**
 * Imports InventoryModule for StockService (reserve/release on confirm and
 * cancel) and SalesModule for SalesService — every fulfilment is a real sale,
 * created through the same checks a walk-in goes through.
 */
@Module({
  imports: [InventoryModule, SalesModule],
  controllers: [OrdersController],
  providers: [OrdersService, PriceResolverService],
  exports: [OrdersService],
})
export class OrdersModule {}
