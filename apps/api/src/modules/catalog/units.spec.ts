import { describe, expect, it } from "vitest";
import { CreateUnitSchema, UpdateUnitSchema } from "./dto.js";
import { COMMON_UNITS, DEFAULT_UNIT_CODE, UNIT_CODE_PRESETS } from "@devsfleet/shared-types";
import { ABBREVIATION_UNIT_CODES, inferUnitCode } from "./lookups.service.js";

describe("inferUnitCode", () => {
  it.each([
    ["m", "MTR"],
    ["Metre", "MTR"],
    ["kg", "KGM"],
    ["ltr", "LTR"],
    ["box", "XBX"],
    ["pack", "XPK"],
    ["roll", "XRO"],
    ["pair", "PR"],
    ["set", "SET"],
    ["sqm", "MTK"],
    ["pcs", "C62"],
    ["bag", "C62"],
    ["unheard-of", "C62"],
  ])("%s → %s", (abbr, code) => expect(inferUnitCode(abbr)).toBe(code));
});

describe("unit DTOs", () => {
  it("accepts a UN/ECE code, upper-casing it, and leaves it absent when omitted", () => {
    expect(CreateUnitSchema.parse({ name: "Metre", abbreviation: "m", unitCode: "mtr" }).unitCode).toBe("MTR");
    expect(CreateUnitSchema.parse({ name: "Metre", abbreviation: "m" }).unitCode).toBeUndefined();
  });

  it("refuses a malformed code", () => {
    expect(() => CreateUnitSchema.parse({ name: "x", abbreviation: "x", unitCode: "TOOLONG" })).toThrow();
    expect(() => CreateUnitSchema.parse({ name: "x", abbreviation: "x", unitCode: "a" })).toThrow();
  });

  it("an update names only what changes", () => {
    expect(UpdateUnitSchema.parse({ unitCode: "kgm" })).toEqual({ unitCode: "KGM" });
    expect(UpdateUnitSchema.parse({})).toEqual({});
  });
});

describe("every unit code the platform can assign", () => {
  const presets = new Set<string>(UNIT_CODE_PRESETS.map((p) => p.code));
  const valid = (code: string) => presets.has(code) || /^[A-Z0-9]{3}$/.test(code);

  it("is in the presets or is a 3-character upper-case code — never a bare Rec 20 packaging code", () => {
    const assignable = new Set<string>([
      DEFAULT_UNIT_CODE,
      ...Object.values(ABBREVIATION_UNIT_CODES),
      ...COMMON_UNITS.map((u) => u.unitCode),
    ]);
    for (const code of assignable) expect(valid(code), `${code} is not a valid unit code`).toBe(true);
    // The official PINT AE validation rejects these bare Rec 20 packaging codes.
    for (const bad of ["BX", "PK", "ROL"]) expect(assignable.has(bad)).toBe(false);
  });

  it("the codes a new tenant's units start with are the ones inference would pick for their names", () => {
    for (const u of COMMON_UNITS) {
      if (inferUnitCode(u.abbreviation) !== DEFAULT_UNIT_CODE) expect(u.unitCode).toBe(inferUnitCode(u.abbreviation));
    }
  });

  it("the starter units cover box, roll and metre with valid codes", () => {
    const by = Object.fromEntries(COMMON_UNITS.map((u) => [u.abbreviation, u.unitCode]));
    expect(by).toMatchObject({ box: "XBX", roll: "XRO", m: "MTR", kg: "KGM", ltr: "LTR", pcs: "C62" });
  });
});
