import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { SerialsModule } from "../serials/serials.module.js";
import { PurchasesController } from "./purchases.controller.js";
import { PurchasesService } from "./purchases.service.js";

@Module({
  imports: [InventoryModule, SerialsModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
