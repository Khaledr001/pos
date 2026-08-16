import { Module } from "@nestjs/common";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { StockService } from "../inventory/stock.service.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { ProductsController } from "./products.controller.js";
import { ProductsService } from "./products.service.js";

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, PlanLimitService, StockService, PriceResolverService],
  exports: [ProductsService],
})
export class ProductsModule {}
