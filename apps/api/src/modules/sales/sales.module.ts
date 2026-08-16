import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";

/** Imports InventoryModule for StockService — the only way stock may move. */
@Module({
  imports: [InventoryModule],
  controllers: [SalesController],
  providers: [SalesService, PriceResolverService],
  exports: [SalesService],
})
export class SalesModule {}
