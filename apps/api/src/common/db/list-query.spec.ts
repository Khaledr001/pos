import { describe, expect, it } from "vitest";
import { z } from "zod";
import { containsPattern, escapeLike, sortSchema } from "./list-query.js";

describe("escapeLike", () => {
  it("escapes the ILIKE wildcards and the escape character itself", () => {
    expect(escapeLike("10%_off\\")).toBe("10\\%\\_off\\\\");
  });
});

describe("containsPattern", () => {
  it("is null for an empty or blank search", () => {
    expect(containsPattern(undefined)).toBeNull();
    expect(containsPattern("   ")).toBeNull();
  });

  it("wraps a trimmed, escaped term", () => {
    expect(containsPattern(" 50% ")).toBe("%50\\%%");
  });
});

describe("sortSchema", () => {
  const schema = z.object(sortSchema(["name", "total"], { sortBy: "name", sortOrder: "asc" }));

  it("applies the defaults", () => {
    expect(schema.parse({})).toEqual({ sortBy: "name", sortOrder: "asc" });
  });

  it("refuses a column the list does not offer", () => {
    expect(schema.safeParse({ sortBy: "passwordHash" }).success).toBe(false);
  });
});
