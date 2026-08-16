import { describe, expect, it } from "vitest";
import {
  PLANS,
  UNLIMITED,
  isAtLimit,
  limitFor,
  resolvePlan,
  trialStatus,
} from "./plans.js";

describe("resolvePlan", () => {
  it("resolves every known plan", () => {
    expect(resolvePlan("pro").name).toBe("Pro");
    expect(resolvePlan("enterprise").maxUsers).toBe(UNLIMITED);
  });

  /**
   * The important case. A typo, a plan withdrawn in a later release, or a
   * corrupted row must shrink the tenant's allowance — never hand out an
   * unlimited one.
   */
  it("fails closed to `free` for anything unrecognised", () => {
    for (const bad of ["", "  ", "PRO", "premium", "enterprise ", null, undefined]) {
      expect(resolvePlan(bad as string).id).toBe("free");
    }
  });
});

describe("isAtLimit", () => {
  it("blocks once the count reaches the cap", () => {
    expect(isAtLimit(1, 2)).toBe(false);
    expect(isAtLimit(2, 2)).toBe(true);
    expect(isAtLimit(3, 2)).toBe(true);
  });

  it("never blocks on UNLIMITED", () => {
    expect(isAtLimit(1_000_000, UNLIMITED)).toBe(false);
  });
});

describe("limitFor", () => {
  it("reads the right cap per resource", () => {
    expect(limitFor(PLANS.free, "branches")).toBe(1);
    expect(limitFor(PLANS.trial, "branches")).toBe(2);
    expect(limitFor(PLANS.pro, "users")).toBe(20);
    expect(limitFor(PLANS.enterprise, "products")).toBe(UNLIMITED);
  });

  it("lets a trial hold a real catalogue — otherwise it proves nothing", () => {
    // 5,000 SKUs is the stated starting catalogue. A trial that cannot import
    // it converts nobody.
    expect(limitFor(PLANS.trial, "products")).toBeGreaterThanOrEqual(5_000);
  });
});

describe("trialStatus", () => {
  const now = new Date("2026-08-16T12:00:00Z");

  it("reports days left while running", () => {
    const ends = new Date("2026-08-20T12:00:00Z");
    expect(trialStatus("trial", ends, now)).toEqual({
      onTrial: true,
      expired: false,
      daysLeft: 4,
    });
  });

  it("reports expiry once the date has passed", () => {
    const ends = new Date("2026-08-15T12:00:00Z");
    const status = trialStatus("trial", ends, now);
    expect(status.expired).toBe(true);
    expect(status.daysLeft).toBe(0);
  });

  it("treats the exact boundary as expired", () => {
    expect(trialStatus("trial", now, now).expired).toBe(true);
  });

  it("is not a trial on any paid plan", () => {
    const ends = new Date("2026-08-20T12:00:00Z");
    expect(trialStatus("pro", ends, now).onTrial).toBe(false);
    expect(trialStatus("pro", ends, now).expired).toBe(false);
  });

  it("is not a trial when no end date is set", () => {
    expect(trialStatus("trial", null, now).onTrial).toBe(false);
  });
});
