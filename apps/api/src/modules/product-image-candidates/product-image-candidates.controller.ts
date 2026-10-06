import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  BulkCandidatesSchema,
  ListCandidatesSchema,
  type BulkCandidatesDto,
  type ListCandidatesDto,
} from "./dto.js";
import { ProductImageCandidatesService } from "./product-image-candidates.service.js";

@ApiTags("product-image-candidates")
@Controller("product-image-candidates")
export class ProductImageCandidatesController {
  constructor(private readonly candidates: ProductImageCandidatesService) {}

  @Post("bulk")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("product:write")
  @Audited("product_image_candidates", "bulk_create")
  @ApiOperation({ summary: "Submit web-found photo candidates (idempotent on product + image URL)" })
  bulk(@Body(zodPipe(BulkCandidatesSchema)) dto: BulkCandidatesDto) {
    return this.candidates.bulkCreate(dto);
  }

  @Get("summary")
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "How many products have an image, await review, or still need a search" })
  summary() {
    return this.candidates.getSummary();
  }

  @Get()
  @RequirePermissions("product:read")
  @ApiOperation({ summary: "Products with their candidate photos, for review" })
  list(@Query(zodPipe(ListCandidatesSchema)) query: ListCandidatesDto) {
    return this.candidates.list(query);
  }

  /** Literal segment before `:id/...` so it can never be read as an id. */
  @Post("products/:productId/reject-all")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("product:write")
  @Audited("product_image_candidates", "reject_all")
  rejectAll(@Param("productId", ParseUUIDPipe) productId: string) {
    return this.candidates.rejectAll(productId);
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("product:write")
  @Audited("product_image_candidates", "approve")
  @ApiOperation({ summary: "Download the candidate (SSRF-guarded) and attach it to the product" })
  approve(@Param("id", ParseUUIDPipe) id: string) {
    return this.candidates.approve(id);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("product:write")
  @Audited("product_image_candidates", "reject")
  reject(@Param("id", ParseUUIDPipe) id: string) {
    return this.candidates.reject(id);
  }
}
