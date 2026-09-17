import { describe, expect, it } from "vitest";
import { findDuplicateNames, productNameKey } from "./bulk-import.service.js";

/**
 * The name-duplicate rule.
 *
 * A supplier price list arrives with the same part typed three different
 * ways, and every one of them creates a separate product unless the importer
 * folds them together first. What exactly counts as "the same name" is the
 * whole rule, so it is pinned here rather than left to whoever next edits
 * the regex.
 */

describe("productNameKey", () => {
  it("ignores case", () => {
    expect(productNameKey("PVC Elbow")).toBe(productNameKey("pvc elbow"));
  });

  it("ignores leading, trailing and repeated spacing", () => {
    expect(productNameKey("  PVC   Elbow  ")).toBe(productNameKey("PVC Elbow"));
  });

  it("folds tabs and newlines the same way as spaces", () => {
    expect(productNameKey("PVC\tElbow")).toBe(productNameKey("PVC Elbow"));
  });

  /**
   * The line the rule deliberately does not cross. These read as the same
   * part to a human, but the importer cannot prove it — `2.5 inch` could be
   * a different listing with a different price, and silently merging two
   * priced rows is worse than importing both and letting someone look.
   */
  it("does not equate different spellings of a measurement", () => {
    expect(productNameKey('Nipple Socket 2.5"')).not.toBe(productNameKey("Nipple Socket 2.5 inch"));
  });

  it("does not equate names differing by punctuation", () => {
    expect(productNameKey("Elbow, 90deg")).not.toBe(productNameKey("Elbow 90deg"));
  });
});

describe("findDuplicateNames", () => {
  const row = (rowNumber: number, name: string) => ({ rowNumber, name });

  it("reports nothing when every name is distinct", () => {
    const found = findDuplicateNames([row(2, "PVC Elbow"), row(3, "Copper Pipe")]);
    expect(found.size).toBe(0);
  });

  /**
   * Every row is named, not just the repeats — the file has to be fixed in
   * one pass, and "row 7 is a duplicate" does not say of what.
   */
  it("names every row a repeated name appears on", () => {
    const found = findDuplicateNames([
      row(2, "PVC Elbow"),
      row(3, "Copper Pipe"),
      row(4, "pvc  ELBOW"),
      row(9, "PVC Elbow"),
    ]);

    expect(found.size).toBe(1);
    expect([...found.values()][0]).toEqual([2, 4, 9]);
  });

  it("catches duplicates that differ only in case or spacing", () => {
    const found = findDuplicateNames([row(2, "Ball Valve 1in"), row(5, "  ball valve 1in ")]);
    expect([...found.values()][0]).toEqual([2, 5]);
  });

  /**
   * A row with no usable name is the parser's problem, not this rule's —
   * `parseRow` already rejects it with "Missing name". Counting several of
   * them as duplicates of each other would bury that clearer message.
   */
  it("ignores blank and whitespace-only names", () => {
    const found = findDuplicateNames([row(2, ""), row(3, "   "), row(4, "\t")]);
    expect(found.size).toBe(0);
  });
});
