import { ERROR_CODES } from "@devsfleet/shared-utils";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { AuthService } from "../auth/auth.service.js";
import { ChangePlanSchema } from "./dto.js";
import { PlatformService } from "./platform.service.js";

/**
 * The platform module had no tests at all, which is the wrong place for a
 * coverage gap: these are the operations that cross tenant boundaries.
 *
 * Focused on the invariants that are easy to break silently — impersonation
 * accountability, and the plan/health paths where the previous behaviour
 * looked right and was not.
 */
const OPERATOR_ID = "0a0a0a0a-1111-4111-8111-111111111111";
const TENANT_ID = "0b0b0b0b-2222-4222-8222-222222222222";
const TARGET_ADMIN_ID = "0c0c0c0c-3333-4333-8333-333333333333";

describe("PlatformService", () => {
  let service: PlatformService;
  let tx: Record<string, ReturnType<typeof vi.fn>>;
  let auditRows: Array<Record<string, unknown>>;
  let issueSessionFor: ReturnType<typeof vi.fn>;
  let dbUp: boolean;

  const asOperator = <T>(fn: () => T): T =>
    RequestContext.run(
      {
        requestId: "test",
        startedAt: Date.now(),
        ipAddress: "203.0.113.9",
        user: {
          id: OPERATOR_ID,
          tenantId: null,
          branchId: null,
          roleId: "r",
          roleName: "admin",
          permissions: ["*"],
          abac: {
            maxDiscountPercent: "100",
            maxSaleAmount: null,
            canApproveRefund: true,
            canViewCost: true,
            allowedBranchIds: [],
          },
          isPlatformAdmin: true,
          planId: "enterprise",
          trialEndsAt: null,
        },
      },
      fn,
    );

  /** A session already impersonating `TARGET_ADMIN_ID` on behalf of the operator. */
  const asImpersonated = <T>(fn: () => T, impersonatedBy = OPERATOR_ID): T =>
    RequestContext.run(
      {
        requestId: "test",
        startedAt: Date.now(),
        tenantId: TENANT_ID,
        user: {
          id: TARGET_ADMIN_ID,
          tenantId: TENANT_ID,
          branchId: null,
          roleId: "r",
          roleName: "admin",
          permissions: ["*"],
          abac: {
            maxDiscountPercent: "100",
            maxSaleAmount: null,
            canApproveRefund: true,
            canViewCost: true,
            allowedBranchIds: [],
          },
          isPlatformAdmin: false,
          planId: "pro",
          trialEndsAt: null,
          ...(impersonatedBy ? { impersonatedBy } : {}),
        },
      },
      fn,
    );

  beforeEach(async () => {
    auditRows = [];
    dbUp = true;
    issueSessionFor = vi.fn(async () => ({ accessToken: "a", expiresIn: 900, user: {} }));

    const selectChain = (rows: unknown[]) => {
      const c: Record<string, unknown> = {};
      for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "offset", "groupBy"]) {
        c[m] = vi.fn(() => c);
      }
      // Awaited directly by the service.
      (c as { then: unknown }).then = (res: (v: unknown) => unknown) => res(rows);
      return c;
    };

    tx = {
      select: vi.fn(() => selectChain([{ user: { id: TARGET_ADMIN_ID } }])),
      insert: vi.fn(() => ({
        values: vi.fn((v: Record<string, unknown>) => {
          auditRows.push(v);
          return Promise.resolve();
        }),
      })),
      execute: vi.fn(async () => {
        if (!dbUp) throw new Error("connection refused");
      }),
      query: {
        tenants: { findFirst: vi.fn(async () => ({ id: TENANT_ID, isActive: true })) },
        users: {
          findFirst: vi.fn(async () => ({
            id: OPERATOR_ID,
            tenantId: TENANT_ID,
            isActive: true,
            isPlatformAdmin: true,
          })),
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformService,
        {
          provide: TenantDatabase,
          useValue: {
            /**
             * Faithful to the real thing: opening the transaction is itself
             * what fails when the database is unreachable. A mock that only
             * throws from `tx.execute()` would let the old `systemHealth` —
             * which ran a SECOND query after catching the first failure —
             * pass a test it should not.
             */
            runAsPlatformAdmin: (fn: (t: unknown) => unknown) => {
              if (!dbUp) return Promise.reject(new Error("connection refused"));
              return fn(tx);
            },
          },
        },
        { provide: AuthService, useValue: { issueSessionFor } },
        { provide: ConfigService, useValue: { get: () => "test" } },
      ],
    }).compile();

    service = moduleRef.get(PlatformService);
  });

  describe("impersonate", () => {
    const dto = { reason: "Ticket #4821" };

    it("stamps the operator into the token and suppresses the refresh token", async () => {
      await asOperator(() => service.impersonate(TENANT_ID, dto));

      expect(issueSessionFor).toHaveBeenCalledWith(TARGET_ADMIN_ID, TENANT_ID, {
        impersonatedBy: OPERATOR_ID,
      });
    });

    it("writes the audit row BEFORE any token is minted", async () => {
      const order: string[] = [];
      tx.insert.mockImplementation(() => ({
        values: vi.fn((v: Record<string, unknown>) => {
          order.push("audit");
          auditRows.push(v);
          return Promise.resolve();
        }),
      }));
      issueSessionFor.mockImplementation(async () => {
        order.push("token");
        return { accessToken: "a", expiresIn: 900, user: {} };
      });

      await asOperator(() => service.impersonate(TENANT_ID, dto));

      expect(order).toEqual(["audit", "token"]);
    });

    it("records the operator, their IP, and the stated reason", async () => {
      await asOperator(() => service.impersonate(TENANT_ID, dto));

      expect(auditRows[0]).toMatchObject({
        action: "impersonate",
        impersonatedBy: OPERATOR_ID,
        ipAddress: "203.0.113.9",
      });
      expect(auditRows[0]!["reason"]).toContain("Ticket #4821");
    });

    it("refuses a suspended tenant", async () => {
      tx.query.tenants.findFirst = vi.fn(async () => ({ id: TENANT_ID, isActive: false }));

      await expect(asOperator(() => service.impersonate(TENANT_ID, dto))).rejects.toMatchObject({
        code: ERROR_CODES.TENANT_SUSPENDED,
      });
      expect(issueSessionFor).not.toHaveBeenCalled();
    });
  });

  describe("endImpersonation", () => {
    it("refuses a session that is not an impersonation", async () => {
      await expect(asOperator(() => service.endImpersonation())).rejects.toMatchObject({
        code: ERROR_CODES.INSUFFICIENT_PERMISSIONS,
      });
    });

    it("writes a closing row so session duration is auditable", async () => {
      await asImpersonated(() => service.endImpersonation());

      expect(auditRows[0]).toMatchObject({
        action: "impersonate_end",
        impersonatedBy: OPERATOR_ID,
      });
    });

    it("returns the operator to their own session", async () => {
      await asImpersonated(() => service.endImpersonation());

      // No impersonation option: this is an ordinary, renewable session again.
      expect(issueSessionFor).toHaveBeenCalledWith(OPERATOR_ID, TENANT_ID);
    });

    it("refuses to restore an operator who was demoted mid-session", async () => {
      tx.query.users.findFirst = vi.fn(async () => ({
        id: OPERATOR_ID,
        tenantId: TENANT_ID,
        isActive: true,
        isPlatformAdmin: false,
      }));

      await expect(asImpersonated(() => service.endImpersonation())).rejects.toMatchObject({
        code: ERROR_CODES.INSUFFICIENT_PERMISSIONS,
      });
      expect(issueSessionFor).not.toHaveBeenCalled();
    });
  });

  describe("systemHealth", () => {
    it("reports degraded instead of throwing when the database is down", async () => {
      dbUp = false;

      const health = await asOperator(() => service.systemHealth());

      expect(health.status).toBe("degraded");
      expect(health.database.connected).toBe(false);
    });

    it("reports healthy when the database answers", async () => {
      const health = await asOperator(() => service.systemHealth());
      expect(health.status).toBe("healthy");
    });
  });
});

/**
 * Schema-level, so it holds regardless of which caller reaches the service.
 */
describe("ChangePlanSchema", () => {
  it("refuses a paid plan with no subscription end date", () => {
    const result = ChangePlanSchema.safeParse({ planId: "pro" });
    expect(result.success).toBe(false);
  });

  it("accepts a paid plan that carries one", () => {
    const result = ChangePlanSchema.safeParse({
      planId: "pro",
      subscriptionEndsAt: "2027-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a free plan without one — there is nothing to expire", () => {
    expect(ChangePlanSchema.safeParse({ planId: "free" }).success).toBe(true);
    expect(ChangePlanSchema.safeParse({ planId: "trial" }).success).toBe(true);
  });
});
