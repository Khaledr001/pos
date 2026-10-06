import { normaliseBrand } from "./query.js";
import { compareSizes, sizeTokens, tokenSetSimilarity, tokenize } from "./tokens.js";

export interface MatchProduct {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
}

export type Confidence = "high" | "medium" | "low";

export interface Alternative {
  product: MatchProduct;
  score: number;
}

export interface MatchResult {
  file: string;
  status: "matched" | "ambiguous" | "unmatched";
  confidence?: Confidence;
  product?: MatchProduct;
  score: number;
  reason: string;
  alternatives: Alternative[];
}

export interface MatchOptions {
  /** The pack is one brand's: treat the brand as part of every file name. */
  brand?: string | undefined;
}

const squash = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]/g, "");

const HIGH = 0.85;
const MEDIUM = 0.65;
const LOW = 0.45;
/** Two products this close are indistinguishable from the file name alone. */
const AMBIGUITY_MARGIN = 0.1;

/**
 * Decide which product a supplier image file belongs to.
 *
 * Only HIGH confidence is ever auto-applied. The rules that make "high"
 * trustworthy: an exact SKU in the file name, or a near-complete name match
 * with the same sizes and a clear winner. Sizes (20mm, 1.5mm, 16inch) are
 * hard constraints — a product whose size differs from the file's is not a
 * candidate at all, however similar the words are.
 */
export function matchFile(file: string, fileName: string, products: MatchProduct[], options: MatchOptions = {}): MatchResult {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");

  // 1. exact SKU
  const squashed = squash(base);
  const skuHits = products.filter((p) => squash(p.sku).length >= 4 && squashed.includes(squash(p.sku)));
  if (skuHits.length > 0) {
    const longest = Math.max(...skuHits.map((p) => squash(p.sku).length));
    const best = skuHits.filter((p) => squash(p.sku).length === longest);
    const only = best[0];
    if (best.length === 1 && only) {
      return { file, status: "matched", confidence: "high", product: only, score: 1, reason: `SKU ${only.sku} in file name`, alternatives: [] };
    }
    return {
      file, status: "ambiguous", score: 1, reason: "Several products share that SKU text",
      alternatives: best.map((product) => ({ product, score: 1 })),
    };
  }

  // 2. name similarity
  const packBrand = normaliseBrand(options.brand);
  const fileTokens = tokenize(base);
  if (packBrand && !fileTokens.includes(packBrand)) fileTokens.push(packBrand);
  const fileSizes = sizeTokens(base);

  const scored: Array<{ product: MatchProduct; score: number; sizeVerdict: "same" | "missing-in-text" }> = [];
  for (const product of products) {
    const brand = normaliseBrand(product.brand);
    if (packBrand && brand !== packBrand) continue;
    const productSizes = sizeTokens(product.name);
    const verdict = compareSizes(productSizes, fileSizes);
    if (verdict === "conflict") continue;

    const productTokens = tokenize(product.name);
    if (brand && !productTokens.includes(brand)) productTokens.push(brand);
    let score = tokenSetSimilarity(fileTokens, productTokens);
    if (brand && fileTokens.includes(brand)) score = Math.min(1, score + 0.1);
    if (verdict === "missing-in-text") score *= 0.85;
    if (score >= LOW) scored.push({ product, score, sizeVerdict: verdict });
  }
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return { file, status: "unmatched", score: 0, reason: "No product with the same words and sizes", alternatives: [] };

  const rival = scored[1];
  const alternatives = scored.slice(0, 4).map(({ product, score }) => ({ product, score }));
  if (rival && best.score - rival.score < AMBIGUITY_MARGIN) {
    return { file, status: "ambiguous", score: best.score, reason: "Two or more products fit equally well", alternatives };
  }

  let confidence: Confidence = best.score >= HIGH ? "high" : best.score >= MEDIUM ? "medium" : "low";
  if (best.sizeVerdict === "missing-in-text" && confidence === "high") confidence = "medium";
  return {
    file, status: "matched", confidence, product: best.product, score: best.score,
    reason: `Name similarity ${(best.score * 100).toFixed(0)}%`, alternatives: alternatives.slice(1),
  };
}
