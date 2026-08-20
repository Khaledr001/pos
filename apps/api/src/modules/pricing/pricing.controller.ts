import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PricingService } from "./pricing.service.js";
import {
  BulkSetProductPricesSchema,
  CreatePriceListSchema,
  ListPriceHistorySchema,
  ListPriceListsSchema,
  SetCustomerPriceSchema,
  SetProductPriceSchema,
  UpdatePriceListSchema,
  type BulkSetProductPricesDto,
  type CreatePriceListDto,
  type ListPriceHistoryDto,
  type ListPriceListsDto,
  type SetCustomerPriceDto,
  type SetProductPriceDto,
  type UpdatePriceListDto,
} from "./dto.js";

@ApiTags("pricing")
@Controller("pricing")
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get("lists")
  @RequirePermissions("price:read")
  @ApiOperation({ summary: "List price lists" })
  listPriceLists(@Query(zodPipe(ListPriceListsSchema)) query: ListPriceListsDto) {
    return this.pricing.listPriceLists(query);
  }

  @Get("lists/:id")
  @RequirePermissions("price:read")
  findPriceList(@Param("id", ParseUUIDPipe) id: string) {
    return this.pricing.findPriceListById(id);
  }

  @Post("lists")
  @RequirePermissions("price:write")
  @Audited("price_lists", "create")
  @ApiOperation({ summary: "Create a price list" })
  createPriceList(@Body(zodPipe(CreatePriceListSchema)) dto: CreatePriceListDto) {
    return this.pricing.createPriceList(dto);
  }

  @Patch("lists/:id")
  @RequirePermissions("price:write")
  @Audited("price_lists", "update")
  updatePriceList(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdatePriceListSchema)) dto: UpdatePriceListDto,
  ) {
    return this.pricing.updatePriceList(id, dto);
  }

  @Delete("lists/:id")
  @RequirePermissions("price:write")
  @Audited("price_lists", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Deactivate a price list (refused on the tenant's default)" })
  removePriceList(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.pricing.removePriceList(id);
  }

  @Get("history")
  @RequirePermissions("price:read")
  @ApiOperation({ summary: "Price change history for one variant" })
  listPriceHistory(@Query(zodPipe(ListPriceHistorySchema)) query: ListPriceHistoryDto) {
    return this.pricing.listPriceHistory(query);
  }

  @Post("products")
  @RequirePermissions("price:write")
  @Audited("product_prices", "update")
  @ApiOperation({ summary: "Set a variant's price on a list, effective from a date" })
  setProductPrice(@Body(zodPipe(SetProductPriceSchema)) dto: SetProductPriceDto) {
    return this.pricing.setProductPrice(dto);
  }

  @Post("products/bulk")
  @RequirePermissions("price:write")
  @Audited("product_prices", "update")
  @ApiOperation({ summary: "Set many variants' prices in one transaction" })
  bulkSetProductPrices(@Body(zodPipe(BulkSetProductPricesSchema)) dto: BulkSetProductPricesDto) {
    return this.pricing.bulkSetProductPrices(dto);
  }

  @Get("customers/:customerId")
  @RequirePermissions("price:read")
  @ApiOperation({ summary: "Negotiated prices for one customer" })
  listCustomerPrices(@Param("customerId", ParseUUIDPipe) customerId: string) {
    return this.pricing.listCustomerPrices(customerId);
  }

  @Post("customers")
  @RequirePermissions("price:write")
  @Audited("customer_prices", "update")
  @ApiOperation({ summary: "Negotiate a price for one customer and variant" })
  setCustomerPrice(@Body(zodPipe(SetCustomerPriceSchema)) dto: SetCustomerPriceDto) {
    return this.pricing.setCustomerPrice(dto);
  }
}
