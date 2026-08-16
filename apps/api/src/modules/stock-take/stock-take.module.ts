import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { StockTakeController } from "./stock-take.controller.js";
import { StockTakeService } from "./stock-take.service.js";

@Module({
  imports: [InventoryModule],
  controllers: [StockTakeController],
  providers: [StockTakeService],
  exports: [StockTakeService],
})
export class StockTakeModule {}
