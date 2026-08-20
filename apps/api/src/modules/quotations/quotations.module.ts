import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { SalesModule } from "../sales/sales.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { QuotationsController } from "./quotations.controller.js";
import { QuotationsService } from "./quotations.service.js";

/**
 * `OrdersModule` for the quotation -> order path, alongside `SalesModule` for
 * the quotation -> sale one; `StorageModule` for uploading the generated PDF;
 * `PricingModule` for the one `PriceResolverService` instance (Stage 5.1).
 */
@Module({
  imports: [SalesModule, OrdersModule, StorageModule, PricingModule],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
