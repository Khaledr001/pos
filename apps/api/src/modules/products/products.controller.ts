import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { BulkImportService } from "./bulk-import.service.js";
import { BulkImportOptionsSchema, type BulkImportOptionsDto } from "./bulk-import.dto.js";
import { ProductsService } from "./products.service.js";
import {
  CreateProductSchema, CreateProductSupplierLinkSchema, CreateVariantUnitSchema,
  ListProductsSchema, SearchVariantsSchema,
  UpdateProductImageSchema, UpdateProductSchema, UpdateProductSupplierLinkSchema, UpdateVariantUnitSchema,
  UploadProductImageSchema,
  type CreateProductDto, type CreateProductSupplierLinkDto, type CreateVariantUnitDto,
  type ListProductsDto, type SearchVariantsDto, type UpdateProductDto,
  type UpdateProductImageDto, type UpdateProductSupplierLinkDto, type UpdateVariantUnitDto,
  type UploadProductImageDto,
} from "./dto.js";

@ApiTags("products")
@Controller("products")
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly bulkImport: BulkImportService,
  ) {}

  // --- bulk import ----------------------------------------------------------

  /**
   * Import products from an Excel/CSV file.
   *
   * DRY RUN BY DEFAULT — `dryRun=true` reports what would change without
   * writing anything. Pass `dryRun=false` to commit.
   */
  @Post("import")
  @RequirePermissions("product:write")
  @Audited("products", "import")
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({ summary: "Bulk import products from Excel/CSV" })
  async importProducts(
    @UploadedFile() file: Express.Multer.File,
    @Query(zodPipe(BulkImportOptionsSchema)) options: BulkImportOptionsDto,
  ) {
    return this.bulkImport.import(file.buffer, options);
  }

  /**
   * Download a template Excel file with correct headers and a "Valid Values"
   * reference sheet populated from this tenant's categories, brands and units.
   */
  @Get("import/template")
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "Download the bulk import Excel template" })
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.bulkImport.generateTemplate();
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="import-template.xlsx"',
      "Content-Length": buffer.length,
    });
    res.end(buffer);
  }

  /**
   * Declared before `:id` on purpose. Express matches in order, so a literal
   * route registered after a parameterised one is never reached — `/search`
   * would be read as an id and fail UUID validation.
   */
  @Get("search")
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "POS search — returns sellable variants, priced" })
  search(@Query(zodPipe(SearchVariantsSchema)) query: SearchVariantsDto) {
    return this.products.searchVariants(query);
  }

  @Get()
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "List products" })
  list(@Query(zodPipe(ListProductsSchema)) query: ListProductsDto) {
    return this.products.list(query);
  }

  @Get(":id")
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "Product with its variants, prices and stock" })
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("branchId") branchId?: string,
  ) {
    return this.products.findById(id, branchId);
  }

  @Post()
  @RequirePermissions("product:write")
  @Audited("products", "create")
  @ApiOperation({ summary: "Create a product with one or more variants" })
  create(@Body(zodPipe(CreateProductSchema)) dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("product:write")
  @Audited("products", "update")
  @ApiOperation({ summary: "Update a product" })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateProductSchema)) dto: UpdateProductDto,
  ) {
    return this.products.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("product:delete")
  @Audited("products", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Soft-delete, or deactivate if it has sales history" })
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.products.remove(id);
  }

  /**
   * Packagings — a box, a carton. `variants/:variantId/units` and
   * `variant-units/:id` are distinct literal segments, so neither collides
   * with `:id` above regardless of registration order.
   */
  @Get("variants/:variantId/units")
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "Packagings offered for one variant" })
  listVariantUnits(@Param("variantId", ParseUUIDPipe) variantId: string) {
    return this.products.listVariantUnits(variantId);
  }

  @Post("variants/:variantId/units")
  @RequirePermissions("product:write")
  @Audited("variant_units", "create")
  @ApiOperation({ summary: "Add a packaging to a variant" })
  createVariantUnit(
    @Param("variantId", ParseUUIDPipe) variantId: string,
    @Body(zodPipe(CreateVariantUnitSchema)) dto: CreateVariantUnitDto,
  ) {
    return this.products.createVariantUnit(variantId, dto);
  }

  @Patch("variant-units/:id")
  @RequirePermissions("product:write")
  @Audited("variant_units", "update")
  @ApiOperation({ summary: "Update a packaging" })
  updateVariantUnit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateVariantUnitSchema)) dto: UpdateVariantUnitDto,
  ) {
    return this.products.updateVariantUnit(id, dto);
  }

  @Delete("variant-units/:id")
  @RequirePermissions("product:write")
  @Audited("variant_units", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a packaging — pure configuration, a real delete" })
  deleteVariantUnit(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.products.deleteVariantUnit(id);
  }

  /**
   * Supplier links (Stage 5.4) — a supplier's own SKU/barcode for one
   * variant, so receiving can match their delivery note directly.
   */
  @Get("variants/:variantId/suppliers")
  @RequirePermissions("supplier:read")
  @ApiOperation({ summary: "Suppliers linked to one variant, with their own codes" })
  listSupplierLinks(@Param("variantId", ParseUUIDPipe) variantId: string) {
    return this.products.listSupplierLinks(variantId);
  }

  @Post("variants/:variantId/suppliers")
  @RequirePermissions("supplier:write")
  @Audited("product_supplier_links", "create")
  createSupplierLink(
    @Param("variantId", ParseUUIDPipe) variantId: string,
    @Body(zodPipe(CreateProductSupplierLinkSchema)) dto: CreateProductSupplierLinkDto,
  ) {
    return this.products.createSupplierLink(variantId, dto);
  }

  @Patch("variant-suppliers/:id")
  @RequirePermissions("supplier:write")
  @Audited("product_supplier_links", "update")
  updateSupplierLink(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateProductSupplierLinkSchema)) dto: UpdateProductSupplierLinkDto,
  ) {
    return this.products.updateSupplierLink(id, dto);
  }

  @Delete("variant-suppliers/:id")
  @RequirePermissions("supplier:write")
  @Audited("product_supplier_links", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSupplierLink(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.products.deleteSupplierLink(id);
  }

  // --- images (Stage 5.6) ---------------------------------------------------

  @Get(":productId/images")
  @RequirePermissions("product:read")
  listImages(@Param("productId", ParseUUIDPipe) productId: string) {
    return this.products.listImages(productId);
  }

  @Post(":productId/images")
  @RequirePermissions("product:write")
  @Audited("product_images", "create")
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({ summary: "Upload a product photo (JPEG/PNG/WebP, 5MB max)" })
  uploadImage(
    @Param("productId", ParseUUIDPipe) productId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(zodPipe(UploadProductImageSchema)) dto: UploadProductImageDto,
  ) {
    return this.products.addImage(productId, file, dto);
  }

  @Patch("images/:id")
  @RequirePermissions("product:write")
  @Audited("product_images", "update")
  updateImage(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateProductImageSchema)) dto: UpdateProductImageDto,
  ) {
    return this.products.updateImage(id, dto);
  }

  @Delete("images/:id")
  @RequirePermissions("product:write")
  @Audited("product_images", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteImage(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.products.deleteImage(id);
  }
}
