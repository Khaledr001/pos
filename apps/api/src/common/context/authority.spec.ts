import type { AuthenticatedUser, PermissionGrant } from "@devsfleet/shared-types";
import { AppError } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { assertMayGrantAbac, assertMayGrantPermissions } from "./authority.js";
import { RequestContext } from "./request-context.js";

/**
 * These cover the escalation paths that `user:write` used to open on its own:
 * assigning a role you do not hold, and raising a ceiling above your own.
 */

const user = (
  permissions: PermissionGrant[],
  abac: Partial<AuthenticatedUser["abac"]> = {},
): AuthenticatedUser => ({
  id: "u1",
  tenantId: "t1",
  branchId: "b1",
  roleId: "r1",
  roleName: "test",
  permissions,
  abac: {
    maxDiscountPercent: "10",
    maxSaleAmount: "1000",
    canApproveRefund: false,
    canViewCost: false,
    allowedBranchIds: [],
    ...abac,
  },
  isPlatformAdmin: false,
  planId: "pro",
  trialEndsAt: null,
});

const as = <T>(who: AuthenticatedUser | undefined, fn: () => T): T =>
  RequestContext.run(
    { requestId: "test", startedAt: 0, ...(who ? { user: who, tenantId: who.tenantId ?? undefined } : {}) },
    fn,
  );

const refused = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : "OTHER";
  }
};

describe("assertMayGrantPermissions", () => {
  it("refuses a role carrying a permission the caller lacks", () => {
    const code = as(user(["user:write", "user:read"]), () =>
      refused(() => assertMayGrantPermissions(["user:write", "sale:void"], "That role")),
    );
    expect(code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("refuses the superuser role to anybody who is not one", () => {
    const code = as(user(["user:write"]), () =>
      refused(() => assertMayGrantPermissions(["*"], "That role")),
    );
    expect(code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("allows an exact subset", () => {
    const code = as(user(["user:write", "user:read", "sale:read"]), () =>
      refused(() => assertMayGrantPermissions(["user:read", "sale:read"], "That role")),
    );
    expect(code).toBeNull();
  });

  it("lets a superuser grant anything", () => {
    const code = as(user(["*"]), () =>
      refused(() => assertMayGrantPermissions(["*", "sale:void"], "That role")),
    );
    expect(code).toBeNull();
  });

  it("is inert outside a request, where there is nobody to check", () => {
    expect(refused(() => assertMayGrantPermissions(["*"], "That role"))).toBeNull();
  });
});

describe("assertMayGrantAbac", () => {
  it("refuses a discount ceiling above the caller's", () => {
    const code = as(user(["user:write"], { maxDiscountPercent: "10" }), () =>
      refused(() => assertMayGrantAbac({ maxDiscountPercent: 25 })),
    );
    expect(code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("allows an equal ceiling", () => {
    const code = as(user(["user:write"], { maxDiscountPercent: "10" }), () =>
      refused(() => assertMayGrantAbac({ maxDiscountPercent: 10 })),
    );
    expect(code).toBeNull();
  });

  it("treats a null sale limit as unlimited, and refuses granting it", () => {
    const code = as(user(["user:write"], { maxSaleAmount: "5000" }), () =>
      refused(() => assertMayGrantAbac({ maxSaleAmount: null })),
    );
    expect(code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("lets an unlimited caller grant any sale limit", () => {
    const code = as(user(["user:write"], { maxSaleAmount: null }), () =>
      refused(() => assertMayGrantAbac({ maxSaleAmount: 999999 })),
    );
    expect(code).toBeNull();
  });

  it("refuses handing out rights the caller does not hold", () => {
    const who = user(["user:write"], { canViewCost: false, canApproveRefund: false });
    expect(as(who, () => refused(() => assertMayGrantAbac({ canViewCost: true })))).toBe(
      "INSUFFICIENT_PERMISSIONS",
    );
    expect(as(who, () => refused(() => assertMayGrantAbac({ canApproveRefund: true })))).toBe(
      "INSUFFICIENT_PERMISSIONS",
    );
    // Withdrawing one is always allowed.
    expect(as(who, () => refused(() => assertMayGrantAbac({ canViewCost: false })))).toBeNull();
  });

  it("refuses widening branch scope beyond the caller's own", () => {
    const who = user(["user:write"], { allowedBranchIds: ["b1"] });
    expect(as(who, () => refused(() => assertMayGrantAbac({ allowedBranchIds: ["b1", "b2"] })))).toBe(
      "INSUFFICIENT_PERMISSIONS",
    );
    // An empty list means EVERY branch, so a scoped caller must not write one.
    expect(as(who, () => refused(() => assertMayGrantAbac({ allowedBranchIds: [] })))).toBe(
      "INSUFFICIENT_PERMISSIONS",
    );
    expect(as(who, () => refused(() => assertMayGrantAbac({ allowedBranchIds: ["b1"] })))).toBeNull();
  });

  it("lets an all-branch caller grant any scope", () => {
    const code = as(user(["user:write"], { allowedBranchIds: [] }), () =>
      refused(() => assertMayGrantAbac({ allowedBranchIds: ["b1", "b2"] })),
    );
    expect(code).toBeNull();
  });
});
