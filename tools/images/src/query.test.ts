import { describe, expect, it } from "vitest";
import { buildQueries, cleanName } from "./query.js";

describe("cleanName", () => {
  it("fixes dictionary typos and drops storage notes", () => {
    expect(cleanName("modi shower haed")).toBe("modi shower head");
    expect(cleanName("rr 3C x 4sqmm flaxible cable")).toBe("rr 3c x 4sqmm flexible cable");
    expect(cleanName("Romex ss hinges 4\" Placed in top of the rack")).toBe("romex stainless steel hinges 4 inch");
  });
});

describe("buildQueries", () => {
  it("tries brand + name, then name", () => {
    expect(buildQueries({ name: "shower haed", brand: "modi" })).toEqual(["modi shower head", "shower head"]);
  });
  it("does not repeat a brand already in the name, and ignores 'others'", () => {
    expect(buildQueries({ name: "modi shower haed", brand: "modi" })).toEqual(["modi shower head"]);
    expect(buildQueries({ name: "1/2 brass nipple", brand: "others" })).toEqual(["1/2 brass nipple"]);
  });
  it("adds the sub-category for one-word names", () => {
    expect(buildQueries({ name: "tape", subCategory: "Insulation Tapes" })).toContain("tape insulation tapes");
  });
});
