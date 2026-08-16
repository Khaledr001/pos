import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { RequestContext } from "../context/request-context.js";

/**
 * Opens the AsyncLocalStorage store for the request and stamps it with an id.
 *
 * Applied to every route in AppModule. Runs before the guards, so by the time
 * JwtAuthGuard calls `RequestContext.setUser` there is a store to write into.
 *
 * An inbound `x-request-id` is honoured so a trace survives across the POS ->
 * API hop: when a terminal reports "sync failed at 14:32", the same id is on
 * the terminal's local log and on the server's.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers["x-request-id"];
    const requestId =
      (Array.isArray(inbound) ? inbound[0] : inbound)?.slice(0, 64) || randomUUID();

    res.setHeader("x-request-id", requestId);

    RequestContext.run(
      {
        requestId,
        startedAt: Date.now(),
        ipAddress: req.ip,
      },
      () => next(),
    );
  }
}
