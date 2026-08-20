import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { SerialsModule } from "../serials/serials.module.js";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";

/**
 * Imports InventoryModule for StockService — the only way stock may move —
 * AuthModule for OverrideGrantsService, which verifies the supervisor
 * approvals a sale carries, and PricingModule for the one
 * PriceResolverService instance (Stage 5.1).
 */
@Module({
  imports: [AuthModule, InventoryModule, SerialsModule, PricingModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
