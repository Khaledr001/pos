import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { InventoryService } from "./inventory.service.js";
import {
  AdjustStockSchema, ListStockSchema, ListTransactionsSchema, TransferStockSchema,
  type AdjustStockDto, type ListStockDto, type ListTransactionsDto, type TransferStockDto,
} from "./dto.js";

@ApiTags("inventory")
@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions("inventory:read")
  @ApiOperation({ summary: "Stock per variant per branch" })
  listStock(@Query(zodPipe(ListStockSchema)) query: ListStockDto) {
    return this.inventory.listStock(query);
  }

  @Get("transactions")
  @RequirePermissions("inventory:read")
  @ApiOperation({ summary: "The stock ledger — every movement, newest first" })
  listTransactions(@Query(zodPipe(ListTransactionsSchema)) query: ListTransactionsDto) {
    return this.inventory.listTransactions(query);
  }

  @Get("low-stock")
  @RequirePermissions("inventory:read")
  @ApiOperation({ summary: "What needs reordering, worst shortfall first" })
  lowStock(@Query("branchId") branchId?: string) {
    return this.inventory.lowStock(branchId);
  }

  /** Stock value is a financial figure, so it needs the financial permission. */
  @Get("valuation")
  @RequirePermissions("report:financial")
  @ApiOperation({ summary: "Stock value at weighted-average cost" })
  valuation(@Query("branchId") branchId?: string) {
    return this.inventory.valuation(branchId);
  }

  @Post("adjust")
  @RequirePermissions("inventory:adjust")
  @Audited("inventory", "adjust")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Set an absolute quantity, with a mandatory reason" })
  adjust(@Body(zodPipe(AdjustStockSchema)) dto: AdjustStockDto) {
    return this.inventory.adjust(dto);
  }

  /**
   * `transfer:approve`, not `transfer:request`.
   *
   * This moves stock between branches IMMEDIATELY — no request, no approval,
   * no shipped/received states. It is a second door into the same cupboard the
   * transfers module guards with four, and it was open to `transfer:request`,
   * which the warehouse role holds. Whoever may use it is exercising exactly
   * the authority `transfer:approve` names.
   */
  @Post("transfer")
  @RequirePermissions("transfer:approve")
  @Audited("inventory", "transfer")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Move stock between branches" })
  transfer(@Body(zodPipe(TransferStockSchema)) dto: TransferStockDto) {
    return this.inventory.transfer(dto);
  }
}
