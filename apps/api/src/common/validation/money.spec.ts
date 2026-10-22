import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZERO_MONEY, zMoney } from "./money.js";

describe("zMoney", () => {
  const schema = zMoney();

  it("returns a canonical four-place string", () => {
    expect(schema.parse("12.5")).toBe("12.5000");
    expect(schema.parse(" 3 ")).toBe("3.0000");
    expect(schema.parse(".25")).toBe("0.2500");
  });

  it("reads numbers through their shortest decimal form, not their float bits", () => {
    expect(schema.parse(0.1)).toBe("0.1000");
    expect(schema.parse(0.30000000000000004)).toBe("0.3000");
    expect(schema.parse(1e-7)).toBe("0.0000");
  });

  it("refuses more than four decimal places in a string", () => {
    expect(schema.safeParse("1.23456").success).toBe(false);
  });

  it("refuses anything that is not a plain decimal", () => {
    for (const bad of ["abc", "", "1,000", "1e3", "12.5.0", "NaN"]) {
      expect(schema.safeParse(bad).success, bad).toBe(false);
    }
    expect(schema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it("refuses negatives unless allowed", () => {
    expect(schema.safeParse("-1").success).toBe(false);
    expect(zMoney({ allowNegative: true }).parse("-1")).toBe("-1.0000");
  });

  it("positive refuses zero, with the caller's message", () => {
    const result = zMoney({ positive: "A price is required" }).safeParse("0");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("A price is required");
    expect(schema.parse("0")).toBe(ZERO_MONEY);
  });

  it("composes with optional, nullable and default", () => {
    const obj = z.object({
      a: zMoney().optional(),
      b: zMoney().nullable().optional(),
      c: zMoney().default(ZERO_MONEY),
    });
    expect(obj.parse({})).toEqual({ c: ZERO_MONEY });
    expect(obj.parse({ a: "1", b: null, c: "2" })).toEqual({ a: "1.0000", b: null, c: "2.0000" });
  });
});
