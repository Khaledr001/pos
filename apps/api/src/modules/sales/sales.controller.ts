import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { SalesService } from "./sales.service.js";
import {
  CreateReturnSchema,
  CreateSaleSchema,
  ListSalesSchema,
  VoidSaleSchema,
  type CreateReturnDto,
  type CreateSaleDto,
  type ListSalesDto,
  type VoidSaleDto,
} from "./dto.js";

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

  /**
   * Declared BEFORE `:id`. Express matches in order, and `invoice` is a
   * literal segment on a parameterised sibling — registering it after would
   * make it unreachable.
   */
  @Get(":id/invoice")
  @RequirePermissions("sale:read")
  @ApiOperation({ summary: "Download the sale as an A4 tax invoice (PDF)" })
  async invoice(
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, body } = await this.sales.invoicePdf(id);

    /**
     * Written straight to the response, which is why `@Res()` is here: the
     * global TransformInterceptor wraps every returned value in the JSON
     * ApiSuccess envelope, and a PDF wrapped in JSON is not a PDF. Taking the
     * response object puts this handler in library-specific mode, so Nest
     * leaves the body alone.
     *
     * `attachment` rather than `inline`: the request is "download the bill".
     */
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `attachment; filename="${filename}"`);
    res.setHeader("content-length", String(body.length));
    res.end(body);
  }

  @Get(":id")
  @RequirePermissions("sale:read")
  @ApiOperation({ summary: "One sale with lines and payments" })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.sales.findById(id);
  }

  /**
   * Idempotent on `localId`. A terminal that times out and retries gets the
   * original sale back, not a second invoice.
   */
  @Post()
  @RequirePermissions("sale:create")
  @Audited("sales", "create")
  @ApiOperation({ summary: "Complete a sale — deducts stock, takes payment" })
  create(@Body(zodPipe(CreateSaleSchema)) dto: CreateSaleDto) {
    return this.sales.create(dto);
  }

  /** Undo a sale entirely — restocks every line and reverses every payment. */
  @Post(":id/void")
  @RequirePermissions("sale:void")
  @Audited("sales", "void")
  @ApiOperation({ summary: "Void a sale" })
  voidSale(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(VoidSaleSchema)) dto: VoidSaleDto) {
    return this.sales.void(id, dto);
  }

  /**
   * Idempotent on `localId`, same as `create` — a terminal pushing a return
   * after a timeout gets the original return back, not a second one.
   */
  @Post("returns")
  @RequirePermissions("sale:return")
  @Audited("sales", "return")
  @ApiOperation({ summary: "Return some or all lines of a sale" })
  createReturn(@Body(zodPipe(CreateReturnSchema)) dto: CreateReturnDto) {
    return this.sales.createReturn(dto);
  }
}
