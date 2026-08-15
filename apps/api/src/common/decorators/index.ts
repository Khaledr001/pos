import type { AuthenticatedUser, Permission } from "@devsfleet/shared-types";
import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import { RequestContext } from "../context/request-context.js";

/**
 * Route decorators.
 *
 * The default posture is closed: JwtAuthGuard is registered globally, so every
 * route requires a valid token unless it opts out with `@Public()`. A new
 * controller written by someone who has not read this file is still protected.
 */

export const IS_PUBLIC_KEY = "isPublic";
export const PERMISSIONS_KEY = "permissions";
export const AUDIT_KEY = "audit";

/**
 * Skip authentication for this route.
 *
 * Legitimate uses are few: login, token refresh, the health probe, and the
 * WhatsApp webhook (which authenticates by HMAC signature instead). Anything
 * else marked public should be questioned in review.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Require every listed permission. Enforced by PermissionsGuard.
 *
 *     @RequirePermissions("product:write")
 *     @Post()
 *     create(...) {}
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Write an audit_log row for this route.
 *
 * Mandatory on anything that moves money or stock: price changes, stock
 * adjustments, voids, refunds, credit-limit edits, permission changes.
 */
export const Audited = (entityType: string, action: string) =>
  SetMetadata(AUDIT_KEY, { entityType, action });

/**
 * Inject the authenticated principal.
 *
 *     findAll(@CurrentUser() user: AuthenticatedUser) {}
 *     findAll(@CurrentUser("tenantId") tenantId: string) {}
 */
export const CurrentUser = createParamDecorator(
  (key: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user ?? RequestContext.get()?.user;
    if (!user) return undefined;
    return key ? user[key] : user;
  },
);

/** Inject the request id, for correlating a client-side report with server logs. */
export const RequestId = createParamDecorator(
  () => RequestContext.requestId,
);
