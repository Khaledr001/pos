import { Module } from "@nestjs/common";
import { TransfersController } from "./transfers.controller.js";
import { TransfersService } from "./transfers.service.js";
import { InventoryModule } from "../inventory/inventory.module.js";

@Module({
  imports: [InventoryModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
