import { TYPO_DICTIONARY } from "./query.js";

/**
 * Text handling shared by the candidate scorer and the supplier-pack matcher.
 *
 * SIZES ARE HARD CONSTRAINTS. A 20mm elbow and a 25mm elbow are different
 * products with near-identical names; a similarity score alone would happily
 * attach one's photo to the other. So a number+unit token ("20mm", "1.5mm",
 * "16inch") is extracted separately and compared for equality, never fuzzily.
 */

const UNIT_ALIASES: Record<string, string> = {
  mm: "mm", millimeter: "mm", millimetre: "mm",
  cm: "cm", m: "m", mtr: "m", meter: "m", metre: "m",
  inch: "inch", inches: "inch", in: "inch", '"': "inch",
  ft: "ft", feet: "ft", foot: "ft",
  w: "w", watt: "w", kw: "kw", v: "v", volt: "v", a: "a", amp: "a", amps: "a",
  l: "l", ltr: "l", liter: "l", litre: "l", ml: "ml", kg: "kg", g: "g", gm: "g", sqmm: "sqmm", sq: "sqmm",
};

const STOP_WORDS = new Set(["the", "for", "with", "and", "of", "a", "an", "piece", "pcs", "pc", "new", "jpg", "jpeg", "png", "webp", "image", "img", "photo"]);

/** Lowercase; join "1.5 mm" / '16"' / "16 inch" into one canonical token "1.5mm" / "16inch". */
export function canonicalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_–—]+/g, " ")
    .replace(/[”″“]/g, '"')
    .replace(/(\d)\s*"/g, "$1inch ")
    .replace(/(\d+(?:\.\d+)?)\s*(millimet(?:er|re)s?|mm|cm|mtr|meters?|metres?|inches|inch|in|ft|feet|foot|watts?|kw|volts?|amps?|ltr|liters?|litres?|ml|kg|gm|sqmm|sq\.?\s*mm|w|v|a|l|m|g)\b/g, (_m, n: string, unit: string) => {
      const key = unit.replace(/\s|\./g, "");
      return `${n}${UNIT_ALIASES[key] ?? key} `;
    })
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2")
    .replace(/\s+/g, " ")
    .trim();
}

const SIZE_RE = /^(\d+(?:\.\d+)?(?:\/\d+)?)(mm|cm|m|inch|ft|w|kw|v|a|l|ml|kg|g|sqmm)$/;

export function isSizeToken(token: string): boolean {
  return SIZE_RE.test(token) || /^\d+\/\d+inch$/.test(token);
}

export function tokenize(text: string): string[] {
  return canonicalise(text)
    .split(/[^a-z0-9./]+/)
    .map((t) => t.replace(/^[./]+|[./]+$/g, ""))
    .filter(Boolean)
    .map((t) => TYPO_DICTIONARY[t] ?? t)
    .filter((t) => !STOP_WORDS.has(t) && (t.length > 1 || /\d/.test(t)));
}

/** The number+unit tokens of a text, as a sorted unique list. */
export function sizeTokens(text: string): string[] {
  return [...new Set(tokenize(text).filter(isSizeToken))].sort();
}

/** Edit distance with an early exit; only used to forgive one-character typos in longer words. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Dice coefficient over word tokens (size tokens excluded), forgiving single-character typos. */
export function tokenSetSimilarity(aTokens: string[], bTokens: string[]): number {
  const a = aTokens.filter((t) => !isSizeToken(t));
  const b = bTokens.filter((t) => !isSizeToken(t));
  if (a.length === 0 || b.length === 0) return 0;
  const remaining = [...b];
  let shared = 0;
  for (const token of a) {
    const index = remaining.findIndex((candidate) => candidate === token || withinOneEdit(candidate, token));
    if (index >= 0) {
      shared += 1;
      remaining.splice(index, 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

export type SizeVerdict = "same" | "missing-in-text" | "conflict";

/**
 * Compare the size tokens of a reference (the product) with another text.
 *  - conflict: the other text states a size the product does not have, or a
 *    different value for a unit the product also states.
 *  - missing-in-text: the product has a size the text never mentions.
 */
export function compareSizes(product: string[], other: string[]): SizeVerdict {
  const productSet = new Set(product);
  if (other.some((s) => !productSet.has(s))) return "conflict";
  if (product.some((s) => !other.includes(s))) return "missing-in-text";
  return "same";
}
