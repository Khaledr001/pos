import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PaintController } from "./paint.controller.js";
import { PaintService } from "./paint.service.js";

@Module({
  imports: [InventoryModule],
  controllers: [PaintController],
  providers: [PaintService],
  exports: [PaintService],
})
export class PaintModule {}
