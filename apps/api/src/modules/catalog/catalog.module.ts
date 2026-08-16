import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller.js";
import { CategoriesService } from "./categories.service.js";
import { LookupsService } from "./lookups.service.js";

@Module({
  controllers: [CatalogController],
  providers: [CategoriesService, LookupsService],
  exports: [CategoriesService, LookupsService],
})
export class CatalogModule {}
