import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PurchasesController } from "./purchases.controller.js";
import { PurchasesService } from "./purchases.service.js";

@Module({
  imports: [InventoryModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
