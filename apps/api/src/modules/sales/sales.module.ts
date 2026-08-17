import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { SerialsModule } from "../serials/serials.module.js";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";

/** Imports InventoryModule for StockService — the only way stock may move. */
@Module({
  imports: [InventoryModule, SerialsModule],
  controllers: [SalesController],
  providers: [SalesService, PriceResolverService],
  exports: [SalesService],
})
export class SalesModule {}
