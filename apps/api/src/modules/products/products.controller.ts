import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ProductsService } from "./products.service.js";
import {
  CreateProductSchema, ListProductsSchema, SearchVariantsSchema, UpdateProductSchema,
  type CreateProductDto, type ListProductsDto, type SearchVariantsDto, type UpdateProductDto,
} from "./dto.js";

@ApiTags("products")
@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

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
}
