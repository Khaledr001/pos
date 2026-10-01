import { describe, expect, it } from "vitest";
import { describeRows, findDuplicateNames, placeSubCategory, productNameKey } from "./bulk-import.service.js";

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
    expect([...found.values()][0]!.map((r) => r.rowNumber)).toEqual([2, 4, 9]);
  });

  it("catches duplicates that differ only in case or spacing", () => {
    const found = findDuplicateNames([row(2, "Ball Valve 1in"), row(5, "  ball valve 1in ")]);
    expect([...found.values()][0]!.map((r) => r.rowNumber)).toEqual([2, 5]);
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

describe("placeSubCategory", () => {
  const parent = { id: "fasteners", depth: 0 };

  it("creates a sub-category the tenant does not have yet", () => {
    expect(placeSubCategory(null, parent)).toBe("create");
  });

  it("leaves one already filed under that parent alone", () => {
    expect(placeSubCategory({ id: "screw", parentId: "fasteners", isParent: false }, parent)).toBe("keep");
  });

  it("treats a sub-category named like its parent as the parent", () => {
    expect(placeSubCategory({ id: "fasteners", parentId: null, isParent: true }, parent)).toBe("keep");
  });

  it("moves a flat, childless category under the parent the sheet names", () => {
    expect(placeSubCategory({ id: "screw", parentId: null, isParent: false }, parent)).toBe("regroup");
  });

  it("never moves a category the tree already places under another parent", () => {
    expect(placeSubCategory({ id: "hook", parentId: "bathroom", isParent: false }, parent)).toBe("conflict");
  });

  it("never moves a category that has sub-categories of its own", () => {
    expect(placeSubCategory({ id: "lighting", parentId: null, isParent: true }, parent)).toBe("conflict");
  });

  it("refuses to nest past the tree's depth limit", () => {
    expect(placeSubCategory(null, { id: "deep", depth: 4 })).toBe("too-deep");
    expect(placeSubCategory({ id: "x", parentId: null, isParent: false }, { id: "deep", depth: 4 })).toBe("too-deep");
  });
});

describe("describeRows", () => {
  it("reads as plain row numbers in a single-sheet file", () => {
    expect(describeRows([{ sheet: null, rowNumber: 4 }, { sheet: null, rowNumber: 9 }])).toBe("rows 4, 9");
  });

  /** Row 4 means nothing in a workbook where every sheet has a row 4. */
  it("names the sheet of every row when the file has several", () => {
    expect(
      describeRows([
        { sheet: "Hardware", rowNumber: 4 },
        { sheet: "Hardware", rowNumber: 9 },
        { sheet: "Electric", rowNumber: 12 },
      ]),
    ).toBe("Hardware rows 4, 9 and Electric row 12");
  });
});
