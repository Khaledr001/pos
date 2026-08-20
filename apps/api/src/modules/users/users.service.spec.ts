import { ERROR_CODES } from "@devsfleet/shared-utils";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "../../common/context/request-context.js";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { UsersService } from "./users.service.js";

/**
 * Covers the PIN-collision guard only.
 *
 * Two people at one branch answering to the same PIN makes `resolvePinHolder`
 * refuse EVERY sign-in at that branch — which a seeded install used to do out
 * of the box, and which the admin panel could recreate at any time because
 * nothing checked on write. These tests pin that guard down.
 *
 * Real bcrypt, not a stub: the whole point is that the same PIN produces
 * DIFFERENT hashes, so a hash comparison can never spot the clash and only a
 * `compare` per candidate can.
 */
const BRANCH_A = "aaaaaaaa-1111-1111-1111-111111111111";
const BRANCH_B = "bbbbbbbb-2222-2222-2222-222222222222";

describe("UsersService — PIN collisions", () => {
  let service: UsersService;
  let candidates: Array<{
    id: string;
    name: string;
    branchId: string | null;
    pinHash: string | null;
  }>;
  let insertedValues: Record<string, unknown> | undefined;

  const withContext = <T>(fn: () => T): T =>
    RequestContext.run(
      {
        requestId: "test",
        startedAt: Date.now(),
        tenantId: "11111111-1111-1111-1111-111111111111",
        branchId: null,
      },
      fn,
    );

  /** Chainable stub that is also the promise it resolves to. */
  function chain(result: unknown) {
    const p = Promise.resolve(result) as Promise<unknown> & Record<string, ReturnType<typeof vi.fn>>;
    for (const m of ["select", "from", "where", "values", "set", "returning", "limit"]) {
      p[m] = vi.fn(() => p);
    }
    /**
     * A JOINED select is `assertMayManage`'s role lookup, not the PIN
     * candidate query — resolve it empty so it takes its own documented
     * "target absent is not a permission problem" early return. These tests
     * are about PIN collisions; authority checks have their own suite.
     */
    p.innerJoin = vi.fn(() => chain([]));
    return p;
  }

  beforeEach(async () => {
    candidates = [];
    insertedValues = undefined;

    const tx = {
      select: vi.fn(() => chain(candidates)),
      insert: vi.fn(() => {
        const c = chain([{ id: "new-user" }]);
        c.values = vi.fn((v: Record<string, unknown>) => {
          insertedValues = v;
          return c;
        });
        return c;
      }),
      update: vi.fn(() => chain([{ id: "u1" }])),
      query: {
        roles: { findFirst: vi.fn(async () => ({ id: "role-1", permissions: ["sale:create"] })) },
        users: { findFirst: vi.fn(async () => ({ branchId: BRANCH_A })) },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: TenantDatabase,
          useValue: {
            run: (fn: (t: unknown) => unknown) => {
              RequestContext.requireTenantId();
              return fn(tx);
            },
          },
        },
        {
          provide: PlanLimitService,
          useValue: { assertTrialActive: () => {}, assertCanCreate: async () => {} },
        },
        // Low rounds: these tests hash and compare for real, and 12 rounds
        // across several candidates is seconds of pure salt-grinding.
        { provide: ConfigService, useValue: { get: () => 4 } },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  const newUser = (pin: string | undefined, branchId: string | null) => ({
    name: "New Cashier",
    email: "new@example.com",
    password: "ChangeMe123!",
    roleId: "role-1",
    branchId,
    ...(pin ? { pin } : {}),
    locale: "en" as const,
    maxDiscountPercent: 0,
    canApproveRefund: false,
    canViewCost: false,
    allowedBranchIds: [],
  });

  it("accepts a PIN nobody else holds", async () => {
    candidates = [
      { id: "u1", name: "Someone Else", branchId: BRANCH_A, pinHash: await bcrypt.hash("9999", 4) },
    ];

    await expect(
      withContext(() => service.create(newUser("1234", BRANCH_A) as never)),
    ).resolves.toBeTruthy();
    expect(insertedValues?.pinHash).toBeTruthy();
  });

  it("refuses a PIN another user at the SAME branch already holds", async () => {
    candidates = [
      { id: "u1", name: "Aisha", branchId: BRANCH_A, pinHash: await bcrypt.hash("1234", 4) },
    ];

    await expect(
      withContext(() => service.create(newUser("1234", BRANCH_A) as never)),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it("names the colliding person, so the admin knows which PIN to change", async () => {
    candidates = [
      { id: "u1", name: "Aisha", branchId: BRANCH_A, pinHash: await bcrypt.hash("1234", 4) },
    ];

    await expect(
      withContext(() => service.create(newUser("1234", BRANCH_A) as never)),
    ).rejects.toThrow(/Aisha/);
  });

  it("allows the same PIN at a DIFFERENT branch", async () => {
    candidates = [
      { id: "u1", name: "Aisha", branchId: BRANCH_A, pinHash: await bcrypt.hash("1234", 4) },
    ];

    await expect(
      withContext(() => service.create(newUser("1234", BRANCH_B) as never)),
    ).resolves.toBeTruthy();
  });

  /**
   * The bug that broke the seeded install: the admin has no branch, so they
   * are a candidate everywhere. Their PIN cannot be reused at ANY branch.
   */
  it("refuses a branch user's PIN that a TENANT-WIDE user already holds", async () => {
    candidates = [
      { id: "owner", name: "The Owner", branchId: null, pinHash: await bcrypt.hash("1234", 4) },
    ];

    await expect(
      withContext(() => service.create(newUser("1234", BRANCH_B) as never)),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it("refuses a TENANT-WIDE user taking a PIN any single branch already uses", async () => {
    candidates = [
      { id: "u1", name: "Aisha", branchId: BRANCH_A, pinHash: await bcrypt.hash("1234", 4) },
    ];

    await expect(
      withContext(() => service.create(newUser("1234", null) as never)),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it("ignores users with no PIN, and deactivated ones are never candidates", async () => {
    // A null pinHash must not throw when compared against.
    candidates = [{ id: "u1", name: "No PIN", branchId: BRANCH_A, pinHash: null }];

    await expect(
      withContext(() => service.create(newUser("1234", BRANCH_A) as never)),
    ).resolves.toBeTruthy();
  });

  it("skips the check entirely when no PIN is being set", async () => {
    candidates = [
      { id: "u1", name: "Aisha", branchId: BRANCH_A, pinHash: await bcrypt.hash("1234", 4) },
    ];

    await expect(
      withContext(() => service.create(newUser(undefined, BRANCH_A) as never)),
    ).resolves.toBeTruthy();
    expect(insertedValues?.pinHash).toBeNull();
  });

  describe("setPin", () => {
    it("refuses a PIN somebody else at that user's branch holds", async () => {
      candidates = [
        { id: "u1", name: "Aisha", branchId: BRANCH_A, pinHash: await bcrypt.hash("1234", 4) },
      ];

      await expect(
        withContext(() => service.setPin("u2", { pin: "1234" } as never)),
      ).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    });

    it("lets a user keep their own PIN — that is not a collision with themselves", async () => {
      candidates = [
        { id: "u1", name: "Aisha", branchId: BRANCH_A, pinHash: await bcrypt.hash("1234", 4) },
      ];

      await expect(
        withContext(() => service.setPin("u1", { pin: "1234" } as never)),
      ).resolves.toBeUndefined();
    });
  });
});
