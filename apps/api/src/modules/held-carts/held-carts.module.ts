import { Module } from "@nestjs/common";
import { HeldCartsController } from "./held-carts.controller.js";
import { HeldCartsService } from "./held-carts.service.js";

@Module({
  controllers: [HeldCartsController],
  providers: [HeldCartsService],
  exports: [HeldCartsService],
})
export class HeldCartsModule {}
