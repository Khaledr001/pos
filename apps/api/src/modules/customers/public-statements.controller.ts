import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "../../common/decorators/index.js";
import { StatementShareService } from "./statement-share.service.js";

/**
 * Where a customer lands from a shared statement link. No session — the
 * signed token in the path is the whole authority. Throttled tighter than
 * the API at large: one customer opens one PDF a handful of times, and the
 * only caller wanting hundreds a minute is one guessing tokens.
 */
@ApiTags("public")
@Controller("public/statements")
export class PublicStatementsController {
  constructor(private readonly statements: StatementShareService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(":token")
  @ApiOperation({ summary: "A shared customer statement, as a PDF" })
  async open(@Param("token") token: string, @Res() res: Response): Promise<void> {
    const pdf = await this.statements.open(token);
    res.setHeader("content-type", "application/pdf");
    // Inline: it opens in the phone's viewer from the chat, not as a download.
    res.setHeader("content-disposition", `inline; filename="${pdf.filename}"`);
    res.setHeader("content-length", String(pdf.body.length));
    // A customer's balances: never kept by a proxy or a shared browser cache.
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("x-robots-tag", "noindex");
    res.end(pdf.body);
  }
}
