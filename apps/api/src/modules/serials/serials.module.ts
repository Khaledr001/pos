import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { SerialsController } from "./serials.controller.js";
import { SerialsService } from "./serials.service.js";

@Module({
  imports: [InventoryModule],
  controllers: [SerialsController],
  providers: [SerialsService],
  exports: [SerialsService],
})
export class SerialsModule {}
