import { Module } from "@nestjs/common";
import { PriceResolverService } from "../pricing/price-resolver.service.js";
import { SalesModule } from "../sales/sales.module.js";
import { QuotationsController } from "./quotations.controller.js";
import { QuotationsService } from "./quotations.service.js";

/**
 * `PriceResolverService` is provided here rather than imported from a pricing
 * module, matching how sales and products already do it — it is stateless and
 * has no module of its own.
 */
@Module({
  imports: [SalesModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, PriceResolverService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
