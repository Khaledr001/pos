import { Module } from "@nestjs/common";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { StockService } from "../inventory/stock.service.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { BulkImportService } from "./bulk-import.service.js";
import { ProductsController } from "./products.controller.js";
import { ProductsService } from "./products.service.js";

@Module({
  imports: [PricingModule, StorageModule],
  controllers: [ProductsController],
  providers: [ProductsService, PlanLimitService, StockService, BulkImportService],
  exports: [ProductsService],
})
export class ProductsModule {}
