import { Module } from "@nestjs/common";
import { AttributeDefinitionsService } from "./attribute-definitions.service.js";
import { CatalogController } from "./catalog.controller.js";
import { CategoriesService } from "./categories.service.js";
import { LookupsService } from "./lookups.service.js";

@Module({
  controllers: [CatalogController],
  providers: [CategoriesService, LookupsService, AttributeDefinitionsService],
  exports: [CategoriesService, LookupsService, AttributeDefinitionsService],
})
export class CatalogModule {}
