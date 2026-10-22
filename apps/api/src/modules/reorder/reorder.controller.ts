import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  CreateDraftOrdersSchema,
  ReorderSuggestionsSchema,
  type CreateDraftOrdersDto,
  type ReorderSuggestionsDto,
} from "./dto.js";
import { ReorderService } from "./reorder.service.js";

@ApiTags("reorder")
@Controller("reorder")
export class ReorderController {
  constructor(private readonly reorder: ReorderService) {}

  @Get("suggestions")
  @RequirePermissions("purchase:read", "inventory:read")
  @ApiOperation({ summary: "Items at or below their reorder level at a branch, grouped by supplier" })
  suggestions(@Query(zodPipe(ReorderSuggestionsSchema)) query: ReorderSuggestionsDto) {
    return this.reorder.suggestions(query.branchId);
  }

  @Post("draft-orders")
  @RequirePermissions("purchase:write")
  @Audited("purchase_order", "create")
  @ApiOperation({ summary: "Raise one draft purchase order per supplier from chosen suggestions" })
  createDraftOrders(@Body(zodPipe(CreateDraftOrdersSchema)) dto: CreateDraftOrdersDto) {
    return this.reorder.createDraftOrders(dto);
  }
}
