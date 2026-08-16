import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller.js";
import { InventoryService } from "./inventory.service.js";
import { StockService } from "./stock.service.js";

/**
 * StockService is exported because sales, purchases and stock takes all write
 * stock through it — it is the choke point, so every writer imports this module
 * rather than reaching for the ledger directly.
 */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockService],
  exports: [StockService, InventoryService],
})
export class InventoryModule {}
