import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { SalesModule } from "../sales/sales.module.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";

/**
 * Imports InventoryModule for StockService (reserve/release on confirm and
 * cancel), SalesModule for SalesService — every fulfilment is a real sale,
 * created through the same checks a walk-in goes through — and PricingModule
 * for the one PriceResolverService instance (Stage 5.1; this used to
 * re-declare its own copy as a provider).
 */
@Module({
  imports: [InventoryModule, SalesModule, PricingModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
