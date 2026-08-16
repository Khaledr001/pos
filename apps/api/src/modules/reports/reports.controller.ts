import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ReportsService } from "./reports.service.js";
import {
  InventoryReportSchema,
  ReportRangeSchema,
  TopProductsSchema,
  type InventoryReportDto,
  type ReportRangeDto,
  type TopProductsDto,
} from "./dto.js";

@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("sales")
  @RequirePermissions("report:read")
  @ApiOperation({ summary: "Sales by day, with the tender split" })
  sales(@Query(zodPipe(ReportRangeSchema)) query: ReportRangeDto) {
    return this.reports.sales(query);
  }

  /**
   * `report:financial`, because ranking by margin exposes cost.
   *
   * The route enforces it rather than the serialiser stripping fields, so the
   * boundary is one line a reviewer can see.
   */
  @Get("top-products")
  @RequirePermissions("report:financial")
  @ApiOperation({ summary: "Best sellers by revenue, quantity or margin" })
  topProducts(@Query(zodPipe(TopProductsSchema)) query: TopProductsDto) {
    return this.reports.topProducts(query);
  }

  @Get("inventory")
  @RequirePermissions("report:read")
  @ApiOperation({ summary: "Stock value, low stock, out of stock" })
  inventory(@Query(zodPipe(InventoryReportSchema)) query: InventoryReportDto) {
    return this.reports.inventory(query);
  }

  @Get("financial")
  @RequirePermissions("report:financial")
  @ApiOperation({ summary: "Revenue, cost, gross profit, margin, overheads" })
  financial(@Query(zodPipe(ReportRangeSchema)) query: ReportRangeDto) {
    return this.reports.financial(query);
  }
}
