import { describe, expect, it } from "vitest";
import { normalizePhone, searchKey, variantSearchKey } from "./text.js";

describe("variantSearchKey", () => {
  it("includes every translated name, so a non-English query can match", () => {
    const key = variantSearchKey({
      productName: "PVC 90° High Pressure Elbow Fitting",
      nameTranslations: { ar: "كوع بي في سي", ur: "پی وی سی کہنی" },
      variantName: "3/4 inch",
      sku: "PVC-ELB-90-34IN",
    });

    expect(key).toContain("elbow");
    expect(key).toContain("كوع");
    expect(key).toContain("کہنی");
  });

  it("canonicalises measurements, so 3/4\" and 3/4 inch land on one key", () => {
    const quoted = variantSearchKey({ productName: 'Elbow 3/4"', sku: "A" });
    const spelled = variantSearchKey({ productName: "Elbow 3/4 inch", sku: "A" });
    const abbreviated = variantSearchKey({ productName: "Elbow 3/4in", sku: "A" });

    expect(quoted).toBe(spelled);
    expect(spelled).toBe(abbreviated);
    expect(quoted).toContain("3/4in");
  });

  it("survives absent translations and an absent variant name", () => {
    // A hyphen is punctuation and becomes a space, so a SKU is findable by
    // its parts — "EL 1" matches "EL-1".
    expect(variantSearchKey({ productName: "Copper Cable", sku: "EL-1" })).toBe(
      "copper cable el 1",
    );
    expect(
      variantSearchKey({ productName: "Copper Cable", nameTranslations: null, sku: "EL-1" }),
    ).toBe("copper cable el 1");
  });

  it("agrees with what create, rename, import and seed each produce", () => {
    // The four writers must not disagree — a key built one way on create and
    // another on rename is a row that quietly stops matching what it used to.
    const args = {
      productName: "PVC Elbow",
      nameTranslations: { ar: "كوع" },
      variantName: "1 inch",
      sku: "PVC-1",
    };
    expect(variantSearchKey(args)).toBe(variantSearchKey({ ...args }));
    // And it is exactly `searchKey` over the same parts, in the same order.
    expect(variantSearchKey(args)).toBe(searchKey("PVC Elbow", "كوع", "1 inch", "PVC-1"));
  });
});

describe("normalizePhone", () => {
  /**
   * Every one of these is the same UAE mobile. Until these collapsed to one
   * value the WhatsApp bot could not recognise a customer whose number had
   * been typed in any other form — and `whatsapp_phone` is uniquely indexed,
   * so three spellings meant three rows that all satisfied the constraint.
   */
  it("collapses every written form of one UAE mobile", () => {
    for (const raw of [
      "+971501234567",
      "971501234567",
      "0501234567",
      "050 123 4567",
      "00971501234567",
      "+971 50 123 4567",
      "(050) 123-4567",
    ]) {
      expect(normalizePhone(raw)).toBe("+971501234567");
    }
  });

  it("leaves a non-UAE number on its own country code", () => {
    expect(normalizePhone("+966501123344")).toBe("+966501123344");
    expect(normalizePhone("00966501123344")).toBe("+966501123344");
  });

  it("returns null for input carrying no digits at all", () => {
    // The DTO treats this as "no phone given" rather than rejecting it, so an
    // offline terminal that has been writing "walk-in" for months still syncs.
    expect(normalizePhone("walk-in")).toBeNull();
    expect(normalizePhone("N/A")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("is idempotent — the backfill can be re-run safely", () => {
    const once = normalizePhone("050 123 4567")!;
    expect(normalizePhone(once)).toBe(once);
  });
});
