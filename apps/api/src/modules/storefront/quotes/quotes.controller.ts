import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { zodPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { SessionCookies } from "../context/session-cookies.service.js";
import { RequireShopper, StorefrontRoute } from "../context/storefront.guard.js";
import { CreateQuoteSchema, QuotePageSchema, type CreateQuoteDto } from "./dto.js";
import { QuotesService } from "./quotes.service.js";

@ApiTags("storefront")
@StorefrontRoute()
@RequireShopper()
@Controller("storefront/quotes")
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly cookies: SessionCookies,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Req() req: Request, @Body(zodPipe(CreateQuoteSchema)) dto: CreateQuoteDto) {
    return this.quotes.create(this.cookies.guestCartId(req), dto);
  }

  @Get()
  list(@Query(zodPipe(QuotePageSchema)) query: { page: number }) {
    return this.quotes.list(query.page);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.quotes.get(id);
  }

  @Post(":id/accept")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  accept(@Param("id", ParseUUIDPipe) id: string) {
    return this.quotes.accept(id);
  }

  @Post(":id/decline")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  decline(@Param("id", ParseUUIDPipe) id: string) {
    return this.quotes.decline(id);
  }
}
