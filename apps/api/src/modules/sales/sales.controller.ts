import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { SalesService } from "./sales.service.js";
import { CreateSaleSchema, ListSalesSchema, type CreateSaleDto, type ListSalesDto } from "./dto.js";

@ApiTags("sales")
@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @RequirePermissions("sale:read")
  @ApiOperation({ summary: "Sales history" })
  list(@Query(zodPipe(ListSalesSchema)) query: ListSalesDto) {
    return this.sales.list(query);
  }

  @Get(":id")
  @RequirePermissions("sale:read")
  @ApiOperation({ summary: "One sale with lines and payments" })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.sales.findById(id);
  }

  /**
   * Idempotent on `clientId`. A terminal that times out and retries gets the
   * original sale back, not a second invoice.
   */
  @Post()
  @RequirePermissions("sale:create")
  @Audited("sales", "create")
  @ApiOperation({ summary: "Complete a sale — deducts stock, takes payment" })
  create(@Body(zodPipe(CreateSaleSchema)) dto: CreateSaleDto) {
    return this.sales.create(dto);
  }
}
