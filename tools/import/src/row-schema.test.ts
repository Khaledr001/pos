import { describe, expect, it } from "vitest";
import { findDuplicateSkus, normalizeHeader, parseRow } from "./row-schema.js";

const HEADERS = ["SKU", "Name", "Category", "Unit", "Barcode", "Selling Price", "Purchase Price"];

function row(values: Record<string, unknown>): unknown[] {
  return HEADERS.map((h) => values[h] ?? "");
}

describe("normalizeHeader", () => {
  it("matches equivalent headers regardless of case, spacing or punctuation", () => {
    expect(normalizeHeader("Selling Price")).toBe(normalizeHeader("selling_price"));
    expect(normalizeHeader("SELLINGPRICE")).toBe(normalizeHeader("Selling Price"));
  });
});

describe("parseRow", () => {
  it("parses a well-formed row", () => {
    const result = parseRow(
      HEADERS,
      row({
        SKU: "PVC-ELB-1IN",
        Name: "PVC Elbow 1 inch",
        Category: "Plumbing",
        Unit: "pcs",
        Barcode: "6291000000017",
        "Selling Price": "2.75",
        "Purchase Price": "1.50",
      }),
      2,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row).toMatchObject({
      sku: "PVC-ELB-1IN",
      name: "PVC Elbow 1 inch",
      categoryName: "Plumbing",
      unitAbbr: "pcs",
      barcode: "6291000000017",
      sellingPrice: 2.75,
      purchasePrice: 1.5,
    });
  });

  it("rejects a row with no sku", () => {
    const result = parseRow(HEADERS, row({ Name: "No SKU", Unit: "pcs", "Selling Price": "1" }), 3);
    expect(result).toEqual({ ok: false, rowNumber: 3, reason: "Missing sku" });
  });

  it("rejects a row with no sellingPrice", () => {
    const result = parseRow(HEADERS, row({ SKU: "X1", Name: "Widget", Unit: "pcs" }), 4);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("sellingPrice");
  });

  it("rejects a zero or negative sellingPrice", () => {
    const result = parseRow(
      HEADERS,
      row({ SKU: "X1", Name: "Widget", Unit: "pcs", "Selling Price": "0" }),
      5,
    );
    expect(result.ok).toBe(false);
  });

  it("defaults purchasePrice to 0 when omitted", () => {
    const result = parseRow(
      HEADERS,
      row({ SKU: "X1", Name: "Widget", Unit: "pcs", "Selling Price": "10" }),
      6,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.purchasePrice).toBe(0);
  });

  it("puts an unrecognised column into attributes, keyed by its original header", () => {
    const headers = [...HEADERS, "Thread Size"];
    const result = parseRow(
      headers,
      [...row({ SKU: "X1", Name: "Widget", Unit: "pcs", "Selling Price": "10" }), "1/2 BSP"],
      7,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.attributes).toEqual({ "Thread Size": "1/2 BSP" });
  });

  it("normalizes a barcode via normalizeBarcode", () => {
    // UPC-A (12 digits) widens to EAN-13 with a leading zero.
    const result = parseRow(
      HEADERS,
      row({ SKU: "X1", Name: "Widget", Unit: "pcs", "Selling Price": "10", Barcode: "123456789012" }),
      8,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.barcode).toBe("0123456789012");
  });
});

describe("findDuplicateSkus", () => {
  it("finds a SKU repeated across rows", () => {
    const rows = [
      { rowNumber: 2, sku: "A" },
      { rowNumber: 3, sku: "B" },
      { rowNumber: 4, sku: "A" },
    ] as never[];

    const duplicates = findDuplicateSkus(rows);
    expect(duplicates.get("A")).toEqual([2, 4]);
    expect(duplicates.has("B")).toBe(false);
  });

  it("returns an empty map when every SKU is unique", () => {
    const rows = [{ rowNumber: 2, sku: "A" }, { rowNumber: 3, sku: "B" }] as never[];
    expect(findDuplicateSkus(rows).size).toBe(0);
  });
});
