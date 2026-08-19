import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { SerialsModule } from "../serials/serials.module.js";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";

/**
 * Imports InventoryModule for StockService — the only way stock may move — and
 * AuthModule for OverrideGrantsService, which verifies the supervisor
 * approvals a sale carries.
 */
@Module({
  imports: [AuthModule, InventoryModule, SerialsModule],
  controllers: [SalesController],
  providers: [SalesService, PriceResolverService],
  exports: [SalesService],
})
export class SalesModule {}
