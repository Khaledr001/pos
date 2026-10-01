import { Controller, Get, HttpCode, HttpStatus, Query } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Public } from "../../../common/decorators/index.js";
import { StorefrontResolver } from "./storefront-resolver.service.js";

/**
 * Caddy's on-demand TLS asks this before it requests a certificate for a
 * hostname it has never seen. Answering 200 only for a live storefront's
 * domain is what stops anyone pointing arbitrary DNS at the platform and
 * burning its Let's Encrypt rate limit — or getting a certificate for a
 * name the platform does not serve.
 *
 * Reachable only on the internal network in production (Caddy -> api); it
 * reveals no more than that a hostname is a shop, which its DNS already does.
 */
@ApiExcludeController()
@Public()
@Controller("storefront/domains")
export class DomainCheckController {
  constructor(private readonly resolver: StorefrontResolver) {}

  @Get("allowed")
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  async allowed(@Query("domain") domain: string | undefined) {
    if (!(await this.resolver.resolve(domain))) {
      throw new AppError(ERROR_CODES.STOREFRONT_NOT_FOUND, "Not a storefront domain.");
    }
    return { allowed: true };
  }
}
