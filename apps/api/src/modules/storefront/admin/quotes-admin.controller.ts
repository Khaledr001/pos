import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../../common/decorators/index.js";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import {
  CloseQuoteSchema,
  ListQuotesSchema,
  PriceQuoteSchema,
  type CloseQuoteDto,
  type ListQuotesDto,
  type PriceQuoteDto,
} from "../quotes/dto.js";
import { QuotesAdminService } from "../quotes/quotes-admin.service.js";

/**
 * The quote desk shares the order desk's permissions: pricing a trade quote is
 * the same trust as moving an online order, and the discount authority a price
 * below list needs is checked in the service, where the numbers are known.
 */
@ApiTags("storefront-admin")
@Controller("storefront-admin/quotes")
export class QuotesAdminController {
  constructor(private readonly quotes: QuotesAdminService) {}

  @Get()
  @RequirePermissions("order:read")
  list(@Query(zodPipe(ListQuotesSchema)) dto: ListQuotesDto) {
    return this.quotes.list(dto);
  }

  @Get(":id")
  @RequirePermissions("order:read")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.quotes.detail(id);
  }

  /** Sets the prices the shopper may accept. Moves the quote to `quoted`. */
  @Post(":id/price")
  @RequirePermissions("order:write")
  @Audited("web_quotes", "price")
  price(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(PriceQuoteSchema)) dto: PriceQuoteDto) {
    return this.quotes.price(id, dto);
  }

  @Post(":id/close")
  @RequirePermissions("order:write")
  @Audited("web_quotes", "close")
  close(@Param("id", ParseUUIDPipe) id: string, @Body(zodPipe(CloseQuoteSchema)) dto: CloseQuoteDto) {
    return this.quotes.close(id, dto);
  }
}
