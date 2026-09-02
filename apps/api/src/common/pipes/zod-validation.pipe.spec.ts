import { describe, expect, it } from "vitest";
import { zQueryBoolean } from "./zod-validation.pipe.js";

describe("zQueryBoolean", () => {
  it("parses the literal string 'false' as false", () => {
    // The bug this guards: z.coerce.boolean() runs Boolean("false"), which is
    // `true` in JavaScript — every explicit ?flag=false silently became true.
    expect(zQueryBoolean(true).parse("false")).toBe(false);
    expect(zQueryBoolean(false).parse("false")).toBe(false);
  });

  it("parses the literal string 'true' as true", () => {
    expect(zQueryBoolean(false).parse("true")).toBe(true);
  });

  it("falls back to the default when the field is absent", () => {
    expect(zQueryBoolean(true).parse(undefined)).toBe(true);
    expect(zQueryBoolean(false).parse(undefined)).toBe(false);
  });
});
