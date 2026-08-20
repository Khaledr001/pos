import { Module } from "@nestjs/common";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { StockService } from "../inventory/stock.service.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { ProductsController } from "./products.controller.js";
import { ProductsService } from "./products.service.js";

@Module({
  imports: [PricingModule],
  controllers: [ProductsController],
  providers: [ProductsService, PlanLimitService, StockService],
  exports: [ProductsService],
})
export class ProductsModule {}
