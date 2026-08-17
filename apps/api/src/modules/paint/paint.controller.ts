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
import { PaintService } from "./paint.service.js";
import {
  CreateFormulaSchema,
  CreatePaintOrderSchema,
  ListPaintOrdersSchema,
  SearchFormulasSchema,
  UpdateFormulaSchema,
  type CreateFormulaDto,
  type CreatePaintOrderDto,
  type ListPaintOrdersDto,
  type SearchFormulasDto,
  type UpdateFormulaDto,
} from "./dto.js";

@ApiTags("paint")
@Controller("paint")
export class PaintController {
  constructor(private readonly paint: PaintService) {}

  @Get("formulas")
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "Search formulas by colour code or name" })
  searchFormulas(@Query(zodPipe(SearchFormulasSchema)) query: SearchFormulasDto) {
    return this.paint.searchFormulas(query);
  }

  @Get("formulas/:id")
  @RequirePermissions("product:read")
  findFormula(@Param("id", ParseUUIDPipe) id: string) {
    return this.paint.findFormulaById(id);
  }

  @Post("formulas")
  @RequirePermissions("product:write")
  @Audited("paint_formula", "create")
  createFormula(@Body(zodPipe(CreateFormulaSchema)) dto: CreateFormulaDto) {
    return this.paint.createFormula(dto);
  }

  @Patch("formulas/:id")
  @RequirePermissions("product:write")
  @Audited("paint_formula", "update")
  updateFormula(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateFormulaSchema)) dto: UpdateFormulaDto,
  ) {
    return this.paint.updateFormula(id, dto);
  }

  @Delete("formulas/:id")
  @RequirePermissions("product:delete")
  @Audited("paint_formula", "delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFormula(@Param("id", ParseUUIDPipe) id: string) {
    return this.paint.deleteFormula(id);
  }

  @Get("orders")
  @RequirePermissions("product:read")
  listOrders(@Query(zodPipe(ListPaintOrdersSchema)) query: ListPaintOrdersDto) {
    return this.paint.listOrders(query);
  }

  /**
   * `sale:create` — a paint order deducts a base can from stock exactly as a
   * sale line would, so the power to run one is the power to sell.
   */
  @Post("orders")
  @RequirePermissions("sale:create")
  @Audited("paint_order", "create")
  @ApiOperation({ summary: "Record a mix; deducts one base can from stock" })
  createOrder(@Body(zodPipe(CreatePaintOrderSchema)) dto: CreatePaintOrderDto) {
    return this.paint.createOrder(dto);
  }
}
