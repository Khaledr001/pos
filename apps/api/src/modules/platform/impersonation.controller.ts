import { Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PlatformService } from "./platform.service.js";

/**
 * Ending an impersonation session — deliberately NOT `@PlatformOnly()`.
 *
 * This is the one platform operation whose caller is not a platform operator.
 * By the time it runs, the operator is holding the *impersonated* token: its
 * principal is the customer's administrator, and `isPlatformAdmin` on it is
 * false. `@PlatformOnly()` would reject the very session this route exists to
 * close, which is why this lives in its own controller rather than alongside
 * the rest of `/admin`.
 *
 * What authorises it instead is the token itself. `impersonatedBy` is signed
 * into the access token by the impersonate route and cannot be set by a
 * client, so its presence is proof that this server minted this session for
 * that operator. `endImpersonation` refuses anything without it, so an
 * ordinary user reaching this route gets a 403 — the route being open to
 * authenticated callers costs nothing.
 *
 * The alternative — having the client hold its super-admin token and send that
 * — was rejected: it needs the operator's credentials parked in browser
 * storage for the whole session (exactly the leak this change removes), and it
 * breaks when their own token expires mid-support-call.
 */
@ApiTags("platform")
@Controller("admin/impersonation")
export class ImpersonationController {
  constructor(private readonly platform: PlatformService) {}

  @Post("end")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "End the current impersonation and return the operator's own session",
  })
  end() {
    return this.platform.endImpersonation();
  }
}
