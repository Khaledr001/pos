import {
  Body,
  Controller,
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
import { StockTakeService } from "./stock-take.service.js";
import {
  ApproveCountSchema,
  CreateStockCountSchema,
  EnterCountSchema,
  ListStockCountsSchema,
  type ApproveCountDto,
  type CreateStockCountDto,
  type EnterCountDto,
  type ListStockCountsDto,
} from "./dto.js";

@ApiTags("stock-take")
@Controller("stock-take")
export class StockTakeController {
  constructor(private readonly stockTake: StockTakeService) {}

  @Get()
  @RequirePermissions("inventory:read")
  list(@Query(zodPipe(ListStockCountsSchema)) query: ListStockCountsDto) {
    return this.stockTake.list(query);
  }

  @Get(":id")
  @RequirePermissions("inventory:read")
  findById(@Param("id", ParseUUIDPipe) id: string) {
    return this.stockTake.findById(id);
  }

  @Post()
  @RequirePermissions("inventory:count")
  @Audited("stock_count", "create")
  @ApiOperation({ summary: "Generate a count sheet" })
  create(@Body(zodPipe(CreateStockCountSchema)) dto: CreateStockCountDto) {
    return this.stockTake.create(dto);
  }

  @Patch(":id/items/:itemId")
  @RequirePermissions("inventory:count")
  @ApiOperation({ summary: "Enter what was on the shelf" })
  enterCount(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body(zodPipe(EnterCountSchema)) dto: EnterCountDto,
  ) {
    return this.stockTake.enterCount(id, itemId, dto);
  }

  @Post(":id/submit")
  @RequirePermissions("inventory:count")
  @Audited("stock_count", "submit")
  @HttpCode(HttpStatus.OK)
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.stockTake.submit(id);
  }

  /**
   * `inventory:adjust`, deliberately not `inventory:count`.
   *
   * Counting and writing off the difference are different powers. Whoever walks
   * the aisles with a clipboard should not also be the one who makes the
   * missing eleven units official.
   */
  @Post(":id/approve")
  @RequirePermissions("inventory:adjust")
  @Audited("stock_count", "approve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Post every variance to the stock ledger" })
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(ApproveCountSchema)) dto: ApproveCountDto,
  ) {
    return this.stockTake.approve(id, dto);
  }

  @Post(":id/cancel")
  @RequirePermissions("inventory:count")
  @Audited("stock_count", "cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.stockTake.cancel(id);
  }
}
