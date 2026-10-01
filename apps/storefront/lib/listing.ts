/** Query-string helpers for product listings (filters live in the URL). */

export type SearchParams = Record<string, string | string[] | undefined>;

export interface ListingQuery {
  q?: string;
  brand: string[];
  attr: Record<string, string[]>;
  minPrice?: string;
  maxPrice?: string;
  inStock: boolean;
  sort?: string;
  page: number;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const list = (v: string | string[] | undefined) => (first(v) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function parseListing(sp: SearchParams): ListingQuery {
  const attr: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(sp)) {
    const m = /^attr\[(\w+)\]$/.exec(key) ?? /^attr\.(\w+)$/.exec(key);
    if (m) attr[m[1]] = list(value);
  }
  return {
    q: first(sp.q)?.trim() || undefined,
    brand: list(sp.brand),
    attr,
    minPrice: first(sp.minPrice) || undefined,
    maxPrice: first(sp.maxPrice) || undefined,
    inStock: first(sp.inStock) === "1",
    sort: first(sp.sort) || undefined,
    page: Math.max(1, Number(first(sp.page)) || 1),
  };
}

export function toSearch(q: ListingQuery): string {
  const sp = new URLSearchParams();
  if (q.q) sp.set("q", q.q);
  if (q.brand.length) sp.set("brand", q.brand.join(","));
  for (const [code, values] of Object.entries(q.attr)) if (values.length) sp.set(`attr[${code}]`, values.join(","));
  if (q.minPrice) sp.set("minPrice", q.minPrice);
  if (q.maxPrice) sp.set("maxPrice", q.maxPrice);
  if (q.inStock) sp.set("inStock", "1");
  if (q.sort) sp.set("sort", q.sort);
  if (q.page > 1) sp.set("page", String(q.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Toggles one value of a multi-select filter and resets to page 1. */
export function toggle(q: ListingQuery, kind: "brand" | { attr: string }, value: string): ListingQuery {
  const next: ListingQuery = { ...q, brand: [...q.brand], attr: { ...q.attr }, page: 1 };
  if (kind === "brand") {
    next.brand = next.brand.includes(value) ? next.brand.filter((b) => b !== value) : [...next.brand, value];
  } else {
    const cur = next.attr[kind.attr] ?? [];
    next.attr[kind.attr] = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  }
  return next;
}

export function activeFilterCount(q: ListingQuery) {
  return q.brand.length + Object.values(q.attr).reduce((n, v) => n + v.length, 0) + (q.minPrice ? 1 : 0) + (q.maxPrice ? 1 : 0) + (q.inStock ? 1 : 0);
}

/** API query for GET /catalog/products. */
export function apiQuery(q: ListingQuery, extra: Record<string, string> = {}) {
  const sp = new URLSearchParams(extra);
  if (q.q) sp.set("q", q.q);
  if (q.brand.length) sp.set("brand", q.brand.join(","));
  for (const [code, values] of Object.entries(q.attr)) if (values.length) sp.set(`attr[${code}]`, values.join(","));
  if (q.minPrice) sp.set("minPrice", q.minPrice);
  if (q.maxPrice) sp.set("maxPrice", q.maxPrice);
  if (q.inStock) sp.set("inStock", "true");
  if (q.sort) sp.set("sort", q.sort);
  sp.set("page", String(q.page));
  sp.set("pageSize", "24");
  return `?${sp.toString()}`;
}
