import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { RequestContext } from "../../../common/context/request-context.js";
import { Public } from "../../../common/decorators/index.js";
import { readCookie, SHOPPER_ACCESS_COOKIE, storefrontHost } from "./cookies.js";
import { assertSiteFeature, type SiteFeatureKey } from "./site-features.js";
import { ShopperTokens } from "./shopper-tokens.service.js";
import { StorefrontResolver } from "./storefront-resolver.service.js";

const REQUIRE_SHOPPER_KEY = "storefront:requireShopper";
/** Exported for the spec that pins which routes need which feature. */
export const REQUIRE_FEATURE_KEY = "storefront:requireFeature";

/**
 * Puts a storefront request into its tenant.
 *
 * Runs after the global guards: JwtAuthGuard has already let the route
 * through as `@Public()`, PermissionsGuard has nothing to check. This is where
 * the request acquires its tenant — from the host, never from the body — and,
 * if the shopper's cookie verifies, its shopper.
 *
 * An unverifiable shopper cookie is ignored rather than refused: an expired
 * access token on a product page is a guest, not an error. Only a route marked
 * `@RequireShopper()` turns "no shopper" into a 401.
 */
@Injectable()
export class StorefrontGuard implements CanActivate {
  constructor(
    private readonly resolver: StorefrontResolver,
    private readonly tokens: ShopperTokens,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const storefront = await this.resolver.resolve(storefrontHost(request));
    if (!storefront) {
      throw new AppError(ERROR_CODES.STOREFRONT_NOT_FOUND, "No online store is set up at this address.");
    }
    RequestContext.setStorefront(storefront);

    // Before anything about the shopper: a feature the site does not run is
    // refused for everyone, signed in or not. Class-level and handler-level
    // requirements add up.
    const features = this.reflector.getAllAndMerge<SiteFeatureKey[]>(REQUIRE_FEATURE_KEY, [context.getHandler(), context.getClass()]);
    if (features?.length) assertSiteFeature(...features);

    const token = readCookie(request, SHOPPER_ACCESS_COOKIE);
    const shopper = token ? await this.tokens.verifyAccess(token) : null;
    if (shopper && shopper.tenantId === storefront.tenantId) {
      RequestContext.setShopper({ accountId: shopper.accountId, customerId: shopper.customerId });
    }

    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_SHOPPER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !RequestContext.get()?.shopper) {
      throw new AppError(ERROR_CODES.SHOPPER_AUTH_REQUIRED, "Sign in to continue.");
    }
    return true;
  }
}

/**
 * Every storefront controller carries this, at class level.
 *
 * `@Public()` here does not mean unauthenticated data access: it means "not a
 * staff route". The tenant comes from StorefrontGuard, and every query still
 * runs under RLS through `db.run()`.
 */
export const StorefrontRoute = () => applyDecorators(Public(), UseGuards(StorefrontGuard));

/**
 * The route belongs to a part of the platform the site may not run
 * (`cart`, `checkout`, `accounts`, `products`, …). Enforced by the guard, so a
 * hidden menu item in the storefront is never the only thing stopping a request.
 */
export const RequireSiteFeature = (...features: SiteFeatureKey[]) => SetMetadata(REQUIRE_FEATURE_KEY, features);

/** The route needs a signed-in shopper. */
export const RequireShopper = () => SetMetadata(REQUIRE_SHOPPER_KEY, true);

/** The signed-in shopper, or throw. For services behind `@RequireShopper()`. */
export function requireShopper(): { accountId: string; customerId: string } {
  const shopper = RequestContext.get()?.shopper;
  if (!shopper) throw new AppError(ERROR_CODES.SHOPPER_AUTH_REQUIRED, "Sign in to continue.");
  return shopper;
}

export function currentShopper(): { accountId: string; customerId: string } | undefined {
  return RequestContext.get()?.shopper;
}
