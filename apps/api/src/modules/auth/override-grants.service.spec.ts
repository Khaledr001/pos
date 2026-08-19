import type { AuthenticatedUser, OverrideGrantPayload } from "@devsfleet/shared-types";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { beforeEach, describe, expect, it } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { OverrideGrantsService } from "./override-grants.service.js";

/**
 * A grant is a credential the till hands back to the server, so the cases that
 * matter are the ones where it should count for NOTHING: forged, expired, from
 * another tenant, or an access token in disguise.
 */

const SECRET = "test-secret-with-plenty-of-entropy-0123456789";
const jwt = new JwtService({});
const config = { get: () => SECRET } as unknown as ConfigService<never, true>;
let service: OverrideGrantsService;

const caller: AuthenticatedUser = {
  id: "cashier", tenantId: "t1", branchId: "b1", roleId: "r1", roleName: "cashier",
  permissions: ["sale:create"],
  abac: { maxDiscountPercent: "0", maxSaleAmount: null, canApproveRefund: false, canViewCost: false, allowedBranchIds: [] },
  isPlatformAdmin: false, planId: "pro", trialEndsAt: null,
};

const sign = (payload: Partial<OverrideGrantPayload>, opts: { secret?: string; expiresIn?: number } = {}) =>
  jwt.signAsync(
    { typ: "override", sub: "mgr", name: "Manager", tenantId: "t1", branchId: "b1",
      permission: "price:override", abac: { maxDiscountPercent: "20", maxSaleAmount: null }, ...payload },
    { secret: opts.secret ?? SECRET, expiresIn: opts.expiresIn ?? 3600 },
  );

const asCaller = <T>(fn: () => Promise<T>): Promise<T> =>
  RequestContext.run({ requestId: "t", startedAt: 0, user: caller, tenantId: "t1" }, fn);

beforeEach(() => {
  service = new OverrideGrantsService(jwt, config);
});

describe("verify", () => {
  it("accepts a well-formed grant", async () => {
    const grant = await sign({});
    const out = await asCaller(() => service.verify([grant]));
    expect(out).toHaveLength(1);
    expect(out[0]?.permission).toBe("price:override");
  });

  it("discards a grant signed with another key", async () => {
    const grant = await sign({}, { secret: "a-completely-different-secret-value-here" });
    expect(await asCaller(() => service.verify([grant]))).toHaveLength(0);
  });

  it("discards an expired grant", async () => {
    const grant = await sign({}, { expiresIn: -1 });
    expect(await asCaller(() => service.verify([grant]))).toHaveLength(0);
  });

  it("discards a grant from another tenant", async () => {
    const grant = await sign({ tenantId: "t2" });
    expect(await asCaller(() => service.verify([grant]))).toHaveLength(0);
  });

  it("discards a grant approved at another branch", async () => {
    const grant = await sign({ branchId: "b9" });
    expect(await asCaller(() => service.verify([grant]))).toHaveLength(0);
  });

  it("refuses an ACCESS token presented as a grant", async () => {
    // Same secret, same shape minus `typ` — this is the attack the marker exists
    // for, because an access token carries a whole permission list.
    const token = await jwt.signAsync(
      { sub: "owner", tenantId: "t1", branchId: "b1", permissions: ["*"] },
      { secret: SECRET, expiresIn: 900 },
    );
    expect(await asCaller(() => service.verify([token]))).toHaveLength(0);
  });

  it("keeps the good ones out of a mixed batch", async () => {
    const good = await sign({ permission: "sale:discount" });
    const bad = await sign({ tenantId: "elsewhere" });
    const out = await asCaller(() => service.verify([bad, good, "not-a-jwt"]));
    expect(out.map((g) => g.permission)).toEqual(["sale:discount"]);
  });

  it("does nothing without grants", async () => {
    expect(await asCaller(() => service.verify(undefined))).toEqual([]);
    expect(await asCaller(() => service.verify([]))).toEqual([]);
  });
});

describe("permissionsWith", () => {
  it("adds only the permission each grant names", () => {
    const grants = [{ permission: "price:override" }, { permission: "sale:discount" }] as OverrideGrantPayload[];
    expect(OverrideGrantsService.permissionsWith(["sale:create"], grants)).toEqual([
      "sale:create", "price:override", "sale:discount",
    ]);
  });
});

describe("discountCeiling", () => {
  const grant = (permission: string, maxDiscountPercent: string) =>
    ({ permission, abac: { maxDiscountPercent, maxSaleAmount: null } }) as OverrideGrantPayload;

  it("lends the approver's ceiling", () => {
    expect(OverrideGrantsService.discountCeiling("0", [grant("sale:discount", "20")], "sale:discount")).toBe("20");
  });

  it("ignores a grant for a different permission", () => {
    expect(OverrideGrantsService.discountCeiling("5", [grant("price:override", "50")], "sale:discount")).toBe("5");
  });

  it("never lowers the caller's own ceiling", () => {
    expect(OverrideGrantsService.discountCeiling("30", [grant("sale:discount", "10")], "sale:discount")).toBe("30");
  });
});
