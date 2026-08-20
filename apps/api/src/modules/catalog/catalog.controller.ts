import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AttributeDefinitionsService } from "./attribute-definitions.service.js";
import { CategoriesService } from "./categories.service.js";
import { LookupsService } from "./lookups.service.js";
import {
  CreateAttributeDefinitionSchema, CreateBrandSchema, CreateCategorySchema, CreateUnitSchema,
  UpdateAttributeDefinitionSchema, UpdateBrandSchema, UpdateCategorySchema, UpdateUnitSchema,
  type CreateAttributeDefinitionDto, type CreateBrandDto, type CreateCategoryDto, type CreateUnitDto,
  type UpdateAttributeDefinitionDto, type UpdateBrandDto, type UpdateCategoryDto, type UpdateUnitDto,
} from "./dto.js";

/**
 * Categories, brands and units.
 *
 * All three gate on `product:*` rather than permissions of their own. They only
 * exist to describe products, and a role able to edit products but not the
 * categories they sit in cannot actually do the job.
 */
@ApiTags("catalog")
@Controller()
export class CatalogController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly lookups: LookupsService,
    private readonly attributes: AttributeDefinitionsService,
  ) {}

  // --- categories ----------------------------------------------------------

  @Get("categories")
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "The category tree, nested" })
  tree(@Query("includeInactive") includeInactive?: string) {
    return this.categories.tree(includeInactive === "true");
  }

  @Get("categories/:id")
  @RequirePermissions("product:read")
  findCategory(@Param("id", ParseUUIDPipe) id: string) {
    return this.categories.findById(id);
  }

  @Post("categories")
  @RequirePermissions("product:write")
  @Audited("categories", "create")
  createCategory(@Body(zodPipe(CreateCategorySchema)) dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch("categories/:id")
  @RequirePermissions("product:write")
  @Audited("categories", "update")
  @ApiOperation({ summary: "Update or move a category; the subtree follows" })
  updateCategory(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateCategorySchema)) dto: UpdateCategoryDto,
  ) {
    return this.categories.update(id, dto);
  }

  @Delete("categories/:id")
  @RequirePermissions("product:delete")
  @Audited("categories", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCategory(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.categories.remove(id);
  }

  // --- brands --------------------------------------------------------------

  @Get("brands")
  @RequirePermissions("product:read")
  listBrands(@Query("includeInactive") includeInactive?: string) {
    return this.lookups.listBrands(includeInactive === "true");
  }

  @Post("brands")
  @RequirePermissions("product:write")
  @Audited("brands", "create")
  createBrand(@Body(zodPipe(CreateBrandSchema)) dto: CreateBrandDto) {
    return this.lookups.createBrand(dto);
  }

  @Patch("brands/:id")
  @RequirePermissions("product:write")
  @Audited("brands", "update")
  updateBrand(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateBrandSchema)) dto: UpdateBrandDto,
  ) {
    return this.lookups.updateBrand(id, dto);
  }

  @Delete("brands/:id")
  @RequirePermissions("product:delete")
  @Audited("brands", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBrand(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.lookups.removeBrand(id);
  }

  // --- units ---------------------------------------------------------------

  @Get("units")
  @RequirePermissions("product:read")
  listUnits() {
    return this.lookups.listUnits();
  }

  @Post("units")
  @RequirePermissions("product:write")
  @Audited("units", "create")
  createUnit(@Body(zodPipe(CreateUnitSchema)) dto: CreateUnitDto) {
    return this.lookups.createUnit(dto);
  }

  @Patch("units/:id")
  @RequirePermissions("product:write")
  @Audited("units", "update")
  updateUnit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateUnitSchema)) dto: UpdateUnitDto,
  ) {
    return this.lookups.updateUnit(id, dto);
  }

  @Delete("units/:id")
  @RequirePermissions("product:delete")
  @Audited("units", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeUnit(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.lookups.removeUnit(id);
  }

  // --- attribute definitions (Stage 5.3) ------------------------------------

  @Get("categories/:categoryId/attributes")
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "Typed attributes defined for one category" })
  listAttributeDefinitions(@Param("categoryId", ParseUUIDPipe) categoryId: string) {
    return this.attributes.listForCategory(categoryId);
  }

  @Post("attributes")
  @RequirePermissions("product:write")
  @Audited("attribute_definitions", "create")
  createAttributeDefinition(
    @Body(zodPipe(CreateAttributeDefinitionSchema)) dto: CreateAttributeDefinitionDto,
  ) {
    return this.attributes.create(dto);
  }

  @Patch("attributes/:id")
  @RequirePermissions("product:write")
  @Audited("attribute_definitions", "update")
  updateAttributeDefinition(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateAttributeDefinitionSchema)) dto: UpdateAttributeDefinitionDto,
  ) {
    return this.attributes.update(id, dto);
  }

  @Delete("attributes/:id")
  @RequirePermissions("product:delete")
  @Audited("attribute_definitions", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a definition — refused while any variant carries a value for it" })
  removeAttributeDefinition(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.attributes.remove(id);
  }
}
