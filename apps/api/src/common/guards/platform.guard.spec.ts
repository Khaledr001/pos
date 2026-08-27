import type { AuthenticatedUser } from "@devsfleet/shared-types";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { PlatformOnly } from "../decorators/index.js";
import { PlatformGuard } from "./platform.guard.js";

/**
 * The boundary between one business and every other business.
 *
 * Untested until now, which is a poor place to have no regression cover: a
 * change that made `canActivate` return true by default would open the whole
 * platform console to any signed-in cashier, and nothing would have failed.
 */
describe("PlatformGuard", () => {
  const guard = new PlatformGuard(new Reflector());

  const user = (isPlatformAdmin: boolean): AuthenticatedUser => ({
    id: "u1",
    tenantId: "t1",
    branchId: null,
    roleId: "r1",
    roleName: "admin",
    // Deliberately the superuser grant: a tenant admin holding EVERY
    // permission inside their own business must still be refused here.
    permissions: ["*"],
    abac: {
      maxDiscountPercent: "100",
      maxSaleAmount: null,
      canApproveRefund: true,
      canViewCost: true,
      allowedBranchIds: [],
    },
    isPlatformAdmin,
    planId: "pro",
    trialEndsAt: null,
  });

  /** A context whose handler/class carry `@PlatformOnly()` when `gated`. */
  const contextFor = (gated: boolean, principal?: AuthenticatedUser) => {
    class Decorated {
      handler() {}
    }
    if (gated) PlatformOnly()(Decorated);

    return {
      getHandler: () => Decorated.prototype.handler,
      getClass: () => Decorated,
      switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
    } as never;
  };

  it("is inert on a route without the decorator", () => {
    expect(guard.canActivate(contextFor(false, user(false)))).toBe(true);
  });

  it("admits a platform operator", () => {
    expect(guard.canActivate(contextFor(true, user(true)))).toBe(true);
  });

  it("refuses a tenant admin holding the superuser permission", () => {
    expect(() => guard.canActivate(contextFor(true, user(false)))).toThrow(
      ForbiddenException,
    );
  });

  it("refuses an unauthenticated request rather than reading through undefined", () => {
    expect(() => guard.canActivate(contextFor(true, undefined))).toThrow(
      ForbiddenException,
    );
  });

  it("does not name the route it is protecting", () => {
    // The message is deliberately vague — see the guard's own comment.
    expect(() => guard.canActivate(contextFor(true, user(false)))).toThrow(
      /^Not available$/,
    );
  });
});
