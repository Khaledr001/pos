/**
 * Turning a shop's informal product name into something a search engine
 * understands. Typos are fixed ONLY through the explicit dictionary below —
 * never by fuzzy guessing — so every rewrite is reviewable and a wrong one is
 * a one-line fix.
 */

/** Misspellings seen in the real price list -> the word the manufacturer would print. */
export const TYPO_DICTIONARY: Readonly<Record<string, string>> = {
  haed: "head",
  flaxible: "flexible",
  fluroresent: "fluorescent",
  eletrical: "electrical",
  bracker: "bracket",
  dimond: "diamond",
  havy: "heavy",
  stright: "straight",
  staight: "straight",
  hangle: "handle",
  custic: "caustic",
  couting: "coating",
  sensore: "sensor",
  silicon: "silicone",
  dooe: "door",
  shawer: "shower",
  swich: "switch",
  socet: "socket",
  cabel: "cable",
  wier: "wire",
};

/** Shorthand a shopkeeper writes that a search engine will not expand. */
export const ABBREVIATIONS: Readonly<Record<string, string>> = {
  ss: "stainless steel",
  mtr: "m",
  ltr: "l",
};

export interface QueryProduct {
  name: string;
  brand?: string | null;
  category?: string | null;
  subCategory?: string | null;
}

/** Lowercase, split on whitespace, fix typos, expand shorthand, drop "Placed in ..." storage notes. */
export function cleanName(raw: string): string {
  const withoutNote = raw.replace(/\bplaced in\b.*$/i, "");
  const tokens = withoutNote
    .toLowerCase()
    .replace(/["”″]/g, " inch ")
    .replace(/[(),;:]/g, " ")
    .replace(/\s[-–]\s/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TYPO_DICTIONARY[token] ?? ABBREVIATIONS[token] ?? token);
  return tokens.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Candidate queries, best first. `brand + name` is precise; the bare name is
 * the fallback for products whose brand is "others" or unknown. The finder
 * stops at the first query that yields enough usable results.
 */
export function buildQueries(product: QueryProduct): string[] {
  const name = cleanName(product.name);
  if (!name) return [];
  const brand = normaliseBrand(product.brand);
  const queries: string[] = [];

  const nameHasBrand = brand !== null && name.split(" ").includes(brand.toLowerCase());
  if (brand && !nameHasBrand) queries.push(`${brand} ${name}`);
  queries.push(name);

  // Generic one-word names ("tape") are hopeless without context.
  if (name.split(" ").length < 2 && product.subCategory) queries.push(`${name} ${product.subCategory.toLowerCase()}`);

  return [...new Set(queries.map((q) => q.trim()))];
}

const NO_BRAND = new Set(["", "others", "other", "none", "n/a", "na", "-", "no brand", "generic"]);

export function normaliseBrand(brand: string | null | undefined): string | null {
  const b = (brand ?? "").trim().toLowerCase();
  return NO_BRAND.has(b) ? null : b;
}
