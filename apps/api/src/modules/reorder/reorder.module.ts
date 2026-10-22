import { Module } from "@nestjs/common";
import { PurchasesModule } from "../purchases/purchases.module.js";
import { ReorderController } from "./reorder.controller.js";
import { ReorderService } from "./reorder.service.js";

@Module({
  imports: [PurchasesModule],
  controllers: [ReorderController],
  providers: [ReorderService],
})
export class ReorderModule {}
