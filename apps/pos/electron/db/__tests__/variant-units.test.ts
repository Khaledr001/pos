import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../sqlite.js";

/**
 * Same singleton-mocking approach as the other db tests, for the same
 * reason: `repositories.ts` reaches the database through the module-level
 * `getDatabase()` singleton.
 */
let db: Database.Database;

vi.mock("../sqlite.js", async () => {
  const actual = await vi.importActual<typeof import("../sqlite.js")>("../sqlite.js");
  return { ...actual, getDatabase: () => db };
});

const { unitsForVariant } = await import("../repositories.js");

function insertPackaging(overrides: Partial<Record<string, unknown>> = {}) {
  const row = {
    id: "vu-1",
    variant_id: "v1",
    unit_id: "unit-box",
    unit_name: "Box",
    unit_abbr: "box",
    conversion_factor: "20",
    barcode: null,
    price_override: null,
    is_sellable: 1,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO variant_units
       (id, variant_id, unit_id, unit_name, unit_abbr, conversion_factor,
        barcode, price_override, is_sellable, updated_at)
     VALUES (@id, @variant_id, @unit_id, @unit_name, @unit_abbr, @conversion_factor,
             @barcode, @price_override, @is_sellable, datetime('now'))`,
  ).run(row);
}

describe("variant_units mirror", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db);
  });

  it("returns packagings for the requested variant, ordered smallest pack first", () => {
    insertPackaging({ id: "vu-1", unit_id: "unit-box", conversion_factor: "20", unit_name: "Box" });
    insertPackaging({ id: "vu-2", unit_id: "unit-carton", conversion_factor: "100", unit_name: "Carton" });

    const units = unitsForVariant("v1");
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.unitName)).toEqual(["Box", "Carton"]);
    expect(units[0]).toMatchObject({ unitId: "unit-box", conversionFactor: "20" });
  });

  it("returns nothing for a variant with no packagings — the base unit only", () => {
    expect(unitsForVariant("never-packaged")).toEqual([]);
  });

  it("excludes a packaging the merchant retired (is_sellable = 0)", () => {
    insertPackaging({ id: "vu-1", is_sellable: 0 });
    expect(unitsForVariant("v1")).toEqual([]);
  });

  it("does not mix packagings between variants", () => {
    insertPackaging({ id: "vu-1", variant_id: "v1" });
    insertPackaging({ id: "vu-2", variant_id: "v2", unit_id: "unit-carton" });

    expect(unitsForVariant("v1")).toHaveLength(1);
    expect(unitsForVariant("v2")).toHaveLength(1);
  });
});
