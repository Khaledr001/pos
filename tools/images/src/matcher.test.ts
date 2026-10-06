import { describe, expect, it } from "vitest";
import { matchFile, type MatchProduct } from "./matcher.js";

const p = (id: string, name: string, brand: string | null = null, sku = ""): MatchProduct => ({ id, name, brand, sku });

const catalogue: MatchProduct[] = [
  p("shower", "modi shower haed", "modi", "md-hws7009"),
  p("fan16", 'modi 16" stand fan', "modi"),
  p("fan18", 'modi 18" stand fan', "modi"),
  p("elbow20", "pvc elbow 20mm", "others"),
  p("elbow25", "pvc elbow 25mm", "others"),
  p("cable15", "rr 3C x 1.5mm flaxible cable", "rr"),
  p("cable15b", "rr 3C x 15mm flaxible cable", "rr"),
  p("panel", "roska 45w sensore panel light", "roska"),
  p("hager", "hager 16a single pole breaker", "hager"),
];

const match = (name: string, options = {}) => matchFile(name, name, catalogue, options);

describe("matchFile", () => {
  it("matches an exact SKU in the file name with high confidence", () => {
    const r = match("MD_HWS7009_front.jpg");
    expect(r).toMatchObject({ status: "matched", confidence: "high", product: { id: "shower" } });
  });

  it("forgives the shop's typo and word order", () => {
    const r = match("Modi Shower Head.jpg");
    expect(r).toMatchObject({ status: "matched", confidence: "high", product: { id: "shower" } });
    expect(match("flexible cable rr 3C x 1.5mm.png")).toMatchObject({ product: { id: "cable15" }, confidence: "high" });
  });

  it("uses the pack brand when file names omit it", () => {
    const r = match("stand_fan_16_inch.jpg", { brand: "modi" });
    expect(r).toMatchObject({ status: "matched", product: { id: "fan16" } });
  });

  it("treats 16 inch, 16in and 16\" as the same size", () => {
    for (const name of ["modi 16 inch stand fan.jpg", "modi-16in-stand-fan.jpg", 'modi 16" stand fan.jpg']) {
      expect(match(name)).toMatchObject({ status: "matched", product: { id: "fan16" } });
    }
  });

  it("never crosses sizes: 20mm is not 25mm", () => {
    expect(match("pvc elbow 20mm.jpg").product?.id).toBe("elbow20");
    expect(match("pvc elbow 25mm.jpg").product?.id).toBe("elbow25");
    expect(match("pvc elbow 32mm.jpg").status).toBe("unmatched");
  });

  it("never crosses 1.5mm and 15mm", () => {
    expect(match("rr 3C x 1.5mm flexible cable.jpg").product?.id).toBe("cable15");
    expect(match("rr 3C x 15mm flexible cable.jpg").product?.id).toBe("cable15b");
  });

  it("a file that states a size no product has is unmatched; a file without a size is capped below high", () => {
    expect(match("modi 20 inch stand fan.jpg").status).toBe("unmatched");
    const r = match("modi stand fan.jpg");
    expect(r.confidence === "high").toBe(false);
  });

  it("reports two equally good products as ambiguous, with both listed", () => {
    const r = matchFile("x", "pvc elbow.jpg", [p("a", "pvc elbow"), p("b", "pvc elbow")]);
    expect(r.status).toBe("ambiguous");
    expect(r.alternatives).toHaveLength(2);
  });

  it("leaves unrelated files unmatched", () => {
    expect(match("IMG_20240101_0001.jpg").status).toBe("unmatched");
    expect(match("company logo.png").status).toBe("unmatched");
  });

  it("matches watt sizes and brand-prefixed names", () => {
    expect(match("Roska 45W Sensor Panel Light.webp")).toMatchObject({ product: { id: "panel" }, confidence: "high" });
  });
});
