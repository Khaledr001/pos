import { normaliseBrand, cleanName } from "./query.js";
import type { ImageHit } from "./providers/types.js";
import { compareSizes, sizeTokens, tokenSetSimilarity, tokenize } from "./tokens.js";

export interface ScoredHit extends ImageHit {
  score: number;
  sourceDomain: string;
  query: string;
}

const MIN_DIMENSION = 400;

/** Marketplaces and shops that photograph the actual product. */
const TRUSTED_RETAILERS = [
  "amazon.ae", "amazon.com", "noon.com", "sharafdg.com", "ubuy", "homedepot.com", "lowes.com", "screwfix.com",
  "toolstation.com", "rs-online.com", "ae.rs-online.com", "farnell.com", "acehardware.com", "ikea.com", "wickes.co.uk",
  "bunnings.com.au", "castorama", "leroymerlin", "hager.com", "legrand.com", "schneider-electric.com", "philips.com",
  "dewalt.com", "stanleytools.com", "bosch", "makita", "hilti",
];
const WEAK_BUT_REAL = ["alibaba.com", "aliexpress.com", "made-in-china.com", "ebay.com", "ebay.ae", "indiamart.com"];
const WATERMARKED_STOCK = [
  "shutterstock", "istockphoto", "alamy", "dreamstime", "depositphotos", "123rf", "gettyimages", "adobestock",
  "vecteezy", "freepik", "stock.adobe", "pngtree", "pngwing", "clipartmax", "vectorstock",
];
const SOCIAL = ["pinterest", "facebook", "instagram", "twitter.com", "x.com", "tiktok", "youtube", "reddit", "tumblr", "flickr", "wordpress.com", "blogspot"];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const hostMatches = (host: string, list: string[]): boolean => list.some((d) => host === d || host.endsWith(`.${d}`) || host.includes(d));

export interface ScoreProduct {
  name: string;
  brand?: string | null;
}

/** 0-100 estimate that this hit shows this product. It only ORDERS the review list; a human decides. */
export function scoreHit(hit: ImageHit, product: ScoreProduct, query: string): ScoredHit | null {
  // Only https image URLs can ever be approved, and tiny images are unusable on a product page.
  if (!hit.imageUrl.startsWith("https://")) return null;
  if (hit.width && hit.height && Math.min(hit.width, hit.height) < MIN_DIMENSION) return null;

  const host = domainOf(hit.pageUrl) || domainOf(hit.imageUrl);
  const brand = normaliseBrand(product.brand);
  let score = 20;

  if (brand && brand.length >= 4 && host.replace(/[^a-z0-9]/g, "").includes(brand.replace(/[^a-z0-9]/g, ""))) score += 25;
  else if (hostMatches(host, TRUSTED_RETAILERS)) score += 12;
  else if (hostMatches(host, WEAK_BUT_REAL)) score += 4;
  if (hostMatches(host, WATERMARKED_STOCK)) score -= 35;
  if (hostMatches(host, SOCIAL)) score -= 30;

  if (hit.width && hit.height) {
    const small = Math.min(hit.width, hit.height);
    score += small >= 800 ? 20 : 15;
    const ratio = small / Math.max(hit.width, hit.height);
    score += ratio >= 0.8 ? 10 : ratio >= 0.6 ? 5 : ratio < 0.4 ? -10 : 0;
  } else {
    score -= 3; // unknown size: usable, but unproven
  }

  const productTokens = tokenize(cleanName(product.name));
  const text = `${hit.title ?? ""} ${hit.pageUrl}`;
  const titleTokens = tokenize(text);
  score += Math.round(tokenSetSimilarity(productTokens, titleTokens) * 30);
  if (brand && titleTokens.includes(brand)) score += 10;

  const verdict = compareSizes(sizeTokens(product.name), sizeTokens(hit.title ?? ""));
  if (verdict === "conflict") score -= 15;
  if (verdict === "same" && sizeTokens(product.name).length > 0) score += 5;

  return { ...hit, score: Math.max(0, Math.min(100, score)), sourceDomain: host, query };
}

/** Best `limit` distinct images, at most two per source domain so one site cannot crowd out the rest. */
export function pickTop(hits: ScoredHit[], limit = 5): ScoredHit[] {
  const seen = new Set<string>();
  const perDomain = new Map<string, number>();
  const picked: ScoredHit[] = [];
  for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
    if (seen.has(hit.imageUrl)) continue;
    const used = perDomain.get(hit.sourceDomain) ?? 0;
    if (used >= 2) continue;
    seen.add(hit.imageUrl);
    perDomain.set(hit.sourceDomain, used + 1);
    picked.push(hit);
    if (picked.length === limit) break;
  }
  return picked;
}
