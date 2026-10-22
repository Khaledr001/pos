import type { AuthenticatedUser } from "@devsfleet/shared-types";
import { AppError } from "@devsfleet/shared-utils";
import { eq, inArray, schema } from "@devsfleet/db";
import { describe, expect, it } from "vitest";
import { branchFilter } from "./branch-scope.js";
import { RequestContext } from "./request-context.js";

/**
 * `branchFilter` is the line between a branch manager and every other shop's
 * books, on every list that uses it. These pin down the three cases.
 */

const user = (allowedBranchIds: string[], isPlatformAdmin = false): AuthenticatedUser => ({
  id: "u1",
  tenantId: "t1",
  branchId: allowedBranchIds[0] ?? null,
  roleId: "r1",
  roleName: "test",
  permissions: ["*"],
  abac: {
    maxDiscountPercent: "10",
    maxSaleAmount: null,
    canApproveRefund: false,
    canViewCost: false,
    allowedBranchIds,
  },
  isPlatformAdmin,
  planId: "pro",
  trialEndsAt: null,
}) as AuthenticatedUser;

const as = <T>(who: AuthenticatedUser, fn: () => T): T =>
  RequestContext.run({ requestId: "test", startedAt: 0, user: who, tenantId: "t1" }, fn);

const column = schema.quotations.branchId;

describe("branchFilter", () => {
  it("limits an unfiltered list to a scoped caller's own branches", () => {
    const condition = as(user(["b1", "b2"]), () => branchFilter(column));
    expect(condition).toEqual(inArray(column, ["b1", "b2"]));
    // And not merely any IN list: the comparison has to see the branches.
    expect(condition).not.toEqual(inArray(column, ["b1"]));
  });

  it("adds nothing for an owner, whose empty scope means every branch", () => {
    expect(as(user([]), () => branchFilter(column))).toBeUndefined();
  });

  it("adds nothing for a platform admin", () => {
    expect(as(user(["b1"], true), () => branchFilter(column))).toBeUndefined();
  });

  it("filters to a named branch inside the caller's scope", () => {
    const condition = as(user(["b1", "b2"]), () => branchFilter(column, "b2"));
    expect(condition).toEqual(eq(column, "b2"));
  });

  it("refuses a named branch outside the caller's scope", () => {
    expect(() => as(user(["b1"]), () => branchFilter(column, "b9"))).toThrow(AppError);
  });
});
