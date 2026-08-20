import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module.js";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { SalesModule } from "../sales/sales.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { QuotationsController } from "./quotations.controller.js";
import { QuotationsService } from "./quotations.service.js";

/**
 * `PriceResolverService` is provided here rather than imported from a pricing
 * module, matching how sales and products already do it — it is stateless and
 * has no module of its own. `OrdersModule` for the quotation -> order path,
 * alongside `SalesModule` for the quotation -> sale one; `StorageModule` for
 * uploading the generated PDF.
 */
@Module({
  imports: [SalesModule, OrdersModule, StorageModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, PriceResolverService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
