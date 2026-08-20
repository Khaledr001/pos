import { Module } from "@nestjs/common";
import { PriceResolverService } from "./price-resolver.service.js";
import { PricingController } from "./pricing.controller.js";
import { PricingService } from "./pricing.service.js";

/**
 * `PriceResolverService` used to be re-declared as a provider in orders,
 * products, quotations and sales — four copies of the same instance, since
 * none of them exported it either. Importing this module gives every one of
 * them the real, single provider instead.
 */
@Module({
  controllers: [PricingController],
  providers: [PriceResolverService, PricingService],
  exports: [PriceResolverService, PricingService],
})
export class PricingModule {}
